import {
  controllerId,
  controllerVersion,
  STRESS_LAB_CONTROLLER_VERSION,
  type ControllerObservationV1,
  type ControllerPassengerObservationV1,
  type ControllerTopologyEdgeV1,
  type ControllerVehicleObservationV1,
  type DispatchControllerV1,
  type DispatchIntentV1,
  type PassengerId,
  type ZoneId,
} from "./types";
import {
  batteryWhAtBasisPoints,
  energyWhForDistance,
  isMissionReserveFeasible,
} from "./simulation-math";

export {
  batteryWhAtBasisPoints,
  energyWhForDistance,
  isMissionReserveFeasible,
  roundPositiveRatio,
} from "./simulation-math";

export const REFERENCE_CONTROLLER_ID = controllerId(
  "oldest-wait-nearest-idle",
);

export const REFERENCE_CONTROLLER = Object.freeze({
  controllerId: REFERENCE_CONTROLLER_ID,
  controllerVersion: controllerVersion(STRESS_LAB_CONTROLLER_VERSION),
  policy: "OLDEST_WAIT_NEAREST_IDLE_V1" as const,
  optimizing: false as const,
});

interface ControllerRoute {
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  readonly edgeIds: readonly string[];
  readonly distanceMetres: number;
  readonly travelSeconds: number;
  readonly signature: string;
}

