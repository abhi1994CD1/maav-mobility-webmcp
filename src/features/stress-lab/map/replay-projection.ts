import type { CurrentRunRecord } from "@/application/stress-lab-ports";
import { replayVerifiedEventLedgerPrefix } from "@/domain/stress-lab/replay";
import type {
  NetworkEdge,
  NetworkFixture,
  PassengerState,
  ScenarioSlot,
  SimulationSnapshot,
  VehicleState,
} from "@/domain/stress-lab/types";

export interface MapCoordinate {
  readonly lat: number;
  readonly lng: number;
}

export interface ReplayRouteProjection {
  readonly edgeId: string;
  readonly fromZoneId: string;
  readonly toZoneId: string;
  readonly path: readonly MapCoordinate[];
}

export interface ReplayDemandProjection {
  readonly zoneId: string;
  readonly zoneName: string;
  readonly requestCount: number;
  readonly position: MapCoordinate;
}

export interface ReplayVehicleProjection {
  readonly id: string;
  readonly state: VehicleState["state"];
  readonly currentZoneId: string;
  readonly occupancy: number;
  readonly capacity: number;
  readonly batteryWh: number;
  readonly minimumReserveBasisPoints: number;
  readonly position: MapCoordinate;
  readonly failed: boolean;
  readonly activeEdgeId?: string;
  readonly activeEdgeProgress?: number;
}

export interface ReplayPassengerProjection {
  readonly id: string;
  readonly state: PassengerState["state"];
  readonly originZoneId: string;
  readonly destinationZoneId: string;
  readonly requestSecond: number;
  readonly assignedVehicleId?: string;
  readonly position: MapCoordinate;
}

export interface ReplayFailureProjection {
  readonly evidenceId: string;
  readonly vehicleId: string;
  readonly disruptionId: string;
  readonly atSecond: number;
  readonly position: MapCoordinate;
}

export interface ReplayFrameProjection {
  readonly runId: string;
  readonly scenarioSlot: ScenarioSlot;
  readonly inputFingerprint: string;
  readonly eventLedgerFingerprint: string;
  readonly resultFingerprint: string;
  readonly index: number;
  readonly atSecond: number;
  readonly displayTime: string;
  readonly throughEventSequence: number;
  readonly vehicles: readonly ReplayVehicleProjection[];
  readonly passengers: readonly ReplayPassengerProjection[];
  readonly failure: ReplayFailureProjection | null;
}

export interface ReplayModel {
  readonly runId: string;
  readonly scenarioSlot: ScenarioSlot;
  readonly inputFingerprint: string;
  readonly eventLedgerFingerprint: string;
  readonly resultFingerprint: string;
  readonly networkFingerprint: string;
  readonly timestamps: readonly number[];
  readonly startSecond: number;
  readonly endSecond: number;
  readonly frameCount: number;
  readonly routes: readonly ReplayRouteProjection[];
  readonly demand: readonly ReplayDemandProjection[];
  readonly failureSecond: number | null;
  readonly bounds: google.maps.LatLngBoundsLiteral;
  readonly projectFrame: (index: number) => ReplayFrameProjection;
}

export interface AuthoredNetworkProjection {
  readonly networkFingerprint: string;
  readonly routes: readonly ReplayRouteProjection[];
  readonly bounds: google.maps.LatLngBoundsLiteral;
}

