import {
  createEventLedgerDocument,
  createFingerprintDocument,
  runResultIdentityValue,
} from "./fingerprint";
import { canonicalJson } from "./canonical-json";
import { deriveInitialOperationalState } from "./initial-state";
import { deriveRunEvidence } from "./metrics";
import {
  REFERENCE_CONTROLLER,
  REFERENCE_DISPATCH_CONTROLLER,
} from "./reference-controller";
import {
  batteryWhAtBasisPoints,
  activeLegProgressAt,
  energyWhForDistance,
  roundPositiveRatio,
} from "./simulation-math";
import { findAuthoredRoute } from "./route";
import { replayVerifiedEventLedger } from "./replay";
import { prepareStressLabRunInput } from "./run-input";
import {
  count,
  evidenceId,
  metres,
  simulatedSecond,
  STRESS_LAB_ENGINE_VERSION,
  STRESS_LAB_EVENT_SCHEMA_VERSION,
  STRESS_LAB_METRIC_DEFINITION_VERSION,
  STRESS_LAB_RESULT_SCHEMA_VERSION,
  STRESS_LAB_TICK_SEMANTICS_VERSION,
  StressLabEngineInvariantError,
  StressLabInputValidationError,
  StressLabSimulationCancelledError,
  wattHours,
  type ActionRejectedReasonCode,
  type ActiveBoardingOperation,
  type ActiveLegEdgeEvidence,
  type Count,
  type ControllerObservationV1,
  type DeterministicSimulationResult,
  type DispatchControllerV1,
  type DispatchIntentV1,
  type DisruptionId,
  type EvidenceId,
  type Fingerprint,
  type PassengerId,
  type PassengerLifecycleState,
  type PassengerRequest,
  type PreparedRunInput,
  type SimulatedSecond,
  type SimulationContext,
  type SimulationEvent,
  type SimulationFactValue,
  type SimulationSnapshot,
  type SimulationState,
  type SimulationTerminalState,
  type StepResult,
  type StressLabRunInput,
  type VehicleFailureDisruption,
  type VehicleLeg,
  type VehicleLegKind,
  type VehicleOperationalState,
  type VehicleState,
  type WattHours,
  type ZoneId,
} from "./types";

interface MutablePassengerState {
  request: PassengerRequest;
  state: PassengerLifecycleState;
  assignedVehicleId?: VehicleState["id"];
  currentZoneId?: ZoneId;
  firstBoardedAtSecond?: SimulatedSecond;
  servedAtSecond?: SimulatedSecond;
  affectedByDisruptionId?: DisruptionId;
  recoveryReleaseSecond?: SimulatedSecond;
}

interface MutableVehicleState {
  id: VehicleState["id"];
  state: VehicleOperationalState;
  currentZoneId: ZoneId;
  seats: Count;
  onboardPassengerIds: PassengerId[];
  reservedPassengerIds: PassengerId[];
  batteryWh: WattHours;
  assignedOriginZoneId?: ZoneId;
  assignedDestinationZoneId?: ZoneId;
  activeLeg?: VehicleLeg;
  activeBoardingOperation?: ActiveBoardingOperation;
  dwellEndsAtSecond?: SimulatedSecond;
  failedByDisruptionId?: DisruptionId;
}

interface MutableSimulationState {
  atSecond: SimulatedSecond;
  nextEventSequence: Count;
  passengers: MutablePassengerState[];
  vehicles: MutableVehicleState[];
  appliedDisruptionIds: DisruptionId[];
  recoveryCompletedDisruptionIds: DisruptionId[];
}

interface InitializedSimulation {
  readonly context: SimulationContext;
  readonly initialState: SimulationState;
  readonly state: SimulationState;
  readonly runStartedEvent: SimulationEvent;
}

interface EventEmitter {
  readonly events: SimulationEvent[];
  emit(
    type: SimulationEvent["type"],
    atSecond: number,
    facts: Readonly<Record<string, SimulationFactValue>>,
  ): SimulationEvent;
}

interface ValidatedDispatchPlan {
  readonly intent: DispatchIntentV1;
  readonly emptyRoute: ReturnType<typeof findAuthoredRoute>;
  readonly serviceRoute: ReturnType<typeof findAuthoredRoute>;
  readonly emptyEnergyWh: WattHours;
  readonly serviceEnergyWh: WattHours;
}

interface ServiceArrival {
  readonly vehicleId: VehicleState["id"];
  readonly leg: VehicleLeg;
}

export interface CancellationSignal {
  readonly aborted: boolean;
}

export interface AsyncSimulationOptions {
  readonly signal?: CancellationSignal;
  readonly yieldEveryTicks?: number;
  readonly yieldControl?: () => Promise<void>;
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

function compactUndefined<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map((entry) => compactUndefined(entry)) as Value;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) result[key] = compactUndefined(entry);
    }
    return result as Value;
  }
  return value;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function cloneVehicleLeg(leg: VehicleLeg | undefined): VehicleLeg | undefined {
  if (!leg) return undefined;
  return {
    ...leg,
    edgeIds: [...leg.edgeIds],
    pathZoneIds: [...leg.pathZoneIds],
    passengerIds: [...leg.passengerIds],
    reservationIds: [...leg.reservationIds],
    edges: leg.edges.map((edge) => ({ ...edge })),
  };
}

function cloneBoardingOperation(
  operation: ActiveBoardingOperation | undefined,
): ActiveBoardingOperation | undefined {
  if (!operation) return undefined;
  return {
    ...operation,
    passengerIds: [...operation.passengerIds],
  };
}

function cloneState(state: SimulationState): MutableSimulationState {
  return {
    atSecond: state.atSecond,
    nextEventSequence: state.nextEventSequence,
    passengers: state.passengers.map((passenger) => ({ ...passenger })),
    vehicles: state.vehicles.map((vehicle) => ({
      ...vehicle,
      onboardPassengerIds: [...vehicle.onboardPassengerIds],
      reservedPassengerIds: [...vehicle.reservedPassengerIds],
      activeLeg: cloneVehicleLeg(vehicle.activeLeg),
      activeBoardingOperation: cloneBoardingOperation(
        vehicle.activeBoardingOperation,
      ),
    })),
    appliedDisruptionIds: [...state.appliedDisruptionIds],
    recoveryCompletedDisruptionIds: [
      ...state.recoveryCompletedDisruptionIds,
    ],
  };
}

function freezeState(state: MutableSimulationState): SimulationState {
  return deepFreeze({
    atSecond: state.atSecond,
    nextEventSequence: state.nextEventSequence,
    passengers: state.passengers,
    vehicles: compactUndefined(state.vehicles) as readonly VehicleState[],
    appliedDisruptionIds: state.appliedDisruptionIds,
    recoveryCompletedDisruptionIds: state.recoveryCompletedDisruptionIds,
  });
}

export function createControllerObservation(
  state: SimulationState,
  input: StressLabRunInput,
): ControllerObservationV1 {
  return deepFreeze({
    observationVersion: "controller-observation-v1",
    atSecond: state.atSecond,
    vehicles: state.vehicles.map((vehicle) => ({
      id: vehicle.id,
      state: vehicle.state,
      currentZoneId: vehicle.currentZoneId,
      seats: vehicle.seats,
      onboardPassengerIds: [...vehicle.onboardPassengerIds],
      reservedPassengerIds: [...vehicle.reservedPassengerIds],
      batteryWh: vehicle.batteryWh,
      ...(vehicle.activeLeg ? { activeLeg: cloneVehicleLeg(vehicle.activeLeg) } : {}),
      ...(vehicle.activeBoardingOperation
        ? {
            activeBoardingOperation: cloneBoardingOperation(
              vehicle.activeBoardingOperation,
            ),
          }
        : {}),
      ...(vehicle.failedByDisruptionId
        ? { failedByDisruptionId: vehicle.failedByDisruptionId }
        : {}),
    })),
    eligiblePassengers: state.passengers
      .filter(
        (passenger) =>
          passenger.state === "WAITING" && passenger.currentZoneId !== undefined,
      )
      .map((passenger) => ({
        id: passenger.request.id,
        arrivalSecond: passenger.request.arrivalSecond,
        originZoneId: passenger.request.originZoneId,
        destinationZoneId: passenger.request.destinationZoneId,
        currentZoneId: passenger.currentZoneId!,
        ...(passenger.affectedByDisruptionId
          ? { affectedByDisruptionId: passenger.affectedByDisruptionId }
          : {}),
      })),
    topology: {
      networkVersion: input.network.networkVersion,
      zoneIds: input.network.zones.map((zone) => zone.id),
      edges: input.network.edges.map((edge) => ({
        id: edge.id,
        fromZoneId: edge.fromZoneId,
        toZoneId: edge.toZoneId,
        distanceMetres: edge.distanceMetres,
        travelSeconds: edge.travelSeconds,
        pathZoneIds: [...edge.pathZoneIds],
      })),
    },
    constraints: { ...input.scenario.constraints },
    fleetParameters: {
      batteryCapacityWh: input.scenario.fleet.batteryCapacityWh,
      dwellSeconds: input.scenario.fleet.dwellSeconds,
      energyWhPerKilometre: input.scenario.fleet.energyWhPerKilometre,
      minimumReserveBasisPoints:
        input.scenario.fleet.minimumReserveBasisPoints,
    },
    activeDisruptionIds: [...state.appliedDisruptionIds],
  });
}

