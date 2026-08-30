import { canonicalJson } from "./canonical-json";
import { createEventLedgerDocument } from "./fingerprint";
import { deriveInitialOperationalState } from "./initial-state";
import { prepareStressLabRunInput } from "./run-input";
import { activeLegProgressAt, energyWhForDistance } from "./simulation-math";
import {
  count,
  disruptionId,
  edgeId,
  evidenceId,
  fingerprint,
  metres,
  passengerId,
  simulatedSecond,
  STRESS_LAB_ENGINE_VERSION,
  STRESS_LAB_EVENT_SCHEMA_VERSION,
  STRESS_LAB_TICK_SEMANTICS_VERSION,
  StressLabArtifactVerificationError,
  vehicleId,
  wattHours,
  zoneId,
  type ActiveBoardingOperation,
  type ActiveLegEvidence,
  type DisruptionId,
  type EventLedgerEnvelope,
  type PassengerId,
  type PassengerState,
  type PreparedRunInput,
  type SimulationEvent,
  type SimulationEventType,
  type SimulationState,
  type StressLabRunInput,
  type VehicleState,
} from "./types";

interface MutableReplayState {
  atSecond: number;
  nextEventSequence: number;
  passengers: Array<{
    request: PassengerState["request"];
    state: PassengerState["state"];
    assignedVehicleId?: VehicleState["id"];
    currentZoneId?: PassengerState["currentZoneId"];
    firstBoardedAtSecond?: PassengerState["firstBoardedAtSecond"];
    servedAtSecond?: PassengerState["servedAtSecond"];
    affectedByDisruptionId?: PassengerState["affectedByDisruptionId"];
    recoveryReleaseSecond?: PassengerState["recoveryReleaseSecond"];
  }>;
  vehicles: Array<{
    id: VehicleState["id"];
    state: VehicleState["state"];
    currentZoneId: VehicleState["currentZoneId"];
    seats: VehicleState["seats"];
    onboardPassengerIds: PassengerId[];
    reservedPassengerIds: PassengerId[];
    batteryWh: VehicleState["batteryWh"];
    assignedOriginZoneId?: VehicleState["assignedOriginZoneId"];
    assignedDestinationZoneId?: VehicleState["assignedDestinationZoneId"];
    activeLeg?: ActiveLegEvidence;
    activeBoardingOperation?: ActiveBoardingOperation;
    dwellEndsAtSecond?: VehicleState["dwellEndsAtSecond"];
    failedByDisruptionId?: VehicleState["failedByDisruptionId"];
  }>;
  appliedDisruptionIds: DisruptionId[];
  recoveryCompletedDisruptionIds: DisruptionId[];
}

const EVENT_TYPES: readonly SimulationEventType[] = Object.freeze([
  "RUN_STARTED", "TICK_OBSERVED", "PASSENGER_ARRIVED",
  "VEHICLE_DISPATCHED_EMPTY", "VEHICLE_ARRIVED_PICKUP",
  "PASSENGERS_BOARDED", "VEHICLE_DEPARTED_SERVICE",
  "VEHICLE_ARRIVED_DROPOFF", "PASSENGERS_SERVED", "BATTERY_CHANGED",
  "VEHICLE_FAILED", "PASSENGERS_REQUEUED", "RECOVERY_ASSIGNED",
  "RECOVERY_COMPLETED", "ACTION_REJECTED", "DISRUPTION_TARGET_NOT_FOUND",
  "RUN_COMPLETED",
]);

const EVENT_KEYS = Object.freeze([
  "evidenceId",
  "type",
  "atSecond",
  "sequence",
  "facts",
] as const);

const COMMON_FACT_KEYS = Object.freeze([
  "totalOnboardAfter",
  "activeSeatCountAfter",
] as const);

const EVENT_FACT_KEYS: Readonly<Record<SimulationEventType, readonly string[]>> =
  Object.freeze({
    RUN_STARTED: Object.freeze([
      "inputFingerprint",
      "engineVersion",
      "tickSemanticsVersion",
      "controllerId",
      "controllerVersion",
      "controllerPolicy",
      "metricDefinitionVersion",
      "eventSchemaVersion",
      "resultSchemaVersion",
      "scenarioSlot",
      "requestCount",
      "vehicleCount",
      "minimumBatteryBasisPoints",
      "vehicleIds",
      ...COMMON_FACT_KEYS,
    ]),
    TICK_OBSERVED: Object.freeze([
      "terminalEvaluation",
      "intakeOpen",
      ...COMMON_FACT_KEYS,
    ]),
    PASSENGER_ARRIVED: Object.freeze([
      "passengerId",
      "requestSecond",
      "originZoneId",
      "destinationZoneId",
      ...COMMON_FACT_KEYS,
    ]),
    VEHICLE_DISPATCHED_EMPTY: Object.freeze([
      "vehicleId",
      "fromZoneId",
      "toZoneId",
      "serviceDestinationZoneId",
      "passengerIds",
      "distanceMetres",
      "travelSeconds",
      "projectedEnergyWh",
      "activeLeg",
      ...COMMON_FACT_KEYS,
    ]),
    VEHICLE_ARRIVED_PICKUP: Object.freeze([
      "vehicleId",
      "zoneId",
      "destinationZoneId",
      "passengerIds",
      "dwellEndsAtSecond",
      "boardingOperation",
      "boardingOperationStarted",
      ...COMMON_FACT_KEYS,
    ]),
    PASSENGERS_BOARDED: Object.freeze([
      "vehicleId",
      "passengerIds",
      "boardedAtSecond",
      "occupancyAfter",
      "seatCapacity",
      "zoneId",
      "terminalHold",
      ...COMMON_FACT_KEYS,
    ]),
    VEHICLE_DEPARTED_SERVICE: Object.freeze([
      "vehicleId",
      "fromZoneId",
      "toZoneId",
      "passengerIds",
      "distanceMetres",
      "travelSeconds",
      "projectedEnergyWh",
      "activeLeg",
      ...COMMON_FACT_KEYS,
    ]),
    VEHICLE_ARRIVED_DROPOFF: Object.freeze([
      "vehicleId",
      "zoneId",
      "passengerIds",
      ...COMMON_FACT_KEYS,
    ]),
    PASSENGERS_SERVED: Object.freeze([
      "vehicleId",
      "passengerIds",
      "passengerMetres",
      ...COMMON_FACT_KEYS,
    ]),
    BATTERY_CHANGED: Object.freeze([
      "vehicleId",
      "movementKind",
      "partial",
      "beforeWh",
      "afterWh",
      "energyWh",
      "distanceMetres",
      "cumulativeDistanceMetres",
      "cumulativeEnergyWh",
      "currentEdgeId",
      "onboardCountDuringLeg",
      "seatCapacity",
      "batteryAfterBasisPoints",
      "belowReserve",
      ...COMMON_FACT_KEYS,
    ]),
    VEHICLE_FAILED: Object.freeze([
      "disruptionId",
      "vehicleId",
      "stateBefore",
      "snappedZoneId",
      "activeLegBefore",
      "partialDistanceMetres",
      "partialEnergyWh",
      "onboardPassengerIds",
      "reservedPassengerIds",
      "reservedPickupZoneId",
      "onboardRecoveryReleaseSecond",
      "selectedOnboardCount",
      "selectedReservedCount",
      "selectedActiveService",
      "rankedCandidates",
      ...COMMON_FACT_KEYS,
    ]),
    PASSENGERS_REQUEUED: Object.freeze([
      "disruptionId",
      "passengerIds",
      "releaseSecond",
      "reasonCode",
      "zoneId",
      ...COMMON_FACT_KEYS,
    ]),
    RECOVERY_ASSIGNED: Object.freeze([
      "vehicleId",
      "passengerIds",
      "originZoneId",
      "destinationZoneId",
      ...COMMON_FACT_KEYS,
    ]),
    RECOVERY_COMPLETED: Object.freeze([
      "disruptionId",
      "affectedPassengerIds",
      "failureSecond",
      "recoveryTimeSeconds",
      "reasonCode",
      ...COMMON_FACT_KEYS,
    ]),
    ACTION_REJECTED: Object.freeze([
      "controllerId",
      "controllerVersion",
      "intentKind",
      "reasonCode",
      "vehicleId",
      "passengerIds",
      ...COMMON_FACT_KEYS,
    ]),
    DISRUPTION_TARGET_NOT_FOUND: Object.freeze([
      "disruptionId",
      "policyVersion",
      "reasonCode",
      ...COMMON_FACT_KEYS,
    ]),
    RUN_COMPLETED: Object.freeze([
      "requestedPassengers",
      "servedPassengers",
      "inServiceAtHorizonPassengers",
      "unservedPassengers",
      "servedPassengerIds",
      "inServiceAtHorizonPassengerIds",
      "unservedPassengerIds",
      "strandedPassengerIds",
      "waitingPassengers",
      "reservedPassengers",
      "onboardPassengers",
      "recoveryWaitPassengers",
      "failedVehicles",
      ...COMMON_FACT_KEYS,
    ]),
  });

