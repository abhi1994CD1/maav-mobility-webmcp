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
  "stress-lab-input-schema-v1" as const;
export const STRESS_LAB_CANONICALIZATION_VERSION = "canonical-json-v1" as const;
export const STRESS_LAB_FINGERPRINT_VERSION = "sha256-v1" as const;
export const STRESS_LAB_NETWORK_VERSION = "sandton-rosebank-v1" as const;
export const STRESS_LAB_PRESET_VERSION =
  "morning-peak-resilience-v1" as const;
export const STRESS_LAB_DEMAND_GENERATOR_VERSION = "demand-v1" as const;
export const STRESS_LAB_ENGINE_VERSION = "maav-sim-v1" as const;
export const STRESS_LAB_METRIC_DEFINITION_VERSION =
  "stress-lab-metrics-v1" as const;
export const STRESS_LAB_DISRUPTION_POLICY_VERSION =
  "equivalent-vehicle-failure-v1" as const;

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
  readonly inputSchemaVersion: typeof STRESS_LAB_INPUT_SCHEMA_VERSION;
  readonly networkVersion: typeof STRESS_LAB_NETWORK_VERSION;
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
  readonly networkVersion: typeof STRESS_LAB_NETWORK_VERSION;
  readonly horizon: SimulationHorizon;
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
  readonly seed: Seed;
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
  readonly networkVersion: typeof STRESS_LAB_NETWORK_VERSION;
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
}

export type VehicleOperationalState =
  | "IDLE"
  | "TRAVELLING_EMPTY"
  | "DWELLING"
  | "TRAVELLING_SERVICE"
  | "FAILED";

export interface VehicleState {
  readonly id: VehicleId;
  readonly state: VehicleOperationalState;
  readonly currentZoneId: ZoneId;
  readonly seats: Count;
  readonly onboardPassengerIds: readonly PassengerId[];
  readonly reservedPassengerIds: readonly PassengerId[];
  readonly batteryWh: WattHours;
}

export type SimulationEventType =
  | "RUN_STARTED"
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
  | "DISPATCH_BLOCKED_RESERVE"
  | "RUN_COMPLETED";

export type SimulationFactValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

export interface SimulationEvent {
  readonly evidenceId: EvidenceId;
  readonly type: SimulationEventType;
  readonly atSecond: SimulatedSecond;
  readonly sequence: Count;
  readonly facts: Readonly<Record<string, SimulationFactValue>>;
}

export interface SimulationSnapshot {
  readonly atSecond: SimulatedSecond;
  readonly vehicles: readonly VehicleState[];
  readonly passengerCounts: Readonly<Record<PassengerLifecycleState, Count>>;
  readonly zoneQueueCounts: Readonly<Record<string, Count>>;
}

export interface MetricSet {
  readonly requestedPassengers: Count;
  readonly servedPassengers: Count;
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

export interface RunArtifact {
  readonly id: RunId;
  readonly scenarioRevisionId: ScenarioRevisionId;
  readonly scenarioSlot: ScenarioSlot;
  readonly status: "COMPLETED" | "CANCELLED" | "FAILED";
  readonly inputFingerprint: Fingerprint;
  readonly resultFingerprint?: Fingerprint;
  readonly events: readonly SimulationEvent[];
  readonly snapshots: readonly SimulationSnapshot[];
  readonly metrics?: MetricSet;
  readonly constraints?: readonly ConstraintEvaluation[];
}

export interface MetricDelta {
  readonly metricKey: keyof MetricSet;
  readonly a: number | null;
  readonly b: number | null;
  readonly absoluteDelta: number | null;
  readonly percentageDeltaBasisPoints: SignedBasisPoints | null;
}

export interface ComparisonArtifact {
  readonly id: ComparisonId;
  readonly runAId: RunId;
  readonly runBId: RunId;
  readonly compatibility: "COMPARABLE" | "INCOMPARABLE";
  readonly compatibilityReasons: readonly string[];
  readonly metricDeltas?: readonly MetricDelta[];
  readonly evidenceHash?: Fingerprint;
}

export interface EvidenceClaim {
  readonly claimCode: string;
  readonly metricKeys: readonly (keyof MetricSet)[];
  readonly evidenceIds: readonly EvidenceId[];
  readonly values: Readonly<Record<"A" | "B" | "delta", number | null>>;
}

export interface FindingArtifact {
  readonly id: FindingId;
  readonly comparisonId: ComparisonId;
  readonly evidenceHash: Fingerprint;
  readonly selectedOutcome: "A" | "B" | "TRADE_OFF" | "INCONCLUSIVE";
  readonly emphasis: "BALANCED" | "SERVICE" | "ENERGY" | "RESILIENCE";
  readonly claims: readonly EvidenceClaim[];
  readonly status: "PENDING_REVIEW" | "ACCEPTED" | "CHALLENGED" | "STALE";
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