function createEmitter(
  state: MutableSimulationState,
  slot: StressLabRunInput["scenarioSlot"],
): EventEmitter {
  const events: SimulationEvent[] = [];
  return {
    events,
    emit(type, atSecondValue, facts) {
      const sequence = state.nextEventSequence;
      const event = deepFreeze({
        evidenceId: evidenceId(
          `ev-${slot}-${String(sequence).padStart(6, "0")}`,
        ),
        type,
        atSecond: simulatedSecond(atSecondValue),
        sequence,
        facts,
      } satisfies SimulationEvent);
      events.push(event);
      state.nextEventSequence = count(sequence + 1);
      return event;
    },
  };
}

function findMutableVehicle(
  state: MutableSimulationState,
  id: VehicleState["id"],
): MutableVehicleState {
  const vehicle = state.vehicles.find((entry) => entry.id === id);
  if (!vehicle) {
    throw new StressLabEngineInvariantError(`Vehicle ${id} is missing.`);
  }
  return vehicle;
}

function findMutablePassenger(
  state: MutableSimulationState,
  id: PassengerId,
): MutablePassengerState {
  const passenger = state.passengers.find((entry) => entry.request.id === id);
  if (!passenger) {
    throw new StressLabEngineInvariantError(`Passenger ${id} is missing.`);
  }
  return passenger;
}

function activeSeatCount(state: MutableSimulationState): number {
  return state.vehicles
    .filter((vehicle) => vehicle.state !== "FAILED")
    .reduce((total, vehicle) => total + vehicle.seats, 0);
}

function totalOnboard(state: MutableSimulationState): number {
  return state.vehicles.reduce(
    (total, vehicle) => total + vehicle.onboardPassengerIds.length,
    0,
  );
}

function batteryBasisPoints(
  batteryWhValue: number,
  capacityWh: number,
): number {
  return roundPositiveRatio(batteryWhValue * 10_000, capacityWh);
}

function minimumBatteryBasisPoints(
  state: MutableSimulationState,
  input: StressLabRunInput,
): number | null {
  if (state.vehicles.length === 0) return null;
  return Math.min(
    ...state.vehicles.map((vehicle) =>
      batteryBasisPoints(
        vehicle.batteryWh,
        input.scenario.fleet.batteryCapacityWh,
      ),
    ),
  );
}

function validatedPreparedInput(prepared: PreparedRunInput): PreparedRunInput {
  const validated = prepareStressLabRunInput(prepared.input);
  if (
    validated.fingerprint !== prepared.fingerprint ||
    validated.canonicalJson !== prepared.canonicalJson
  ) {
    throw new StressLabInputValidationError(
      "PREPARED_INPUT_MISMATCH",
      "Prepared input identity does not match its validated canonical content.",
    );
  }
  return validated;
}

export function initializeSimulation(
  preparedValue: PreparedRunInput,
  controller: DispatchControllerV1 = REFERENCE_DISPATCH_CONTROLLER,
): InitializedSimulation {
  const prepared = validatedPreparedInput(preparedValue);
  const input = prepared.input;
  const derivedInitialState = deriveInitialOperationalState(input);
  const mutable = cloneState(derivedInitialState);
  const context: SimulationContext = deepFreeze({
    input,
    inputFingerprint: prepared.fingerprint,
    engineVersion: STRESS_LAB_ENGINE_VERSION,
    tickSemanticsVersion: STRESS_LAB_TICK_SEMANTICS_VERSION,
    controllerId: controller.controllerId,
    controllerVersion: controller.controllerVersion,
    metricDefinitionVersion: STRESS_LAB_METRIC_DEFINITION_VERSION,
    eventSchemaVersion: STRESS_LAB_EVENT_SCHEMA_VERSION,
    resultSchemaVersion: STRESS_LAB_RESULT_SCHEMA_VERSION,
  });
  const initialState = derivedInitialState;
  const emitter = createEmitter(mutable, input.scenarioSlot);
  const runStartedEvent = emitter.emit("RUN_STARTED", 0, {
    inputFingerprint: prepared.fingerprint,
    engineVersion: STRESS_LAB_ENGINE_VERSION,
    tickSemanticsVersion: STRESS_LAB_TICK_SEMANTICS_VERSION,
    controllerId: controller.controllerId,
    controllerVersion: controller.controllerVersion,
    controllerPolicy:
      controller.controllerId === REFERENCE_CONTROLLER.controllerId
        ? REFERENCE_CONTROLLER.policy
        : "INJECTED_DETERMINISTIC_CONTROLLER",
    metricDefinitionVersion: STRESS_LAB_METRIC_DEFINITION_VERSION,
    eventSchemaVersion: STRESS_LAB_EVENT_SCHEMA_VERSION,
    resultSchemaVersion: STRESS_LAB_RESULT_SCHEMA_VERSION,
    scenarioSlot: input.scenarioSlot,
    requestCount: input.demandTrace.requests.length,
    vehicleCount: input.scenario.fleet.vehicleCount,
    activeSeatCountAfter: activeSeatCount(mutable),
    totalOnboardAfter: 0,
    minimumBatteryBasisPoints: minimumBatteryBasisPoints(mutable, input),
    vehicleIds: Object.freeze(mutable.vehicles.map((vehicle) => vehicle.id)),
  });
  return deepFreeze({
    context,
    initialState,
    state: freezeState(mutable),
    runStartedEvent,
  });
}

function vehicleLeg(
  kind: VehicleLegKind,
  route: ReturnType<typeof findAuthoredRoute>,
  input: StressLabRunInput,
  atSecondValue: number,
  onboardCountAtDeparture: number,
  passengerIds: readonly PassengerId[],
  reservationIds: readonly PassengerId[],
): VehicleLeg {
  let elapsedSeconds = 0;
  const edges: ActiveLegEdgeEvidence[] = route.edgeIds.map((id) => {
    const edge = input.network.edges.find((candidate) => candidate.id === id);
    if (!edge) {
      throw new StressLabEngineInvariantError(
        `Resolved route references missing edge ${id}.`,
      );
    }
    const startOffsetSeconds = elapsedSeconds;
    elapsedSeconds += edge.travelSeconds;
    return deepFreeze({
      edgeId: edge.id,
      fromZoneId: edge.fromZoneId,
      toZoneId: edge.toZoneId,
      distanceMetres: edge.distanceMetres,
      travelSeconds: edge.travelSeconds,
      energyWh: energyWhForDistance(
        edge.distanceMetres,
        input.scenario.fleet.energyWhPerKilometre,
      ),
      startOffsetSeconds: simulatedSecond(startOffsetSeconds),
      endOffsetSeconds: simulatedSecond(elapsedSeconds),
    });
  });
  const energyWhValue = wattHours(
    edges.reduce((total, edge) => total + edge.energyWh, 0),
  );
  return deepFreeze({
    kind,
    purpose: kind === "EMPTY" ? "PICKUP" : "PASSENGER_SERVICE",
    fromZoneId: route.fromZoneId,
    toZoneId: route.toZoneId,
    edgeIds: route.edgeIds,
    pathZoneIds: route.pathZoneIds,
    passengerIds,
    reservationIds,
    edges,
    distanceMetres: route.distanceMetres,
    travelSeconds: route.travelSeconds,
    energyWh: energyWhValue,
    startedAtSecond: simulatedSecond(atSecondValue),
    endsAtSecond: simulatedSecond(atSecondValue + route.travelSeconds),
    onboardCountAtDeparture: count(onboardCountAtDeparture),
    accountedDistanceMetres: metres(0),
    accountedEnergyWh: wattHours(0),
  });
}

