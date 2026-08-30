import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/route-context/route";

const ROUTE_ENDPOINT = "http://localhost/api/route-context";
const UPSTREAM_ENDPOINT =
  "https://routes.googleapis.com/directions/v2:computeRoutes";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function routeRequest(signal?: AbortSignal): Request {
  return new Request(ROUTE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ corridorId: "rosebank-sandton" }),
    signal,
  });
}

describe("Routes API server boundary", () => {
  it("rejects caller-provided route scope", async () => {
    const response = await POST(
      new Request(ROUTE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          corridorId: "arbitrary-route",
          origin: { latitude: 0, longitude: 0 },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "INVALID_INPUT",
      message: "Unsupported route-context request.",
    });
  });

  it("returns authored fallback without geometry when the server key is absent", async () => {
    vi.stubEnv("GOOGLE_ROUTES_API_KEY", "");
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(routeRequest());

    expect(upstreamFetch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      source: "AUTHORED_FALLBACK",
      corridorId: "rosebank-sandton",
      distanceMeters: 7800,
      durationSeconds: 1020,
      staticDurationSeconds: 1020,
      delaySeconds: 0,
      capturedForSession: true,
      reasonCode: "NO_SERVER_KEY",
    });
  });

  it("sends the exact bounded request and returns normalized Google geometry", async () => {
    const configuredCredential = "configured-for-contract-test";
    vi.stubEnv("GOOGLE_ROUTES_API_KEY", configuredCredential);
    const upstreamFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          routes: [
            {
              distanceMeters: 7600,
              duration: "1180s",
              staticDuration: "1020s",
              polyline: { encodedPolyline: "abc123" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(routeRequest());

    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [url, options] = upstreamFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(UPSTREAM_ENDPOINT);
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({
      "content-type": "application/json",
      "x-goog-api-key": configuredCredential,
      "x-goog-fieldmask":
        "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline",
    });
    expect(JSON.parse(String(options.body))).toEqual({
      origin: {
        location: {
          latLng: { latitude: -26.1458, longitude: 28.0419 },
        },
      },
      destination: {
        location: {
          latLng: { latitude: -26.1076, longitude: 28.0567 },
        },
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      computeAlternativeRoutes: false,
      units: "METRIC",
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      source: "GOOGLE",
      corridorId: "rosebank-sandton",
      distanceMeters: 7600,
      durationSeconds: 1180,
      staticDurationSeconds: 1020,
      delaySeconds: 160,
      encodedPolyline: "abc123",
      capturedForSession: true,
    });
    expect(JSON.stringify(responseBody)).not.toContain(configuredCredential);
  });

  it("converts malformed Google success into the bounded fallback", async () => {
    vi.stubEnv("GOOGLE_ROUTES_API_KEY", "configured-for-contract-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                distanceMeters: 7600,
                duration: "1180s",
                staticDuration: "1020s",
                polyline: { encodedPolyline: "" },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const response = await POST(routeRequest());

    expect(await response.json()).toEqual({
      source: "AUTHORED_FALLBACK",
      corridorId: "rosebank-sandton",
      distanceMeters: 7800,
      durationSeconds: 1020,
      staticDurationSeconds: 1020,
      delaySeconds: 0,
      capturedForSession: true,
      reasonCode: "ROUTES_UNAVAILABLE",
    });
  });

  it("does not leak an upstream non-OK body", async () => {
    vi.stubEnv("GOOGLE_ROUTES_API_KEY", "configured-for-contract-test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("unrestricted upstream provider text", { status: 503 }),
      ),
    );

    const response = await POST(routeRequest());
    const body = await response.json();

    expect(body).toMatchObject({
      source: "AUTHORED_FALLBACK",
      reasonCode: "ROUTES_UNAVAILABLE",
    });
    expect(JSON.stringify(body)).not.toContain("upstream provider text");
    expect(body).not.toHaveProperty("encodedPolyline");
  });

  it("propagates request cancellation to the upstream call and falls back safely", async () => {
    vi.stubEnv("GOOGLE_ROUTES_API_KEY", "configured-for-contract-test");
    let upstreamSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        upstreamSignal = options.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          if (upstreamSignal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          upstreamSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    );
    const controller = new AbortController();
    const pending = POST(routeRequest(controller.signal));

    controller.abort();
    const response = await pending;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(await response.json()).toMatchObject({
      source: "AUTHORED_FALLBACK",
      reasonCode: "ROUTES_UNAVAILABLE",
    });
  });
});