const ACTIVE_LEG_KEYS = Object.freeze([
  "kind",
  "purpose",
  "fromZoneId",
  "toZoneId",
  "edgeIds",
  "pathZoneIds",
  "passengerIds",
  "reservationIds",
  "edges",
  "distanceMetres",
  "travelSeconds",
  "energyWh",
  "startedAtSecond",
  "endsAtSecond",
  "onboardCountAtDeparture",
  "accountedDistanceMetres",
  "accountedEnergyWh",
] as const);

const ACTIVE_LEG_EDGE_KEYS = Object.freeze([
  "edgeId",
  "fromZoneId",
  "toZoneId",
  "distanceMetres",
  "travelSeconds",
  "energyWh",
  "startOffsetSeconds",
  "endOffsetSeconds",
] as const);

const BOARDING_OPERATION_KEYS = Object.freeze([
  "startedAtSecond",
  "completesAtSecond",
  "passengerIds",
  "originZoneId",
  "destinationZoneId",
] as const);

const LEDGER_ENVELOPE_KEYS = Object.freeze([
  "eventSchemaVersion",
  "inputFingerprint",
  "engineVersion",
  "tickSemanticsVersion",
  "controllerId",
  "controllerVersion",
  "events",
  "fingerprint",
] as const);

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function fail(message: string, path = "eventLedger"): never {
  throw new StressLabArtifactVerificationError(path, message);
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("Expected a plain object.", path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("Expected a plain object.", path);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = plainRecord(value, path);
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      fail("Unexpected property.", `${path}.${key}`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      fail("Missing required property.", `${path}.${key}`);
    }
  }
  return record;
}

function assertDenseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail("Expected an array.", path);
  const keys = Object.keys(value);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail("Sparse array entries are not allowed.", `${path}[${index}]`);
    }
  }
  for (const key of keys) {
    if (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      fail("Unexpected array property.", `${path}.${key}`);
    }
  }
  return value;
}

function eventPath(index: number): string {
  return `eventLedger.events[${index}]`;
}

function assertKnownZone(
  input: StressLabRunInput,
  value: string,
  path: string,
): void {
  if (!input.network.zones.some((zone) => zone.id === value)) {
    fail(`Unknown authored-network zone ${value}.`, path);
  }
}

function assertKnownEdge(
  input: StressLabRunInput,
  value: string,
  path: string,
): void {
  if (!input.network.edges.some((edge) => edge.id === value)) {
    fail(`Unknown authored-network edge ${value}.`, path);
  }
}

function cloneLeg(leg: ActiveLegEvidence): ActiveLegEvidence {
  return {
    ...leg,
    edgeIds: [...leg.edgeIds],
    pathZoneIds: [...leg.pathZoneIds],
    passengerIds: [...leg.passengerIds],
    reservationIds: [...leg.reservationIds],
    edges: leg.edges.map((edge) => ({ ...edge })),
  };
}

function cloneBoarding(operation: ActiveBoardingOperation): ActiveBoardingOperation {
  return { ...operation, passengerIds: [...operation.passengerIds] };
}

function mutable(initial: SimulationState): MutableReplayState {
  return {
    atSecond: initial.atSecond,
    nextEventSequence: initial.nextEventSequence,
    passengers: initial.passengers.map((entry) => ({ ...entry })),
    vehicles: initial.vehicles.map((entry) => ({
      ...entry,
      onboardPassengerIds: [...entry.onboardPassengerIds],
      reservedPassengerIds: [...entry.reservedPassengerIds],
      ...(entry.activeLeg ? { activeLeg: cloneLeg(entry.activeLeg) } : {}),
      ...(entry.activeBoardingOperation
        ? { activeBoardingOperation: cloneBoarding(entry.activeBoardingOperation) }
        : {}),
    })),
    appliedDisruptionIds: [...initial.appliedDisruptionIds],
    recoveryCompletedDisruptionIds: [...initial.recoveryCompletedDisruptionIds],
  };
}

function facts(event: SimulationEvent): Readonly<Record<string, unknown>> {
  if (event.facts === null || typeof event.facts !== "object" || Array.isArray(event.facts)) {
    fail(`${event.type}.facts must be an object.`);
  }
  return event.facts;
}

function stringFact(event: SimulationEvent, key: string): string {
  const value = facts(event)[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`${event.type}.${key} must be a non-empty string.`);
  }
  return value;
}

function numberFact(event: SimulationEvent, key: string): number {
  const value = facts(event)[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${event.type}.${key} must be a non-negative safe integer.`);
  }
  return value;
}

function booleanFact(event: SimulationEvent, key: string): boolean {
  const value = facts(event)[key];
  if (typeof value !== "boolean") fail(`${event.type}.${key} must be boolean.`);
  return value;
}

function optionalNumberFact(event: SimulationEvent, key: string): number | null {
  const value = facts(event)[key];
  if (value !== null && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    fail(`${event.type}.${key} must be a non-negative safe integer or null.`);
  }
  return value;
}

function stringsFact(event: SimulationEvent, key: string): readonly string[] {
  const value = facts(event)[key];
  const entries = assertDenseArray(value, `${event.type}.${key}`);
  if (entries.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    fail(`${event.type}.${key} must be a string array.`);
  }
  return entries as readonly string[];
}

function knownZoneFact(
  event: SimulationEvent,
  key: string,
  input: StressLabRunInput,
  eventIndex: number,
): string {
  const value = stringFact(event, key);
  assertKnownZone(input, value, `${eventPath(eventIndex)}.facts.${key}`);
  return value;
}

function nullableKnownZoneFact(
  event: SimulationEvent,
  key: string,
  input: StressLabRunInput,
  eventIndex: number,
): string | null {
  if (facts(event)[key] === null) return null;
  return knownZoneFact(event, key, input, eventIndex);
}

function nullableKnownEdgeFact(
  event: SimulationEvent,
  key: string,
  input: StressLabRunInput,
  eventIndex: number,
): string | null {
  if (facts(event)[key] === null) return null;
  const value = stringFact(event, key);
  assertKnownEdge(input, value, `${eventPath(eventIndex)}.facts.${key}`);
  return value;
}

function nestedString(
  value: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): string {
  const entry = value[key];
  if (typeof entry !== "string" || entry.length === 0) {
    fail(`${path}.${key} must be a non-empty string.`);
  }
  return entry;
}

function validateFactValue(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail(`${path} must be a safe integer.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateFactValue(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => validateFactValue(entry, `${path}.${key}`));
    return;
  }
  fail(`${path} contains an unsupported value.`);
}

