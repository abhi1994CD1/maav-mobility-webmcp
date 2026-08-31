declare const stressLabBrand: unique symbol;

export type Brand<Value, Name extends string> = Value & {
  readonly [stressLabBrand]: Name;
};

export type ExperimentId = Brand<string, "ExperimentId">;
export type ZoneId = Brand<string, "ZoneId">;
export type EdgeId = Brand<string, "EdgeId">;
export type PassengerId = Brand<string, "PassengerId">;
export type VehicleId = Brand<string, "VehicleId">;
export type ScenarioRevisionId = Brand<string, "ScenarioRevisionId">;
export type DisruptionId = Brand<string, "DisruptionId">;
export type RunId = Brand<string, "RunId">;
export type ComparisonId = Brand<string, "ComparisonId">;
export type FindingId = Brand<string, "FindingId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type OperationId = Brand<string, "OperationId">;
export type Fingerprint = Brand<string, "Fingerprint">;
export type NetworkVersion = Brand<string, "NetworkVersion">;
export type ControllerId = Brand<string, "ControllerId">;
export type ControllerVersion = Brand<string, "ControllerVersion">;

export type SimulatedSecond = Brand<number, "SimulatedSecond">;
export type Metres = Brand<number, "Metres">;
export type WattHours = Brand<number, "WattHours">;
export type WattHoursPerKilometre = Brand<number, "WattHoursPerKilometre">;
export type Count = Brand<number, "Count">;
export type BasisPoints = Brand<number, "BasisPoints">;
export type SignedBasisPoints = Brand<number, "SignedBasisPoints">;
export type Seed = Brand<number, "Seed">;
export type LatitudeMicrodegrees = Brand<number, "LatitudeMicrodegrees">;
export type LongitudeMicrodegrees = Brand<number, "LongitudeMicrodegrees">;

export const STRESS_LAB_INPUT_SCHEMA_VERSION =
  "run-input-schema-v2" as const;
export const STRESS_LAB_NETWORK_SCHEMA_VERSION =
  "stress-lab-input-schema-v1" as const;
export const STRESS_LAB_CANONICALIZATION_VERSION = "canonical-json-v1" as const;
export const STRESS_LAB_FINGERPRINT_VERSION = "sha256-v1" as const;
export const STRESS_LAB_NETWORK_VERSION =
  "sandton-rosebank-v1" as NetworkVersion;
export const STRESS_LAB_PRESET_VERSION =
  "morning-peak-resilience-v2" as const;
export const STRESS_LAB_DEMAND_GENERATOR_VERSION = "demand-v1" as const;
export const STRESS_LAB_ENGINE_VERSION = "maav-sim-v2" as const;
export const STRESS_LAB_TICK_SEMANTICS_VERSION =
  "maav-30-second-tick-v2" as const;
export const STRESS_LAB_CONTROLLER_VERSION =
  "oldest-wait-nearest-idle-v1" as const;
export const STRESS_LAB_METRIC_DEFINITION_VERSION =
  "stress-lab-metrics-v2" as const;
export const STRESS_LAB_DISRUPTION_POLICY_VERSION =
  "equivalent-vehicle-failure-v1" as const;
export const STRESS_LAB_EVENT_SCHEMA_VERSION = "event-schema-v2" as const;
export const STRESS_LAB_RESULT_SCHEMA_VERSION =
  "simulation-result-schema-v2" as const;
export const STRESS_LAB_COMPARISON_SCHEMA_VERSION =
  "comparison-schema-v1" as const;
export const STRESS_LAB_COMPARISON_CLAIM_TEMPLATE_VERSION =
  "bounded-comparison-claims-v1" as const;

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const FINGERPRINT_PATTERN = /^sha256-v1:[0-9a-f]{64}$/u;

function stableId<Id extends string>(kind: string, value: string): Id {
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new StressLabInputValidationError(
      "INVALID_ID",
      `${kind} must contain 1–64 stable identifier characters.`,
    );
  }
  return value as Id;
}

export const experimentId = (value: string): ExperimentId =>
  stableId<ExperimentId>("ExperimentId", value);
export const zoneId = (value: string): ZoneId =>
  stableId<ZoneId>("ZoneId", value);
export const edgeId = (value: string): EdgeId =>
  stableId<EdgeId>("EdgeId", value);
export const passengerId = (value: string): PassengerId =>
  stableId<PassengerId>("PassengerId", value);
export const vehicleId = (value: string): VehicleId =>
  stableId<VehicleId>("VehicleId", value);
export const scenarioRevisionId = (value: string): ScenarioRevisionId =>
  stableId<ScenarioRevisionId>("ScenarioRevisionId", value);
export const disruptionId = (value: string): DisruptionId =>
  stableId<DisruptionId>("DisruptionId", value);
export const runId = (value: string): RunId => stableId<RunId>("RunId", value);
export const comparisonId = (value: string): ComparisonId =>
  stableId<ComparisonId>("ComparisonId", value);
export const findingId = (value: string): FindingId =>
  stableId<FindingId>("FindingId", value);
export const evidenceId = (value: string): EvidenceId =>
  stableId<EvidenceId>("EvidenceId", value);
