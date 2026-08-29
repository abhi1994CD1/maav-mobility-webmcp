import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.strictObject({
  corridorId: z.literal("rosebank-sandton"),
});

const fallback = (reasonCode: "NO_SERVER_KEY" | "ROUTES_UNAVAILABLE") =>
  NextResponse.json({
    source: "AUTHORED_FALLBACK" as const,
    corridorId: "rosebank-sandton" as const,
    distanceMeters: 7800,
    durationSeconds: 1020,
    delaySeconds: 0,
    capturedForSession: true,
    reasonCode,
  });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_INPUT", message: "Unsupported route-context request." },
      { status: 400 },
    );
  }

  const serverKey = process.env.GOOGLE_ROUTES_API_KEY;
  if (!serverKey) return fallback("NO_SERVER_KEY");

  try {
    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": serverKey,
          "x-goog-fieldmask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify({
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
        }),
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!response.ok) return fallback("ROUTES_UNAVAILABLE");

    const payload: unknown = await response.json();
    const route = extractRoute(payload);
    if (!route) return fallback("ROUTES_UNAVAILABLE");

    return NextResponse.json({
      source: "GOOGLE" as const,
      corridorId: "rosebank-sandton" as const,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      delaySeconds: Math.max(0, route.durationSeconds - 1020),
      capturedForSession: true,
    });
  } catch {
    return fallback("ROUTES_UNAVAILABLE");
  }
}

function extractRoute(
  payload: unknown,
): { distanceMeters: number; durationSeconds: number } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const routes = (payload as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return undefined;
  const route = routes[0] as Record<string, unknown>;
  if (
    typeof route.distanceMeters !== "number" ||
    typeof route.duration !== "string"
  ) {
    return undefined;
  }
  const durationSeconds = Number.parseFloat(route.duration.replace("s", ""));
  if (!Number.isFinite(durationSeconds)) return undefined;
  return { distanceMeters: route.distanceMeters, durationSeconds };
}