function activeLegFact(
  event: SimulationEvent,
  key: string,
  input: StressLabRunInput,
  eventIndex: number,
): ActiveLegEvidence {
  const value = facts(event)[key];
  const basePath = `${eventPath(eventIndex)}.facts.${key}`;
  const leg = assertExactKeys(value, ACTIVE_LEG_KEYS, basePath);
  const edgeIdsValue = leg.edgeIds;
  const pathZoneIdsValue = leg.pathZoneIds;
  const passengerIdsValue = leg.passengerIds;
  const reservationIdsValue = leg.reservationIds;
  const edgesValue = leg.edges;
  const edgeIdsArray = assertDenseArray(edgeIdsValue, `${basePath}.edgeIds`);
  const pathZoneIdsArray = assertDenseArray(pathZoneIdsValue, `${basePath}.pathZoneIds`);
  const passengerIdsArray = assertDenseArray(passengerIdsValue, `${basePath}.passengerIds`);
  const reservationIdsArray = assertDenseArray(reservationIdsValue, `${basePath}.reservationIds`);
  const edgesArray = assertDenseArray(edgesValue, `${basePath}.edges`);
  if (edgeIdsArray.length === 0 ||
      edgesArray.length !== edgeIdsArray.length ||
      [...edgeIdsArray, ...pathZoneIdsArray, ...passengerIdsArray, ...reservationIdsArray]
        .some((entry) => typeof entry !== "string" || entry.length === 0)) {
    fail(
      `${event.type}.${key} contains incomplete route arrays ` +
        `(edges=${edgesArray.length}, edgeIds=${edgeIdsArray.length}).`,
      basePath,
    );
  }
  const edges = edgesArray.map((candidate, index) => {
    const edgePath = `${basePath}.edges[${index}]`;
    const edge = assertExactKeys(candidate, ACTIVE_LEG_EDGE_KEYS, edgePath);
    const numericKeys = ["distanceMetres", "travelSeconds", "energyWh", "startOffsetSeconds", "endOffsetSeconds"] as const;
    for (const required of numericKeys) {
      if (typeof edge[required] !== "number" || !Number.isSafeInteger(edge[required]) || (edge[required] as number) < 0) {
        fail("Expected a non-negative safe integer.", `${edgePath}.${required}`);
      }
    }
    const start = edge.startOffsetSeconds as number;
    const end = edge.endOffsetSeconds as number;
    const duration = edge.travelSeconds as number;
    const priorEdge = index === 0
      ? undefined
      : plainRecord(edgesArray[index - 1], `${basePath}.edges[${index - 1}]`);
    const priorEnd = index === 0 ? 0 : Number(priorEdge?.endOffsetSeconds);
    if (duration <= 0 || start !== priorEnd || end !== start + duration) {
      fail("Edge offsets are inconsistent.", edgePath);
    }
    const edgeIdValue = nestedString(edge, "edgeId", edgePath);
    assertKnownEdge(input, edgeIdValue, `${edgePath}.edgeId`);
    const authoredEdge = input.network.edges.find(
      (candidateEdge) => candidateEdge.id === edgeIdValue,
    )!;
    const fromZoneIdValue = nestedString(edge, "fromZoneId", edgePath);
    const toZoneIdValue = nestedString(edge, "toZoneId", edgePath);
    assertKnownZone(input, fromZoneIdValue, `${edgePath}.fromZoneId`);
    assertKnownZone(input, toZoneIdValue, `${edgePath}.toZoneId`);
    const expectedEnergyWh = energyWhForDistance(
      authoredEdge.distanceMetres,
      input.scenario.fleet.energyWhPerKilometre,
    );
    if (
      authoredEdge.fromZoneId !== fromZoneIdValue ||
      authoredEdge.toZoneId !== toZoneIdValue ||
      authoredEdge.distanceMetres !== edge.distanceMetres ||
      authoredEdge.travelSeconds !== duration ||
      expectedEnergyWh !== edge.energyWh
    ) {
      fail(
        "Edge facts do not match the verified authored network and run input.",
        edgePath,
      );
    }
    return {
      edgeId: edgeId(edgeIdValue),
      fromZoneId: zoneId(fromZoneIdValue),
      toZoneId: zoneId(toZoneIdValue),
      distanceMetres: metres(edge.distanceMetres as number),
      travelSeconds: simulatedSecond(duration),
      energyWh: wattHours(edge.energyWh as number),
      startOffsetSeconds: simulatedSecond(start),
      endOffsetSeconds: simulatedSecond(end),
    };
  });
  const distance = Number(leg.distanceMetres);
  const duration = Number(leg.travelSeconds);
  const energy = Number(leg.energyWh);
  const started = Number(leg.startedAtSecond);
  const ended = Number(leg.endsAtSecond);
  const accountedDistance = Number(leg.accountedDistanceMetres);
  const accountedEnergy = Number(leg.accountedEnergyWh);
  const onboard = Number(leg.onboardCountAtDeparture);
  if (![distance, duration, energy, started, ended, accountedDistance, accountedEnergy, onboard].every(Number.isSafeInteger) ||
      distance !== edges.reduce((sum, edge) => sum + edge.distanceMetres, 0) ||
      duration !== edges.reduce((sum, edge) => sum + edge.travelSeconds, 0) ||
      energy !== edges.reduce((sum, edge) => sum + edge.energyWh, 0) ||
      ended !== started + duration || accountedDistance < 0 || accountedDistance > distance ||
      accountedEnergy < 0 || accountedEnergy > energy ||
      edgeIdsArray.some((id, index) => id !== edges[index].edgeId) ||
      edges.some((edge, index) => index > 0 && edges[index - 1].toZoneId !== edge.fromZoneId) ||
      edges[0].fromZoneId !== leg.fromZoneId || edges.at(-1)!.toZoneId !== leg.toZoneId ||
      canonicalJson(pathZoneIdsArray) !==
        canonicalJson([edges[0].fromZoneId, ...edges.map((edge) => edge.toZoneId)])) {
    fail("Active-leg path or totals are inconsistent.", basePath);
  }
  const fromZoneIdValue = nestedString(leg, "fromZoneId", basePath);
  const toZoneIdValue = nestedString(leg, "toZoneId", basePath);
  assertKnownZone(input, fromZoneIdValue, `${basePath}.fromZoneId`);
  assertKnownZone(input, toZoneIdValue, `${basePath}.toZoneId`);
  return cloneLeg({
    kind: leg.kind === "EMPTY" ? "EMPTY" : leg.kind === "SERVICE" ? "SERVICE" : fail(`${event.type}.${key}.kind is invalid.`),
    purpose: leg.purpose === "PICKUP" ? "PICKUP" : leg.purpose === "PASSENGER_SERVICE" ? "PASSENGER_SERVICE" : fail(`${event.type}.${key}.purpose is invalid.`),
    fromZoneId: zoneId(fromZoneIdValue),
    toZoneId: zoneId(toZoneIdValue),
    edgeIds: edgeIdsArray.map((id) => edgeId(id as string)),
    pathZoneIds: pathZoneIdsArray.map((id) => zoneId(id as string)),
    passengerIds: passengerIdsArray.map((id) => passengerId(id as string)),
    reservationIds: reservationIdsArray.map((id) => passengerId(id as string)), edges,
    distanceMetres: metres(distance), travelSeconds: simulatedSecond(duration), energyWh: wattHours(energy),
    startedAtSecond: simulatedSecond(started), endsAtSecond: simulatedSecond(ended),
    onboardCountAtDeparture: count(onboard), accountedDistanceMetres: metres(accountedDistance),
    accountedEnergyWh: wattHours(accountedEnergy),
  });
}

function boardingFact(
  event: SimulationEvent,
  key: string,
  input: StressLabRunInput,
  eventIndex: number,
): ActiveBoardingOperation {
  const value = facts(event)[key];
  const basePath = `${eventPath(eventIndex)}.facts.${key}`;
  const operation = assertExactKeys(value, BOARDING_OPERATION_KEYS, basePath);
  const started = Number(operation.startedAtSecond);
  const completed = Number(operation.completesAtSecond);
  const passengerIdsValue = assertDenseArray(
    operation.passengerIds,
    `${basePath}.passengerIds`,
  );
  if (!Number.isSafeInteger(started) || !Number.isSafeInteger(completed) || completed < started ||
      passengerIdsValue.some((id) => typeof id !== "string" || id.length === 0)) {
    fail("Boarding operation is malformed.", basePath);
  }
  const originZoneIdValue = nestedString(operation, "originZoneId", basePath);
  const destinationZoneIdValue = nestedString(
    operation,
    "destinationZoneId",
    basePath,
  );
  assertKnownZone(input, originZoneIdValue, `${basePath}.originZoneId`);
  assertKnownZone(
    input,
    destinationZoneIdValue,
    `${basePath}.destinationZoneId`,
  );
  return cloneBoarding({
    startedAtSecond: simulatedSecond(started), completesAtSecond: simulatedSecond(completed),
    passengerIds: passengerIdsValue.map((id) => passengerId(id as string)),
    originZoneId: zoneId(originZoneIdValue),
    destinationZoneId: zoneId(destinationZoneIdValue),
  });
}

function movementStartLeg(
  event: SimulationEvent,
  input: StressLabRunInput,
  eventIndex: number,
): ActiveLegEvidence {
  const leg = activeLegFact(event, "activeLeg", input, eventIndex);
  if (leg.accountedDistanceMetres !== 0 || leg.accountedEnergyWh !== 0) {
    fail(`${event.type}.activeLeg must start with zero accounted movement.`);
  }
  return leg;
}

type MutableReplayVehicle = MutableReplayState["vehicles"][number];

