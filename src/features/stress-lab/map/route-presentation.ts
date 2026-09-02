import type {
  MapCoordinate,
  ReplayFrameProjection,
  ReplayRouteProjection,
} from "./replay-projection";

export type RouteGeometrySource = "GOOGLE" | "AUTHORED";

export interface PresentedRoute extends ReplayRouteProjection {
  readonly source: RouteGeometrySource;
}

export interface RoutePresentationSummary {
  readonly routes: readonly PresentedRoute[];
  readonly googleCount: number;
  readonly fallbackCount: number;
  readonly roadFollowingCount: number;
}

export type RouteCompute = (
  request: google.maps.routes.ComputeRoutesRequest,
) => Promise<{
  readonly routes?: readonly { readonly path?: readonly MapCoordinate[] }[];
}>;

type RoutesLibraryImporter = () => Promise<google.maps.RoutesLibrary>;

let routesLibraryPromise: Promise<google.maps.RoutesLibrary> | null = null;

export function loadGoogleRoutesLibrary(
  importer: RoutesLibraryImporter = async () =>
    google.maps.importLibrary("routes") as Promise<google.maps.RoutesLibrary>,
): Promise<google.maps.RoutesLibrary> {
  routesLibraryPromise ??= importer();
  return routesLibraryPromise;
}

const ROUTE_TIMEOUT_MS = 8_000;
const MAX_CONCURRENT_ROUTE_REQUESTS = 3;
const SANITY_PADDING_DEGREES = 0.08;
const ENDPOINT_TOLERANCE_DEGREES = 0.006;

function freezeCoordinate(point: MapCoordinate): MapCoordinate {
  return Object.freeze({ lat: point.lat, lng: point.lng });
}

function finiteCoordinate(value: unknown): value is MapCoordinate {
  if (!value || typeof value !== "object") return false;
  const point = value as { readonly lat?: unknown; readonly lng?: unknown };
  return typeof point.lat === "number" && Number.isFinite(point.lat) &&
    typeof point.lng === "number" && Number.isFinite(point.lng);
}

function squaredDistance(left: MapCoordinate, right: MapCoordinate): number {
  return (left.lat - right.lat) ** 2 + (left.lng - right.lng) ** 2;
}

export function createGoogleRouteRequest(
  route: ReplayRouteProjection,
): google.maps.routes.ComputeRoutesRequest {
  const origin = route.path[0];
  const destination = route.path.at(-1);
  if (!origin || !destination) {
    throw new Error("Authored route presentation endpoints are unavailable.");
  }
  return Object.freeze({
    origin: freezeCoordinate(origin),
    destination: freezeCoordinate(destination),
    fields: Object.freeze(["path"]),
    travelMode: "DRIVING",
    routingPreference: "TRAFFIC_UNAWARE",
  });
}

export function validateGoogleRoutePath(
  value: unknown,
  route: ReplayRouteProjection,
  bounds: google.maps.LatLngBoundsLiteral,
): readonly MapCoordinate[] | null {
  if (!Array.isArray(value) || value.length < 2 || !value.every(finiteCoordinate)) {
    return null;
  }
  const withinSanityRegion = value.every((point) =>
    point.lat >= bounds.south - SANITY_PADDING_DEGREES &&
    point.lat <= bounds.north + SANITY_PADDING_DEGREES &&
    point.lng >= bounds.west - SANITY_PADDING_DEGREES &&
    point.lng <= bounds.east + SANITY_PADDING_DEGREES);
  const authoredOrigin = route.path[0];
  const authoredDestination = route.path.at(-1);
  const first = value[0];
  const last = value.at(-1);
  if (
    !withinSanityRegion || !authoredOrigin || !authoredDestination || !first || !last ||
    squaredDistance(first, authoredOrigin) > ENDPOINT_TOLERANCE_DEGREES ** 2 ||
    squaredDistance(last, authoredDestination) > ENDPOINT_TOLERANCE_DEGREES ** 2
  ) {
    return null;
  }
  return Object.freeze(value.map(freezeCoordinate));
}

interface QueueEntry {
  readonly run: () => Promise<void>;
}

export class RouteRequestCoordinator {
  readonly #entries = new Map<string, Promise<readonly MapCoordinate[] | null>>();
  readonly #queue: QueueEntry[] = [];
  #active = 0;