export class StressLabMapProjectionError extends Error {
  readonly code = "INVALID_REPLAY_PROJECTION" as const;
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "StressLabMapProjectionError";
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new StressLabMapProjectionError(path, message);
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function coordinate(
  value: { readonly latitudeMicrodegrees: number; readonly longitudeMicrodegrees: number },
): MapCoordinate {
  return Object.freeze({
    lat: value.latitudeMicrodegrees / 1_000_000,
    lng: value.longitudeMicrodegrees / 1_000_000,
  });
}

function displayTime(displayStart: string, atSecond: number): string {
  const parts = displayStart.split(":").map(Number);
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    return fail("input.horizon.displayStart", "Display start is invalid.");
  }
  const total = parts[0] * 3_600 + parts[1] * 60 + parts[2] + atSecond;
  const hours = Math.floor(total / 3_600) % 24;
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function interpolatePath(path: readonly MapCoordinate[], ratio: number): MapCoordinate {
  if (path.length < 2) return fail("network.edge.displayPath", "Display path is incomplete.");
  const clamped = Math.max(0, Math.min(1, ratio));
  const progress = clamped * (path.length - 1);
  const segment = Math.min(path.length - 2, Math.floor(progress));
  const local = progress - segment;
  const from = path[segment];
  const to = path[segment + 1];
  return Object.freeze({
    lat: from.lat + (to.lat - from.lat) * local,
    lng: from.lng + (to.lng - from.lng) * local,
  });
}

interface VehiclePositionProjection {
  readonly position: MapCoordinate;
  readonly activeEdgeId?: string;
  readonly activeEdgeProgress?: number;
}

function vehiclePosition(
  vehicle: VehicleState,
  atSecond: number,
  zoneCoordinates: ReadonlyMap<string, MapCoordinate>,
  edges: ReadonlyMap<string, { readonly edge: NetworkEdge; readonly path: readonly MapCoordinate[] }>,
): VehiclePositionProjection {
  const leg = vehicle.activeLeg;
  if (!leg) {
    const position = zoneCoordinates.get(vehicle.currentZoneId) ??
      fail(`vehicles.${vehicle.id}.currentZoneId`, "Vehicle references an unknown zone.");
    return Object.freeze({ position });
  }
  const elapsed = Math.max(0, atSecond - leg.startedAtSecond);
  const activeEvidence = leg.edges.find(
    (edge) => elapsed >= edge.startOffsetSeconds && elapsed <= edge.endOffsetSeconds,
  ) ?? leg.edges.at(-1);
  if (!activeEvidence) {
    return fail(`vehicles.${vehicle.id}.activeLeg.edges`, "Active leg has no edge evidence.");
  }
  const authored = edges.get(activeEvidence.edgeId);
  if (!authored) {
    return fail(
      `vehicles.${vehicle.id}.activeLeg.edges.${activeEvidence.edgeId}`,
      "Active leg references an unknown authored edge.",
    );
  }
  if (
    authored.edge.fromZoneId !== activeEvidence.fromZoneId ||
    authored.edge.toZoneId !== activeEvidence.toZoneId
  ) {
    return fail(
      `vehicles.${vehicle.id}.activeLeg.edges.${activeEvidence.edgeId}`,
      "Active leg topology conflicts with the authored edge.",
    );
  }
  const duration = activeEvidence.endOffsetSeconds - activeEvidence.startOffsetSeconds;
  const ratio = duration === 0
    ? 1
    : (elapsed - activeEvidence.startOffsetSeconds) / duration;
  const activeEdgeProgress = Math.max(0, Math.min(1, ratio));
  return Object.freeze({
    position: interpolatePath(authored.path, activeEdgeProgress),
    activeEdgeId: String(activeEvidence.edgeId),
    activeEdgeProgress,
  });
}

function assertSnapshotOrder(snapshots: readonly SimulationSnapshot[]): void {
  if (snapshots.length === 0) {
    fail("result.snapshots", "Committed result contains no replay snapshots.");
  }
  let priorSecond = -1;
  let priorSequence = 0;
  for (const [index, snapshot] of snapshots.entries()) {
    if (
      !Number.isSafeInteger(snapshot.atSecond) ||
      snapshot.atSecond <= priorSecond ||
      !Number.isSafeInteger(snapshot.throughEventSequence) ||
      snapshot.throughEventSequence <= priorSequence
    ) {
      fail(`result.snapshots.${index}`, "Replay snapshots are not strictly ordered.");
    }
    priorSecond = snapshot.atSecond;
    priorSequence = snapshot.throughEventSequence;
  }
}

export function nearestReplayFrameIndex(
  timestamps: readonly number[],
  targetSecond: number,
): number {
  if (timestamps.length === 0) return 0;
  let selected = 0;
  let selectedDistance = Math.abs(timestamps[0] - targetSecond);
  for (let index = 1; index < timestamps.length; index += 1) {
    const distance = Math.abs(timestamps[index] - targetSecond);
    if (distance < selectedDistance) {
      selected = index;
      selectedDistance = distance;
    }
  }
  return selected;
}

export function createAuthoredNetworkProjection(
  network: NetworkFixture,
  networkFingerprint: string,
): AuthoredNetworkProjection {
  const zoneCoordinates = new Map<string, MapCoordinate>();
  for (const [index, zone] of network.zones.entries()) {
    if (zoneCoordinates.has(zone.id)) {
      fail(`network.zones.${index}.id`, "Network zone ID is duplicated.");
    }
    zoneCoordinates.set(zone.id, coordinate(zone.displayCoordinate));
  }
  const seenEdges = new Set<string>();
  const routes = network.edges.map((edge, index) => {
    if (seenEdges.has(edge.id)) {
      fail(`network.edges.${index}.id`, "Network edge ID is duplicated.");
    }
    seenEdges.add(edge.id);
    if (!zoneCoordinates.has(edge.fromZoneId) || !zoneCoordinates.has(edge.toZoneId)) {
      fail(`network.edges.${index}`, "Network edge references an unknown zone.");
    }
    const path = Object.freeze(edge.displayPath.map(coordinate));
    if (path.length < 2) {
      fail(`network.edges.${index}.displayPath`, "Network display path is incomplete.");
    }
    return Object.freeze({
      edgeId: String(edge.id),
      fromZoneId: String(edge.fromZoneId),
      toZoneId: String(edge.toZoneId),
      path,
    });
  });
  const latitudes = [...zoneCoordinates.values()].map((value) => value.lat);
  const longitudes = [...zoneCoordinates.values()].map((value) => value.lng);
  if (latitudes.length === 0 || longitudes.length === 0) {
    fail("network.zones", "Network has no displayable zones.");
  }
  return deepFreeze({
    networkFingerprint,
    routes,
    bounds: {
      north: Math.max(...latitudes),
      south: Math.min(...latitudes),
      east: Math.max(...longitudes),
      west: Math.min(...longitudes),
    },
  });
}

export function createReplayModel(run: CurrentRunRecord): ReplayModel {
  const input = run.preparedInput.input;
  const snapshots = run.verifiedResult.snapshots;
  assertSnapshotOrder(snapshots);

  const authoredNetwork = createAuthoredNetworkProjection(
    input.network,
    input.networkFingerprint,
  );

  const zoneCoordinates = new Map<string, MapCoordinate>();
  const zoneNames = new Map<string, string>();
  for (const [index, zone] of input.network.zones.entries()) {
    if (zoneCoordinates.has(zone.id)) {
      fail(`input.network.zones.${index}.id`, "Network zone ID is duplicated.");
    }
    zoneCoordinates.set(zone.id, coordinate(zone.displayCoordinate));
    zoneNames.set(zone.id, zone.name);
  }

  const routeById = new Map(authoredNetwork.routes.map((route) => [route.edgeId, route]));
  const edgeMap = new Map<
    string,
    { readonly edge: NetworkEdge; readonly path: readonly MapCoordinate[] }
  >();
  input.network.edges.forEach((edge, index) => {
    if (edgeMap.has(edge.id)) {
      fail(`input.network.edges.${index}.id`, "Network edge ID is duplicated.");
    }
    if (!zoneCoordinates.has(edge.fromZoneId) || !zoneCoordinates.has(edge.toZoneId)) {
      fail(`input.network.edges.${index}`, "Network edge references an unknown zone.");
    }
    const path = routeById.get(String(edge.id))?.path ??
      fail(`input.network.edges.${index}.displayPath`, "Network display path is incomplete.");
    edgeMap.set(edge.id, { edge, path });
  });

  const requestsByOrigin = new Map<string, number>();
  for (const [index, request] of input.demandTrace.requests.entries()) {
    if (!zoneCoordinates.has(request.originZoneId) || !zoneCoordinates.has(request.destinationZoneId)) {
      fail(`input.demandTrace.requests.${index}`, "Passenger request references an unknown zone.");
    }
    requestsByOrigin.set(
      request.originZoneId,
      (requestsByOrigin.get(request.originZoneId) ?? 0) + 1,
    );
  }
  const demand = [...requestsByOrigin.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([zoneId, requestCount]) => Object.freeze({
      zoneId,
      zoneName: zoneNames.get(zoneId) ?? zoneId,
      requestCount,
      position: zoneCoordinates.get(zoneId)!,
    }));

  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    for (const [vehicleIndex, vehicle] of snapshot.vehicles.entries()) {
      if (!zoneCoordinates.has(vehicle.currentZoneId)) {
        fail(
          `result.snapshots.${snapshotIndex}.vehicles.${vehicleIndex}.currentZoneId`,
          "Snapshot vehicle references an unknown zone.",
        );
      }
      for (const [edgeIndex, edgeId] of (vehicle.activeLeg?.edgeIds ?? []).entries()) {
        if (!edgeMap.has(edgeId)) {
          fail(
            `result.snapshots.${snapshotIndex}.vehicles.${vehicleIndex}.activeLeg.edgeIds.${edgeIndex}`,
            "Snapshot vehicle references an unknown edge.",
          );
        }
      }
    }
  }