function assertExactPassengerCohort(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
  message: string,
): void {
  if (
    new Set(actual).size !== actual.length ||
    new Set(expected).size !== expected.length ||
    canonicalJson([...actual].sort()) !== canonicalJson([...expected].sort())
  ) {
    fail(message, path);
  }
}

/**
 * Binds a structurally and topologically valid submitted movement to the
 * authoritative replay state. The route may be any connected authored path
 * between the derived endpoints; this validator never selects a route.
 */
function stateBoundMovementStart(
  state: MutableReplayState,
  vehicle: MutableReplayVehicle,
  event: SimulationEvent,
  input: StressLabRunInput,
  eventIndex: number,
): ActiveLegEvidence {
  const leg = movementStartLeg(event, input, eventIndex);
  const basePath = `${eventPath(eventIndex)}.facts.activeLeg`;
  const eventPassengerIds = stringsFact(event, "passengerIds");
  if (leg.startedAtSecond !== event.atSecond || vehicle.activeLeg !== undefined) {
    fail(
      "Movement must start at the event second without replacing an active leg.",
      basePath,
    );
  }

  if (event.type === "VEHICLE_DISPATCHED_EMPTY") {
    if (
      vehicle.state !== "IDLE" ||
      vehicle.onboardPassengerIds.length !== 0 ||
      vehicle.reservedPassengerIds.length !== 0 ||
      leg.kind !== "EMPTY" ||
      leg.purpose !== "PICKUP" ||
      leg.onboardCountAtDeparture !== 0 ||
      leg.passengerIds.length !== 0
    ) {
      fail(
        "Empty pickup leg conflicts with the vehicle's authoritative replay state.",
        basePath,
      );
    }
    assertExactPassengerCohort(
      leg.reservationIds,
      eventPassengerIds,
      `${basePath}.reservationIds`,
      "Empty pickup reservations do not match the dispatched cohort.",
    );
    if (eventPassengerIds.length === 0 || eventPassengerIds.length > vehicle.seats) {
      fail("Empty pickup cohort is empty or exceeds vehicle capacity.", basePath);
    }
    let pickupZone: string | undefined;
    let serviceDestination: string | undefined;
    for (const id of eventPassengerIds) {
      const passenger = findPassenger(state, id);
      if (
        passenger.state !== "WAITING" ||
        passenger.assignedVehicleId !== undefined ||
        passenger.currentZoneId === undefined
      ) {
        fail(
          `Passenger ${id} is not eligible for this pickup assignment.`,
          `${basePath}.reservationIds`,
        );
      }
      pickupZone ??= passenger.currentZoneId;
      serviceDestination ??= passenger.request.destinationZoneId;
      if (
        passenger.currentZoneId !== pickupZone ||
        passenger.request.destinationZoneId !== serviceDestination
      ) {
        fail(
          "Pickup cohort does not share one authoritative current pickup and destination.",
          `${basePath}.reservationIds`,
        );
      }
    }
    if (
      leg.fromZoneId !== vehicle.currentZoneId ||
      leg.toZoneId !== pickupZone ||
      stringFact(event, "serviceDestinationZoneId") !== serviceDestination
    ) {
      fail(
        "Empty pickup endpoints do not match vehicle location and passenger request context.",
        basePath,
      );
    }
    return leg;
  }

  if (event.type === "VEHICLE_DEPARTED_SERVICE") {
    if (
      vehicle.state !== "DWELLING" ||
      vehicle.assignedOriginZoneId === undefined ||
      vehicle.assignedDestinationZoneId === undefined ||
      leg.kind !== "SERVICE" ||
      leg.purpose !== "PASSENGER_SERVICE" ||
      leg.reservationIds.length !== 0
    ) {
      fail(
        "Service leg conflicts with the vehicle's authoritative replay state.",
        basePath,
      );
    }
    assertExactPassengerCohort(
      leg.passengerIds,
      vehicle.onboardPassengerIds,
      `${basePath}.passengerIds`,
      "Service-leg passengers do not match authoritative vehicle occupancy.",
    );
    assertExactPassengerCohort(
      eventPassengerIds,
      vehicle.onboardPassengerIds,
      `${eventPath(eventIndex)}.facts.passengerIds`,
      "Service-departure passengers do not match authoritative vehicle occupancy.",
    );
    if (
      leg.passengerIds.length === 0 ||
      leg.onboardCountAtDeparture !== vehicle.onboardPassengerIds.length ||
      leg.fromZoneId !== vehicle.currentZoneId ||
      leg.fromZoneId !== vehicle.assignedOriginZoneId ||
      leg.toZoneId !== vehicle.assignedDestinationZoneId
    ) {
      fail(
        "Service endpoints or occupancy do not match authoritative replay state.",
        basePath,
      );
    }
    for (const id of vehicle.onboardPassengerIds) {
      const passenger = findPassenger(state, id);
      if (
        passenger.state !== "ONBOARD" ||
        passenger.assignedVehicleId !== vehicle.id ||
        passenger.currentZoneId !== vehicle.currentZoneId ||
        passenger.request.destinationZoneId !== leg.toZoneId
      ) {
        fail(
          `Passenger ${id} cannot authorize this service leg.`,
          `${basePath}.passengerIds`,
        );
      }
    }
    return leg;
  }

  fail("Event cannot create an active leg.", eventPath(eventIndex));
}

function expectedActiveEdgeId(
  leg: ActiveLegEvidence,
  atSecondValue: number,
): string | null {
  const elapsed = Math.max(
    0,
    Math.min(leg.travelSeconds, atSecondValue - leg.startedAtSecond),
  );
  if (elapsed === leg.travelSeconds) return null;
  return leg.edges.find((edge) => elapsed < edge.endOffsetSeconds)?.edgeId ?? null;
}

