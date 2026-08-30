import { z } from "zod";
import type { RouteContext } from "@/domain/types";

const MAX_DISTANCE_METERS = 100_000;
const MAX_DURATION_SECONDS = 86_400;
const MAX_ENCODED_POLYLINE_LENGTH = 20_000;

const distanceSchema = z.number().finite().min(1).max(MAX_DISTANCE_METERS);
const durationSchema = z.number().finite().min(1).max(MAX_DURATION_SECONDS);
const delaySchema = z.number().finite().min(0).max(MAX_DURATION_SECONDS);
const encodedPolylineSchema = z
  .string()
  .min(1)
  .max(MAX_ENCODED_POLYLINE_LENGTH)
  .refine((value) => value.trim().length > 0);

const commonNormalizedShape = {
  corridorId: z.literal("rosebank-sandton"),
  distanceMeters: distanceSchema,
  durationSeconds: durationSchema,
  staticDurationSeconds: durationSchema,
  delaySeconds: delaySchema,
  capturedForSession: z.literal(true),
};

const normalizedGoogleSchema = z
  .strictObject({
    source: z.literal("GOOGLE"),
    ...commonNormalizedShape,
    encodedPolyline: encodedPolylineSchema,
  })
  .refine(hasConsistentDelay);

const normalizedFallbackSchema = z
  .strictObject({
    source: z.literal("AUTHORED_FALLBACK"),
    ...commonNormalizedShape,
    reasonCode: z.enum([
      "NO_SERVER_KEY",
      "ROUTES_UNAVAILABLE",
      "CLIENT_UNAVAILABLE",
    ]),
  })
  .refine(hasConsistentDelay);

const upstreamRouteSchema = z.object({
  distanceMeters: distanceSchema,
  duration: z.string(),
  staticDuration: z.string(),
  polyline: z.object({
    encodedPolyline: encodedPolylineSchema,
  }),
});

export type RouteFallbackReason = NonNullable<RouteContext["reasonCode"]>;

export interface RoutePresentationContext extends RouteContext {
  staticDurationSeconds: number;
  encodedPolyline?: string;
}

export function createAuthoredRouteContext(
  reasonCode: RouteFallbackReason,
): RoutePresentationContext {
  return {
    source: "AUTHORED_FALLBACK",
    corridorId: "rosebank-sandton",
    distanceMeters: 7_800,
    durationSeconds: 1_020,
    staticDurationSeconds: 1_020,
    delaySeconds: 0,
    capturedForSession: true,
    reasonCode,
  };
}

export function parseNormalizedRouteContext(
  value: unknown,
): RoutePresentationContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = Reflect.get(value, "source");
  const result =
    source === "GOOGLE"
      ? normalizedGoogleSchema.safeParse(value)
      : source === "AUTHORED_FALLBACK"
        ? normalizedFallbackSchema.safeParse(value)
        : undefined;
  return result?.success ? result.data : undefined;
}

export function normalizeGoogleRoutesPayload(
  payload: unknown,
): RoutePresentationContext | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const routes = Reflect.get(payload, "routes");
  if (!Array.isArray(routes) || routes.length === 0) return undefined;

  const parsedRoute = upstreamRouteSchema.safeParse(routes[0]);
  if (!parsedRoute.success) return undefined;

  const durationSeconds = parseGoogleDuration(parsedRoute.data.duration);
  const staticDurationSeconds = parseGoogleDuration(
    parsedRoute.data.staticDuration,
  );
  if (
    durationSeconds === undefined ||
    staticDurationSeconds === undefined
  ) {
    return undefined;
  }

  const delaySeconds = Math.max(0, durationSeconds - staticDurationSeconds);
  if (!delaySchema.safeParse(delaySeconds).success) return undefined;

  return {
    source: "GOOGLE",
    corridorId: "rosebank-sandton",
    distanceMeters: parsedRoute.data.distanceMeters,
    durationSeconds,
    staticDurationSeconds,
    delaySeconds,
    encodedPolyline: parsedRoute.data.polyline.encodedPolyline,
    capturedForSession: true,
  };
}

function parseGoogleDuration(value: string): number | undefined {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?s$/.test(value)) return undefined;
  const seconds = Number(value.slice(0, -1));
  return durationSchema.safeParse(seconds).success ? seconds : undefined;
}

function hasConsistentDelay(value: {
  durationSeconds: number;
  staticDurationSeconds: number;
  delaySeconds: number;
}): boolean {
  const expected = Math.max(
    0,
    value.durationSeconds - value.staticDurationSeconds,
  );
  return Math.abs(value.delaySeconds - expected) < 0.000_001;
}