export const operationId = (value: string): OperationId =>
  stableId<OperationId>("OperationId", value);
export const networkVersion = (value: string): NetworkVersion =>
  stableId<NetworkVersion>("NetworkVersion", value);
export const controllerId = (value: string): ControllerId =>
  stableId<ControllerId>("ControllerId", value);
export const controllerVersion = (value: string): ControllerVersion =>
  stableId<ControllerVersion>("ControllerVersion", value);

export function fingerprint(value: string): Fingerprint {
  if (!FINGERPRINT_PATTERN.test(value)) {
    throw new StressLabInputValidationError(
      "INVALID_FINGERPRINT",
      "Fingerprint must use sha256-v1 and 64 lowercase hexadecimal characters.",
    );
  }
  return value as Fingerprint;
}

function integerUnit<Unit extends number>(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): Unit {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new StressLabInputValidationError(
      "INVALID_INTEGER_UNIT",
      `${name} must be a safe integer from ${minimum} to ${maximum}.`,
    );
  }
  return value as Unit;
}

export const simulatedSecond = (value: number): SimulatedSecond =>
  integerUnit<SimulatedSecond>("SimulatedSecond", value, 0, 86_400);
export const metres = (value: number): Metres =>
  integerUnit<Metres>("Metres", value, 0, 10_000_000);
export const wattHours = (value: number): WattHours =>
  integerUnit<WattHours>("WattHours", value, 0, 1_000_000_000);
export const wattHoursPerKilometre = (
  value: number,
): WattHoursPerKilometre =>
  integerUnit<WattHoursPerKilometre>(
    "WattHoursPerKilometre",
    value,
    1,
    100_000,
  );
export const count = (value: number): Count =>
  integerUnit<Count>("Count", value, 0, 1_000_000);
export const basisPoints = (value: number): BasisPoints =>
  integerUnit<BasisPoints>("BasisPoints", value, 0, 10_000);
export const signedBasisPoints = (value: number): SignedBasisPoints =>
  integerUnit<SignedBasisPoints>("SignedBasisPoints", value, -1_000_000, 1_000_000);
export const seed = (value: number): Seed =>
  integerUnit<Seed>("Seed", value, 0, 0xffff_ffff);
export const latitudeMicrodegrees = (value: number): LatitudeMicrodegrees =>
  integerUnit<LatitudeMicrodegrees>(
    "LatitudeMicrodegrees",
    value,
    -90_000_000,
    90_000_000,
  );
export const longitudeMicrodegrees = (value: number): LongitudeMicrodegrees =>
  integerUnit<LongitudeMicrodegrees>(
    "LongitudeMicrodegrees",
    value,
    -180_000_000,
    180_000_000,
  );

export type ScenarioSlot = "A" | "B";

export interface DisplayCoordinate {
  readonly latitudeMicrodegrees: LatitudeMicrodegrees;
  readonly longitudeMicrodegrees: LongitudeMicrodegrees;
}

export interface NetworkZone {
  readonly id: ZoneId;
  readonly name: string;
  readonly displayCoordinate: DisplayCoordinate;
}

export interface NetworkEdge {
  readonly id: EdgeId;
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  readonly distanceMetres: Metres;
  readonly travelSeconds: SimulatedSecond;
  readonly pathZoneIds: readonly ZoneId[];
  readonly displayPath: readonly DisplayCoordinate[];
}

export interface NetworkFixture {
  readonly inputSchemaVersion: typeof STRESS_LAB_NETWORK_SCHEMA_VERSION;
  readonly networkVersion: NetworkVersion;
  readonly zones: readonly NetworkZone[];
  readonly edges: readonly NetworkEdge[];
}

export interface TemporalWeightWindow {
  readonly startSecond: SimulatedSecond;
  readonly endSecondExclusive: SimulatedSecond;
  readonly weight: Count;
}

export interface OriginDestinationWeight {
  readonly originZoneId: ZoneId;
  readonly destinationZoneId: ZoneId;
  readonly weight: Count;
}

export interface DemandDefinition {
  readonly generatorVersion: typeof STRESS_LAB_DEMAND_GENERATOR_VERSION;
  readonly requestCount: Count;
  readonly temporalWeights: readonly TemporalWeightWindow[];
  readonly originDestinationWeights: readonly OriginDestinationWeight[];
}

export interface PassengerRequest {
  readonly id: PassengerId;
  readonly arrivalSecond: SimulatedSecond;
  readonly originZoneId: ZoneId;
  readonly destinationZoneId: ZoneId;
}

export interface DemandTrace {
  readonly seed: Seed;
  readonly generatorVersion: typeof STRESS_LAB_DEMAND_GENERATOR_VERSION;
  readonly requests: readonly PassengerRequest[];
  readonly fingerprint: Fingerprint;
}

export interface ZoneWeight {
  readonly zoneId: ZoneId;
  readonly weight: Count;
}

export interface FleetConfiguration {
  readonly vehicleCount: Count;
  readonly seatsPerVehicle: Count;
  readonly batteryCapacityWh: WattHours;
  readonly startingBatteryBasisPoints: BasisPoints;
  readonly minimumReserveBasisPoints: BasisPoints;
  readonly energyWhPerKilometre: WattHoursPerKilometre;
  readonly dwellSeconds: SimulatedSecond;
  readonly initialZoneWeights: readonly ZoneWeight[];
}