function routeEnergyWh(
  input: StressLabRunInput,
  route: ReturnType<typeof findAuthoredRoute>,
): WattHours {
  return wattHours(
    route.edgeIds.reduce((total, id) => {
      const edge = input.network.edges.find((candidate) => candidate.id === id);
      if (!edge) {
        throw new StressLabEngineInvariantError(
          `Resolved route references missing edge ${id}.`,
        );
      }
      return (
        total +
        energyWhForDistance(
          edge.distanceMetres,
          input.scenario.fleet.energyWhPerKilometre,
        )
      );
    }, 0),
  );
}

function emitBatteryChange(
  state: MutableSimulationState,
  input: StressLabRunInput,
  vehicle: MutableVehicleState,
  emitter: EventEmitter,
  atSecondValue: number,
  movementKind: VehicleLegKind,
  distanceMetresValue: number,
  energyWhValue: number,
  onboardCountDuringLeg: number,
  partial: boolean,
  cumulativeDistanceMetres: number,
  cumulativeEnergyWh: number,
  currentEdgeId: ActiveLegEdgeEvidence["edgeId"] | null,
): void {
  const beforeWh = vehicle.batteryWh;
  const afterWh = beforeWh - energyWhValue;
  if (!Number.isSafeInteger(afterWh) || afterWh < 0) {
    throw new StressLabEngineInvariantError(
      `Vehicle ${vehicle.id} produced invalid battery energy.`,
    );
  }
  vehicle.batteryWh = wattHours(afterWh);
  const afterBasisPoints = batteryBasisPoints(
    afterWh,
    input.scenario.fleet.batteryCapacityWh,
  );
  emitter.emit("BATTERY_CHANGED", atSecondValue, {
    vehicleId: vehicle.id,
    movementKind,
    partial,
    beforeWh,
    afterWh,
    energyWh: energyWhValue,
    distanceMetres: distanceMetresValue,
    cumulativeDistanceMetres,
    cumulativeEnergyWh,
    currentEdgeId,
    onboardCountDuringLeg,
    seatCapacity: vehicle.seats,
    batteryAfterBasisPoints: afterBasisPoints,
    belowReserve:
      afterBasisPoints < input.scenario.fleet.minimumReserveBasisPoints,
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });
}

function accountActiveLegTo(
  state: MutableSimulationState,
  input: StressLabRunInput,
  vehicle: MutableVehicleState,
  emitter: EventEmitter,
  atSecondValue: number,
): ReturnType<typeof activeLegProgressAt> | undefined {
  const leg = vehicle.activeLeg;
  if (!leg) return undefined;
  const progress = activeLegProgressAt(leg, atSecondValue);
  const distanceDelta = progress.distanceMetres - leg.accountedDistanceMetres;
  const energyDelta = progress.energyWh - leg.accountedEnergyWh;
  if (distanceDelta < 0 || energyDelta < 0) {
    throw new StressLabEngineInvariantError(
      `Vehicle ${vehicle.id} movement accounting moved backwards.`,
    );
  }
  if (distanceDelta > 0 || energyDelta > 0) {
    emitBatteryChange(
      state,
      input,
      vehicle,
      emitter,
      atSecondValue,
      leg.kind,
      distanceDelta,
      energyDelta,
      leg.onboardCountAtDeparture,
      !progress.complete,
      progress.distanceMetres,
      progress.energyWh,
      progress.currentEdgeId,
    );
  }
  vehicle.activeLeg = deepFreeze({
    ...leg,
    accountedDistanceMetres: progress.distanceMetres,
    accountedEnergyWh: progress.energyWh,
  });
  return progress;
}

function recoveryAffectedPassengers(
  state: MutableSimulationState,
  disruptionIdValue: DisruptionId,
): readonly MutablePassengerState[] {
  return state.passengers.filter(
    (passenger) =>
      passenger.affectedByDisruptionId === disruptionIdValue,
  );
}

function maybeCompleteRecovery(
  state: MutableSimulationState,
  disruption: VehicleFailureDisruption,
  emitter: EventEmitter,
  atSecondValue: number,
): void {
  if (state.recoveryCompletedDisruptionIds.includes(disruption.id)) return;
  const affected = recoveryAffectedPassengers(state, disruption.id);
  if (
    affected.some(
      (passenger) =>
        passenger.state !== "ONBOARD" && passenger.state !== "SERVED",
    )
  ) {
    return;
  }
  state.recoveryCompletedDisruptionIds.push(disruption.id);
  emitter.emit("RECOVERY_COMPLETED", atSecondValue, {
    disruptionId: disruption.id,
    affectedPassengerIds: Object.freeze(
      affected.map((passenger) => passenger.request.id),
    ),
    failureSecond: disruption.atSecond,
    recoveryTimeSeconds: atSecondValue - disruption.atSecond,
    reasonCode:
      affected.length === 0
        ? "NO_AFFECTED_PASSENGERS"
        : "ALL_AFFECTED_PASSENGERS_RECOVERED",
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });
}

function beginBoardingOperation(
  vehicle: MutableVehicleState,
  atSecondValue: number,
  dwellSeconds: number,
): void {
  if (
    !vehicle.assignedOriginZoneId ||
    !vehicle.assignedDestinationZoneId ||
    vehicle.reservedPassengerIds.length === 0
  ) {
    throw new StressLabEngineInvariantError(
      `Vehicle ${vehicle.id} cannot start an incomplete boarding operation.`,
    );
  }
  const passengerIds = Object.freeze(
    [...vehicle.reservedPassengerIds].sort(compareCodeUnits),
  );
  vehicle.activeBoardingOperation = deepFreeze({
    startedAtSecond: simulatedSecond(atSecondValue),
    completesAtSecond: simulatedSecond(atSecondValue + dwellSeconds),
    passengerIds,
    originZoneId: vehicle.assignedOriginZoneId,
    destinationZoneId: vehicle.assignedDestinationZoneId,
  });
  vehicle.dwellEndsAtSecond = vehicle.activeBoardingOperation.completesAtSecond;
}

