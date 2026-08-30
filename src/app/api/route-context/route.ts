import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAuthoredRouteContext,
  normalizeGoogleRoutesPayload,
} from "@/infrastructure/google/route-context-contract";

const requestSchema = z.strictObject({
  corridorId: z.literal("rosebank-sandton"),
});

const fallback = (reasonCode: "NO_SERVER_KEY" | "ROUTES_UNAVAILABLE") =>
  NextResponse.json(createAuthoredRouteContext(reasonCode));

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
          "x-goog-fieldmask":
            "routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline",
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
          computeAlternativeRoutes: false,
          units: "METRIC",
        }),
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(4_000),
        ]),
      },
    );
    if (!response.ok) return fallback("ROUTES_UNAVAILABLE");

    const payload: unknown = await response.json();
    const route = normalizeGoogleRoutesPayload(payload);
    if (!route) return fallback("ROUTES_UNAVAILABLE");

    return NextResponse.json(route);
  } catch {
    return fallback("ROUTES_UNAVAILABLE");
  }
}