export interface ScenarioConstraints {
  readonly maximumWaitSeconds: SimulatedSecond;
  readonly maximumUnservedPassengers: Count;
  readonly minimumBatteryReserveBasisPoints: BasisPoints;
  readonly maximumRecoverySeconds: SimulatedSecond;
  readonly standingAllowed: false;
}

export type ScenarioObjective =
  | "LOWER_WAIT"
  | "LOWER_ENERGY_PER_PASSENGER_KM"
  | "HIGHER_UTILIZATION"
  | "FASTER_RECOVERY"
  | "LOWER_EMPTY_KM";

export interface ScenarioConfiguration {
  readonly slot: ScenarioSlot;
  readonly label: string;
  readonly fleet: FleetConfiguration;
  readonly constraints: ScenarioConstraints;
  readonly objectives: readonly ScenarioObjective[];
}

export interface DeterministicVehicleFailureTarget {
  readonly kind: "DETERMINISTIC_RULE";
  readonly policyVersion: typeof STRESS_LAB_DISRUPTION_POLICY_VERSION;
  readonly ranking: readonly [
    "HIGHEST_ONBOARD_OCCUPANCY",
    "HIGHEST_RESERVED_PASSENGER_COUNT",
    "ACTIVE_SERVICE_FIRST",
    "ASCENDING_VEHICLE_ID",
  ];
}

export interface VehicleFailureDisruption {
  readonly id: DisruptionId;
  readonly type: "VEHICLE_FAILURE";
  readonly atSecond: SimulatedSecond;
  readonly target: DeterministicVehicleFailureTarget;
  readonly recoveryTransferSeconds: SimulatedSecond;
}

export type DisruptionSpecification = VehicleFailureDisruption;

export interface SimulationHorizon {
  readonly displayStart: "08:30:00";
  readonly displayEnd: "09:00:00";
  readonly durationSeconds: SimulatedSecond;
  readonly tickSeconds: SimulatedSecond;
}

export interface GoldenExperimentPreset {
  readonly inputSchemaVersion: typeof STRESS_LAB_INPUT_SCHEMA_VERSION;
  readonly presetVersion: typeof STRESS_LAB_PRESET_VERSION;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly metricDefinitionVersion: typeof STRESS_LAB_METRIC_DEFINITION_VERSION;
  readonly canonicalizationVersion: typeof STRESS_LAB_CANONICALIZATION_VERSION;
  readonly fingerprintVersion: typeof STRESS_LAB_FINGERPRINT_VERSION;
  readonly networkVersion: NetworkVersion;
  readonly horizon: SimulationHorizon;
  readonly terminalEvaluationSecond: SimulatedSecond;
  readonly seed: Seed;
  readonly demand: DemandDefinition;
  readonly scenarios: Readonly<Record<ScenarioSlot, ScenarioConfiguration>>;
  readonly disruptions: Readonly<
    Record<ScenarioSlot, readonly DisruptionSpecification[]>
  >;
}

export interface StressLabRunInput {
  readonly inputSchemaVersion: typeof STRESS_LAB_INPUT_SCHEMA_VERSION;
  readonly canonicalizationVersion: typeof STRESS_LAB_CANONICALIZATION_VERSION;
  readonly fingerprintVersion: typeof STRESS_LAB_FINGERPRINT_VERSION;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly metricDefinitionVersion: typeof STRESS_LAB_METRIC_DEFINITION_VERSION;
  readonly presetVersion: typeof STRESS_LAB_PRESET_VERSION;
  readonly scenarioSlot: ScenarioSlot;
  readonly horizon: SimulationHorizon;
  readonly terminalEvaluationSecond: SimulatedSecond;
  readonly seed: Seed;
  readonly networkVersion: NetworkVersion;
  readonly network: NetworkFixture;
  readonly networkFingerprint: Fingerprint;
  readonly demandDefinition: DemandDefinition;
  readonly demandTrace: DemandTrace;
  readonly scenario: ScenarioConfiguration;
  readonly disruptions: readonly DisruptionSpecification[];
}

export interface PreparedRunInput {
  readonly input: StressLabRunInput;
  readonly canonicalJson: string;
  readonly fingerprint: Fingerprint;
}

export interface GoldenExperimentInputManifest {
  readonly inputSchemaVersion: typeof STRESS_LAB_INPUT_SCHEMA_VERSION;
  readonly canonicalizationVersion: typeof STRESS_LAB_CANONICALIZATION_VERSION;
  readonly fingerprintVersion: typeof STRESS_LAB_FINGERPRINT_VERSION;
  readonly presetVersion: typeof STRESS_LAB_PRESET_VERSION;
  readonly presetFingerprint: Fingerprint;
  readonly networkVersion: NetworkVersion;
  readonly networkFingerprint: Fingerprint;
  readonly demandGeneratorVersion: typeof STRESS_LAB_DEMAND_GENERATOR_VERSION;
  readonly demandFingerprint: Fingerprint;
  readonly seed: Seed;
  readonly runInputFingerprints: Readonly<Record<ScenarioSlot, Fingerprint>>;
}

