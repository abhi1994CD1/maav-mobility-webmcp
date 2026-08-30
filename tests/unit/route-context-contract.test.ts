import { describe, expect, it } from "vitest";
import {
  normalizeGoogleRoutesPayload,
  parseNormalizedRouteContext,
} from "@/infrastructure/google/route-context-contract";

const VALID_UPSTREAM_ROUTE = {
  distanceMeters: 7600,
  duration: "1180s",
  staticDuration: "1020s",
  polyline: { encodedPolyline: "abc123" },
};

describe("Google route context contract", () => {
  it("normalizes only the first bounded route and calculates traffic delay", () => {
    expect(
      normalizeGoogleRoutesPayload({
        routes: [
          VALID_UPSTREAM_ROUTE,
          {
            ...VALID_UPSTREAM_ROUTE,
            distanceMeters: 9999,
            duration: "9999s",
          },
        ],
      }),
    ).toEqual({
      source: "GOOGLE",
      corridorId: "rosebank-sandton",
      distanceMeters: 7600,
      durationSeconds: 1180,
      staticDurationSeconds: 1020,
      delaySeconds: 160,
      encodedPolyline: "abc123",
      capturedForSession: true,
    });
  });

  it.each([
    ["missing routes", {}],
    ["missing route", { routes: [] }],
    [
      "invalid duration",
      { routes: [{ ...VALID_UPSTREAM_ROUTE, duration: "not-seconds" }] },
    ],
    [
      "invalid static duration",
      { routes: [{ ...VALID_UPSTREAM_ROUTE, staticDuration: "-2s" }] },
    ],
    [
      "non-finite distance",
      { routes: [{ ...VALID_UPSTREAM_ROUTE, distanceMeters: Infinity }] },
    ],
    [
      "missing polyline",
      { routes: [{ ...VALID_UPSTREAM_ROUTE, polyline: undefined }] },
    ],
    [
      "empty polyline",
      {
        routes: [
          { ...VALID_UPSTREAM_ROUTE, polyline: { encodedPolyline: "" } },
        ],
      },
    ],
    [
      "oversized polyline",
      {
        routes: [
          {
            ...VALID_UPSTREAM_ROUTE,
            polyline: { encodedPolyline: "x".repeat(20_001) },
          },
        ],
      },
    ],
  ])("rejects %s", (_label, payload) => {
    expect(normalizeGoogleRoutesPayload(payload)).toBeUndefined();
  });

  it("strictly validates normalized Google and fallback DTOs", () => {
    const google = {
      source: "GOOGLE",
      corridorId: "rosebank-sandton",
      distanceMeters: 7600,
      durationSeconds: 1180,
      staticDurationSeconds: 1020,
      delaySeconds: 160,
      encodedPolyline: "abc123",
      capturedForSession: true,
    } as const;
    const fallback = {
      source: "AUTHORED_FALLBACK",
      corridorId: "rosebank-sandton",
      distanceMeters: 7800,
      durationSeconds: 1020,
      staticDurationSeconds: 1020,
      delaySeconds: 0,
      capturedForSession: true,
      reasonCode: "ROUTES_UNAVAILABLE",
    } as const;

    expect(parseNormalizedRouteContext(google)).toEqual(google);
    expect(parseNormalizedRouteContext(fallback)).toEqual(fallback);
    expect(
      parseNormalizedRouteContext({ ...google, rawText: "provider prose" }),
    ).toBeUndefined();
    expect(
      parseNormalizedRouteContext({ ...google, delaySeconds: 159 }),
    ).toBeUndefined();
    expect(
      parseNormalizedRouteContext({
        ...fallback,
        encodedPolyline: "must-not-be-present",
      }),
    ).toBeUndefined();
  });
});