function applyVehicleFailure(
  state: MutableSimulationState,
  context: SimulationContext,
  disruption: VehicleFailureDisruption,
  emitter: EventEmitter,
  atSecondValue: number,
): void {
  const candidates = state.vehicles
    .filter((vehicle) => vehicle.state !== "FAILED")
    .sort((left, right) => {
      if (left.onboardPassengerIds.length !== right.onboardPassengerIds.length) {
        return right.onboardPassengerIds.length - left.onboardPassengerIds.length;
      }
      if (left.reservedPassengerIds.length !== right.reservedPassengerIds.length) {
        return right.reservedPassengerIds.length - left.reservedPassengerIds.length;
      }
      const leftService = left.state === "TRAVELLING_SERVICE" ? 1 : 0;
      const rightService = right.state === "TRAVELLING_SERVICE" ? 1 : 0;
      if (leftService !== rightService) return rightService - leftService;
      return compareCodeUnits(left.id, right.id);
    });
  const selected = candidates[0];
  state.appliedDisruptionIds.push(disruption.id);
  if (!selected) {
    emitter.emit("DISRUPTION_TARGET_NOT_FOUND", atSecondValue, {
      disruptionId: disruption.id,
      policyVersion: disruption.target.policyVersion,
      reasonCode: "NO_ACTIVE_VEHICLE",
      totalOnboardAfter: 0,
      activeSeatCountAfter: 0,
    });
    return;
  }

  const stateBefore = selected.state;
  const rankedCandidates = candidates.map(
    (vehicle) =>
      `${vehicle.id}|${vehicle.onboardPassengerIds.length}|${vehicle.reservedPassengerIds.length}|${vehicle.state === "TRAVELLING_SERVICE" ? 1 : 0}`,
  );
  let leg = selected.activeLeg;
  let snappedZoneId = selected.currentZoneId;
  let partialDistanceMetres = 0;
  let partialEnergyWh = 0;
  if (leg) {
    const progress = accountActiveLegTo(
      state,
      context.input,
      selected,
      emitter,
      atSecondValue,
    )!;
    partialDistanceMetres = progress.distanceMetres;
    partialEnergyWh = progress.energyWh;
    snappedZoneId = progress.snappedZoneId;
    leg = selected.activeLeg;
  }

  const reservedPassengerIds = [...selected.reservedPassengerIds];
  const onboardPassengerIds = [...selected.onboardPassengerIds];
  const reservedPickupZoneId = selected.assignedOriginZoneId;
  for (const passengerIdValue of reservedPassengerIds) {
    const passenger = findMutablePassenger(state, passengerIdValue);
    passenger.state = "WAITING";
    passenger.assignedVehicleId = undefined;
    passenger.affectedByDisruptionId = disruption.id;
  }
  for (const passengerIdValue of onboardPassengerIds) {
    const passenger = findMutablePassenger(state, passengerIdValue);
    passenger.state = "RECOVERY_WAIT";
    passenger.assignedVehicleId = undefined;
    passenger.currentZoneId = snappedZoneId;
    passenger.affectedByDisruptionId = disruption.id;
    passenger.recoveryReleaseSecond = simulatedSecond(
      atSecondValue + disruption.recoveryTransferSeconds,
    );
  }

  selected.state = "FAILED";
  selected.currentZoneId = snappedZoneId;
  selected.onboardPassengerIds = [];
  selected.reservedPassengerIds = [];
  selected.assignedOriginZoneId = undefined;
  selected.assignedDestinationZoneId = undefined;
  selected.activeLeg = undefined;
  selected.activeBoardingOperation = undefined;
  selected.dwellEndsAtSecond = undefined;
  selected.failedByDisruptionId = disruption.id;

  emitter.emit("VEHICLE_FAILED", atSecondValue, {
    disruptionId: disruption.id,
    vehicleId: selected.id,
    stateBefore,
    snappedZoneId,
    activeLegBefore: leg ?? null,
    partialDistanceMetres,
    partialEnergyWh,
    onboardPassengerIds: Object.freeze(onboardPassengerIds),
    reservedPassengerIds: Object.freeze(reservedPassengerIds),
    reservedPickupZoneId: reservedPickupZoneId ?? snappedZoneId,
    onboardRecoveryReleaseSecond:
      onboardPassengerIds.length === 0
        ? null
        : atSecondValue + disruption.recoveryTransferSeconds,
    selectedOnboardCount: onboardPassengerIds.length,
    selectedReservedCount: reservedPassengerIds.length,
    selectedActiveService: stateBefore === "TRAVELLING_SERVICE",
    rankedCandidates: Object.freeze(rankedCandidates),
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });
  if (reservedPassengerIds.length > 0) {
    emitter.emit("PASSENGERS_REQUEUED", atSecondValue, {
      disruptionId: disruption.id,
      passengerIds: Object.freeze(reservedPassengerIds),
      releaseSecond: atSecondValue,
      reasonCode: "FAILED_VEHICLE_RESERVED_RELEASE",
      zoneId: reservedPickupZoneId ?? snappedZoneId,
      totalOnboardAfter: totalOnboard(state),
      activeSeatCountAfter: activeSeatCount(state),
    });
  }
  maybeCompleteRecovery(state, disruption, emitter, atSecondValue);
}

function completeDwell(
  state: MutableSimulationState,
  context: SimulationContext,
  vehicle: MutableVehicleState,
  emitter: EventEmitter,
  atSecondValue: number,
  allowDeparture = true,
): void {
  const operation = vehicle.activeBoardingOperation;
  if (
    !operation ||
    operation.completesAtSecond !== atSecondValue ||
    !vehicle.assignedOriginZoneId ||
    !vehicle.assignedDestinationZoneId ||
    vehicle.reservedPassengerIds.length === 0
  ) {
    vehicle.state = "IDLE";
    vehicle.dwellEndsAtSecond = undefined;
    vehicle.assignedOriginZoneId = undefined;
    vehicle.assignedDestinationZoneId = undefined;
    vehicle.reservedPassengerIds = [];
    return;
  }

  const boardedPassengerIds = [...operation.passengerIds];
  if (
    canonicalJson(boardedPassengerIds) !==
    canonicalJson([...vehicle.reservedPassengerIds].sort(compareCodeUnits))
  ) {
    throw new StressLabEngineInvariantError(
      `Vehicle ${vehicle.id} boarding manifest changed after operation start.`,
    );
  }
  for (const passengerIdValue of boardedPassengerIds) {
    const passenger = findMutablePassenger(state, passengerIdValue);
    if (
      passenger.state !== "RESERVED" ||
      passenger.assignedVehicleId !== vehicle.id
    ) {
      throw new StressLabEngineInvariantError(
        `Vehicle ${vehicle.id} cannot board passenger ${passengerIdValue}.`,
      );
    }
    passenger.state = "ONBOARD";
    passenger.currentZoneId = vehicle.currentZoneId;
    passenger.firstBoardedAtSecond ??= simulatedSecond(atSecondValue);
  }
  vehicle.onboardPassengerIds = boardedPassengerIds;
  vehicle.reservedPassengerIds = [];
  vehicle.activeBoardingOperation = undefined;
  emitter.emit("PASSENGERS_BOARDED", atSecondValue, {
    vehicleId: vehicle.id,
    passengerIds: Object.freeze(boardedPassengerIds),
    boardedAtSecond: atSecondValue,
    occupancyAfter: vehicle.onboardPassengerIds.length,
    seatCapacity: vehicle.seats,
    zoneId: vehicle.currentZoneId,
    terminalHold: !allowDeparture,
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });

  for (const disruption of context.input.disruptions) {
    if (
      boardedPassengerIds.some(
        (id) =>
          findMutablePassenger(state, id).affectedByDisruptionId ===
          disruption.id,
      )
    ) {
      maybeCompleteRecovery(state, disruption, emitter, atSecondValue);
    }
  }
  if (operation.originZoneId === operation.destinationZoneId) {
    for (const passengerIdValue of boardedPassengerIds) {
      const passenger = findMutablePassenger(state, passengerIdValue);
      passenger.state = "SERVED";
      passenger.assignedVehicleId = undefined;
      passenger.servedAtSecond = simulatedSecond(atSecondValue);
      passenger.recoveryReleaseSecond = undefined;
    }
    vehicle.onboardPassengerIds = [];
    vehicle.state = "IDLE";
    vehicle.dwellEndsAtSecond = undefined;
    vehicle.assignedOriginZoneId = undefined;
    vehicle.assignedDestinationZoneId = undefined;
    emitter.emit("PASSENGERS_SERVED", atSecondValue, {
      vehicleId: vehicle.id,
      passengerIds: Object.freeze(boardedPassengerIds),
      passengerMetres: boardedPassengerIds.reduce((total, id) => {
        const request = findMutablePassenger(state, id).request;
        return (
          total +
          findAuthoredRoute(
            context.input.network,
            request.originZoneId,
            request.destinationZoneId,
          ).distanceMetres
        );
      }, 0),
      totalOnboardAfter: totalOnboard(state),
      activeSeatCountAfter: activeSeatCount(state),
    });
    return;
  }
  if (!allowDeparture) {
    vehicle.dwellEndsAtSecond = undefined;
    return;
  }

  const serviceRoute = findAuthoredRoute(
    context.input.network,
    vehicle.assignedOriginZoneId,
    vehicle.assignedDestinationZoneId,
  );
  const serviceEnergyWh = routeEnergyWh(context.input, serviceRoute);
  const reserveWh = batteryWhAtBasisPoints(
    context.input.scenario.fleet.batteryCapacityWh,
    context.input.scenario.fleet.minimumReserveBasisPoints,
  );
  if (vehicle.batteryWh - serviceEnergyWh < reserveWh) {
    throw new StressLabEngineInvariantError(
      `Vehicle ${vehicle.id} began a service leg below mission reserve.`,
    );
  }
  vehicle.state = "TRAVELLING_SERVICE";
  vehicle.dwellEndsAtSecond = undefined;
  vehicle.activeLeg = vehicleLeg(
    "SERVICE",
    serviceRoute,
    context.input,
    atSecondValue,
    vehicle.onboardPassengerIds.length,
    vehicle.onboardPassengerIds,
    [],
  );
  emitter.emit("VEHICLE_DEPARTED_SERVICE", atSecondValue, {
    vehicleId: vehicle.id,
    fromZoneId: serviceRoute.fromZoneId,
    toZoneId: serviceRoute.toZoneId,
    passengerIds: Object.freeze(boardedPassengerIds),
    distanceMetres: serviceRoute.distanceMetres,
    travelSeconds: serviceRoute.travelSeconds,
    projectedEnergyWh: serviceEnergyWh,
    activeLeg: vehicle.activeLeg,
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });

}