function validateRequiredFacts(
  event: SimulationEvent,
  input: StressLabRunInput,
  eventIndex: number,
): void {
  const basePath = eventPath(eventIndex);
  assertExactKeys(event.facts, EVENT_FACT_KEYS[event.type], `${basePath}.facts`);
  Object.entries(facts(event)).forEach(([key, value]) =>
    validateFactValue(value, `${basePath}.facts.${key}`),
  );
  numberFact(event, "totalOnboardAfter");
  numberFact(event, "activeSeatCountAfter");

  switch (event.type) {
    case "RUN_STARTED":
      fingerprint(stringFact(event, "inputFingerprint"));
      [
        "engineVersion",
        "tickSemanticsVersion",
        "controllerId",
        "controllerVersion",
        "controllerPolicy",
        "metricDefinitionVersion",
        "eventSchemaVersion",
        "resultSchemaVersion",
        "scenarioSlot",
      ].forEach((key) => stringFact(event, key));
      ["requestCount", "vehicleCount"].forEach((key) => numberFact(event, key));
      optionalNumberFact(event, "minimumBatteryBasisPoints");
      stringsFact(event, "vehicleIds").forEach(vehicleId);
      return;
    case "TICK_OBSERVED":
      booleanFact(event, "terminalEvaluation");
      booleanFact(event, "intakeOpen");
      return;
    case "PASSENGER_ARRIVED":
      passengerId(stringFact(event, "passengerId"));
      numberFact(event, "requestSecond");
      knownZoneFact(event, "originZoneId", input, eventIndex);
      knownZoneFact(event, "destinationZoneId", input, eventIndex);
      return;
    case "VEHICLE_DISPATCHED_EMPTY": {
      vehicleId(stringFact(event, "vehicleId"));
      const fromZoneIdValue = knownZoneFact(event, "fromZoneId", input, eventIndex);
      const toZoneIdValue = knownZoneFact(event, "toZoneId", input, eventIndex);
      knownZoneFact(event, "serviceDestinationZoneId", input, eventIndex);
      const passengerIds = stringsFact(event, "passengerIds");
      passengerIds.forEach(passengerId);
      ["distanceMetres", "travelSeconds", "projectedEnergyWh"].forEach((key) =>
        numberFact(event, key),
      );
      const leg = movementStartLeg(event, input, eventIndex);
      if (
        leg.kind !== "EMPTY" ||
        leg.purpose !== "PICKUP" ||
        leg.fromZoneId !== fromZoneIdValue ||
        leg.toZoneId !== toZoneIdValue ||
        leg.distanceMetres !== numberFact(event, "distanceMetres") ||
        leg.travelSeconds !== numberFact(event, "travelSeconds") ||
        leg.energyWh !== numberFact(event, "projectedEnergyWh") ||
        leg.passengerIds.length !== 0 ||
        canonicalJson(leg.reservationIds) !== canonicalJson(passengerIds)
      ) {
        fail("Empty-dispatch movement facts do not match active-leg evidence.", basePath);
      }
      return;
    }
    case "VEHICLE_ARRIVED_PICKUP": {
      vehicleId(stringFact(event, "vehicleId"));
      const zoneIdValue = knownZoneFact(event, "zoneId", input, eventIndex);
      const destinationZoneIdValue = knownZoneFact(
        event,
        "destinationZoneId",
        input,
        eventIndex,
      );
      const passengerIds = stringsFact(event, "passengerIds");
      passengerIds.forEach(passengerId);
      if (booleanFact(event, "boardingOperationStarted")) {
        const dwellEndsAtSecond = numberFact(event, "dwellEndsAtSecond");
        const operation = boardingFact(event, "boardingOperation", input, eventIndex);
        if (operation.completesAtSecond !== dwellEndsAtSecond) {
          fail(
            "Pickup dwell completion does not match the boarding operation.",
            `${basePath}.facts.dwellEndsAtSecond`,
          );
        }
        if (operation.originZoneId !== zoneIdValue) {
          fail(
            "Pickup zone does not match the boarding operation origin.",
            `${basePath}.facts.zoneId`,
          );
        }
        if (operation.destinationZoneId !== destinationZoneIdValue) {
          fail(
            "Pickup destination does not match the boarding operation.",
            `${basePath}.facts.destinationZoneId`,
          );
        }
        if (
          canonicalJson([...operation.passengerIds].sort()) !==
          canonicalJson([...passengerIds].sort())
        ) {
          fail(
            "Pickup passenger manifest does not match the boarding operation.",
            `${basePath}.facts.passengerIds`,
          );
        }
      } else if (
        facts(event).dwellEndsAtSecond !== null ||
        facts(event).boardingOperation !== null
      ) {
        fail("Terminal pickup arrival cannot contain a new boarding operation.", basePath);
      }
      return;
    }
    case "PASSENGERS_BOARDED":
      vehicleId(stringFact(event, "vehicleId"));
      stringsFact(event, "passengerIds").forEach(passengerId);
      ["boardedAtSecond", "occupancyAfter", "seatCapacity"].forEach((key) =>
        numberFact(event, key),
      );
      knownZoneFact(event, "zoneId", input, eventIndex);
      booleanFact(event, "terminalHold");
      return;
    case "VEHICLE_DEPARTED_SERVICE": {
      vehicleId(stringFact(event, "vehicleId"));
      const fromZoneIdValue = knownZoneFact(event, "fromZoneId", input, eventIndex);
      const toZoneIdValue = knownZoneFact(event, "toZoneId", input, eventIndex);
      const passengerIds = stringsFact(event, "passengerIds");
      passengerIds.forEach(passengerId);
      ["distanceMetres", "travelSeconds", "projectedEnergyWh"].forEach((key) =>
        numberFact(event, key),
      );
      const leg = movementStartLeg(event, input, eventIndex);
      if (
        leg.kind !== "SERVICE" ||
        leg.purpose !== "PASSENGER_SERVICE" ||
        leg.fromZoneId !== fromZoneIdValue ||
        leg.toZoneId !== toZoneIdValue ||
        leg.distanceMetres !== numberFact(event, "distanceMetres") ||
        leg.travelSeconds !== numberFact(event, "travelSeconds") ||
        leg.energyWh !== numberFact(event, "projectedEnergyWh") ||
        canonicalJson(leg.passengerIds) !== canonicalJson(passengerIds) ||
        leg.reservationIds.length !== 0
      ) {
        fail("Service-departure facts do not match active-leg evidence.", basePath);
      }
      return;
    }
    case "BATTERY_CHANGED": {
      vehicleId(stringFact(event, "vehicleId"));
      const movementKind = stringFact(event, "movementKind");
      if (movementKind !== "EMPTY" && movementKind !== "SERVICE") {
        fail("Movement kind is invalid.", `${basePath}.facts.movementKind`);
      }
      booleanFact(event, "partial");
      [
        "beforeWh",
        "afterWh",
        "energyWh",
        "distanceMetres",
        "cumulativeDistanceMetres",
        "cumulativeEnergyWh",
        "onboardCountDuringLeg",
        "seatCapacity",
        "batteryAfterBasisPoints",
      ].forEach((key) => numberFact(event, key));
      nullableKnownEdgeFact(event, "currentEdgeId", input, eventIndex);
      booleanFact(event, "belowReserve");
      return;
    }
    case "VEHICLE_ARRIVED_DROPOFF":
      vehicleId(stringFact(event, "vehicleId"));
      knownZoneFact(event, "zoneId", input, eventIndex);
      stringsFact(event, "passengerIds").forEach(passengerId);
      return;
    case "PASSENGERS_SERVED":
      vehicleId(stringFact(event, "vehicleId"));
      stringsFact(event, "passengerIds").forEach(passengerId);
      numberFact(event, "passengerMetres");
      return;
    case "VEHICLE_FAILED":
      disruptionId(stringFact(event, "disruptionId"));
      vehicleId(stringFact(event, "vehicleId"));
      stringFact(event, "stateBefore");
      knownZoneFact(event, "snappedZoneId", input, eventIndex);
      if (facts(event).activeLegBefore !== null) {
        activeLegFact(event, "activeLegBefore", input, eventIndex);
      }
      [
        "partialDistanceMetres",
        "partialEnergyWh",
        "selectedOnboardCount",
        "selectedReservedCount",
      ].forEach((key) => numberFact(event, key));
      stringsFact(event, "onboardPassengerIds").forEach(passengerId);
      stringsFact(event, "reservedPassengerIds").forEach(passengerId);
      knownZoneFact(event, "reservedPickupZoneId", input, eventIndex);
      optionalNumberFact(event, "onboardRecoveryReleaseSecond");
      booleanFact(event, "selectedActiveService");
      stringsFact(event, "rankedCandidates");
      return;
    case "PASSENGERS_REQUEUED":
      disruptionId(stringFact(event, "disruptionId"));
      stringsFact(event, "passengerIds").forEach(passengerId);
      numberFact(event, "releaseSecond");
      stringFact(event, "reasonCode");
      nullableKnownZoneFact(event, "zoneId", input, eventIndex);
      return;
    case "RECOVERY_ASSIGNED":
      vehicleId(stringFact(event, "vehicleId"));
      stringsFact(event, "passengerIds").forEach(passengerId);
      knownZoneFact(event, "originZoneId", input, eventIndex);
      knownZoneFact(event, "destinationZoneId", input, eventIndex);
      return;
    case "RECOVERY_COMPLETED":
      disruptionId(stringFact(event, "disruptionId"));
      stringsFact(event, "affectedPassengerIds").forEach(passengerId);
      numberFact(event, "failureSecond");
      numberFact(event, "recoveryTimeSeconds");
      stringFact(event, "reasonCode");
      return;
    case "ACTION_REJECTED":
      ["controllerId", "controllerVersion", "intentKind", "reasonCode"].forEach(
        (key) => stringFact(event, key),
      );
      vehicleId(stringFact(event, "vehicleId"));
      stringsFact(event, "passengerIds").forEach(passengerId);
      return;
    case "DISRUPTION_TARGET_NOT_FOUND":
      disruptionId(stringFact(event, "disruptionId"));
      stringFact(event, "policyVersion");
      stringFact(event, "reasonCode");
      return;
    case "RUN_COMPLETED":
      [
        "requestedPassengers",
        "servedPassengers",
        "inServiceAtHorizonPassengers",
        "unservedPassengers",
        "waitingPassengers",
        "reservedPassengers",
        "onboardPassengers",
        "recoveryWaitPassengers",
        "failedVehicles",
      ].forEach((key) => numberFact(event, key));
      [
        "servedPassengerIds",
        "inServiceAtHorizonPassengerIds",
        "unservedPassengerIds",
        "strandedPassengerIds",
      ].forEach((key) => stringsFact(event, key).forEach(passengerId));
      return;
    default:
      fail(`Unknown event type ${String(event.type)}.`, `${basePath}.type`);
  }
}

function findVehicle(state: MutableReplayState, idValue: string) {
  const value = state.vehicles.find((entry) => entry.id === idValue);
  if (!value) fail(`Unknown vehicle ${idValue}.`);
  return value;
}

function findPassenger(state: MutableReplayState, idValue: string) {
  const value = state.passengers.find((entry) => entry.request.id === idValue);
  if (!value) fail(`Unknown passenger ${idValue}.`);
  return value;
}