  constructor(
    private readonly concurrency = MAX_CONCURRENT_ROUTE_REQUESTS,
    private readonly timeoutMs = ROUTE_TIMEOUT_MS,
  ) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new Error("Route request concurrency must be a positive integer.");
    }
  }

  load(
    networkFingerprint: string,
    route: ReplayRouteProjection,
    bounds: google.maps.LatLngBoundsLiteral,
    compute: RouteCompute,
  ): Promise<readonly MapCoordinate[] | null> {
    const key = `${networkFingerprint}:${route.edgeId}`;
    const existing = this.#entries.get(key);
    if (existing) return existing;

    let resolveResult!: (value: readonly MapCoordinate[] | null) => void;
    const result = new Promise<readonly MapCoordinate[] | null>((resolve) => {
      resolveResult = resolve;
    });
    this.#entries.set(key, result);
    this.#queue.push({
      run: async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeoutResult = new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), this.timeoutMs);
          });
          const computed = compute(createGoogleRouteRequest(route))
            .then((response) => validateGoogleRoutePath(response.routes?.[0]?.path, route, bounds))
            .catch(() => null);
          resolveResult(await Promise.race([computed, timeoutResult]));
        } finally {
          if (timeout) clearTimeout(timeout);
        }
      },
    });
    this.#drain();
    return result;
  }

  #drain(): void {
    while (this.#active < this.concurrency && this.#queue.length > 0) {
      const entry = this.#queue.shift();
      if (!entry) return;
      this.#active += 1;
      void entry.run().finally(() => {
        this.#active -= 1;
        this.#drain();
      });
    }
  }
}

export const pageRouteRequestCoordinator = new RouteRequestCoordinator();

export function summarizePresentedRoutes(
  authoredRoutes: readonly ReplayRouteProjection[],
  googlePaths: ReadonlyMap<string, readonly MapCoordinate[]>,
): RoutePresentationSummary {
  let googleCount = 0;
  let roadFollowingCount = 0;
  const routes = authoredRoutes.map((route) => {
    const googlePath = googlePaths.get(route.edgeId);
    if (!googlePath) return Object.freeze({ ...route, source: "AUTHORED" as const });
    googleCount += 1;
    if (googlePath.length > 2) roadFollowingCount += 1;
    return Object.freeze({ ...route, path: googlePath, source: "GOOGLE" as const });
  });
  return Object.freeze({
    routes: Object.freeze(routes),
    googleCount,
    fallbackCount: authoredRoutes.length - googleCount,
    roadFollowingCount,
  });
}

export function interpolatePresentationPath(
  path: readonly MapCoordinate[],
  normalizedProgress: number,
): MapCoordinate {
  if (path.length < 2 || !path.every(finiteCoordinate)) {
    throw new Error("Presentation route path is incomplete.");
  }
  const segmentLengths = path.slice(1).map((point, index) =>
    Math.hypot(point.lat - path[index].lat, point.lng - path[index].lng));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (!(totalLength > 0)) return freezeCoordinate(path[0]);
  const target = Math.max(0, Math.min(1, normalizedProgress)) * totalLength;
  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (target <= traversed + segmentLength || index === segmentLengths.length - 1) {
      const ratio = segmentLength === 0 ? 0 : (target - traversed) / segmentLength;
      return freezeCoordinate({
        lat: path[index].lat + (path[index + 1].lat - path[index].lat) * ratio,
        lng: path[index].lng + (path[index + 1].lng - path[index].lng) * ratio,
      });
    }
    traversed += segmentLength;
  }
  return freezeCoordinate(path.at(-1)!);
}

export function projectFrameOntoPresentedRoutes(
  frame: ReplayFrameProjection,
  routes: readonly PresentedRoute[],
): ReplayFrameProjection {
  const routeById = new Map(routes.map((route) => [route.edgeId, route]));
  const vehiclePositions = new Map<string, MapCoordinate>();
  const vehicles = frame.vehicles.map((vehicle) => {
    const route = vehicle.activeEdgeId ? routeById.get(vehicle.activeEdgeId) : undefined;
    const position = route && vehicle.activeEdgeProgress !== undefined
      ? interpolatePresentationPath(route.path, vehicle.activeEdgeProgress)
      : vehicle.position;
    vehiclePositions.set(vehicle.id, position);
    return Object.freeze({ ...vehicle, position });
  });
  const passengers = frame.passengers.map((passenger) => {
    const position = passenger.assignedVehicleId
      ? vehiclePositions.get(passenger.assignedVehicleId) ?? passenger.position
      : passenger.position;
    return Object.freeze({ ...passenger, position });
  });
  return Object.freeze({ ...frame, vehicles: Object.freeze(vehicles), passengers: Object.freeze(passengers) });
}

export const ROUTE_SEMANTIC_PALETTE = Object.freeze({
  baseline: "rgba(100, 116, 139, 0.26)",
  scenarioA: "#67E8F9",
  scenarioB: "#A78BFA",
  failure: "#F59E0B",
  failedVehicle: "#FB7185",
  selectedHalo: "rgba(255, 255, 255, 0.72)",
  evidencePass: "#6EE7B7",
});