function validateDispatchIntent(
  state: MutableSimulationState,
  context: SimulationContext,
  intent: DispatchIntentV1,
): ValidatedDispatchPlan | ActionRejectedReasonCode {
  const vehicle = state.vehicles.find((entry) => entry.id === intent.vehicleId);
  if (!vehicle) return "UNKNOWN_VEHICLE";
  if (vehicle.state !== "IDLE") return "VEHICLE_NOT_IDLE";
  if (intent.passengerIds.length === 0) return "EMPTY_PASSENGER_SET";
  if (new Set(intent.passengerIds).size !== intent.passengerIds.length) {
    return "DUPLICATE_PASSENGER";
  }
  if (intent.passengerIds.length > vehicle.seats) return "CAPACITY_EXCEEDED";
  for (const passengerIdValue of intent.passengerIds) {
    const passenger = state.passengers.find(
      (entry) => entry.request.id === passengerIdValue,
    );
    if (!passenger) return "UNKNOWN_PASSENGER";
    if (passenger.state !== "WAITING" || !passenger.currentZoneId) {
      return "PASSENGER_NOT_ELIGIBLE";
    }
    if (passenger.currentZoneId !== intent.originZoneId) {
      return "ORIGIN_MISMATCH";
    }
    if (passenger.request.destinationZoneId !== intent.destinationZoneId) {
      return "DESTINATION_MISMATCH";
    }
  }
  let emptyRoute: ReturnType<typeof findAuthoredRoute>;
  let serviceRoute: ReturnType<typeof findAuthoredRoute>;
  try {
    emptyRoute = findAuthoredRoute(
      context.input.network,
      vehicle.currentZoneId,
      intent.originZoneId,
    );
    serviceRoute = findAuthoredRoute(
      context.input.network,
      intent.originZoneId,
      intent.destinationZoneId,
    );
  } catch {
    return "TOPOLOGY_UNREACHABLE";
  }
  const emptyEnergyWh = routeEnergyWh(context.input, emptyRoute);
  const serviceEnergyWh = routeEnergyWh(context.input, serviceRoute);
  const reserveWh = batteryWhAtBasisPoints(
    context.input.scenario.fleet.batteryCapacityWh,
    context.input.scenario.fleet.minimumReserveBasisPoints,
  );
  if (vehicle.batteryWh - emptyEnergyWh - serviceEnergyWh < reserveWh) {
    return "RESERVE_INFEASIBLE";
  }
  return Object.freeze({
    intent,
    emptyRoute,
    serviceRoute,
    emptyEnergyWh,
    serviceEnergyWh,
  });
}

function emitRejectedIntent(
  state: MutableSimulationState,
  context: SimulationContext,
  emitter: EventEmitter,
  atSecondValue: number,
  intent: DispatchIntentV1,
  reasonCode: ActionRejectedReasonCode,
): void {
  emitter.emit("ACTION_REJECTED", atSecondValue, {
    controllerId: context.controllerId,
    controllerVersion: context.controllerVersion,
    intentKind: intent.kind,
    reasonCode,
    vehicleId: intent.vehicleId,
    passengerIds: Object.freeze([...intent.passengerIds]),
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });
}

function applyDispatchPlan(
  state: MutableSimulationState,
  context: SimulationContext,
  emitter: EventEmitter,
  atSecondValue: number,
  plan: ValidatedDispatchPlan,
): void {
  const { intent } = plan;
  const vehicle = findMutableVehicle(state, intent.vehicleId);
  for (const passengerIdValue of intent.passengerIds) {
    const passenger = findMutablePassenger(state, passengerIdValue);
    if (passenger.state !== "WAITING") {
      throw new StressLabEngineInvariantError(
        `Controller selected non-waiting passenger ${passengerIdValue}.`,
      );
    }
    passenger.state = "RESERVED";
    passenger.assignedVehicleId = vehicle.id;
  }
  vehicle.reservedPassengerIds = [...intent.passengerIds];
  vehicle.assignedOriginZoneId = intent.originZoneId;
  vehicle.assignedDestinationZoneId = intent.destinationZoneId;

  const recoveryPassengerIds = intent.passengerIds.filter(
    (id) => findMutablePassenger(state, id).affectedByDisruptionId !== undefined,
  );
  if (recoveryPassengerIds.length > 0) {
    emitter.emit("RECOVERY_ASSIGNED", atSecondValue, {
      vehicleId: vehicle.id,
      passengerIds: Object.freeze(recoveryPassengerIds),
      originZoneId: intent.originZoneId,
      destinationZoneId: intent.destinationZoneId,
      totalOnboardAfter: totalOnboard(state),
      activeSeatCountAfter: activeSeatCount(state),
    });
  }

  if (plan.emptyRoute.travelSeconds === 0) {
    vehicle.state = "DWELLING";
    vehicle.currentZoneId = intent.originZoneId;
    beginBoardingOperation(
      vehicle,
      atSecondValue,
      context.input.scenario.fleet.dwellSeconds,
    );
    const boardingOperation = vehicle.activeBoardingOperation!;
    emitter.emit("VEHICLE_ARRIVED_PICKUP", atSecondValue, {
      vehicleId: vehicle.id,
      zoneId: intent.originZoneId,
      destinationZoneId: intent.destinationZoneId,
      passengerIds: intent.passengerIds,
      dwellEndsAtSecond: boardingOperation.completesAtSecond,
      boardingOperation,
      boardingOperationStarted: true,
      totalOnboardAfter: totalOnboard(state),
      activeSeatCountAfter: activeSeatCount(state),
    });
    if (context.input.scenario.fleet.dwellSeconds === 0) {
      completeDwell(state, context, vehicle, emitter, atSecondValue);
    }
    return;
  }

  vehicle.state = "TRAVELLING_EMPTY";
  vehicle.activeLeg = vehicleLeg(
    "EMPTY",
    plan.emptyRoute,
    context.input,
    atSecondValue,
    0,
    [],
    intent.passengerIds,
  );
  emitter.emit("VEHICLE_DISPATCHED_EMPTY", atSecondValue, {
    vehicleId: vehicle.id,
    fromZoneId: plan.emptyRoute.fromZoneId,
    toZoneId: plan.emptyRoute.toZoneId,
    serviceDestinationZoneId: intent.destinationZoneId,
    passengerIds: intent.passengerIds,
    distanceMetres: plan.emptyRoute.distanceMetres,
    travelSeconds: plan.emptyRoute.travelSeconds,
    projectedEnergyWh: plan.emptyEnergyWh,
    activeLeg: vehicle.activeLeg,
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });
}

function snapshotFor(
  state: MutableSimulationState,
  input: StressLabRunInput,
): SimulationSnapshot {
  const passengerCounts: Record<PassengerLifecycleState, Count> = {
    NOT_ARRIVED: count(0),
    WAITING: count(0),
    RESERVED: count(0),
    ONBOARD: count(0),
    RECOVERY_WAIT: count(0),
    SERVED: count(0),
  };
  for (const passenger of state.passengers) {
    passengerCounts[passenger.state] = count(
      passengerCounts[passenger.state] + 1,
    );
  }
  const zoneQueueCounts: Record<string, Count> = {};
  for (const zone of input.network.zones) zoneQueueCounts[zone.id] = count(0);
  for (const passenger of state.passengers) {
    if (
      (passenger.state === "WAITING" ||
        passenger.state === "RECOVERY_WAIT") &&
      passenger.currentZoneId
    ) {
      zoneQueueCounts[passenger.currentZoneId] = count(
        (zoneQueueCounts[passenger.currentZoneId] ?? 0) + 1,
      );
    }
  }
  return deepFreeze({
    atSecond: state.atSecond,
    throughEventSequence: count(state.nextEventSequence - 1),
    vehicles: compactUndefined(state.vehicles) as readonly VehicleState[],
    passengerCounts,
    zoneQueueCounts,
    appliedDisruptionIds: state.appliedDisruptionIds,
    recoveryCompletedDisruptionIds: state.recoveryCompletedDisruptionIds,
  });
}

function assertEventOrder(events: readonly SimulationEvent[]): void {
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const prior = events[index - 1];
    if (
      !Number.isSafeInteger(event.atSecond) ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1 ||
      (prior &&
        (event.atSecond < prior.atSecond ||
          event.sequence !== prior.sequence + 1))
    ) {
      throw new StressLabEngineInvariantError(
        "Simulation events must have monotonic time and contiguous sequence.",
      );
    }
  }
}

