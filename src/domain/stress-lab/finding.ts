import { createFingerprintDocument } from "./fingerprint";
import { isTrustedRunComparison } from "./comparison";
import {
  STRESS_LAB_FINDING_POLICY_VERSION,
  STRESS_LAB_FINDING_SCHEMA_VERSION,
  STRESS_LAB_FINDING_TEMPLATE_VERSION,
  type ComparisonMetricKey,
  type ComparisonNumericUnit,
  type ConstraintComparison,
  type FindingCandidateArtifact,
  type FindingCaveat,
  type FindingEmphasis,
  type FindingEvidenceClaim,
  type FindingEvidenceRelationship,
  type FindingFavouredSide,
  type FindingImprovementDirection,
  type FindingMetricFamily,
  type FindingSelectedOutcome,
  type MetricDelta,
  type TrustedComparisonArtifact,
} from "./types";

const FINDING_FINGERPRINT_SCOPE = "FINDING_CANDIDATE_EVIDENCE";
const FINDING_INPUT_KEYS = Object.freeze([
  "comparison",
  "selectedOutcome",
  "emphasis",
] as const);

type MaterialityRule =
  | "NONE"
  | "TOTAL_ENERGY"
  | "ENERGY_PER_PASSENGER_KILOMETRE"
  | "CAPACITY_UTILIZATION";

export type FindingMetricPolicyEntry = Readonly<
  | {
      readonly metricKey: ComparisonMetricKey;
      readonly eligible: true;
      readonly family: FindingMetricFamily;
      readonly improvementDirection: FindingImprovementDirection;
      readonly unit: ComparisonNumericUnit;
      readonly tieBreakKey: ComparisonMetricKey;
      readonly materialityRule: MaterialityRule;
    }
  | {
      readonly metricKey: ComparisonMetricKey;
      readonly eligible: false;
      readonly unit: ComparisonNumericUnit;
      readonly exclusionReason:
        | "CONTROLLED_INPUT"
        | "REDUNDANT_OUTCOME"
        | "DIAGNOSTIC_ONLY";
    }
>;

function includedMetric(
  metricKey: ComparisonMetricKey,
  family: FindingMetricFamily,
  improvementDirection: FindingImprovementDirection,
  unit: ComparisonNumericUnit,
  materialityRule: MaterialityRule = "NONE",
): FindingMetricPolicyEntry {
  return Object.freeze({
    metricKey,
    eligible: true,
    family,
    improvementDirection,
    unit,
    tieBreakKey: metricKey,
    materialityRule,
  });
}

function excludedMetric(
  metricKey: ComparisonMetricKey,
  unit: ComparisonNumericUnit,
  exclusionReason: Extract<
    FindingMetricPolicyEntry,
    { readonly eligible: false }
  >["exclusionReason"],
): FindingMetricPolicyEntry {
  return Object.freeze({ metricKey, eligible: false, unit, exclusionReason });
}

/**
 * Exhaustively classifies every published comparison metric. Eligible entries
 * describe policy categories; they never preselect an output row.
 */