export interface PreparedGoldenExperimentInputs {
  readonly networkFingerprint: Fingerprint;
  readonly presetFingerprint: Fingerprint;
  readonly sharedDemandTrace: DemandTrace;
  readonly runs: Readonly<Record<ScenarioSlot, PreparedRunInput>>;
  readonly manifest: GoldenExperimentInputManifest;
  readonly manifestCanonicalJson: string;
  readonly manifestFingerprint: Fingerprint;
}

export type PassengerLifecycleState =
  | "NOT_ARRIVED"
  | "WAITING"
  | "RESERVED"
  | "ONBOARD"
  | "RECOVERY_WAIT"
  | "SERVED";

export interface PassengerState {
  readonly request: PassengerRequest;
  readonly state: PassengerLifecycleState;
  readonly assignedVehicleId?: VehicleId;
  readonly currentZoneId?: ZoneId;
  readonly firstBoardedAtSecond?: SimulatedSecond;
  readonly servedAtSecond?: SimulatedSecond;
  readonly affectedByDisruptionId?: DisruptionId;
  readonly recoveryReleaseSecond?: SimulatedSecond;
}

export type VehicleOperationalState =
  | "IDLE"
  | "TRAVELLING_EMPTY"
  | "DWELLING"
  | "TRAVELLING_SERVICE"
  | "FAILED";

export type VehicleLegKind = "EMPTY" | "SERVICE";
export type VehicleLegPurpose = "PICKUP" | "PASSENGER_SERVICE";

export interface ActiveLegEdgeEvidence {
  readonly edgeId: EdgeId;
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  readonly distanceMetres: Metres;
  readonly travelSeconds: SimulatedSecond;
  readonly energyWh: WattHours;
  readonly startOffsetSeconds: SimulatedSecond;
  readonly endOffsetSeconds: SimulatedSecond;
}

export interface ActiveLegEvidence {
  readonly kind: VehicleLegKind;
  readonly purpose: VehicleLegPurpose;
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  readonly edgeIds: readonly EdgeId[];
  readonly pathZoneIds: readonly ZoneId[];
  readonly passengerIds: readonly PassengerId[];
  readonly reservationIds: readonly PassengerId[];
  readonly edges: readonly ActiveLegEdgeEvidence[];
  readonly distanceMetres: Metres;
  readonly travelSeconds: SimulatedSecond;
  readonly energyWh: WattHours;
  readonly startedAtSecond: SimulatedSecond;
  readonly endsAtSecond: SimulatedSecond;
  readonly onboardCountAtDeparture: Count;
  readonly accountedDistanceMetres: Metres;
  readonly accountedEnergyWh: WattHours;
}

export type VehicleLeg = ActiveLegEvidence;

export interface VehicleState {
  readonly id: VehicleId;
  readonly state: VehicleOperationalState;
  readonly currentZoneId: ZoneId;
  readonly seats: Count;
  readonly onboardPassengerIds: readonly PassengerId[];
  readonly reservedPassengerIds: readonly PassengerId[];
  readonly batteryWh: WattHours;
  readonly assignedOriginZoneId?: ZoneId;
  readonly assignedDestinationZoneId?: ZoneId;
  readonly activeLeg?: VehicleLeg;
  readonly activeBoardingOperation?: ActiveBoardingOperation;
  readonly dwellEndsAtSecond?: SimulatedSecond;
  readonly failedByDisruptionId?: DisruptionId;
}

export interface ActiveBoardingOperation {
  readonly startedAtSecond: SimulatedSecond;
  readonly completesAtSecond: SimulatedSecond;
  readonly passengerIds: readonly PassengerId[];
  readonly originZoneId: ZoneId;
  readonly destinationZoneId: ZoneId;
}

export type SimulationEventType =
  | "RUN_STARTED"
  | "TICK_OBSERVED"
  | "PASSENGER_ARRIVED"
  | "VEHICLE_DISPATCHED_EMPTY"
  | "VEHICLE_ARRIVED_PICKUP"
  | "PASSENGERS_BOARDED"
  | "VEHICLE_DEPARTED_SERVICE"
  | "VEHICLE_ARRIVED_DROPOFF"
  | "PASSENGERS_SERVED"
  | "BATTERY_CHANGED"
  | "VEHICLE_FAILED"
  | "PASSENGERS_REQUEUED"
  | "RECOVERY_ASSIGNED"
  | "RECOVERY_COMPLETED"
  | "ACTION_REJECTED"
  | "DISRUPTION_TARGET_NOT_FOUND"
  | "RUN_COMPLETED";

export type SimulationFactValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | ActiveLegEvidence
  | ActiveBoardingOperation;

export type ActionRejectedReasonCode =
  | "CAPACITY_EXCEEDED"
  | "DUPLICATE_PASSENGER"
  | "EMPTY_PASSENGER_SET"
  | "ORIGIN_MISMATCH"
  | "DESTINATION_MISMATCH"
  | "PASSENGER_NOT_ELIGIBLE"
  | "RESERVE_INFEASIBLE"
  | "TOPOLOGY_UNREACHABLE"
  | "UNKNOWN_PASSENGER"
  | "UNKNOWN_VEHICLE"
  | "VEHICLE_NOT_IDLE";