export function assertSimulationInvariants(
  state: SimulationState,
  context: SimulationContext,
  events: readonly SimulationEvent[] = [],
  priorState?: SimulationState,
): void {
  const passengerIds = state.passengers.map((entry) => entry.request.id);
  if (
    passengerIds.length !== context.input.demandTrace.requests.length ||
    new Set(passengerIds).size !== passengerIds.length
  ) {
    throw new StressLabEngineInvariantError(
      "Passenger conservation or identity uniqueness failed.",
    );
  }
  const vehicleIds = state.vehicles.map((entry) => entry.id);
  if (new Set(vehicleIds).size !== vehicleIds.length) {
    throw new StressLabEngineInvariantError("Vehicle IDs must remain unique.");
  }
  const passengerAssignmentCounts = new Map<PassengerId, number>();
  const reserveWh = batteryWhAtBasisPoints(
    context.input.scenario.fleet.batteryCapacityWh,
    context.input.scenario.fleet.minimumReserveBasisPoints,
  );
  for (const vehicle of state.vehicles) {
    if (
      vehicle.onboardPassengerIds.length > vehicle.seats ||
      vehicle.onboardPassengerIds.length < 0 ||
      vehicle.batteryWh < 0 ||
      vehicle.batteryWh > context.input.scenario.fleet.batteryCapacityWh ||
      vehicle.batteryWh < reserveWh
    ) {
      throw new StressLabEngineInvariantError(
        `Vehicle ${vehicle.id} violates capacity or battery invariants.`,
      );
    }
    if (
      vehicle.state === "FAILED" &&
      (vehicle.activeLeg ||
        vehicle.activeBoardingOperation ||
        vehicle.dwellEndsAtSecond !== undefined ||
        vehicle.onboardPassengerIds.length > 0 ||
        vehicle.reservedPassengerIds.length > 0)
    ) {
      throw new StressLabEngineInvariantError(
        `Failed vehicle ${vehicle.id} retained an active mission.`,
      );
    }
    if (
      (vehicle.state === "TRAVELLING_EMPTY" ||
        vehicle.state === "TRAVELLING_SERVICE") !==
      (vehicle.activeLeg !== undefined)
    ) {
      throw new StressLabEngineInvariantError(
        `Vehicle ${vehicle.id} has inconsistent movement state.`,
      );
    }
    if (
      vehicle.activeBoardingOperation &&
      (vehicle.state !== "DWELLING" ||
        vehicle.dwellEndsAtSecond !==
          vehicle.activeBoardingOperation.completesAtSecond ||
        canonicalJson([...vehicle.reservedPassengerIds].sort(compareCodeUnits)) !==
          canonicalJson(vehicle.activeBoardingOperation.passengerIds))
    ) {
      throw new StressLabEngineInvariantError(
        `Vehicle ${vehicle.id} has inconsistent boarding-operation state.`,
      );
    }
    for (const passengerIdValue of [
      ...vehicle.onboardPassengerIds,
      ...vehicle.reservedPassengerIds,
    ]) {
      passengerAssignmentCounts.set(
        passengerIdValue,
        (passengerAssignmentCounts.get(passengerIdValue) ?? 0) + 1,
      );
    }
  }

  for (const passenger of state.passengers) {
    const assignedCount = passengerAssignmentCounts.get(passenger.request.id) ?? 0;
    if (assignedCount > 1) {
      throw new StressLabEngineInvariantError(
        `Passenger ${passenger.request.id} occupies multiple vehicle states.`,
      );
    }
    if (
      passenger.state === "NOT_ARRIVED" &&
      passenger.request.arrivalSecond <= state.atSecond
    ) {
      throw new StressLabEngineInvariantError(
        `Passenger ${passenger.request.id} remained not-arrived after release.`,
      );
    }
    if (
      (passenger.state === "RESERVED" || passenger.state === "ONBOARD") &&
      (!passenger.assignedVehicleId || assignedCount !== 1)
    ) {
      throw new StressLabEngineInvariantError(
        `Passenger ${passenger.request.id} has inconsistent assignment state.`,
      );
    }
    if (
      passenger.state !== "RESERVED" &&
      passenger.state !== "ONBOARD" &&
      passenger.assignedVehicleId !== undefined
    ) {
      throw new StressLabEngineInvariantError(
        `Passenger ${passenger.request.id} retained a stale vehicle assignment.`,
      );
    }
    if (
      passenger.state === "SERVED" &&
      passenger.servedAtSecond === undefined
    ) {
      throw new StressLabEngineInvariantError(
        `Served passenger ${passenger.request.id} lacks a service time.`,
      );
    }
  }

  if (priorState) {
    for (const failed of priorState.vehicles.filter(
      (vehicle) => vehicle.state === "FAILED",
    )) {
      if (
        state.vehicles.find((vehicle) => vehicle.id === failed.id)?.state !==
        "FAILED"
      ) {
        throw new StressLabEngineInvariantError(
          `Failed vehicle ${failed.id} became operational again.`,
        );
      }
    }
  }
  assertEventOrder(events);
}