export const FINDING_METRIC_SELECTION_REGISTRY = Object.freeze({
  requestedPassengers: excludedMetric(
    "requestedPassengers",
    "PASSENGERS",
    "CONTROLLED_INPUT",
  ),
  servedPassengers: excludedMetric(
    "servedPassengers",
    "PASSENGERS",
    "REDUNDANT_OUTCOME",
  ),
  inServiceAtHorizonPassengers: includedMetric(
    "inServiceAtHorizonPassengers",
    "RESILIENCE",
    "LOWER",
    "PASSENGERS",
  ),
  unservedPassengers: includedMetric(
    "unservedPassengers",
    "SERVICE",
    "LOWER",
    "PASSENGERS",
  ),
  averageWaitSeconds: includedMetric(
    "averageWaitSeconds",
    "SERVICE",
    "LOWER",
    "SECONDS",
  ),
  p95WaitSeconds: includedMetric(
    "p95WaitSeconds",
    "SERVICE",
    "LOWER",
    "SECONDS",
  ),
  maximumWaitSeconds: includedMetric(
    "maximumWaitSeconds",
    "SERVICE",
    "LOWER",
    "SECONDS",
  ),
  onTimeBasisPoints: includedMetric(
    "onTimeBasisPoints",
    "SERVICE",
    "HIGHER",
    "BASIS_POINTS",
  ),
  peakOccupancyBasisPoints: excludedMetric(
    "peakOccupancyBasisPoints",
    "BASIS_POINTS",
    "DIAGNOSTIC_ONLY",
  ),
  passengerMetres: excludedMetric(
    "passengerMetres",
    "METRES",
    "DIAGNOSTIC_ONLY",
  ),
  vehicleMetres: excludedMetric(
    "vehicleMetres",
    "METRES",
    "DIAGNOSTIC_ONLY",
  ),
  emptyVehicleMetres: excludedMetric(
    "emptyVehicleMetres",
    "METRES",
    "DIAGNOSTIC_ONLY",
  ),
  utilizationBasisPoints: includedMetric(
    "utilizationBasisPoints",
    "UTILIZATION",
    "HIGHER",
    "BASIS_POINTS",
    "CAPACITY_UTILIZATION",
  ),
  totalEnergyWh: includedMetric(
    "totalEnergyWh",
    "ENERGY",
    "LOWER",
    "WATT_HOURS",
    "TOTAL_ENERGY",
  ),
  energyWhPerPassengerKilometre: includedMetric(
    "energyWhPerPassengerKilometre",
    "ENERGY",
    "LOWER",
    "WATT_HOURS_PER_PASSENGER_KILOMETRE",
    "ENERGY_PER_PASSENGER_KILOMETRE",
  ),
  minimumBatteryBasisPoints: includedMetric(
    "minimumBatteryBasisPoints",
    "RESILIENCE",
    "HIGHER",
    "BASIS_POINTS",
  ),
  reserveViolations: includedMetric(
    "reserveViolations",
    "RESILIENCE",
    "LOWER",
    "COUNT",
  ),
  reserveBlockedAssignments: excludedMetric(
    "reserveBlockedAssignments",
    "COUNT",
    "DIAGNOSTIC_ONLY",
  ),
  recoveryTimeSeconds: includedMetric(
    "recoveryTimeSeconds",
    "RESILIENCE",
    "LOWER",
    "SECONDS",
  ),
} as const satisfies Readonly<
  Record<ComparisonMetricKey, FindingMetricPolicyEntry>
>);

export class StressLabFindingError extends Error {
  readonly code:
    | "INVALID_FINDING_INPUT"
    | "UNTRUSTED_COMPARISON"
    | "INVALID_FINDING_EVIDENCE";
  readonly path: string;

  constructor(
    code: StressLabFindingError["code"],
    path: string,
    message: string,
  ) {
    super(`${code} at ${path}: ${message}`);
    this.name = "StressLabFindingError";
    this.code = code;
    this.path = path;
  }
}

export interface CreateFindingCandidateInput {
  readonly comparison: TrustedComparisonArtifact;
  readonly selectedOutcome: FindingSelectedOutcome;
  readonly emphasis: FindingEmphasis;
}

type RecoveryState = "RECOVERED" | "NOT_RECOVERED" | "NOT_APPLICABLE";

interface ExactMagnitude {
  readonly difference: bigint;
  readonly scale: bigint;
}

interface SelectedPolicyMetric {
  readonly source: MetricDelta;
  readonly policy: Extract<FindingMetricPolicyEntry, { readonly eligible: true }>;
  readonly recoveryDifference: boolean;
  readonly favouredSide: FindingFavouredSide;
  readonly recoveryStateComparison?: Readonly<{
    readonly A: RecoveryState;
    readonly B: RecoveryState;
  }>;
}

interface PolicyMetricCandidate extends SelectedPolicyMetric {
  readonly magnitude: ExactMagnitude | null;
}

export interface FindingPolicySelection {
  readonly constraintDifference?: ConstraintComparison;
  readonly serviceOrResilienceDifference?: SelectedPolicyMetric;
  readonly materialEnergyOrUtilizationDifference?: SelectedPolicyMetric;
  readonly evidenceRelationship: FindingEvidenceRelationship;
  readonly recoveryStates: Readonly<{
    readonly A: RecoveryState;
    readonly B: RecoveryState;
  }>;
}

