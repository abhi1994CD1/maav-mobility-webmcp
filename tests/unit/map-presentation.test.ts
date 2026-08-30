import { describe, expect, it } from "vitest";
import {
  activateCanonicalIncident,
  createCanonicalOperationalState,
  createInitialCommandCenterState,
} from "@/domain/scenario";
import {
  corridorStrokeColor,
  deriveGoogleTrafficSummary,
  deriveRoutePresentation,
  GOOGLE_MAP_UNAVAILABLE_MESSAGE,
  initialGoogleMapStatus,
  isGoogleMapReady,
  mapContextLabel,
} from "@/infrastructure/google/map-presentation";
import {
  createAuthoredRouteContext,
  type RoutePresentationContext,
} from "@/infrastructure/google/route-context-contract";

const GOOGLE_ROUTE_CONTEXT: RoutePresentationContext = {
  source: "GOOGLE",
  corridorId: "rosebank-sandton",
  distanceMeters: 7600,
  durationSeconds: 1180,
  staticDurationSeconds: 1020,
  delaySeconds: 160,
  encodedPolyline: "abc123",
  capturedForSession: true,
};

describe("Google map presentation adapter", () => {
  it("keeps missing-key, loading, ready, and failure state ephemeral and explicit", () => {
    expect(initialGoogleMapStatus()).toBe("UNCONFIGURED");
    expect(initialGoogleMapStatus("   ")).toBe("UNCONFIGURED");
    expect(initialGoogleMapStatus("configured-browser-key")).toBe("LOADING");
    expect(isGoogleMapReady("LOADING")).toBe(false);
    expect(isGoogleMapReady("FAILED")).toBe(false);
    expect(isGoogleMapReady("READY")).toBe(true);
    expect(GOOGLE_MAP_UNAVAILABLE_MESSAGE).toBe(
      "GOOGLE MAP UNAVAILABLE • AUTHORED FALLBACK ACTIVE",
    );
  });

  it("derives every documented map and route context label", () => {
    expect(mapContextLabel("READY", "GOOGLE")).toBe(
      "GOOGLE MAPS + ROUTES CONTEXT",
    );
    expect(mapContextLabel("READY", "AUTHORED_FALLBACK")).toBe(
      "GOOGLE MAPS • AUTHORED ROUTE FALLBACK",
    );
    expect(mapContextLabel("FAILED", "GOOGLE")).toBe(
      "AUTHORED MAP • GOOGLE ROUTE CONTEXT",
    );
    expect(mapContextLabel("UNCONFIGURED", "AUTHORED_FALLBACK")).toBe(
      "AUTHORED MAP + ROUTE FALLBACK",
    );
  });

  it("derives a bounded read-only traffic session summary only for Google", () => {
    expect(deriveGoogleTrafficSummary(GOOGLE_ROUTE_CONTEXT)).toEqual({
      distanceKilometers: 7.6,
      durationMinutes: 1180 / 60,
      delayMinutes: 160 / 60,
    });
    expect(
      deriveGoogleTrafficSummary(
        createAuthoredRouteContext("ROUTES_UNAVAILABLE"),
      ),
    ).toBeUndefined();
  });

  it("projects stable authored fallback overlays without mutating domain state", () => {
    const state = createInitialCommandCenterState();
    const before = structuredClone(state);

    const overlays = deriveRoutePresentation(
      state.operational,
      createAuthoredRouteContext("NO_SERVER_KEY"),
    );

    expect(overlays.authoredBackbone).toMatchObject({
      id: "north-spine",
      status: "HEALTHY",
      strokeColor: "#55d8ff",
      strokeOpacity: 0.94,
      strokeWeight: 5,
    });
    expect(overlays.authoredBackbone?.path).toHaveLength(6);
    expect(overlays.googleRouteContext).toBeUndefined();
    expect(overlays.stops.map((stop) => stop.id)).toEqual([
      "park-station",
      "braamfontein",
      "rosebank",
      "sandton",
      "marlboro",
      "midrand",
    ]);
    expect(overlays.vehicles.map((vehicle) => vehicle.id)).toEqual([
      "veh-17",
      "veh-23",
      "veh-31",
      "veh-44",
    ]);
    expect(state).toEqual(before);
    expect(state.revision).toBe(0);
  });

  it("keeps the full authored spine subdued under valid Google geometry", () => {
    const operational = createCanonicalOperationalState();

    const overlays = deriveRoutePresentation(
      operational,
      GOOGLE_ROUTE_CONTEXT,
    );

    expect(overlays.authoredBackbone).toMatchObject({
      id: "north-spine",
      strokeColor: "#68858d",
      strokeOpacity: 0.46,
      strokeWeight: 3,
      zIndex: 1,
    });
    expect(overlays.authoredBackbone?.path).toHaveLength(6);
    expect(overlays.googleRouteContext).toEqual({
      id: "rosebank-sandton-google-route",
      encodedPath: "abc123",
      status: "HEALTHY",
      strokeColor: "#55d8ff",
    });
  });

  it("selects Google geometry only for a Google source with valid geometry", () => {
    const operational = createCanonicalOperationalState();

    const missingGeometry = deriveRoutePresentation(operational, {
      ...GOOGLE_ROUTE_CONTEXT,
      encodedPolyline: undefined,
    });
    const fallbackWithUnexpectedGeometry = deriveRoutePresentation(
      operational,
      {
        ...createAuthoredRouteContext("ROUTES_UNAVAILABLE"),
        encodedPolyline: "must-not-render",
      },
    );

    expect(missingGeometry.googleRouteContext).toBeUndefined();
    expect(missingGeometry.authoredBackbone?.strokeColor).toBe("#55d8ff");
    expect(fallbackWithUnexpectedGeometry.googleRouteContext).toBeUndefined();
  });

  it("uses red only for disruption and green only for verified recovery", () => {
    const healthy = createCanonicalOperationalState();
    const disrupted = activateCanonicalIncident(healthy);
    const recovered = structuredClone(healthy);
    recovered.network.corridors[0]!.status = "RECOVERED";

    expect(corridorStrokeColor("HEALTHY")).toBe("#55d8ff");
    expect(
      deriveRoutePresentation(disrupted, GOOGLE_ROUTE_CONTEXT)
        .googleRouteContext?.strokeColor,
    ).toBe("#ff5c4d");
    expect(
      deriveRoutePresentation(recovered, GOOGLE_ROUTE_CONTEXT)
        .googleRouteContext?.strokeColor,
    ).toBe("#45d6a8");
  });
});