export function stepSimulation(
  stateValue: SimulationState,
  atSecondValue: number,
  context: SimulationContext,
  controller: DispatchControllerV1,
): StepResult {
  const { input } = context;
  if (
    !Number.isSafeInteger(atSecondValue) ||
    atSecondValue < 0 ||
    atSecondValue > input.terminalEvaluationSecond ||
    atSecondValue % input.horizon.tickSeconds !== 0 ||
    atSecondValue < stateValue.atSecond
  ) {
    throw new StressLabInputValidationError(
      "INVALID_SIMULATION_TICK",
      "Simulation ticks must be monotonic, in-horizon, and aligned.",
    );
  }
  const state = cloneState(stateValue);
  state.atSecond = simulatedSecond(atSecondValue);
  const emitter = createEmitter(state, input.scenarioSlot);
  const isTerminalEvaluation =
    atSecondValue === input.terminalEvaluationSecond;
  emitter.emit("TICK_OBSERVED", atSecondValue, {
    terminalEvaluation: isTerminalEvaluation,
    intakeOpen: atSecondValue < input.horizon.durationSeconds,
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });

  // 1. Disruptions win every same-tick completion tie.
  for (const disruption of [...input.disruptions].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  )) {
    if (
      disruption.atSecond === atSecondValue &&
      !state.appliedDisruptionIds.includes(disruption.id)
    ) {
      applyVehicleFailure(state, context, disruption, emitter, atSecondValue);
    }
  }

  // 2. Account movement edge-by-edge, then settle completed travel legs.
  for (const vehicle of [...state.vehicles].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  )) {
    accountActiveLegTo(state, input, vehicle, emitter, atSecondValue);
  }
  const serviceArrivals: ServiceArrival[] = [];
  for (const vehicle of [...state.vehicles].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  )) {
    const leg = vehicle.activeLeg;
    if (!leg || leg.endsAtSecond !== atSecondValue) continue;
    if (
      leg.accountedDistanceMetres !== leg.distanceMetres ||
      leg.accountedEnergyWh !== leg.energyWh
    ) {
      throw new StressLabEngineInvariantError(
        `Vehicle ${vehicle.id} completed before movement evidence reconciled.`,
      );
    }
    vehicle.currentZoneId = leg.toZoneId;
    vehicle.activeLeg = undefined;
    if (leg.kind === "EMPTY") {
      vehicle.state = isTerminalEvaluation ? "IDLE" : "DWELLING";
      if (!isTerminalEvaluation) {
        beginBoardingOperation(
          vehicle,
          atSecondValue,
          input.scenario.fleet.dwellSeconds,
        );
      }
      const boardingOperation = vehicle.activeBoardingOperation ?? null;
      emitter.emit("VEHICLE_ARRIVED_PICKUP", atSecondValue, {
        vehicleId: vehicle.id,
        zoneId: vehicle.currentZoneId,
        destinationZoneId: vehicle.assignedDestinationZoneId ?? null,
        passengerIds: Object.freeze([...vehicle.reservedPassengerIds]),
        dwellEndsAtSecond: boardingOperation?.completesAtSecond ?? null,
        boardingOperation,
        boardingOperationStarted: boardingOperation !== null,
        totalOnboardAfter: totalOnboard(state),
        activeSeatCountAfter: activeSeatCount(state),
      });
    } else {
      serviceArrivals.push({ vehicleId: vehicle.id, leg });
      emitter.emit("VEHICLE_ARRIVED_DROPOFF", atSecondValue, {
        vehicleId: vehicle.id,
        zoneId: vehicle.currentZoneId,
        passengerIds: Object.freeze([...vehicle.onboardPassengerIds]),
        totalOnboardAfter: totalOnboard(state),
        activeSeatCountAfter: activeSeatCount(state),
      });
    }
  }

  // 3. Complete dwell actions.
  for (const vehicle of [...state.vehicles].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  )) {
    if (
      vehicle.state === "DWELLING" &&
      vehicle.dwellEndsAtSecond === atSecondValue &&
      (!isTerminalEvaluation ||
        (vehicle.activeBoardingOperation?.startedAtSecond ?? atSecondValue) <
          atSecondValue)
    ) {
      completeDwell(
        state,
        context,
        vehicle,
        emitter,
        atSecondValue,
        !isTerminalEvaluation,
      );
    }
  }

  // 4. Unload service arrivals and mark passengers served.
  for (const arrival of serviceArrivals.sort((left, right) =>
    compareCodeUnits(left.vehicleId, right.vehicleId),
  )) {
    const vehicle = findMutableVehicle(state, arrival.vehicleId);
    const servedPassengerIds = [...vehicle.onboardPassengerIds].sort(
      compareCodeUnits,
    );
    for (const passengerIdValue of servedPassengerIds) {
      const passenger = findMutablePassenger(state, passengerIdValue);
      if (passenger.state !== "ONBOARD") {
        throw new StressLabEngineInvariantError(
          `Vehicle ${vehicle.id} cannot serve passenger ${passengerIdValue}.`,
        );
      }
      passenger.state = "SERVED";
      passenger.assignedVehicleId = undefined;
      passenger.currentZoneId = arrival.leg.toZoneId;
      passenger.servedAtSecond = simulatedSecond(atSecondValue);
      passenger.recoveryReleaseSecond = undefined;
    }
    vehicle.onboardPassengerIds = [];
    vehicle.state = "IDLE";
    vehicle.assignedOriginZoneId = undefined;
    vehicle.assignedDestinationZoneId = undefined;
    const passengerMetresValue = servedPassengerIds.reduce((total, id) => {
      const request = findMutablePassenger(state, id).request;
      return (
        total +
        findAuthoredRoute(
          input.network,
          request.originZoneId,
          request.destinationZoneId,
        ).distanceMetres
      );
    }, 0);
    emitter.emit("PASSENGERS_SERVED", atSecondValue, {
      vehicleId: vehicle.id,
      passengerIds: Object.freeze(servedPassengerIds),
      passengerMetres: passengerMetresValue,
      totalOnboardAfter: totalOnboard(state),
      activeSeatCountAfter: activeSeatCount(state),
    });
  }

  // 5. Release disruption-affected passengers after the fixed transfer delay.
  const releasedByDisruption = new Map<DisruptionId, PassengerId[]>();
  for (const passenger of state.passengers) {
    if (
      passenger.state === "RECOVERY_WAIT" &&
      passenger.recoveryReleaseSecond === atSecondValue &&
      passenger.affectedByDisruptionId
    ) {
      passenger.state = "WAITING";
      passenger.recoveryReleaseSecond = undefined;
      const values =
        releasedByDisruption.get(passenger.affectedByDisruptionId) ?? [];
      values.push(passenger.request.id);
      releasedByDisruption.set(passenger.affectedByDisruptionId, values);
    }
  }
  for (const [disruptionIdValue, ids] of [...releasedByDisruption.entries()].sort(
    (left, right) => compareCodeUnits(left[0], right[0]),
  )) {
    const first = findMutablePassenger(state, ids[0]);
    emitter.emit("PASSENGERS_REQUEUED", atSecondValue, {
      disruptionId: disruptionIdValue,
      passengerIds: Object.freeze([...ids].sort(compareCodeUnits)),
      releaseSecond: atSecondValue,
      reasonCode: "FAILED_VEHICLE_TRANSFER_COMPLETE",
      zoneId: first.currentZoneId ?? null,
      totalOnboardAfter: totalOnboard(state),
      activeSeatCountAfter: activeSeatCount(state),
    });
  }

  // 6. Release authored demand at this tick.
  for (const passenger of state.passengers) {
    if (
      atSecondValue < input.horizon.durationSeconds &&
      passenger.state === "NOT_ARRIVED" &&
      passenger.request.arrivalSecond === atSecondValue
    ) {
      passenger.state = "WAITING";
      passenger.currentZoneId = passenger.request.originZoneId;
      emitter.emit("PASSENGER_ARRIVED", atSecondValue, {
        passengerId: passenger.request.id,
        requestSecond: passenger.request.arrivalSecond,
        originZoneId: passenger.request.originZoneId,
        destinationZoneId: passenger.request.destinationZoneId,
        totalOnboardAfter: totalOnboard(state),
        activeSeatCountAfter: activeSeatCount(state),
      });
    }
  }

  // 7–8. A causally restricted controller proposes intents; the engine alone
  // validates and applies them. The terminal observation starts no new work.
  const handledIntentKeys = new Set<string>();
  if (!isTerminalEvaluation) {
    for (let iteration = 0; iteration < state.vehicles.length; iteration += 1) {
      const observation = createControllerObservation(
        freezeState(cloneState(state as SimulationState)),
        input,
      );
      const intents = [...controller.decide(observation)].sort((left, right) => {
        const leftKey = `${left.vehicleId}|${left.originZoneId}|${left.destinationZoneId}|${[...left.passengerIds].sort(compareCodeUnits).join(",")}`;
        const rightKey = `${right.vehicleId}|${right.originZoneId}|${right.destinationZoneId}|${[...right.passengerIds].sort(compareCodeUnits).join(",")}`;
        return compareCodeUnits(leftKey, rightKey);
      });
      let applied = false;
      for (const intent of intents) {
        const intentKey = `${intent.vehicleId}|${intent.originZoneId}|${intent.destinationZoneId}|${[...intent.passengerIds].sort(compareCodeUnits).join(",")}`;
        if (handledIntentKeys.has(intentKey)) continue;
        handledIntentKeys.add(intentKey);
        const validation = validateDispatchIntent(state, context, intent);
        if (typeof validation === "string") {
          emitRejectedIntent(
            state,
            context,
            emitter,
            atSecondValue,
            intent,
            validation,
          );
          continue;
        }
        applyDispatchPlan(state, context, emitter, atSecondValue, validation);
        applied = true;
      }
      if (!applied) break;
    }
  }

  const nextState = freezeState(state);
  assertSimulationInvariants(nextState, context, emitter.events, stateValue);
  const snapshot = snapshotFor(state, input);
  return deepFreeze({
    state: nextState,
    events: emitter.events,
    snapshot,
  });
}

function terminalStateFor(state: SimulationState): SimulationTerminalState {
  return deepFreeze(compactUndefined({
    atSecond: state.atSecond,
    passengers: state.passengers,
    vehicles: state.vehicles,
    appliedDisruptionIds: state.appliedDisruptionIds,
    recoveryCompletedDisruptionIds: state.recoveryCompletedDisruptionIds,
  }));
}