function clonePlain<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry)) as Value;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = clonePlain((value as Record<string, unknown>)[key]);
    }
    return clone as Value;
  }
  return value;
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

function compareCanonicalKey(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertExactInput(
  value: unknown,
): asserts value is CreateFindingCandidateInput {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new StressLabFindingError(
      "INVALID_FINDING_INPUT",
      "finding",
      "Finding input must be a plain object.",
    );
  }
  const record = value as Record<string, unknown>;
  const expected = new Set<string>(FINDING_INPUT_KEYS);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new StressLabFindingError(
        "INVALID_FINDING_INPUT",
        `finding.${key}`,
        "Unexpected finding input property.",
      );
    }
  }
  for (const key of FINDING_INPUT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new StressLabFindingError(
        "INVALID_FINDING_INPUT",
        `finding.${key}`,
        "Missing finding input property.",
      );
    }
  }
}

function assertSelectedOutcome(
  value: unknown,
): asserts value is FindingSelectedOutcome {
  if (
    value !== "A" &&
    value !== "B" &&
    value !== "TRADE_OFF" &&
    value !== "INCONCLUSIVE"
  ) {
    throw new StressLabFindingError(
      "INVALID_FINDING_INPUT",
      "finding.selectedOutcome",
      "selectedOutcome must be A, B, TRADE_OFF, or INCONCLUSIVE.",
    );
  }
}

function assertEmphasis(value: unknown): asserts value is FindingEmphasis {
  if (
    value !== "BALANCED" &&
    value !== "SERVICE" &&
    value !== "ENERGY" &&
    value !== "RESILIENCE"
  ) {
    throw new StressLabFindingError(
      "INVALID_FINDING_INPUT",
      "finding.emphasis",
      "emphasis must be BALANCED, SERVICE, ENERGY, or RESILIENCE.",
    );
  }
}

function metricRows(
  comparison: Pick<TrustedComparisonArtifact, "metricDeltas">,
): ReadonlyMap<ComparisonMetricKey, MetricDelta> {
  const rows = new Map<ComparisonMetricKey, MetricDelta>();
  for (const row of comparison.metricDeltas) {
    const policy = FINDING_METRIC_SELECTION_REGISTRY[row.metricKey];
    if (!policy || policy.unit !== row.unit) {
      throw new StressLabFindingError(
        "INVALID_FINDING_EVIDENCE",
        `comparison.metricDeltas.${row.metricKey}.unit`,
        "Metric evidence is absent from the versioned registry or has the wrong unit.",
      );
    }
    if (rows.has(row.metricKey)) {
      throw new StressLabFindingError(
        "INVALID_FINDING_EVIDENCE",
        `comparison.metricDeltas.${row.metricKey}`,
        "Metric evidence must occur exactly once.",
      );
    }
    rows.set(row.metricKey, row);
  }
  for (const metricKey of Object.keys(
    FINDING_METRIC_SELECTION_REGISTRY,
  ) as ComparisonMetricKey[]) {
    if (!rows.has(metricKey)) {
      throw new StressLabFindingError(
        "INVALID_FINDING_EVIDENCE",
        `comparison.metricDeltas.${metricKey}`,
        "The finding policy requires every published comparison metric.",
      );
    }
  }
  return rows;
}

function constraintRows(
  comparison: Pick<TrustedComparisonArtifact, "constraintComparisons">,
): ReadonlyMap<
  ConstraintComparison["constraintCode"],
  ConstraintComparison
> {
  const rows = new Map<
    ConstraintComparison["constraintCode"],
    ConstraintComparison
  >();
  for (const row of comparison.constraintComparisons) {
    if (rows.has(row.constraintCode)) {
      throw new StressLabFindingError(
        "INVALID_FINDING_EVIDENCE",
        `comparison.constraintComparisons.${row.constraintCode}`,
        "Constraint evidence must occur exactly once.",
      );
    }
    rows.set(row.constraintCode, row);
  }
  return rows;
}