export type RecoveryCompletionReasonCode =
  | "ALL_AFFECTED_PASSENGERS_RECOVERED"
  | "NO_AFFECTED_PASSENGERS";

export interface ActionRejectedFacts
  extends Readonly<Record<string, SimulationFactValue>> {
  readonly controllerId: string;
  readonly controllerVersion: string;
  readonly intentKind: "DISPATCH";
  readonly reasonCode: ActionRejectedReasonCode;
  readonly vehicleId: string;
  readonly passengerIds: readonly string[];
  readonly totalOnboardAfter: number;
  readonly activeSeatCountAfter: number;
}

export interface SimulationEvent {
  readonly evidenceId: EvidenceId;
  readonly type: SimulationEventType;
  readonly atSecond: SimulatedSecond;
  readonly sequence: Count;
  readonly facts: Readonly<Record<string, SimulationFactValue>>;
}

export interface ActionRejectedEvent extends SimulationEvent {
  readonly type: "ACTION_REJECTED";
  readonly facts: ActionRejectedFacts;
}

export interface SimulationSnapshot {
  readonly atSecond: SimulatedSecond;
  readonly throughEventSequence: Count;
  readonly vehicles: readonly VehicleState[];
  readonly passengerCounts: Readonly<Record<PassengerLifecycleState, Count>>;
  readonly zoneQueueCounts: Readonly<Record<string, Count>>;
  readonly appliedDisruptionIds: readonly DisruptionId[];
  readonly recoveryCompletedDisruptionIds: readonly DisruptionId[];
}

export interface SimulationState {
  readonly atSecond: SimulatedSecond;
  readonly nextEventSequence: Count;
  readonly passengers: readonly PassengerState[];
  readonly vehicles: readonly VehicleState[];
  readonly appliedDisruptionIds: readonly DisruptionId[];
  readonly recoveryCompletedDisruptionIds: readonly DisruptionId[];
}

export interface ControllerTopologyEdgeV1 {
  readonly id: EdgeId;
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  readonly distanceMetres: Metres;
  readonly travelSeconds: SimulatedSecond;
  readonly pathZoneIds: readonly ZoneId[];
}

export interface ControllerTopologyV1 {
  readonly networkVersion: NetworkVersion;
  readonly zoneIds: readonly ZoneId[];
  readonly edges: readonly ControllerTopologyEdgeV1[];
}

export interface ControllerVehicleObservationV1 {
  readonly id: VehicleId;
  readonly state: VehicleOperationalState;
  readonly currentZoneId: ZoneId;
  readonly seats: Count;
  readonly onboardPassengerIds: readonly PassengerId[];
  readonly reservedPassengerIds: readonly PassengerId[];
  readonly batteryWh: WattHours;
  readonly activeLeg?: ActiveLegEvidence;
  readonly activeBoardingOperation?: ActiveBoardingOperation;
  readonly failedByDisruptionId?: DisruptionId;
}

export interface ControllerPassengerObservationV1 {
  readonly id: PassengerId;
  readonly arrivalSecond: SimulatedSecond;
  readonly originZoneId: ZoneId;
  readonly destinationZoneId: ZoneId;
  readonly currentZoneId: ZoneId;
  readonly affectedByDisruptionId?: DisruptionId;
}

export interface ControllerObservationV1 {
  readonly observationVersion: "controller-observation-v1";
  readonly atSecond: SimulatedSecond;
  readonly vehicles: readonly ControllerVehicleObservationV1[];
  readonly eligiblePassengers: readonly ControllerPassengerObservationV1[];
  readonly topology: ControllerTopologyV1;
  readonly constraints: ScenarioConstraints;
  readonly fleetParameters: Readonly<
    Pick<
      FleetConfiguration,
      | "batteryCapacityWh"
      | "dwellSeconds"
      | "energyWhPerKilometre"
      | "minimumReserveBasisPoints"
    >
  >;
  readonly activeDisruptionIds: readonly DisruptionId[];
}

export interface DispatchIntentV1 {
  readonly intentVersion: "dispatch-intent-v1";
  readonly kind: "DISPATCH";
  readonly vehicleId: VehicleId;
  readonly passengerIds: readonly PassengerId[];
  readonly originZoneId: ZoneId;
  readonly destinationZoneId: ZoneId;
}

export interface DispatchControllerV1 {
  readonly controllerId: ControllerId;
  readonly controllerVersion: ControllerVersion;
  decide(observation: ControllerObservationV1): readonly DispatchIntentV1[];
}

export interface SimulationContext {
  readonly input: StressLabRunInput;
  readonly inputFingerprint: Fingerprint;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly tickSemanticsVersion: typeof STRESS_LAB_TICK_SEMANTICS_VERSION;
  readonly controllerId: ControllerId;
  readonly controllerVersion: ControllerVersion;
  readonly metricDefinitionVersion: typeof STRESS_LAB_METRIC_DEFINITION_VERSION;
  readonly eventSchemaVersion: typeof STRESS_LAB_EVENT_SCHEMA_VERSION;
  readonly resultSchemaVersion: typeof STRESS_LAB_RESULT_SCHEMA_VERSION;
}

