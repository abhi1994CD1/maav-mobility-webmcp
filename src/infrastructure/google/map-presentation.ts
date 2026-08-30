import type {
  Coordinate,
  OperationalState,
  RouteContextSource,
} from "@/domain/types";
import type { RoutePresentationContext } from "./route-context-contract";

export type GoogleMapStatus = "UNCONFIGURED" | "LOADING" | "READY" | "FAILED";

export const GOOGLE_MAP_UNAVAILABLE_MESSAGE =
  "GOOGLE MAP UNAVAILABLE • AUTHORED FALLBACK ACTIVE";

export interface GoogleCorridorOverlay {
  id: string;
  path: Coordinate[];
  status: "HEALTHY" | "DISRUPTED" | "RECOVERED";
  strokeColor: string;
  strokeOpacity: number;
  strokeWeight: number;
  zIndex: number;
}

export interface GoogleRouteContextOverlay {
  id: string;
  encodedPath: string;
  status: GoogleCorridorOverlay["status"];
  strokeColor: string;
}

export interface GoogleStopOverlay {
  id: string;
  name: string;
  position: Coordinate;
  accessible: boolean;
}

export interface GoogleVehicleOverlay {
  id: string;
  label: string;
  position: Coordinate;
  status: "IN_SERVICE" | "DELAYED" | "REROUTED" | "BRIDGE_SERVICE";
  accessible: boolean;
}

export interface GoogleMapOverlayModel {
  authoredBackbone?: GoogleCorridorOverlay;
  googleRouteContext?: GoogleRouteContextOverlay;
  stops: GoogleStopOverlay[];
  vehicles: GoogleVehicleOverlay[];
}

export interface GoogleTrafficSummary {
  distanceKilometers: number;
  durationMinutes: number;
  delayMinutes: number;
}

export function initialGoogleMapStatus(apiKey?: string): GoogleMapStatus {
  return apiKey?.trim() ? "LOADING" : "UNCONFIGURED";
}

export function isGoogleMapReady(status: GoogleMapStatus): boolean {
  return status === "READY";
}

export function mapContextLabel(
  mapStatus: GoogleMapStatus,
  routeContextSource: RouteContextSource,
): string {
  const googleMapReady = isGoogleMapReady(mapStatus);
  if (googleMapReady && routeContextSource === "GOOGLE") {
    return "GOOGLE MAPS + ROUTES CONTEXT";
  }
  if (googleMapReady) return "GOOGLE MAPS • AUTHORED ROUTE FALLBACK";
  if (routeContextSource === "GOOGLE") {
    return "AUTHORED MAP • GOOGLE ROUTE CONTEXT";
  }
  return "AUTHORED MAP + ROUTE FALLBACK";
}

export function corridorStrokeColor(
  status: GoogleCorridorOverlay["status"],
): string {
  if (status === "DISRUPTED") return "#ff5c4d";
  if (status === "RECOVERED") return "#45d6a8";
  return "#55d8ff";
}

export function deriveGoogleTrafficSummary(
  routeContext: RoutePresentationContext,
): GoogleTrafficSummary | undefined {
  if (routeContext.source !== "GOOGLE") return undefined;
  return {
    distanceKilometers: routeContext.distanceMeters / 1_000,
    durationMinutes: routeContext.durationSeconds / 60,
    delayMinutes: routeContext.delaySeconds / 60,
  };
}

export function deriveRoutePresentation(
  operational: OperationalState,
  routeContext: RoutePresentationContext,
): GoogleMapOverlayModel {
  const corridor = operational.network.corridors[0];
  const googleEncodedPath = usableGoogleEncodedPath(routeContext);
  const status = corridor?.status ?? "HEALTHY";
  return {
    authoredBackbone: corridor
      ? {
          id: corridor.id,
          path: corridor.path.map((point) => ({ ...point })),
          status: corridor.status,
          strokeColor: googleEncodedPath
            ? "#68858d"
            : corridorStrokeColor(corridor.status),
          strokeOpacity: googleEncodedPath ? 0.46 : 0.94,
          strokeWeight: googleEncodedPath ? 3 : 5,
          zIndex: googleEncodedPath ? 1 : 2,
        }
      : undefined,
    googleRouteContext: googleEncodedPath
      ? {
          id: `${routeContext.corridorId}-google-route`,
          encodedPath: googleEncodedPath,
          status,
          strokeColor: corridorStrokeColor(status),
        }
      : undefined,
    stops: operational.network.stops.map((stop) => ({
      id: stop.id,
      name: stop.name,
      position: { ...stop.position },
      accessible: stop.accessible,
    })),
    vehicles: operational.fleet.vehicles.map((vehicle) => ({
      id: vehicle.id,
      label: vehicle.label,
      position: { ...vehicle.position },
      status: vehicle.status,
      accessible: vehicle.accessible,
    })),
  };
}

function usableGoogleEncodedPath(
  routeContext: RoutePresentationContext,
): string | undefined {
  if (routeContext.source !== "GOOGLE") return undefined;
  const encodedPath = routeContext.encodedPolyline;
  if (
    typeof encodedPath !== "string" ||
    encodedPath.trim().length === 0 ||
    encodedPath.length > 20_000
  ) {
    return undefined;
  }
  return encodedPath;
}