function addDisruption(values: DisruptionId[], idValue: string): void {
  const id = disruptionId(idValue);
  if (values.includes(id)) fail(`Disruption ${id} was applied twice.`);
  values.push(id);
}

function applyEvent(
  state: MutableReplayState,
  event: SimulationEvent,
  input: StressLabRunInput,
  eventIndex: number,
): void {
  switch (event.type) {
    case "RUN_STARTED": {
      const expectedVehicles = state.vehicles.map((vehicle) => vehicle.id);
      if (
        numberFact(event, "requestCount") !== state.passengers.length ||
        numberFact(event, "vehicleCount") !== state.vehicles.length ||
        canonicalJson(stringsFact(event, "vehicleIds")) !==
          canonicalJson(expectedVehicles)
      ) fail("RUN_STARTED does not match the derived initial state.");
      return;
    }
    case "TICK_OBSERVED":
    case "ACTION_REJECTED":
      return;
    case "RECOVERY_ASSIGNED": {
      const vehicle = findVehicle(state, stringFact(event, "vehicleId"));
      const origin = zoneId(stringFact(event, "originZoneId"));
      const destination = zoneId(stringFact(event, "destinationZoneId"));
      if (vehicle.state !== "IDLE") {
        fail("Recovery assignment requires an idle vehicle.");
      }
      for (const id of stringsFact(event, "passengerIds")) {
        const passenger = findPassenger(state, id);
        if (
          !passenger.affectedByDisruptionId ||
          passenger.state !== "WAITING" ||
          passenger.assignedVehicleId !== undefined ||
          passenger.currentZoneId !== origin ||
          passenger.request.destinationZoneId !== destination
        ) {
          fail(
            "Recovery assignment conflicts with replayed recovery location or request destination.",
          );
        }
      }
      return;
    }
    case "RUN_COMPLETED": {
      const served = stringsFact(event, "servedPassengerIds");
      const inService = stringsFact(event, "inServiceAtHorizonPassengerIds");
      const unserved = stringsFact(event, "unservedPassengerIds");
      const all = [...served, ...inService, ...unserved];
      if (
        new Set(all).size !== all.length ||
        all.length !== state.passengers.length ||
        all.some((id) => !state.passengers.some((passenger) => passenger.request.id === id)) ||
        numberFact(event, "servedPassengers") !== served.length ||
        numberFact(event, "inServiceAtHorizonPassengers") !== inService.length ||
        numberFact(event, "unservedPassengers") !== unserved.length
      ) fail("RUN_COMPLETED terminal passenger partitions are invalid.");
      for (const id of served) {
        if (findPassenger(state, id).state !== "SERVED") {
          fail("RUN_COMPLETED served partition conflicts with state.");
        }
      }
      return;
    }
    case "PASSENGER_ARRIVED": {
      const passenger = findPassenger(state, stringFact(event, "passengerId"));
      if (
        passenger.state !== "NOT_ARRIVED" ||
        event.atSecond !== passenger.request.arrivalSecond ||
        numberFact(event, "requestSecond") !== passenger.request.arrivalSecond ||
        stringFact(event, "originZoneId") !== passenger.request.originZoneId ||
        stringFact(event, "destinationZoneId") !==
          passenger.request.destinationZoneId
      ) fail("Passenger arrival conflicts with the verified request.");
      passenger.state = "WAITING";
      passenger.currentZoneId = passenger.request.originZoneId;
      return;
    }
    case "VEHICLE_DISPATCHED_EMPTY": {
      const vehicle = findVehicle(state, stringFact(event, "vehicleId"));
      if (vehicle.state !== "IDLE") fail("Empty dispatch requires an idle vehicle.");
      const ids = stringsFact(event, "passengerIds").map(passengerId);
      const leg = stateBoundMovementStart(
        state,
        vehicle,
        event,
        input,
        eventIndex,
      );
      for (const id of ids) { const passenger = findPassenger(state, id); if (passenger.state !== "WAITING") fail("Dispatch reserved an ineligible passenger."); passenger.state = "RESERVED"; passenger.assignedVehicleId = vehicle.id; }
      vehicle.state = "TRAVELLING_EMPTY"; vehicle.reservedPassengerIds = [...ids]; vehicle.assignedOriginZoneId = leg.toZoneId; vehicle.assignedDestinationZoneId = zoneId(stringFact(event, "serviceDestinationZoneId")); vehicle.activeLeg = leg; return;
    }
    case "VEHICLE_ARRIVED_PICKUP": {
      const vehicle = findVehicle(state, stringFact(event, "vehicleId")); const ids = stringsFact(event, "passengerIds").map(passengerId);
      const pickupZone = zoneId(stringFact(event, "zoneId"));
      const destination = zoneId(stringFact(event, "destinationZoneId"));
      if (vehicle.state === "IDLE") {
        if (vehicle.currentZoneId !== pickupZone || vehicle.activeLeg !== undefined) {
          fail("Local pickup does not occur at the vehicle's replayed location.");
        }
        for (const id of ids) {
          const passenger = findPassenger(state, id);
          if (
            passenger.state !== "WAITING" ||
            passenger.assignedVehicleId !== undefined ||
            passenger.currentZoneId !== pickupZone ||
            passenger.request.destinationZoneId !== destination
          ) fail("Local pickup reserved an ineligible passenger or wrong request context.");
          passenger.state = "RESERVED"; passenger.assignedVehicleId = vehicle.id;
        }
        vehicle.reservedPassengerIds = [...ids]; vehicle.assignedOriginZoneId = pickupZone; vehicle.assignedDestinationZoneId = destination;
      }
      else if (vehicle.state === "TRAVELLING_EMPTY") {
        const leg = vehicle.activeLeg;
        if (
          !leg ||
          leg.kind !== "EMPTY" ||
          leg.purpose !== "PICKUP" ||
          pickupZone !== leg.toZoneId ||
          pickupZone !== vehicle.assignedOriginZoneId ||
          destination !== vehicle.assignedDestinationZoneId
        ) {
          fail("Pickup arrival conflicts with the accepted empty leg endpoints.");
        }
        assertExactPassengerCohort(
          ids,
          vehicle.reservedPassengerIds,
          `${eventPath(eventIndex)}.facts.passengerIds`,
          "Pickup arrival cohort does not match authoritative reservations.",
        );
        assertExactPassengerCohort(
          leg.reservationIds,
          vehicle.reservedPassengerIds,
          `${eventPath(eventIndex)}.facts.passengerIds`,
          "Accepted empty leg no longer matches authoritative reservations.",
        );
        for (const id of ids) {
          const passenger = findPassenger(state, id);
          if (
            passenger.state !== "RESERVED" ||
            passenger.assignedVehicleId !== vehicle.id ||
            passenger.currentZoneId !== pickupZone ||
            passenger.request.destinationZoneId !== destination
          ) fail("Pickup arrival passenger ownership is invalid.");
        }
      } else fail("Pickup arrival requires idle-local or empty-travelling state.");
      if (
        vehicle.activeLeg &&
        (vehicle.activeLeg.accountedDistanceMetres !== vehicle.activeLeg.distanceMetres ||
          vehicle.activeLeg.accountedEnergyWh !== vehicle.activeLeg.energyWh)
      ) fail("Pickup arrived before empty movement completed.");
      if (!booleanFact(event, "boardingOperationStarted")) {
        if (vehicle.state !== "TRAVELLING_EMPTY") fail("Only completed empty travel may stop at the terminal pickup boundary.");
        vehicle.state = "IDLE";
        vehicle.currentZoneId = pickupZone;
        vehicle.activeLeg = undefined;
        return;
      }
      const operation = boardingFact(event, "boardingOperation", input, eventIndex);
      if (
        operation.startedAtSecond !== event.atSecond ||
        operation.originZoneId !== pickupZone ||
        operation.destinationZoneId !== destination
      ) fail("Boarding operation does not bind to the replayed pickup context.");
      assertExactPassengerCohort(
        operation.passengerIds,
        vehicle.reservedPassengerIds,
        `${eventPath(eventIndex)}.facts.boardingOperation.passengerIds`,
        "Boarding manifest does not match authoritative reservations.",
      );
      vehicle.state = "DWELLING"; vehicle.currentZoneId = pickupZone; vehicle.activeLeg = undefined; vehicle.activeBoardingOperation = operation; vehicle.dwellEndsAtSecond = operation.completesAtSecond; return;
    }
    case "PASSENGERS_BOARDED": {
      const vehicle = findVehicle(state, stringFact(event, "vehicleId"));
      if (vehicle.state !== "DWELLING" || !vehicle.activeBoardingOperation) fail("Boarding requires active dwell.");
      const ids = stringsFact(event, "passengerIds").map(passengerId);
      if (ids.length > vehicle.seats || canonicalJson(ids) !== canonicalJson(vehicle.activeBoardingOperation.passengerIds)) fail("Boarding violates manifest/capacity.");
      assertExactPassengerCohort(
        ids,
        vehicle.reservedPassengerIds,
        `${eventPath(eventIndex)}.facts.passengerIds`,
        "Boarding cohort does not match authoritative reservations.",
      );
      if (
        stringFact(event, "zoneId") !== vehicle.currentZoneId ||
        vehicle.assignedOriginZoneId !== vehicle.currentZoneId ||
        numberFact(event, "occupancyAfter") !== ids.length ||
        numberFact(event, "seatCapacity") !== vehicle.seats
      ) fail("Boarding facts conflict with replayed vehicle state.");
      for (const id of ids) { const passenger = findPassenger(state, id); if (passenger.state !== "RESERVED" || passenger.assignedVehicleId !== vehicle.id) fail("Boarding lacks reservation."); passenger.state = "ONBOARD"; passenger.currentZoneId = vehicle.currentZoneId; passenger.firstBoardedAtSecond ??= simulatedSecond(numberFact(event, "boardedAtSecond")); }
      vehicle.onboardPassengerIds = [...ids]; vehicle.reservedPassengerIds = []; vehicle.activeBoardingOperation = undefined; vehicle.dwellEndsAtSecond = undefined; return;
    }
    case "VEHICLE_DEPARTED_SERVICE": { const vehicle = findVehicle(state, stringFact(event, "vehicleId")); if (vehicle.state !== "DWELLING") fail("Service departure requires dwelling state."); const leg = stateBoundMovementStart(state, vehicle, event, input, eventIndex); vehicle.state = "TRAVELLING_SERVICE"; vehicle.activeLeg = leg; vehicle.dwellEndsAtSecond = undefined; return; }
    case "BATTERY_CHANGED": {
      const vehicle = findVehicle(state, stringFact(event, "vehicleId")); const before = numberFact(event, "beforeWh"); const after = numberFact(event, "afterWh"); const energy = numberFact(event, "energyWh");
      if (vehicle.batteryWh !== before || before - energy !== after || !vehicle.activeLeg) fail("Battery delta lacks a reconcilable active leg.");
      const submittedEdge = facts(event).currentEdgeId === null
        ? null
        : stringFact(event, "currentEdgeId");
      if (
        stringFact(event, "movementKind") !== vehicle.activeLeg.kind ||
        submittedEdge !== expectedActiveEdgeId(vehicle.activeLeg, event.atSecond) ||
        numberFact(event, "onboardCountDuringLeg") !==
          vehicle.activeLeg.onboardCountAtDeparture ||
        numberFact(event, "seatCapacity") !== vehicle.seats ||
        booleanFact(event, "partial") !==
          (event.atSecond < vehicle.activeLeg.endsAtSecond)
      ) fail("Battery movement evidence does not refer to the accepted active leg.");
      const distance = numberFact(event, "cumulativeDistanceMetres"); const cumulativeEnergy = numberFact(event, "cumulativeEnergyWh");
      if (distance > vehicle.activeLeg.distanceMetres || cumulativeEnergy > vehicle.activeLeg.energyWh || distance - vehicle.activeLeg.accountedDistanceMetres !== numberFact(event, "distanceMetres") || cumulativeEnergy - vehicle.activeLeg.accountedEnergyWh !== energy) fail("Movement cumulative evidence does not reconcile.");
      vehicle.batteryWh = wattHours(after); vehicle.activeLeg = cloneLeg({ ...vehicle.activeLeg, accountedDistanceMetres: metres(distance), accountedEnergyWh: wattHours(cumulativeEnergy) }); return;
    }
    case "VEHICLE_ARRIVED_DROPOFF": { const vehicle = findVehicle(state, stringFact(event, "vehicleId")); const leg = vehicle.activeLeg; const destination = zoneId(stringFact(event, "zoneId")); const ids = stringsFact(event, "passengerIds"); if (vehicle.state !== "TRAVELLING_SERVICE" || !leg || leg.accountedDistanceMetres !== leg.distanceMetres || leg.accountedEnergyWh !== leg.energyWh) fail("Dropoff requires completed service movement."); if (destination !== leg.toZoneId || destination !== vehicle.assignedDestinationZoneId) fail("Dropoff location differs from the accepted service-leg destination."); assertExactPassengerCohort(ids, vehicle.onboardPassengerIds, `${eventPath(eventIndex)}.facts.passengerIds`, "Dropoff cohort differs from authoritative occupancy."); assertExactPassengerCohort(leg.passengerIds, vehicle.onboardPassengerIds, `${eventPath(eventIndex)}.facts.passengerIds`, "Accepted service leg differs from authoritative occupancy."); for (const id of ids) { const passenger = findPassenger(state, id); if (passenger.state !== "ONBOARD" || passenger.assignedVehicleId !== vehicle.id || passenger.request.destinationZoneId !== destination) fail("Dropoff passenger context is invalid."); } vehicle.currentZoneId = destination; vehicle.activeLeg = undefined; return; }
    case "PASSENGERS_SERVED": { const vehicle = findVehicle(state, stringFact(event, "vehicleId")); const ids = stringsFact(event, "passengerIds").map(passengerId); assertExactPassengerCohort(ids, vehicle.onboardPassengerIds, `${eventPath(eventIndex)}.facts.passengerIds`, "Served cohort differs from authoritative occupancy."); for (const id of ids) { const passenger = findPassenger(state, id); if (passenger.state !== "ONBOARD" || passenger.assignedVehicleId !== vehicle.id || passenger.request.destinationZoneId !== vehicle.currentZoneId) fail("Serving requires onboard state at the immutable request destination."); passenger.state = "SERVED"; passenger.assignedVehicleId = undefined; passenger.currentZoneId = vehicle.currentZoneId; passenger.servedAtSecond = event.atSecond; passenger.recoveryReleaseSecond = undefined; } vehicle.onboardPassengerIds = []; vehicle.state = "IDLE"; vehicle.assignedOriginZoneId = undefined; vehicle.assignedDestinationZoneId = undefined; return; }
    case "VEHICLE_FAILED": {
      const disruption = disruptionId(stringFact(event, "disruptionId")); addDisruption(state.appliedDisruptionIds, disruption); const vehicle = findVehicle(state, stringFact(event, "vehicleId")); if (vehicle.state === "FAILED") fail("Vehicle failed twice."); const snapped = zoneId(stringFact(event, "snappedZoneId")); const reserved = stringsFact(event, "reservedPassengerIds").map(passengerId); const onboard = stringsFact(event, "onboardPassengerIds").map(passengerId); const release = optionalNumberFact(event, "onboardRecoveryReleaseSecond");
      const eventLeg = facts(event).activeLegBefore === null
        ? undefined
        : activeLegFact(event, "activeLegBefore", input, eventIndex);
      const expectedSnap = eventLeg
        ? activeLegProgressAt(eventLeg, event.atSecond).snappedZoneId
        : vehicle.currentZoneId;
      if (
        stringFact(event, "stateBefore") !== vehicle.state ||
        canonicalJson(eventLeg ?? null) !== canonicalJson(vehicle.activeLeg ?? null) ||
        canonicalJson(reserved) !== canonicalJson(vehicle.reservedPassengerIds) ||
        canonicalJson(onboard) !== canonicalJson(vehicle.onboardPassengerIds) ||
        snapped !== expectedSnap ||
        stringFact(event, "reservedPickupZoneId") !==
          (vehicle.assignedOriginZoneId ?? vehicle.currentZoneId) ||
        numberFact(event, "partialDistanceMetres") !==
          (eventLeg?.accountedDistanceMetres ?? 0) ||
        numberFact(event, "partialEnergyWh") !==
          (eventLeg?.accountedEnergyWh ?? 0)
      ) fail("Vehicle-failure evidence does not reconcile with pre-failure state.");
      for (const id of reserved) { const passenger = findPassenger(state, id); if (passenger.state !== "RESERVED" || passenger.assignedVehicleId !== vehicle.id || passenger.currentZoneId !== vehicle.assignedOriginZoneId) fail("Failed-vehicle reservation ownership is invalid."); passenger.state = "WAITING"; passenger.assignedVehicleId = undefined; passenger.affectedByDisruptionId = disruption; }
      for (const id of onboard) { const passenger = findPassenger(state, id); if (passenger.state !== "ONBOARD" || passenger.assignedVehicleId !== vehicle.id) fail("Failed-vehicle occupancy is invalid."); passenger.state = "RECOVERY_WAIT"; passenger.assignedVehicleId = undefined; passenger.currentZoneId = snapped; passenger.affectedByDisruptionId = disruption; if (release === null) fail("Occupied failure requires recovery release."); passenger.recoveryReleaseSecond = simulatedSecond(release); }
      vehicle.state = "FAILED"; vehicle.currentZoneId = snapped; vehicle.onboardPassengerIds = []; vehicle.reservedPassengerIds = []; vehicle.assignedOriginZoneId = undefined; vehicle.assignedDestinationZoneId = undefined; vehicle.activeLeg = undefined; vehicle.activeBoardingOperation = undefined; vehicle.dwellEndsAtSecond = undefined; vehicle.failedByDisruptionId = disruption; return;
    }
    case "PASSENGERS_REQUEUED": {
      if (stringFact(event, "reasonCode") === "FAILED_VEHICLE_RESERVED_RELEASE") {
        const disruption = disruptionId(stringFact(event, "disruptionId"));
        const releaseZone = nullableKnownZoneFact(
          event,
          "zoneId",
          input,
          eventIndex,
        );
        for (const idValue of stringsFact(event, "passengerIds")) {
          const passenger = findPassenger(state, idValue);
          if (
            passenger.state !== "WAITING" ||
            passenger.affectedByDisruptionId !== disruption ||
            passenger.currentZoneId !== releaseZone ||
            numberFact(event, "releaseSecond") !== event.atSecond
          ) {
            fail("Reserved-passenger release does not reconcile with failure state.");
          }
        }
        return;
      }
      const releaseZone = nullableKnownZoneFact(
        event,
        "zoneId",
        input,
        eventIndex,
      );
      for (const idValue of stringsFact(event, "passengerIds")) {
        const passenger = findPassenger(state, idValue);
        if (
          passenger.state !== "RECOVERY_WAIT" ||
          passenger.currentZoneId !== releaseZone ||
          passenger.recoveryReleaseSecond !== event.atSecond ||
          numberFact(event, "releaseSecond") !== event.atSecond
        ) fail("Recovery release requires matching recovery wait context.");
        passenger.state = "WAITING";
        passenger.recoveryReleaseSecond = undefined;
      }
      return;
    }
    case "RECOVERY_COMPLETED": addDisruption(state.recoveryCompletedDisruptionIds, stringFact(event, "disruptionId")); return;
    case "DISRUPTION_TARGET_NOT_FOUND": addDisruption(state.appliedDisruptionIds, stringFact(event, "disruptionId")); return;
    default: fail(`Unknown event type ${String(event.type)}.`);
  }
}