function exactMagnitude(row: MetricDelta): ExactMagnitude | null {
  if (
    row.leftValue === null ||
    row.rightValue === null ||
    row.rightMinusLeft === null ||
    row.relativeDeltaStatus === "NOT_APPLICABLE"
  ) {
    return null;
  }
  if (
    !Number.isSafeInteger(row.leftValue) ||
    !Number.isSafeInteger(row.rightValue) ||
    !Number.isSafeInteger(row.rightMinusLeft) ||
    row.leftValue < 0 ||
    row.rightValue < 0 ||
    row.rightMinusLeft !== row.rightValue - row.leftValue
  ) {
    throw new StressLabFindingError(
      "INVALID_FINDING_EVIDENCE",
      `comparison.metricDeltas.${row.metricKey}`,
      "Metric selection requires non-negative safe integers and an exact signed delta.",
    );
  }
  const difference = BigInt(Math.abs(row.rightMinusLeft));
  const scale = BigInt(
    Math.max(Math.abs(row.leftValue), Math.abs(row.rightValue)),
  );
  if (difference === BigInt(0) || scale === BigInt(0)) return null;
  return { difference, scale };
}

function compareMagnitude(
  left: ExactMagnitude,
  right: ExactMagnitude,
): number {
  const leftProduct = left.difference * right.scale;
  const rightProduct = right.difference * left.scale;
  if (leftProduct > rightProduct) return -1;
  if (leftProduct < rightProduct) return 1;
  return 0;
}

function favouredSide(
  row: MetricDelta,
  direction: FindingImprovementDirection,
): FindingFavouredSide {
  if (row.leftValue === null || row.rightValue === null) {
    return "NOT_APPLICABLE";
  }
  if (row.leftValue === row.rightValue) return "EQUAL";
  if (direction === "LOWER") {
    return row.leftValue < row.rightValue ? "A" : "B";
  }
  return row.leftValue > row.rightValue ? "A" : "B";
}

function recoveryState(
  side: "left" | "right",
  row: MetricDelta,
  constraint: ConstraintComparison,
  hasDisruption: boolean,
): RecoveryState {
  const value = side === "left" ? row.leftValue : row.rightValue;
  const constraintSide = constraint[side];
  if (value !== null) {
    if (constraintSide.observed !== value) {
      throw new StressLabFindingError(
        "INVALID_FINDING_EVIDENCE",
        `comparison.metricDeltas.recoveryTimeSeconds.${side}Value`,
        "Recovery metric and constraint evidence disagree.",
      );
    }
    return "RECOVERED";
  }
  if (constraintSide.observed !== null) {
    throw new StressLabFindingError(
      "INVALID_FINDING_EVIDENCE",
      `comparison.constraintComparisons.MAXIMUM_RECOVERY.${side}.observed`,
      "A null recovery metric requires a null constraint observation.",
    );
  }
  if (hasDisruption && !constraintSide.passed) return "NOT_RECOVERED";
  if (!hasDisruption && constraintSide.passed) return "NOT_APPLICABLE";
  throw new StressLabFindingError(
    "INVALID_FINDING_EVIDENCE",
    `comparison.constraintComparisons.MAXIMUM_RECOVERY.${side}`,
    "Recovery applicability contradicts the shared disruption provenance.",
  );
}

function metricCandidate(
  row: MetricDelta,
  policy: Extract<
    FindingMetricPolicyEntry,
    { readonly eligible: true }
  >,
  recoveryStates: Readonly<{
    readonly A: RecoveryState;
    readonly B: RecoveryState;
  }>,
): PolicyMetricCandidate | undefined {
  if (row.metricKey === "recoveryTimeSeconds") {
    if (
      recoveryStates.A === "RECOVERED" &&
      recoveryStates.B === "NOT_RECOVERED"
    ) {
      return {
        source: row,
        policy,
        magnitude: null,
        recoveryDifference: true,
        favouredSide: "A",
        recoveryStateComparison: recoveryStates,
      };
    }
    if (
      recoveryStates.A === "NOT_RECOVERED" &&
      recoveryStates.B === "RECOVERED"
    ) {
      return {
        source: row,
        policy,
        magnitude: null,
        recoveryDifference: true,
        favouredSide: "B",
        recoveryStateComparison: recoveryStates,
      };
    }
    if (recoveryStates.A !== recoveryStates.B) {
      throw new StressLabFindingError(
        "INVALID_FINDING_EVIDENCE",
        "comparison.metricDeltas.recoveryTimeSeconds",
        "Recovered, not-recovered, and not-applicable states are incompatible.",
      );
    }
    if (recoveryStates.A !== "RECOVERED") return undefined;
  }
  const magnitude = exactMagnitude(row);
  if (!magnitude) return undefined;
  return {
    source: row,
    policy,
    magnitude,
    recoveryDifference: false,
    favouredSide: favouredSide(row, policy.improvementDirection),
    ...(row.metricKey === "recoveryTimeSeconds"
      ? { recoveryStateComparison: recoveryStates }
      : {}),
  };
}

