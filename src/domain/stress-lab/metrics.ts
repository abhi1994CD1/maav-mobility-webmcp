import { findAuthoredRoute } from "./route";
import { roundPositiveRatio } from "./reference-controller";
import {
  basisPoints,
  count,
  metres,
  simulatedSecond,
  StressLabEngineInvariantError,
  wattHours,
  zoneId,
  type ConstraintEvaluation,
  type EvidenceId,
  type MetricSet,
  type SimulationEvent,
  type StressLabRunInput,
  type ZoneId,
} from "./types";

interface PassengerEvidence {
  readonly arrivalSecond: number;
  readonly arrivalEvidenceId: EvidenceId;
  readonly originZoneId: ZoneId;
  readonly destinationZoneId: ZoneId;
  boardSecond?: number;
  boardEvidenceId?: EvidenceId;
  served: boolean;
}

export interface DerivedRunEvidence {
  readonly metrics: MetricSet;
  readonly constraints: readonly ConstraintEvaluation[];
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

function factString(event: SimulationEvent, key: string): string {
  const value = event.facts[key];
  if (typeof value !== "string") {
    throw new StressLabEngineInvariantError(
      `${event.type} is missing required string fact ${key}.`,
    );
  }
  return value;
}

function factNumber(event: SimulationEvent, key: string): number {
  const value = event.facts[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new StressLabEngineInvariantError(
      `${event.type} is missing required integer fact ${key}.`,
    );
  }
  return value;
}

function factBoolean(event: SimulationEvent, key: string): boolean {
  const value = event.facts[key];
  if (typeof value !== "boolean") {
    throw new StressLabEngineInvariantError(
      `${event.type} is missing required boolean fact ${key}.`,
    );
  }
  return value;
}

function factStrings(event: SimulationEvent, key: string): readonly string[] {
  const value = event.facts[key];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new StressLabEngineInvariantError(
      `${event.type} is missing required string-list fact ${key}.`,
    );
  }
  return value as readonly string[];
}

function findRunStarted(events: readonly SimulationEvent[]): SimulationEvent {
  const values = events.filter((event) => event.type === "RUN_STARTED");
  if (values.length !== 1) {
    throw new StressLabEngineInvariantError(
      "A completed ledger must contain exactly one RUN_STARTED event.",
    );
  }
  return values[0];
}

function findRunCompleted(events: readonly SimulationEvent[]): SimulationEvent {
  const values = events.filter((event) => event.type === "RUN_COMPLETED");
  if (values.length !== 1) {
    throw new StressLabEngineInvariantError(
      "A completed ledger must contain exactly one RUN_COMPLETED event.",
    );
  }
  return values[0];
}

function evidenceForMinimum(
  values: readonly { readonly value: number; readonly evidenceId: EvidenceId }[],
): readonly EvidenceId[] {
  if (values.length === 0) return Object.freeze([]);
  const minimum = Math.min(...values.map((entry) => entry.value));
  return Object.freeze(
    values
      .filter((entry) => entry.value === minimum)
      .map((entry) => entry.evidenceId),
  );
}