function finalizeSimulation(
  prepared: PreparedRunInput,
  stateValue: SimulationState,
  context: SimulationContext,
  priorEvents: readonly SimulationEvent[],
  snapshots: readonly SimulationSnapshot[],
): DeterministicSimulationResult {
  const state = cloneState(stateValue);
  const emitter = createEmitter(state, context.input.scenarioSlot);
  const servedPassengerIds = state.passengers
    .filter((passenger) => passenger.state === "SERVED")
    .map((passenger) => passenger.request.id);
  const inServiceAtHorizonPassengerIds = state.passengers
    .filter((passenger) => {
      if (passenger.state === "ONBOARD" || passenger.state === "RECOVERY_WAIT") {
        return true;
      }
      if (
        passenger.state !== "RESERVED" ||
        !passenger.affectedByDisruptionId ||
        !passenger.assignedVehicleId
      ) {
        return false;
      }
      const vehicle = state.vehicles.find(
        (candidate) => candidate.id === passenger.assignedVehicleId,
      );
      return Boolean(
        vehicle &&
          vehicle.state !== "FAILED" &&
          (vehicle.activeLeg?.purpose === "PICKUP" ||
            vehicle.activeBoardingOperation),
      );
    })
    .map((passenger) => passenger.request.id);
  const completedOrActiveIds = new Set([
    ...servedPassengerIds,
    ...inServiceAtHorizonPassengerIds,
  ]);
  const unservedPassengerIds = state.passengers
    .filter((passenger) => !completedOrActiveIds.has(passenger.request.id))
    .map((passenger) => passenger.request.id);
  const strandedPassengerIds = state.passengers
    .filter(
      (passenger) =>
        unservedPassengerIds.includes(passenger.request.id) &&
        passenger.affectedByDisruptionId !== undefined,
    )
    .map((passenger) => passenger.request.id);
  emitter.emit("RUN_COMPLETED", context.input.terminalEvaluationSecond, {
    requestedPassengers: state.passengers.length,
    servedPassengers: servedPassengerIds.length,
    inServiceAtHorizonPassengers: inServiceAtHorizonPassengerIds.length,
    unservedPassengers: unservedPassengerIds.length,
    servedPassengerIds: Object.freeze(servedPassengerIds),
    inServiceAtHorizonPassengerIds: Object.freeze(
      inServiceAtHorizonPassengerIds,
    ),
    unservedPassengerIds: Object.freeze(unservedPassengerIds),
    strandedPassengerIds: Object.freeze(strandedPassengerIds),
    waitingPassengers: state.passengers.filter(
      (passenger) => passenger.state === "WAITING",
    ).length,
    reservedPassengers: state.passengers.filter(
      (passenger) => passenger.state === "RESERVED",
    ).length,
    onboardPassengers: state.passengers.filter(
      (passenger) => passenger.state === "ONBOARD",
    ).length,
    recoveryWaitPassengers: state.passengers.filter(
      (passenger) => passenger.state === "RECOVERY_WAIT",
    ).length,
    failedVehicles: state.vehicles.filter((vehicle) => vehicle.state === "FAILED")
      .length,
    totalOnboardAfter: totalOnboard(state),
    activeSeatCountAfter: activeSeatCount(state),
  });
  const finalState = freezeState(state);
  const events = deepFreeze([...priorEvents, ...emitter.events]);
  assertEventOrder(events);
  assertSimulationInvariants(finalState, context, events, stateValue);
  const terminalState = terminalStateFor(finalState);
  const evidence = deriveRunEvidence(context.input, events);
  const ledgerDocument = createEventLedgerDocument({
    eventSchemaVersion: context.eventSchemaVersion,
    inputFingerprint: context.inputFingerprint,
    engineVersion: context.engineVersion,
    tickSemanticsVersion: context.tickSemanticsVersion,
    controllerId: context.controllerId,
    controllerVersion: context.controllerVersion,
    events,
  });
  const ledgerEnvelope = deepFreeze({
    eventSchemaVersion: context.eventSchemaVersion,
    inputFingerprint: context.inputFingerprint,
    engineVersion: context.engineVersion,
    tickSemanticsVersion: context.tickSemanticsVersion,
    controllerId: context.controllerId,
    controllerVersion: context.controllerVersion,
    events,
    fingerprint: ledgerDocument.fingerprint,
  });
  const replayedTerminalState = terminalStateFor(
    replayVerifiedEventLedger(prepared, ledgerEnvelope),
  );
  if (canonicalJson(replayedTerminalState) !== canonicalJson(terminalState)) {
    throw new StressLabEngineInvariantError(
      "Verified event replay did not reconstruct the canonical terminal state.",
    );
  }
  const resultIdentity = {
    resultSchemaVersion: context.resultSchemaVersion,
    eventSchemaVersion: context.eventSchemaVersion,
    inputFingerprint: context.inputFingerprint,
    engineVersion: context.engineVersion,
    tickSemanticsVersion: context.tickSemanticsVersion,
    controllerId: context.controllerId,
    controllerVersion: context.controllerVersion,
    metricDefinitionVersion: context.metricDefinitionVersion,
    eventLedgerFingerprint: ledgerDocument.fingerprint,
    snapshots,
    terminalState,
    metrics: evidence.metrics,
    constraints: evidence.constraints,
  };
  const fingerprintDocument = createFingerprintDocument(
    "RUN_RESULT_EVIDENCE",
    runResultIdentityValue(resultIdentity),
  );
  return deepFreeze({
    status: "COMPLETED",
    resultSchemaVersion: context.resultSchemaVersion,
    eventSchemaVersion: context.eventSchemaVersion,
    inputFingerprint: context.inputFingerprint,
    engineVersion: context.engineVersion,
    tickSemanticsVersion: context.tickSemanticsVersion,
    controllerId: context.controllerId,
    controllerVersion: context.controllerVersion,
    metricDefinitionVersion: context.metricDefinitionVersion,
    events,
    snapshots,
    terminalState,
    metrics: evidence.metrics,
    constraints: evidence.constraints,
    eventLedgerFingerprint: ledgerDocument.fingerprint,
    canonicalResultJson: fingerprintDocument.canonicalJson,
    resultFingerprint: fingerprintDocument.fingerprint,
  });
}

function tickValues(input: StressLabRunInput): readonly number[] {
  const values: number[] = [];
  for (
    let atSecondValue = 0;
    atSecondValue <= input.terminalEvaluationSecond;
    atSecondValue += input.horizon.tickSeconds
  ) {
    values.push(atSecondValue);
  }
  return Object.freeze(values);
}

export function runDeterministicSimulationWithController(
  prepared: PreparedRunInput,
  controller: DispatchControllerV1,
): DeterministicSimulationResult {
  const initialized = initializeSimulation(prepared, controller);
  let state = initialized.state;
  const events: SimulationEvent[] = [initialized.runStartedEvent];
  const snapshots: SimulationSnapshot[] = [];
  for (const atSecondValue of tickValues(initialized.context.input)) {
    const step = stepSimulation(
      state,
      atSecondValue,
      initialized.context,
      controller,
    );
    state = step.state;
    events.push(...step.events);
    snapshots.push(step.snapshot);
  }
  return finalizeSimulation(
    prepared,
    state,
    initialized.context,
    events,
    snapshots,
  );
}

export function runDeterministicSimulation(
  prepared: PreparedRunInput,
): DeterministicSimulationResult {
  return runDeterministicSimulationWithController(
    prepared,
    REFERENCE_DISPATCH_CONTROLLER,
  );
}

function assertNotCancelled(signal: CancellationSignal | undefined): void {
  if (signal?.aborted) throw new StressLabSimulationCancelledError();
}

export async function runDeterministicSimulationAsync(
  prepared: PreparedRunInput,
  options: AsyncSimulationOptions = {},
): Promise<DeterministicSimulationResult> {
  assertNotCancelled(options.signal);
  const yieldEveryTicks = options.yieldEveryTicks ?? 6;
  if (
    !Number.isSafeInteger(yieldEveryTicks) ||
    yieldEveryTicks < 1 ||
    yieldEveryTicks > 67
  ) {
    throw new StressLabInputValidationError(
      "INVALID_YIELD_INTERVAL",
      "Yield interval must be an integer from 1 to 67 ticks.",
    );
  }
  const yieldControl = options.yieldControl ?? (() => Promise.resolve());
  const controller = REFERENCE_DISPATCH_CONTROLLER;
  const initialized = initializeSimulation(prepared, controller);
  assertNotCancelled(options.signal);
  let state = initialized.state;
  const events: SimulationEvent[] = [initialized.runStartedEvent];
  const snapshots: SimulationSnapshot[] = [];
  const ticks = tickValues(initialized.context.input);
  for (let index = 0; index < ticks.length; index += 1) {
    assertNotCancelled(options.signal);
    const step = stepSimulation(
      state,
      ticks[index],
      initialized.context,
      controller,
    );
    state = step.state;
    events.push(...step.events);
    snapshots.push(step.snapshot);
    if ((index + 1) % yieldEveryTicks === 0 && index + 1 < ticks.length) {
      await yieldControl();
      assertNotCancelled(options.signal);
    }
  }
  assertNotCancelled(options.signal);
  const result = finalizeSimulation(
    prepared,
    state,
    initialized.context,
    events,
    snapshots,
  );
  assertNotCancelled(options.signal);
  return result;
}

export function fingerprintIdentityOf(
  result: DeterministicSimulationResult,
): Readonly<{
  inputFingerprint: Fingerprint;
  eventLedgerFingerprint: Fingerprint;
  resultFingerprint: Fingerprint;
  lastEvidenceId: EvidenceId;
}> {
  const last = result.events.at(-1);
  if (!last) {
    throw new StressLabEngineInvariantError(
      "Completed simulation result has no event evidence.",
    );
  }
  return Object.freeze({
    inputFingerprint: result.inputFingerprint,
    eventLedgerFingerprint: result.eventLedgerFingerprint,
    resultFingerprint: result.resultFingerprint,
    lastEvidenceId: last.evidenceId,
  });
}