function rankCandidates(
  candidates: readonly PolicyMetricCandidate[],
): PolicyMetricCandidate | undefined {
  return [...candidates].sort((left, right) => {
    if (left.recoveryDifference !== right.recoveryDifference) {
      return left.recoveryDifference ? -1 : 1;
    }
    if (left.magnitude && right.magnitude) {
      const magnitudeOrder = compareMagnitude(left.magnitude, right.magnitude);
      if (magnitudeOrder !== 0) return magnitudeOrder;
    }
    return compareCanonicalKey(
      left.policy.tieBreakKey,
      right.policy.tieBreakKey,
    );
  })[0];
}

function isMaterial(candidate: PolicyMetricCandidate): boolean {
  const magnitude = candidate.magnitude;
  if (!magnitude) return false;
  switch (candidate.policy.materialityRule) {
    case "TOTAL_ENERGY":
      return (
        magnitude.difference >= BigInt(100) &&
        BigInt(20) * magnitude.difference >= magnitude.scale
      );
    case "ENERGY_PER_PASSENGER_KILOMETRE":
      return (
        magnitude.difference >= BigInt(1) &&
        BigInt(20) * magnitude.difference >= magnitude.scale
      );
    case "CAPACITY_UTILIZATION":
      return magnitude.difference >= BigInt(100);
    case "NONE":
      return false;
  }
}

const CONSTRAINT_METRIC = Object.freeze({
  MAXIMUM_WAIT: "maximumWaitSeconds",
  MAXIMUM_UNSERVED: "unservedPassengers",
  MINIMUM_RESERVE: "minimumBatteryBasisPoints",
  MAXIMUM_RECOVERY: "recoveryTimeSeconds",
  NO_STANDING: "peakOccupancyBasisPoints",
} as const satisfies Readonly<
  Record<ConstraintComparison["constraintCode"], ComparisonMetricKey>
>);

function evidenceRelationship(
  service: SelectedPolicyMetric | undefined,
  efficiency: SelectedPolicyMetric | undefined,
): FindingEvidenceRelationship {
  if (!efficiency) return "NO_MATERIAL_EFFICIENCY_DIFFERENCE";
  if (
    service?.favouredSide !== "A" &&
    service?.favouredSide !== "B"
  ) {
    return "NEUTRAL_MATERIAL_DIFFERENCE";
  }
  return service.favouredSide === efficiency.favouredSide
    ? "ALIGNED_MATERIAL_DIFFERENCE"
    : "OPPOSING_TRADE_OFF";
}

/**
 * Pure versioned selector. It does not attest evidence or create a finding;
 * createFindingCandidate remains the sole trusted candidate boundary.
 */