export interface StepResult {
  readonly state: SimulationState;
  readonly events: readonly SimulationEvent[];
  readonly snapshot: SimulationSnapshot;
}

export interface SimulationTerminalState {
  readonly atSecond: SimulatedSecond;
  readonly passengers: readonly PassengerState[];
  readonly vehicles: readonly VehicleState[];
  readonly appliedDisruptionIds: readonly DisruptionId[];
  readonly recoveryCompletedDisruptionIds: readonly DisruptionId[];
}

export interface MetricSet {
  readonly requestedPassengers: Count;
  readonly servedPassengers: Count;
  readonly inServiceAtHorizonPassengers: Count;
  readonly unservedPassengers: Count;
  readonly averageWaitSeconds: SimulatedSecond | null;
  readonly p95WaitSeconds: SimulatedSecond | null;
  readonly maximumWaitSeconds: SimulatedSecond;
  readonly onTimeBasisPoints: BasisPoints | null;
  readonly peakOccupancyBasisPoints: BasisPoints | null;
  readonly passengerMetres: Metres;
  readonly vehicleMetres: Metres;
  readonly emptyVehicleMetres: Metres;
  readonly utilizationBasisPoints: BasisPoints | null;
  readonly totalEnergyWh: WattHours;
  readonly energyWhPerPassengerKilometre: WattHours | null;
  readonly minimumBatteryBasisPoints: BasisPoints | null;
  readonly reserveViolations: Count;
  readonly reserveBlockedAssignments: Count;
  readonly recoveryTimeSeconds: SimulatedSecond | null;
}

export interface ConstraintEvaluation {
  readonly code:
    | "MAXIMUM_WAIT"
    | "MAXIMUM_UNSERVED"
    | "MINIMUM_RESERVE"
    | "MAXIMUM_RECOVERY"
    | "NO_STANDING";
  readonly passed: boolean;
  readonly observed: number | null;
  readonly threshold: number | null;
  readonly unit: "SECONDS" | "PASSENGERS" | "BASIS_POINTS" | "COUNT";
  readonly evidenceIds: readonly EvidenceId[];
}

export interface DeterministicSimulationResult {
  readonly status: "COMPLETED";
  readonly resultSchemaVersion: typeof STRESS_LAB_RESULT_SCHEMA_VERSION;
  readonly eventSchemaVersion: typeof STRESS_LAB_EVENT_SCHEMA_VERSION;
  readonly inputFingerprint: Fingerprint;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly tickSemanticsVersion: typeof STRESS_LAB_TICK_SEMANTICS_VERSION;
  readonly controllerId: ControllerId;
  readonly controllerVersion: ControllerVersion;
  readonly metricDefinitionVersion: typeof STRESS_LAB_METRIC_DEFINITION_VERSION;
  readonly events: readonly SimulationEvent[];
  readonly snapshots: readonly SimulationSnapshot[];
  readonly terminalState: SimulationTerminalState;
  readonly metrics: MetricSet;
  readonly constraints: readonly ConstraintEvaluation[];
  readonly eventLedgerFingerprint: Fingerprint;
  readonly canonicalResultJson: string;
  readonly resultFingerprint: Fingerprint;
}

export interface EventLedgerEnvelope {
  readonly eventSchemaVersion: typeof STRESS_LAB_EVENT_SCHEMA_VERSION;
  readonly inputFingerprint: Fingerprint;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly tickSemanticsVersion: typeof STRESS_LAB_TICK_SEMANTICS_VERSION;
  readonly controllerId: ControllerId;
  readonly controllerVersion: ControllerVersion;
  readonly events: readonly SimulationEvent[];
  readonly fingerprint: Fingerprint;
}

export interface RunResultArtifact {
  readonly resultSchemaVersion: typeof STRESS_LAB_RESULT_SCHEMA_VERSION;
  readonly eventSchemaVersion: typeof STRESS_LAB_EVENT_SCHEMA_VERSION;
  readonly inputFingerprint: Fingerprint;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly tickSemanticsVersion: typeof STRESS_LAB_TICK_SEMANTICS_VERSION;
  readonly controllerId: ControllerId;
  readonly controllerVersion: ControllerVersion;
  readonly metricDefinitionVersion: typeof STRESS_LAB_METRIC_DEFINITION_VERSION;
  readonly eventLedgerFingerprint: Fingerprint;
  readonly snapshots: readonly SimulationSnapshot[];
  readonly terminalState: SimulationTerminalState;
  readonly metrics: MetricSet;
  readonly constraints: readonly ConstraintEvaluation[];
  readonly canonicalResultJson: string;
  readonly resultFingerprint: Fingerprint;
}

declare const verifiedRunResultBrand: unique symbol;

export type VerifiedRunResultArtifact = RunResultArtifact & {
  readonly [verifiedRunResultBrand]: true;
};