/** Fold canonical KPIs and hard constraints only from the immutable ledger. */
export function deriveRunEvidence(
  input: StressLabRunInput,
  events: readonly SimulationEvent[],
): DerivedRunEvidence {
  const started = findRunStarted(events);
  const completed = findRunCompleted(events);
  const passengers = new Map<string, PassengerEvidence>();

  let passengerMetresValue = 0;
  let vehicleMetresValue = 0;
  let emptyVehicleMetresValue = 0;
  let seatMetresValue = 0;
  let totalEnergyWhValue = 0;
  let reserveBlockedAssignmentsValue = 0;
  let reserveViolationsValue = 0;
  let peakOccupancyBasisPointsValue: number | null = null;
  const batteryEvidence: {
    readonly value: number;
    readonly evidenceId: EvidenceId;
  }[] = [];
  const standingViolationEvidence: EvidenceId[] = [];
  let failureEvent: SimulationEvent | undefined;
  let recoveryCompletedEvent: SimulationEvent | undefined;
  let disruptionTargetMissing = false;

  const considerOccupancy = (event: SimulationEvent): void => {
    const onboard = event.facts.totalOnboardAfter;
    const activeSeats = event.facts.activeSeatCountAfter;
    if (onboard === undefined && activeSeats === undefined) return;
    if (
      typeof onboard !== "number" ||
      typeof activeSeats !== "number" ||
      !Number.isSafeInteger(onboard) ||
      !Number.isSafeInteger(activeSeats) ||
      onboard < 0 ||
      activeSeats < 0 ||
      onboard > activeSeats
    ) {
      throw new StressLabEngineInvariantError(
        `${event.type} contains invalid fleet occupancy evidence.`,
      );
    }
    if (activeSeats > 0) {
      const ratio = roundPositiveRatio(onboard * 10_000, activeSeats);
      peakOccupancyBasisPointsValue = Math.max(
        peakOccupancyBasisPointsValue ?? 0,
        ratio,
      );
    }
  };

  for (const event of events) {
    considerOccupancy(event);
    switch (event.type) {
      case "RUN_STARTED": {
        const minimumBattery = event.facts.minimumBatteryBasisPoints;
        if (typeof minimumBattery === "number") {
          if (!Number.isSafeInteger(minimumBattery)) {
            throw new StressLabEngineInvariantError(
              "RUN_STARTED contains invalid battery evidence.",
            );
          }
          batteryEvidence.push({
            value: minimumBattery,
            evidenceId: event.evidenceId,
          });
        }
        break;
      }
      case "PASSENGER_ARRIVED": {
        const passengerId = factString(event, "passengerId");
        if (passengers.has(passengerId)) {
          throw new StressLabEngineInvariantError(
            `Passenger ${passengerId} arrived more than once.`,
          );
        }
        passengers.set(passengerId, {
          arrivalSecond: factNumber(event, "requestSecond"),
          arrivalEvidenceId: event.evidenceId,
          originZoneId: zoneId(factString(event, "originZoneId")),
          destinationZoneId: zoneId(factString(event, "destinationZoneId")),
          served: false,
        });
        break;
      }
      case "PASSENGERS_BOARDED": {
        const boardedAtSecond = factNumber(event, "boardedAtSecond");
        const passengerIds = factStrings(event, "passengerIds");
        const occupancyAfter = factNumber(event, "occupancyAfter");
        const seatCapacity = factNumber(event, "seatCapacity");
        if (occupancyAfter > seatCapacity) {
          standingViolationEvidence.push(event.evidenceId);
        }
        for (const passengerId of passengerIds) {
          const evidence = passengers.get(passengerId);
          if (!evidence) {
            throw new StressLabEngineInvariantError(
              `Passenger ${passengerId} boarded before arrival evidence.`,
            );
          }
          if (evidence.boardSecond === undefined) {
            evidence.boardSecond = boardedAtSecond;
            evidence.boardEvidenceId = event.evidenceId;
          }
        }
        break;
      }
      case "PASSENGERS_SERVED": {
        passengerMetresValue += factNumber(event, "passengerMetres");
        for (const passengerId of factStrings(event, "passengerIds")) {
          const evidence = passengers.get(passengerId);
          if (!evidence || evidence.served) {
            throw new StressLabEngineInvariantError(
              `Passenger ${passengerId} has invalid service evidence.`,
            );
          }
          evidence.served = true;
        }
        break;
      }
      case "BATTERY_CHANGED": {
        const distance = factNumber(event, "distanceMetres");
        const energy = factNumber(event, "energyWh");
        const seats = factNumber(event, "seatCapacity");
        const movementKind = factString(event, "movementKind");
        const batteryBasisPointsValue = factNumber(
          event,
          "batteryAfterBasisPoints",
        );
        vehicleMetresValue += distance;
        seatMetresValue += distance * seats;
        totalEnergyWhValue += energy;
        if (movementKind === "EMPTY") emptyVehicleMetresValue += distance;
        if (factBoolean(event, "belowReserve")) reserveViolationsValue += 1;
        batteryEvidence.push({
          value: batteryBasisPointsValue,
          evidenceId: event.evidenceId,
        });
        break;
      }
      case "ACTION_REJECTED":
        if (event.facts.reasonCode === "RESERVE_INFEASIBLE") {
          reserveBlockedAssignmentsValue += 1;
        }
        break;
      case "VEHICLE_FAILED":
        if (failureEvent) {
          throw new StressLabEngineInvariantError(
            "H0 supports at most one applied vehicle failure per run.",
          );
        }
        failureEvent = event;
        break;
      case "RECOVERY_COMPLETED":
        if (recoveryCompletedEvent) {
          throw new StressLabEngineInvariantError(
            "A disruption may complete recovery only once.",
          );
        }
        recoveryCompletedEvent = event;
        break;
      case "DISRUPTION_TARGET_NOT_FOUND":
        disruptionTargetMissing = true;
        break;
      default:
        break;
    }
  }

  if (passengers.size !== input.demandTrace.requests.length) {
    throw new StressLabEngineInvariantError(
      "Passenger-arrival ledger count does not match the frozen demand trace.",
    );
  }

  const waits = [...passengers.entries()].map(([id, evidence]) => {
    if (evidence.served && evidence.boardSecond === undefined) {
      throw new StressLabEngineInvariantError(
        `Passenger ${id} was served without boarding evidence.`,
      );
    }
    const boardOrHorizon =
      evidence.boardSecond ?? input.terminalEvaluationSecond;
    const wait = boardOrHorizon - evidence.arrivalSecond;
    if (!Number.isSafeInteger(wait) || wait < 0) {
      throw new StressLabEngineInvariantError(
        `Passenger ${id} has invalid wait evidence.`,
      );
    }
    return {
      passengerId: id,
      wait,
      evidenceId: evidence.boardEvidenceId ?? evidence.arrivalEvidenceId,
      boarded: evidence.boardSecond !== undefined,
      served: evidence.served,
      originZoneId: evidence.originZoneId,
      destinationZoneId: evidence.destinationZoneId,
    };
  });
  const terminalServedIds = factStrings(completed, "servedPassengerIds");
  const terminalInServiceIds = factStrings(
    completed,
    "inServiceAtHorizonPassengerIds",
  );
  const terminalUnservedIds = factStrings(completed, "unservedPassengerIds");
  const terminalIds = [
    ...terminalServedIds,
    ...terminalInServiceIds,
    ...terminalUnservedIds,
  ];
  if (
    new Set(terminalIds).size !== terminalIds.length ||
    terminalIds.length !== passengers.size ||
    terminalIds.some((id) => !passengers.has(id))
  ) {
    throw new StressLabEngineInvariantError(
      "RUN_COMPLETED terminal passenger partitions are not exhaustive and disjoint.",
    );
  }
  for (const [id, evidence] of passengers) {
    if (evidence.served !== terminalServedIds.includes(id)) {
      throw new StressLabEngineInvariantError(
        `Passenger ${id} terminal service outcome conflicts with service events.`,
      );
    }
  }
  const requested = waits.length;
  const served = terminalServedIds.length;
  const inServiceAtHorizon = terminalInServiceIds.length;
  const unserved = terminalUnservedIds.length;
  const sortedWaits = waits.map((entry) => entry.wait).sort((a, b) => a - b);
  const maximumWait = sortedWaits.at(-1) ?? 0;
  const averageWait =
    requested === 0
      ? null
      : roundPositiveRatio(
          sortedWaits.reduce((total, value) => total + value, 0),
          requested,
        );
  const p95Wait =
    requested === 0
      ? null
      : sortedWaits[Math.max(0, Math.ceil((requested * 95) / 100) - 1)];
  const onTime =
    requested === 0
      ? null
      : roundPositiveRatio(
          waits.filter(
            (entry) =>
              entry.boarded &&
              entry.wait <= input.scenario.constraints.maximumWaitSeconds,
          ).length * 10_000,
          requested,
        );
  const minimumBattery =
    batteryEvidence.length === 0
      ? null
      : Math.min(...batteryEvidence.map((entry) => entry.value));
  const recoveryTime = recoveryCompletedEvent
    ? factNumber(recoveryCompletedEvent, "recoveryTimeSeconds")
    : null;

  // Recompute served passenger authored distances independently as a
  // reconciliation against the aggregate event facts.
  const expectedPassengerMetres = waits
    .filter((entry) => entry.served)
    .reduce(
      (total, entry) =>
        total +
        findAuthoredRoute(
          input.network,
          entry.originZoneId,
          entry.destinationZoneId,
        ).distanceMetres,
      0,
    );
  if (passengerMetresValue !== expectedPassengerMetres) {
    throw new StressLabEngineInvariantError(
      "Passenger-distance events do not reconcile to authored served OD routes.",
    );
  }
  const utilizationBasisPointsValue =
    seatMetresValue === 0
      ? null
      : roundPositiveRatio(passengerMetresValue * 10_000, seatMetresValue);
  if (
    utilizationBasisPointsValue !== null &&
    utilizationBasisPointsValue > 10_000
  ) {
    throw new StressLabEngineInvariantError(
      "Passenger-distance evidence exceeds available seat-distance evidence.",
    );
  }

  const metrics: MetricSet = deepFreeze({
    requestedPassengers: count(requested),
    servedPassengers: count(served),
    inServiceAtHorizonPassengers: count(inServiceAtHorizon),
    unservedPassengers: count(unserved),
    averageWaitSeconds:
      averageWait === null ? null : simulatedSecond(averageWait),
    p95WaitSeconds: p95Wait === null ? null : simulatedSecond(p95Wait),
    maximumWaitSeconds: simulatedSecond(maximumWait),
    onTimeBasisPoints: onTime === null ? null : basisPoints(onTime),
    peakOccupancyBasisPoints:
      peakOccupancyBasisPointsValue === null
        ? null
        : basisPoints(peakOccupancyBasisPointsValue),
    passengerMetres: metres(passengerMetresValue),
    vehicleMetres: metres(vehicleMetresValue),
    emptyVehicleMetres: metres(emptyVehicleMetresValue),
    utilizationBasisPoints:
      utilizationBasisPointsValue === null
        ? null
        : basisPoints(utilizationBasisPointsValue),
    totalEnergyWh: wattHours(totalEnergyWhValue),
    energyWhPerPassengerKilometre:
      passengerMetresValue === 0
        ? null
        : wattHours(
            roundPositiveRatio(totalEnergyWhValue * 1_000, passengerMetresValue),
          ),
    minimumBatteryBasisPoints:
      minimumBattery === null ? null : basisPoints(minimumBattery),
    reserveViolations: count(reserveViolationsValue),
    reserveBlockedAssignments: count(reserveBlockedAssignmentsValue),
    recoveryTimeSeconds:
      recoveryTime === null ? null : simulatedSecond(recoveryTime),
  });

  const maximumWaitEvidence = Object.freeze(
    waits
      .filter((entry) => entry.wait === maximumWait)
      .map((entry) => entry.evidenceId),
  );
  const disruptionConfigured = input.disruptions.length > 0;
  const recoveryPassed =
    !disruptionConfigured ||
    (!disruptionTargetMissing &&
      failureEvent !== undefined &&
      recoveryTime !== null &&
      recoveryTime <= input.scenario.constraints.maximumRecoverySeconds);
  const constraints: readonly ConstraintEvaluation[] = deepFreeze([
    {
      code: "MAXIMUM_WAIT",
      passed: maximumWait <= input.scenario.constraints.maximumWaitSeconds,
      observed: maximumWait,
      threshold: input.scenario.constraints.maximumWaitSeconds,
      unit: "SECONDS",
      evidenceIds: maximumWaitEvidence,
    },
    {
      code: "MAXIMUM_UNSERVED",
      passed: unserved <= input.scenario.constraints.maximumUnservedPassengers,
      observed: unserved,
      threshold: input.scenario.constraints.maximumUnservedPassengers,
      unit: "PASSENGERS",
      evidenceIds: [completed.evidenceId],
    },
    {
      code: "MINIMUM_RESERVE",
      passed:
        reserveViolationsValue === 0 &&
        (minimumBattery === null ||
          minimumBattery >=
            input.scenario.constraints.minimumBatteryReserveBasisPoints),
      observed: minimumBattery,
      threshold: input.scenario.constraints.minimumBatteryReserveBasisPoints,
      unit: "BASIS_POINTS",
      evidenceIds: evidenceForMinimum(batteryEvidence),
    },
    {
      code: "MAXIMUM_RECOVERY",
      passed: recoveryPassed,
      observed: recoveryTime,
      threshold: input.scenario.constraints.maximumRecoverySeconds,
      unit: "SECONDS",
      evidenceIds: Object.freeze(
        [failureEvent?.evidenceId, recoveryCompletedEvent?.evidenceId]
          .filter((value): value is EvidenceId => value !== undefined),
      ),
    },
    {
      code: "NO_STANDING",
      passed: standingViolationEvidence.length === 0,
      observed: standingViolationEvidence.length,
      threshold: 0,
      unit: "COUNT",
      evidenceIds: Object.freeze(standingViolationEvidence),
    },
  ]);

  if (factNumber(started, "requestCount") !== requested) {
    throw new StressLabEngineInvariantError(
      "RUN_STARTED request count does not match ledger arrivals.",
    );
  }
  if (
    factNumber(completed, "servedPassengers") !== served ||
    factNumber(completed, "inServiceAtHorizonPassengers") !==
      inServiceAtHorizon ||
    factNumber(completed, "unservedPassengers") !== unserved
  ) {
    throw new StressLabEngineInvariantError(
      "RUN_COMPLETED passenger counts do not reconcile to the ledger.",
    );
  }
  if (requested !== served + inServiceAtHorizon + unserved) {
    throw new StressLabEngineInvariantError(
      "Terminal passenger outcomes do not conserve the frozen demand trace.",
    );
  }

  return deepFreeze({ metrics, constraints });
}