interface WaitingGroup {
  readonly originZoneId: ZoneId;
  readonly destinationZoneId: ZoneId;
  readonly passengers: readonly ControllerPassengerObservationV1[];
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function routeFromTopology(
  observation: ControllerObservationV1,
  fromZoneId: ZoneId,
  toZoneId: ZoneId,
): ControllerRoute | undefined {
  if (fromZoneId === toZoneId) {
    return Object.freeze({
      fromZoneId,
      toZoneId,
      edgeIds: Object.freeze([]),
      distanceMetres: 0,
      travelSeconds: 0,
      signature: `${fromZoneId}:stationary`,
    });
  }
  const candidates: ControllerRoute[] = [];
  const outgoing = (zone: ZoneId): readonly ControllerTopologyEdgeV1[] =>
    observation.topology.edges
      .filter((edge) => edge.fromZoneId === zone)
      .sort((left, right) => compareCodeUnits(left.id, right.id));
  const visit = (
    current: ZoneId,
    visited: ReadonlySet<ZoneId>,
    edges: readonly ControllerTopologyEdgeV1[],
    distanceMetres: number,
    travelSeconds: number,
  ): void => {
    if (current === toZoneId) {
      const edgeIds = edges.map((edge) => edge.id);
      candidates.push(
        Object.freeze({
          fromZoneId,
          toZoneId,
          edgeIds: Object.freeze(edgeIds),
          distanceMetres,
          travelSeconds,
          signature: edgeIds.join(">"),
        }),
      );
      return;
    }
    for (const edge of outgoing(current)) {
      if (visited.has(edge.toZoneId)) continue;
      const next = new Set(visited);
      next.add(edge.toZoneId);
      visit(
        edge.toZoneId,
        next,
        [...edges, edge],
        distanceMetres + edge.distanceMetres,
        travelSeconds + edge.travelSeconds,
      );
    }
  };
  visit(fromZoneId, new Set([fromZoneId]), [], 0, 0);
  return candidates.sort((left, right) => {
    if (left.travelSeconds !== right.travelSeconds) {
      return left.travelSeconds - right.travelSeconds;
    }
    if (left.distanceMetres !== right.distanceMetres) {
      return left.distanceMetres - right.distanceMetres;
    }
    return compareCodeUnits(left.signature, right.signature);
  })[0];
}

function waitingGroups(
  observation: ControllerObservationV1,
): readonly WaitingGroup[] {
  const grouped = new Map<string, ControllerPassengerObservationV1[]>();
  for (const passenger of observation.eligiblePassengers) {
    const key = `${passenger.currentZoneId}->${passenger.destinationZoneId}`;
    const values = grouped.get(key) ?? [];
    values.push(passenger);
    grouped.set(key, values);
  }
  return [...grouped.values()]
    .map((passengers) => {
      const ordered = [...passengers].sort((left, right) => {
        if (left.arrivalSecond !== right.arrivalSecond) {
          return left.arrivalSecond - right.arrivalSecond;
        }
        return compareCodeUnits(left.id, right.id);
      });
      const first = ordered[0];
      if (!first) throw new Error("Controller waiting group is empty.");
      return Object.freeze({
        originZoneId: first.currentZoneId,
        destinationZoneId: first.destinationZoneId,
        passengers: Object.freeze(ordered),
      });
    })
    .sort((left, right) => {
      const arrivalDifference =
        (left.passengers[0]?.arrivalSecond ?? 0) -
        (right.passengers[0]?.arrivalSecond ?? 0);
      if (arrivalDifference !== 0) return arrivalDifference;
      const originDifference = compareCodeUnits(
        left.originZoneId,
        right.originZoneId,
      );
      if (originDifference !== 0) return originDifference;
      return compareCodeUnits(left.destinationZoneId, right.destinationZoneId);
    });
}

interface IntentCandidate {
  readonly intent: DispatchIntentV1;
  readonly reserveFeasible: boolean;
}

function intentCandidate(
  observation: ControllerObservationV1,
  vehicle: ControllerVehicleObservationV1,
  group: WaitingGroup,
): IntentCandidate | undefined {
  const emptyRoute = routeFromTopology(
    observation,
    vehicle.currentZoneId,
    group.originZoneId,
  );
  const serviceRoute = routeFromTopology(
    observation,
    group.originZoneId,
    group.destinationZoneId,
  );
  if (!emptyRoute || !serviceRoute) return undefined;
  const requiredEnergyWh =
    energyWhForDistance(
      emptyRoute.distanceMetres,
      observation.fleetParameters.energyWhPerKilometre,
    ) +
    energyWhForDistance(
      serviceRoute.distanceMetres,
      observation.fleetParameters.energyWhPerKilometre,
    );
  const reserveWh = batteryWhAtBasisPoints(
    observation.fleetParameters.batteryCapacityWh,
    observation.fleetParameters.minimumReserveBasisPoints,
  );
  return Object.freeze({
    intent: Object.freeze({
      intentVersion: "dispatch-intent-v1",
      kind: "DISPATCH",
      vehicleId: vehicle.id,
      passengerIds: Object.freeze(
        group.passengers.slice(0, vehicle.seats).map((passenger) => passenger.id),
      ),
      originZoneId: group.originZoneId,
      destinationZoneId: group.destinationZoneId,
    }),
    reserveFeasible: isMissionReserveFeasible(
      vehicle.batteryWh,
      requiredEnergyWh,
      reserveWh,
    ),
  });
}

function decideReference(
  observation: ControllerObservationV1,
): readonly DispatchIntentV1[] {
  const groups = waitingGroups(observation);
  const vehicles = observation.vehicles
    .filter((vehicle) => vehicle.state === "IDLE")
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  let firstReserveBlocked: DispatchIntentV1 | undefined;
  for (const vehicle of vehicles) {
    for (const group of groups.filter(
      (candidate) => candidate.originZoneId === vehicle.currentZoneId,
    )) {
      const candidate = intentCandidate(observation, vehicle, group);
      if (candidate?.reserveFeasible) return Object.freeze([candidate.intent]);
      firstReserveBlocked ??= candidate?.intent;
    }
  }
  for (const group of groups) {
    const ranked = vehicles
      .map((vehicle) => ({
        vehicle,
        pickupRoute: routeFromTopology(
          observation,
          vehicle.currentZoneId,
          group.originZoneId,
        ),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          vehicle: ControllerVehicleObservationV1;
          pickupRoute: ControllerRoute;
        } => candidate.pickupRoute !== undefined,
      )
      .sort((left, right) => {
        if (left.pickupRoute.travelSeconds !== right.pickupRoute.travelSeconds) {
          return left.pickupRoute.travelSeconds - right.pickupRoute.travelSeconds;
        }
        if (left.pickupRoute.distanceMetres !== right.pickupRoute.distanceMetres) {
          return left.pickupRoute.distanceMetres - right.pickupRoute.distanceMetres;
        }
        if (left.vehicle.batteryWh !== right.vehicle.batteryWh) {
          return right.vehicle.batteryWh - left.vehicle.batteryWh;
        }
        return compareCodeUnits(left.vehicle.id, right.vehicle.id);
      });
    for (const candidate of ranked) {
      const decision = intentCandidate(observation, candidate.vehicle, group);
      if (decision?.reserveFeasible) return Object.freeze([decision.intent]);
      firstReserveBlocked ??= decision?.intent;
    }
  }
  return firstReserveBlocked
    ? Object.freeze([firstReserveBlocked])
    : Object.freeze([]);
}

export const REFERENCE_DISPATCH_CONTROLLER: DispatchControllerV1 = Object.freeze({
  controllerId: REFERENCE_CONTROLLER.controllerId,
  controllerVersion: REFERENCE_CONTROLLER.controllerVersion,
  decide: decideReference,
});

/** Convenience facade retained for focused policy tests. */
export function selectNextDispatch(
  observation: ControllerObservationV1,
): DispatchIntentV1 | undefined {
  return REFERENCE_DISPATCH_CONTROLLER.decide(observation)[0];
}

export function orderedPassengerIds(
  passengerIds: readonly PassengerId[],
): readonly PassengerId[] {
  return Object.freeze([...passengerIds].sort(compareCodeUnits));
}