export interface RunArtifact {
  readonly id: RunId;
  readonly scenarioRevisionId: ScenarioRevisionId;
  readonly scenarioSlot: ScenarioSlot;
  readonly status: "COMPLETED" | "CANCELLED" | "FAILED";
  readonly inputFingerprint: Fingerprint;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly tickSemanticsVersion: typeof STRESS_LAB_TICK_SEMANTICS_VERSION;
  readonly controllerId: ControllerId;
  readonly controllerVersion: ControllerVersion;
  readonly metricDefinitionVersion: typeof STRESS_LAB_METRIC_DEFINITION_VERSION;
  readonly eventSchemaVersion: typeof STRESS_LAB_EVENT_SCHEMA_VERSION;
  readonly resultSchemaVersion: typeof STRESS_LAB_RESULT_SCHEMA_VERSION;
  readonly eventLedgerFingerprint?: Fingerprint;
  readonly resultFingerprint?: Fingerprint;
  readonly events: readonly SimulationEvent[];
  readonly snapshots: readonly SimulationSnapshot[];
  readonly metrics?: MetricSet;
  readonly constraints?: readonly ConstraintEvaluation[];
}

export type ComparisonMetricKey = keyof MetricSet;

export type ComparisonNumericUnit =
  | "PASSENGERS"
  | "SECONDS"
  | "BASIS_POINTS"
  | "METRES"
  | "WATT_HOURS"
  | "WATT_HOURS_PER_PASSENGER_KILOMETRE"
  | "COUNT";

export type ComparisonRelation = "RIGHT_HIGHER" | "RIGHT_LOWER" | "EQUAL";

export type RelativeDeltaStatus =
  | "DEFINED"
  | "LEFT_ZERO_DENOMINATOR"
  | "NOT_APPLICABLE";