export function deriveFindingPolicySelection(
  comparison: Pick<
    TrustedComparisonArtifact,
    "metricDeltas" | "constraintComparisons" | "sharedProvenance"
  >,
  emphasis: FindingEmphasis,
): FindingPolicySelection {
  assertEmphasis(emphasis);
  const metrics = metricRows(comparison);
  const constraints = constraintRows(comparison);
  const recoveryMetric = metrics.get("recoveryTimeSeconds")!;
  const recoveryConstraint = constraints.get("MAXIMUM_RECOVERY");
  if (!recoveryConstraint) {
    throw new StressLabFindingError(
      "INVALID_FINDING_EVIDENCE",
      "comparison.constraintComparisons.MAXIMUM_RECOVERY",
      "Recovery selection requires the matching hard constraint.",
    );
  }
  const hasDisruption = comparison.sharedProvenance.disruptionPolicy.length > 0;
  const recoveryStates = {
    A: recoveryState("left", recoveryMetric, recoveryConstraint, hasDisruption),
    B: recoveryState("right", recoveryMetric, recoveryConstraint, hasDisruption),
  } as const;

  const constraintDifference = [...constraints.values()]
    .filter(
      (entry) =>
        entry.transition === "LEFT_PASS_RIGHT_FAIL" ||
        entry.transition === "LEFT_FAIL_RIGHT_PASS",
    )
    .sort((left, right) =>
      compareCanonicalKey(left.constraintCode, right.constraintCode),
    )[0];
  const excludedMetricKey = constraintDifference
    ? CONSTRAINT_METRIC[constraintDifference.constraintCode]
    : undefined;

  const eligible = [...metrics.values()]
    .filter((row) => row.metricKey !== excludedMetricKey)
    .flatMap((row) => {
      const policy = FINDING_METRIC_SELECTION_REGISTRY[row.metricKey];
      if (!policy.eligible) return [];
      const candidate = metricCandidate(row, policy, recoveryStates);
      return candidate ? [candidate] : [];
    });
  const service = eligible.filter(
    (candidate) => candidate.policy.family === "SERVICE",
  );
  const resilience = eligible.filter(
    (candidate) => candidate.policy.family === "RESILIENCE",
  );
  let serviceOrResilienceDifference: PolicyMetricCandidate | undefined;
  if (emphasis === "SERVICE") {
    serviceOrResilienceDifference =
      rankCandidates(service) ?? rankCandidates(resilience);
  } else if (emphasis === "RESILIENCE") {
    serviceOrResilienceDifference =
      rankCandidates(resilience) ?? rankCandidates(service);
  } else {
    serviceOrResilienceDifference = rankCandidates([
      ...service,
      ...resilience,
    ]);
  }
  const materialEnergyOrUtilizationDifference = rankCandidates(
    eligible.filter(
      (candidate) =>
        (candidate.policy.family === "ENERGY" ||
          candidate.policy.family === "UTILIZATION") &&
        isMaterial(candidate),
    ),
  );
  const publicServiceDifference = serviceOrResilienceDifference
    ? {
        source: serviceOrResilienceDifference.source,
        policy: serviceOrResilienceDifference.policy,
        recoveryDifference: serviceOrResilienceDifference.recoveryDifference,
        favouredSide: serviceOrResilienceDifference.favouredSide,
        ...(serviceOrResilienceDifference.recoveryStateComparison
          ? {
              recoveryStateComparison:
                serviceOrResilienceDifference.recoveryStateComparison,
            }
          : {}),
      }
    : undefined;
  const publicEfficiencyDifference = materialEnergyOrUtilizationDifference
    ? {
        source: materialEnergyOrUtilizationDifference.source,
        policy: materialEnergyOrUtilizationDifference.policy,
        recoveryDifference:
          materialEnergyOrUtilizationDifference.recoveryDifference,
        favouredSide: materialEnergyOrUtilizationDifference.favouredSide,
        ...(materialEnergyOrUtilizationDifference.recoveryStateComparison
          ? {
              recoveryStateComparison:
                materialEnergyOrUtilizationDifference.recoveryStateComparison,
            }
          : {}),
      }
    : undefined;
  return deepFreeze({
    ...(constraintDifference
      ? { constraintDifference: clonePlain(constraintDifference) }
      : {}),
    ...(publicServiceDifference
      ? {
          serviceOrResilienceDifference: clonePlain(
            publicServiceDifference,
          ),
        }
      : {}),
    ...(publicEfficiencyDifference
      ? {
          materialEnergyOrUtilizationDifference: clonePlain(
            publicEfficiencyDifference,
          ),
        }
      : {}),
    evidenceRelationship: evidenceRelationship(
      serviceOrResilienceDifference,
      materialEnergyOrUtilizationDifference,
    ),
    recoveryStates,
  });
}