  const failureEvent = run.eventLedger.events.find((event) => event.type === "VEHICLE_FAILED");
  const timestamps = Object.freeze(snapshots.map((snapshot) => Number(snapshot.atSecond)));

  const projectFrame = (index: number): ReplayFrameProjection => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= snapshots.length) {
      return fail("cursor", "Replay cursor is outside the committed snapshot sequence.");
    }
    const snapshot = snapshots[index];
    const replayed = replayVerifiedEventLedgerPrefix(
      run.preparedInput,
      run.eventLedger,
      snapshot.throughEventSequence,
    );
    if (replayed.atSecond !== snapshot.atSecond) {
      return fail(`result.snapshots.${index}`, "Verified prefix timestamp conflicts with its snapshot.");
    }
    const vehiclePositions = new Map<string, MapCoordinate>();
    const vehicles = snapshot.vehicles.map((vehicle) => {
      const projected = vehiclePosition(vehicle, snapshot.atSecond, zoneCoordinates, edgeMap);
      vehiclePositions.set(vehicle.id, projected.position);
      return Object.freeze({
        id: vehicle.id,
        state: vehicle.state,
        currentZoneId: vehicle.currentZoneId,
        occupancy: vehicle.onboardPassengerIds.length,
        capacity: vehicle.seats,
        batteryWh: vehicle.batteryWh,
        minimumReserveBasisPoints:
          input.scenario.fleet.minimumReserveBasisPoints,
        position: projected.position,
        failed: vehicle.state === "FAILED",
        ...(projected.activeEdgeId
          ? {
              activeEdgeId: projected.activeEdgeId,
              activeEdgeProgress: projected.activeEdgeProgress,
            }
          : {}),
      });
    });
    const passengers = replayed.passengers.map((passenger, passengerIndex) => {
      const assignedPosition = passenger.assignedVehicleId
        ? vehiclePositions.get(passenger.assignedVehicleId)
        : undefined;
      const zoneId = passenger.currentZoneId ?? passenger.request.originZoneId;
      const position = assignedPosition ?? zoneCoordinates.get(zoneId);
      if (!position) {
        return fail(
          `result.snapshots.${index}.passengers.${passengerIndex}.currentZoneId`,
          "Passenger references an unknown current position.",
        );
      }
      return Object.freeze({
        id: passenger.request.id,
        state: passenger.state,
        originZoneId: passenger.request.originZoneId,
        destinationZoneId: passenger.request.destinationZoneId,
        requestSecond: passenger.request.arrivalSecond,
        ...(passenger.assignedVehicleId
          ? { assignedVehicleId: passenger.assignedVehicleId }
          : {}),
        position,
      });
    });

    let failure: ReplayFailureProjection | null = null;
    if (failureEvent && failureEvent.sequence <= snapshot.throughEventSequence) {
      const vehicleId = failureEvent.facts.vehicleId;
      const disruptionId = failureEvent.facts.disruptionId;
      const snappedZoneId = failureEvent.facts.snappedZoneId;
      if (
        typeof vehicleId !== "string" ||
        typeof disruptionId !== "string" ||
        typeof snappedZoneId !== "string"
      ) {
        return fail("eventLedger.VEHICLE_FAILED.facts", "Failure evidence is incomplete.");
      }
      const position = zoneCoordinates.get(snappedZoneId);
      if (!position) {
        return fail("eventLedger.VEHICLE_FAILED.facts.snappedZoneId", "Failure references an unknown zone.");
      }
      failure = Object.freeze({
        evidenceId: failureEvent.evidenceId,
        vehicleId,
        disruptionId,
        atSecond: failureEvent.atSecond,
        position,
      });
    }

    return deepFreeze({
      runId: run.id,
      scenarioSlot: input.scenarioSlot,
      inputFingerprint: run.preparedInput.fingerprint,
      eventLedgerFingerprint: run.eventLedger.fingerprint,
      resultFingerprint: run.verifiedResult.resultFingerprint,
      index,
      atSecond: snapshot.atSecond,
      displayTime: displayTime(input.horizon.displayStart, snapshot.atSecond),
      throughEventSequence: snapshot.throughEventSequence,
      vehicles,
      passengers,
      failure,
    });
  };

  return deepFreeze({
    runId: run.id,
    scenarioSlot: input.scenarioSlot,
    inputFingerprint: run.preparedInput.fingerprint,
    eventLedgerFingerprint: run.eventLedger.fingerprint,
    resultFingerprint: run.verifiedResult.resultFingerprint,
    networkFingerprint: input.networkFingerprint,
    timestamps,
    startSecond: timestamps[0],
    endSecond: timestamps.at(-1)!,
    frameCount: timestamps.length,
    routes: authoredNetwork.routes,
    demand,
    failureSecond: failureEvent ? Number(failureEvent.atSecond) : null,
    bounds: authoredNetwork.bounds,
    projectFrame,
  });
}