export interface ComparisonEvidenceReference {
  readonly inputFingerprint: Fingerprint;
  readonly eventLedgerFingerprint: Fingerprint;
  readonly resultFingerprint: Fingerprint;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface MetricDelta {
  readonly metricKey: ComparisonMetricKey;
  readonly unit: ComparisonNumericUnit;
  readonly leftValue: number | null;
  readonly rightValue: number | null;
  readonly rightMinusLeft: number | null;
  readonly relation: ComparisonRelation | "NOT_APPLICABLE";
  readonly relativeDeltaBasisPoints: number | null;
  readonly relativeDeltaStatus: RelativeDeltaStatus;
  readonly leftEvidence: ComparisonEvidenceReference;
  readonly rightEvidence: ComparisonEvidenceReference;
}

export type ConstraintTransition =
  | "BOTH_PASS"
  | "BOTH_FAIL"
  | "LEFT_PASS_RIGHT_FAIL"
  | "LEFT_FAIL_RIGHT_PASS";

export interface ComparedConstraintSide {
  readonly passed: boolean;
  readonly observed: number | null;
  readonly threshold: number | null;
  readonly evidence: ComparisonEvidenceReference;
}

export interface ConstraintComparison {
  readonly constraintCode: ConstraintEvaluation["code"];
  readonly unit: ConstraintEvaluation["unit"];
  readonly left: ComparedConstraintSide;
  readonly right: ComparedConstraintSide;
  readonly rightMinusLeft: number | null;
  readonly relation: ComparisonRelation | "NOT_APPLICABLE";
  readonly transition: ConstraintTransition;
  readonly evidenceDiffers: boolean;
}

export type PermittedScenarioDifference =
  | {
      readonly path:
        | "scenario.slot"
        | "scenario.label"
        | "disruptions[].id";
      readonly kind: "SCENARIO_IDENTITY";
      readonly leftValue: string;
      readonly rightValue: string;
    }
  | {
      readonly path:
        | "scenario.fleet.vehicleCount"
        | "scenario.fleet.seatsPerVehicle";
      readonly kind: "FLEET_CONFIGURATION";
      readonly unit: "VEHICLES" | "SEATS_PER_VEHICLE";
      readonly leftValue: number;
      readonly rightValue: number;
      readonly rightMinusLeft: number;
    };

export interface ComparisonScenarioIdentity {
  readonly slot: ScenarioSlot;
  readonly label: string;
  readonly inputFingerprint: Fingerprint;
  readonly eventLedgerFingerprint: Fingerprint;
  readonly resultFingerprint: Fingerprint;
}

export interface SharedComparisonProvenance {
  readonly inputSchemaVersion: typeof STRESS_LAB_INPUT_SCHEMA_VERSION;
  readonly presetVersion: typeof STRESS_LAB_PRESET_VERSION;
  readonly canonicalizationVersion: typeof STRESS_LAB_CANONICALIZATION_VERSION;
  readonly fingerprintVersion: typeof STRESS_LAB_FINGERPRINT_VERSION;
  readonly networkVersion: NetworkVersion;
  readonly networkFingerprint: Fingerprint;
  readonly demandGeneratorVersion: typeof STRESS_LAB_DEMAND_GENERATOR_VERSION;
  readonly demandFingerprint: Fingerprint;
  readonly seed: Seed;
  readonly horizon: SimulationHorizon;
  readonly terminalEvaluationSecond: SimulatedSecond;
  readonly engineVersion: typeof STRESS_LAB_ENGINE_VERSION;
  readonly tickSemanticsVersion: typeof STRESS_LAB_TICK_SEMANTICS_VERSION;
  readonly controllerId: ControllerId;
  readonly controllerVersion: ControllerVersion;
  readonly metricDefinitionVersion: typeof STRESS_LAB_METRIC_DEFINITION_VERSION;
  readonly eventSchemaVersion: typeof STRESS_LAB_EVENT_SCHEMA_VERSION;
  readonly resultSchemaVersion: typeof STRESS_LAB_RESULT_SCHEMA_VERSION;
  readonly hardConstraints: ScenarioConstraints;
  readonly operationalAssumptions: Readonly<
    Omit<FleetConfiguration, "vehicleCount" | "seatsPerVehicle">
  >;
  readonly objectives: readonly ScenarioObjective[];
  readonly disruptionPolicy: readonly {
    readonly type: DisruptionSpecification["type"];
    readonly atSecond: SimulatedSecond;
    readonly target: DeterministicVehicleFailureTarget;
    readonly recoveryTransferSeconds: SimulatedSecond;
  }[];
}

export interface EvidenceClaim {
  readonly claimCode:
    | "CONSTRAINT_STATUS"
    | "SERVICE_METRIC_DELTA"
    | "ENERGY_METRIC_DELTA";
  readonly subjectKind: "CONSTRAINT" | "METRIC";
  readonly subjectId: ConstraintEvaluation["code"] | ComparisonMetricKey;
  readonly unit: ComparisonNumericUnit | ConstraintEvaluation["unit"];
  readonly leftValue: number | null;
  readonly rightValue: number | null;
  readonly rightMinusLeft: number | null;
  readonly relation: ComparisonRelation | "NOT_APPLICABLE";
  readonly constraintTransition: ConstraintTransition | null;
  readonly leftEvidence: ComparisonEvidenceReference;
  readonly rightEvidence: ComparisonEvidenceReference;
}

export interface ComparisonArtifact {
  readonly comparisonSchemaVersion: typeof STRESS_LAB_COMPARISON_SCHEMA_VERSION;
  readonly claimTemplateVersion: typeof STRESS_LAB_COMPARISON_CLAIM_TEMPLATE_VERSION;
  readonly compatibility: "COMPARABLE";
  readonly deltaConvention: "RIGHT_MINUS_LEFT";
  readonly left: ComparisonScenarioIdentity;
  readonly right: ComparisonScenarioIdentity;
  readonly sharedProvenance: SharedComparisonProvenance;
  readonly permittedScenarioDifferences: readonly PermittedScenarioDifference[];
  readonly metricDeltas: readonly MetricDelta[];
  readonly constraintComparisons: readonly ConstraintComparison[];
  readonly claims: readonly EvidenceClaim[];
  readonly canonicalComparisonJson: string;
  readonly comparisonFingerprint: Fingerprint;
}

declare const trustedComparisonArtifactBrand: unique symbol;

export type TrustedComparisonArtifact = ComparisonArtifact & {
  readonly [trustedComparisonArtifactBrand]: true;
};

export interface FindingArtifact {
  readonly id: FindingId;
  readonly comparisonId: ComparisonId;
  readonly evidenceHash: Fingerprint;
  readonly selectedOutcome: "A" | "B" | "TRADE_OFF" | "INCONCLUSIVE";
  readonly emphasis: "BALANCED" | "SERVICE" | "ENERGY" | "RESILIENCE";
  readonly claims: readonly EvidenceClaim[];
  readonly status: "PENDING_REVIEW" | "ACCEPTED" | "CHALLENGED" | "STALE";
}

export interface ComparisonMismatch {
  readonly path: string;
  readonly leftValue: unknown;
  readonly rightValue: unknown;
}

export class StressLabComparisonError extends Error {
  readonly code:
    | "UNVERIFIED_RUN_RESULT"
    | "INCOMPARABLE_RUNS"
    | "INVALID_COMPARISON_EVIDENCE";
  readonly path: string;
  readonly leftValue: unknown;
  readonly rightValue: unknown;
  readonly mismatches: readonly ComparisonMismatch[];

  constructor(
    code: StressLabComparisonError["code"],
    path: string,
    message: string,
    leftValue?: unknown,
    rightValue?: unknown,
    mismatches: readonly ComparisonMismatch[] = [],
  ) {
    super(`${code} at ${path}: ${message}`);
    this.name = "StressLabComparisonError";
    this.code = code;
    this.path = path;
    this.leftValue = leftValue;
    this.rightValue = rightValue;
    this.mismatches = Object.freeze([...mismatches]);
  }
}

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export class StressLabInputValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StressLabInputValidationError";
    this.code = code;
  }
}

export class StressLabEngineInvariantError extends Error {
  readonly code = "ENGINE_INVARIANT_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "StressLabEngineInvariantError";
  }
}

export class StressLabArtifactVerificationError extends Error {
  readonly code = "ARTIFACT_VERIFICATION_FAILED" as const;
  readonly path: string;

  constructor(path: string, message: string) {
    super(`ARTIFACT_VERIFICATION_FAILED at ${path}: ${message}`);
    this.name = "StressLabArtifactVerificationError";
    this.path = path;
  }
}

export class StressLabSimulationCancelledError extends Error {
  readonly code = "OPERATION_CANCELLED" as const;

  constructor() {
    super("The deterministic simulation was cancelled before completion.");
    this.name = "StressLabSimulationCancelledError";
  }
}