function constraintClaim(source: ConstraintComparison): FindingEvidenceClaim {
  return {
    claimId: `finding-claim:constraint:${source.constraintCode}`,
    templateId: "constraint-evidence-v1",
    selectionSlot: "CONSTRAINT_DIFFERENCE",
    subjectKind: "CONSTRAINT",
    constraintCode: source.constraintCode,
    unit: source.unit,
    left: clonePlain(source.left),
    right: clonePlain(source.right),
    rightMinusLeft: source.rightMinusLeft,
    relation: source.relation,
    constraintTransition: source.transition,
  };
}

function metricClaim(
  candidate: SelectedPolicyMetric,
  selectionSlot:
    | "SERVICE_RESILIENCE_DIFFERENCE"
    | "ENERGY_UTILIZATION_DIFFERENCE",
): FindingEvidenceClaim {
  const source = candidate.source;
  return {
    claimId: `finding-claim:metric:${source.metricKey}`,
    templateId: "metric-evidence-v1",
    selectionSlot,
    subjectKind: "METRIC",
    metricKey: source.metricKey,
    metricFamily: candidate.policy.family,
    improvementDirection: candidate.policy.improvementDirection,
    favouredSide: candidate.favouredSide,
    ...(candidate.recoveryStateComparison
      ? { recoveryStateComparison: clonePlain(candidate.recoveryStateComparison) }
      : {}),
    unit: source.unit,
    leftValue: source.leftValue,
    rightValue: source.rightValue,
    rightMinusLeft: source.rightMinusLeft,
    relation: source.relation,
    relativeDeltaBasisPoints: source.relativeDeltaBasisPoints,
    relativeDeltaStatus: source.relativeDeltaStatus,
    leftEvidence: clonePlain(source.leftEvidence),
    rightEvidence: clonePlain(source.rightEvidence),
  };
}

function claimsFor(
  selection: FindingPolicySelection,
): readonly FindingEvidenceClaim[] {
  const claims: FindingEvidenceClaim[] = [];
  if (selection.constraintDifference) {
    claims.push(constraintClaim(selection.constraintDifference));
  }
  if (selection.serviceOrResilienceDifference) {
    claims.push(
      metricClaim(
        selection.serviceOrResilienceDifference,
        "SERVICE_RESILIENCE_DIFFERENCE",
      ),
    );
  }
  if (selection.materialEnergyOrUtilizationDifference) {
    claims.push(
      metricClaim(
        selection.materialEnergyOrUtilizationDifference,
        "ENERGY_UTILIZATION_DIFFERENCE",
      ),
    );
  }
  if (
    claims.length > 3 ||
    new Set(claims.map((claim) => claim.claimId)).size !== claims.length
  ) {
    throw new StressLabFindingError(
      "INVALID_FINDING_EVIDENCE",
      "finding.claims",
      "Finding claims must contain no more than three unique trusted rows.",
    );
  }
  return claims;
}

function failedConstraintCodes(
  comparison: TrustedComparisonArtifact,
  side: "left" | "right",
): readonly ConstraintComparison["constraintCode"][] {
  return comparison.constraintComparisons
    .filter((entry) => !entry[side].passed)
    .map((entry) => entry.constraintCode)
    .sort(compareCanonicalKey);
}

function notApplicableMetricKeys(
  comparison: TrustedComparisonArtifact,
): readonly ComparisonMetricKey[] {
  return comparison.metricDeltas
    .filter((row) => {
      const policy = FINDING_METRIC_SELECTION_REGISTRY[row.metricKey];
      return (
        policy.eligible &&
        (row.leftValue === null ||
          row.rightValue === null ||
          row.relativeDeltaStatus === "NOT_APPLICABLE")
      );
    })
    .map((row) => row.metricKey)
    .sort(compareCanonicalKey);
}