function validateEventEnvelope(
  event: SimulationEvent,
  prior: SimulationEvent | undefined,
  expectedSequence: number,
  input: StressLabRunInput,
  eventIndex: number,
): void {
  const basePath = eventPath(eventIndex);
  assertExactKeys(event, EVENT_KEYS, basePath);
  if (!EVENT_TYPES.includes(event.type)) {
    fail(`Unknown event type ${String(event.type)}.`, `${basePath}.type`);
  }
  evidenceId(String(event.evidenceId));
  if (!Number.isSafeInteger(event.sequence) || !Number.isSafeInteger(event.atSecond) || event.sequence !== expectedSequence || event.atSecond < 0) fail("Event sequence/time envelope is invalid.", basePath);
  if (prior && event.atSecond < prior.atSecond) fail("Event time moved backwards.", `${basePath}.atSecond`);
  if (!event.evidenceId.endsWith(String(event.sequence).padStart(6, "0"))) fail("Evidence ID does not match sequence.", `${basePath}.evidenceId`);
  validateRequiredFacts(event, input, eventIndex);
}

function replayReducer(
  initial: SimulationState,
  orderedEvents: readonly SimulationEvent[],
  input: StressLabRunInput,
): SimulationState {
  const state = mutable(initial); let prior: SimulationEvent | undefined;
  for (let eventIndex = 0; eventIndex < orderedEvents.length; eventIndex += 1) {
    const event = orderedEvents[eventIndex];
    validateEventEnvelope(
      event,
      prior,
      state.nextEventSequence,
      input,
      eventIndex,
    );
    if (event.type === "TICK_OBSERVED" || event.type === "RUN_COMPLETED") state.atSecond = event.atSecond;
    else if (event.atSecond > state.atSecond) fail("State time advanced without TICK_OBSERVED evidence.");
    applyEvent(state, event, input, eventIndex); state.nextEventSequence += 1; prior = event;
  }
  return deepFreeze({ atSecond: simulatedSecond(state.atSecond), nextEventSequence: count(state.nextEventSequence), passengers: state.passengers, vehicles: state.vehicles, appliedDisruptionIds: state.appliedDisruptionIds, recoveryCompletedDisruptionIds: state.recoveryCompletedDisruptionIds });
}