function caveatsFor(
  comparison: TrustedComparisonArtifact,
  selectedOutcome: FindingSelectedOutcome,
  selection: FindingPolicySelection,
): readonly FindingCaveat[] {
  const leftFailedConstraintCodes = failedConstraintCodes(comparison, "left");
  const rightFailedConstraintCodes = failedConstraintCodes(comparison, "right");
  const caveats: FindingCaveat[] = [];
  if (
    leftFailedConstraintCodes.length > 0 ||
    rightFailedConstraintCodes.length > 0
  ) {
    caveats.push({
      code: "HARD_CONSTRAINT_FAILURES_PRESENT",
      templateId: "hard-constraint-failures-v1",
      leftFailedConstraintCodes: [...leftFailedConstraintCodes],
      rightFailedConstraintCodes: [...rightFailedConstraintCodes],
    });
  }
  const recoveryNotCompletedSides = (["A", "B"] as const).filter(
    (side) => selection.recoveryStates[side] === "NOT_RECOVERED",
  );
  if (recoveryNotCompletedSides.length > 0) {
    caveats.push({
      code: "RECOVERY_NOT_COMPLETED",
      templateId: "recovery-not-completed-v1",
      sides: recoveryNotCompletedSides,
    });
  }
  if (selectedOutcome === "A" || selectedOutcome === "B") {
    caveats.push({
      code: "PROPOSED_OUTCOME_REQUIRES_HUMAN_REVIEW",
      templateId: "proposed-outcome-human-review-v1",
      proposedOutcome: selectedOutcome,
      failedConstraintCodes: [
        ...(selectedOutcome === "A"
          ? leftFailedConstraintCodes
          : rightFailedConstraintCodes),
      ],
    });
  } else if (selectedOutcome === "TRADE_OFF") {
    caveats.push({
      code: "TRADE_OFF_REQUIRES_HUMAN_REVIEW",
      templateId: "trade-off-human-review-v1",
    });
    if (selection.evidenceRelationship !== "OPPOSING_TRADE_OFF") {
      caveats.push({
        code: "PROPOSED_TRADE_OFF_NOT_ESTABLISHED",
        templateId: "proposed-trade-off-not-established-v1",
        evidenceRelationship: selection.evidenceRelationship,
      });
    }
  } else {
    caveats.push({
      code: "INCONCLUSIVE_REQUIRES_HUMAN_REVIEW",
      templateId: "inconclusive-human-review-v1",
    });
  }
  const notApplicable = notApplicableMetricKeys(comparison);
  if (notApplicable.length > 0) {
    caveats.push({
      code: "NOT_APPLICABLE_EVIDENCE_PRESENT",
      templateId: "not-applicable-evidence-v1",
      metricKeys: [...notApplicable],
    });
  }
  caveats.push({
    code: "SYNTHETIC_SIMULATION_LIMITATION",
    templateId: "synthetic-simulation-limitation-v1",
  });
  return caveats;
}

/**
 * Deterministically selects a bounded pending-review candidate from one exact
 * runtime-trusted comparison. The policy copies trusted rows and uses exact
 * transient ratio arithmetic only for selection; it never recalculates KPIs.
 */
export function createFindingCandidate(
  inputValue: CreateFindingCandidateInput,
): FindingCandidateArtifact {
  assertExactInput(inputValue);
  if (!isTrustedRunComparison(inputValue.comparison)) {
    throw new StressLabFindingError(
      "UNTRUSTED_COMPARISON",
      "finding.comparison",
      "Only the exact artifact returned by createTrustedRunComparison is trusted.",
    );
  }
  assertSelectedOutcome(inputValue.selectedOutcome);
  assertEmphasis(inputValue.emphasis);
  const selection = deriveFindingPolicySelection(
    inputValue.comparison,
    inputValue.emphasis,
  );
  const claims = claimsFor(selection);
  const caveats = caveatsFor(
    inputValue.comparison,
    inputValue.selectedOutcome,
    selection,
  );
  const identity = {
    findingSchemaVersion: STRESS_LAB_FINDING_SCHEMA_VERSION,
    findingTemplateVersion: STRESS_LAB_FINDING_TEMPLATE_VERSION,
    findingPolicyVersion: STRESS_LAB_FINDING_POLICY_VERSION,
    comparisonFingerprint: inputValue.comparison.comparisonFingerprint,
    selectedOutcome: inputValue.selectedOutcome,
    emphasis: inputValue.emphasis,
    evidenceRelationship: selection.evidenceRelationship,
    claims,
    caveats,
  };
  const document = createFingerprintDocument(
    FINDING_FINGERPRINT_SCOPE,
    identity,
  );
  return deepFreeze({
    ...clonePlain(identity),
    canonicalFindingJson: document.canonicalJson,
    findingFingerprint: document.fingerprint,
  });
}