function validateVerifiedEnvelope(preparedValue: PreparedRunInput, envelope: EventLedgerEnvelope): PreparedRunInput {
  assertExactKeys(envelope, LEDGER_ENVELOPE_KEYS, "eventLedger");
  assertDenseArray(envelope.events, "eventLedger.events");
  const prepared = prepareStressLabRunInput(preparedValue.input);
  if (prepared.fingerprint !== preparedValue.fingerprint || prepared.canonicalJson !== preparedValue.canonicalJson) fail("Prepared input canonical identity is invalid.");
  fingerprint(String(envelope.fingerprint));
  if (envelope.eventSchemaVersion !== STRESS_LAB_EVENT_SCHEMA_VERSION || envelope.engineVersion !== STRESS_LAB_ENGINE_VERSION || envelope.tickSemanticsVersion !== STRESS_LAB_TICK_SEMANTICS_VERSION || envelope.inputFingerprint !== prepared.fingerprint) fail("Ledger provenance does not match verified input/runtime.");
  if (createEventLedgerDocument(envelope).fingerprint !== envelope.fingerprint) fail("Event-ledger fingerprint is invalid.");
  const starts = envelope.events.filter((event) => event.type === "RUN_STARTED"); const completions = envelope.events.filter((event) => event.type === "RUN_COMPLETED");
  if (starts.length !== 1 || completions.length !== 1 || envelope.events[0]?.type !== "RUN_STARTED" || envelope.events.at(-1)?.type !== "RUN_COMPLETED") fail("Ledger requires exactly one first RUN_STARTED and one last RUN_COMPLETED.");
  if (stringFact(starts[0], "inputFingerprint") !== prepared.fingerprint) fail("RUN_STARTED does not bind to verified input.");
  if (
    stringFact(starts[0], "engineVersion") !== envelope.engineVersion ||
    stringFact(starts[0], "tickSemanticsVersion") !==
      envelope.tickSemanticsVersion ||
    stringFact(starts[0], "controllerId") !== envelope.controllerId ||
    stringFact(starts[0], "controllerVersion") !==
      envelope.controllerVersion ||
    stringFact(starts[0], "eventSchemaVersion") !==
      envelope.eventSchemaVersion ||
    stringFact(starts[0], "scenarioSlot") !== prepared.input.scenarioSlot
  ) fail("RUN_STARTED semantic provenance conflicts with its ledger envelope.");
  return prepared;
}

export function replayVerifiedEventLedger(preparedValue: PreparedRunInput, envelope: EventLedgerEnvelope): SimulationState {
  const prepared = validateVerifiedEnvelope(preparedValue, envelope);
  return replayReducer(
    deriveInitialOperationalState(prepared.input),
    envelope.events,
    prepared.input,
  );
}

export function replayVerifiedEventLedgerPrefix(preparedValue: PreparedRunInput, envelope: EventLedgerEnvelope, throughEventSequence: number): SimulationState {
  const prepared = validateVerifiedEnvelope(preparedValue, envelope);
  if (!Number.isSafeInteger(throughEventSequence) || throughEventSequence < 1) fail("Replay prefix must be a positive sequence.");
  return replayReducer(
    deriveInitialOperationalState(prepared.input),
    envelope.events.filter((event) => event.sequence <= throughEventSequence),
    prepared.input,
  );
}
