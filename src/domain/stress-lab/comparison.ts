import { canonicalJson } from "./canonical-json";
import { createFingerprintDocument } from "./fingerprint";
import { isVerifiedRunResultArtifact } from "./result-verification";
import { prepareStressLabRunInput } from "./run-input";
import {
  STRESS_LAB_COMPARISON_CLAIM_TEMPLATE_VERSION,
  STRESS_LAB_COMPARISON_SCHEMA_VERSION,
  StressLabComparisonError,
  type ComparisonArtifact,
  type ComparisonEvidenceReference,
  type ComparisonMetricKey,
  type ComparisonNumericUnit,
  type ComparisonRelation,
  type ConstraintComparison,
  type ConstraintEvaluation,
  type ConstraintTransition,
  type EvidenceClaim,
  type MetricDelta,
  type PermittedScenarioDifference,
  type PreparedRunInput,
  type RelativeDeltaStatus,
  type SharedComparisonProvenance,
  type TrustedComparisonArtifact,
  type VerifiedRunResultArtifact,
} from "./types";

export interface TrustedComparisonOperand {
  readonly preparedInput: PreparedRunInput;
  readonly verifiedResult: VerifiedRunResultArtifact;
}

const trustedComparisonArtifacts = new WeakSet<object>();

const METRIC_DEFINITIONS = Object.freeze([
  ["requestedPassengers", "PASSENGERS"],
  ["servedPassengers", "PASSENGERS"],
  ["inServiceAtHorizonPassengers", "PASSENGERS"],
  ["unservedPassengers", "PASSENGERS"],
  ["averageWaitSeconds", "SECONDS"],
  ["p95WaitSeconds", "SECONDS"],
  ["maximumWaitSeconds", "SECONDS"],
  ["onTimeBasisPoints", "BASIS_POINTS"],
  ["peakOccupancyBasisPoints", "BASIS_POINTS"],
  ["passengerMetres", "METRES"],
  ["vehicleMetres", "METRES"],
  ["emptyVehicleMetres", "METRES"],
  ["utilizationBasisPoints", "BASIS_POINTS"],
  ["totalEnergyWh", "WATT_HOURS"],
  ["energyWhPerPassengerKilometre", "WATT_HOURS_PER_PASSENGER_KILOMETRE"],
  ["minimumBatteryBasisPoints", "BASIS_POINTS"],
  ["reserveViolations", "COUNT"],
  ["reserveBlockedAssignments", "COUNT"],
  ["recoveryTimeSeconds", "SECONDS"],
] as const satisfies readonly (readonly [ComparisonMetricKey, ComparisonNumericUnit])[]);

const CONSTRAINT_ORDER = Object.freeze([
  "MAXIMUM_WAIT",
  "MAXIMUM_UNSERVED",
  "MINIMUM_RESERVE",
  "MAXIMUM_RECOVERY",
  "NO_STANDING",
] as const satisfies readonly ConstraintEvaluation["code"][]);

const COMPARISON_IDENTITY_KEYS = Object.freeze([
  "comparisonSchemaVersion",
  "claimTemplateVersion",
  "compatibility",
  "deltaConvention",
  "left",
  "right",
  "sharedProvenance",
  "permittedScenarioDifferences",
  "metricDeltas",
  "constraintComparisons",
  "claims",
] as const);

type ComparisonIdentityInput = Omit<
  ComparisonArtifact,
  "canonicalComparisonJson" | "comparisonFingerprint"
>;

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

function firstMismatchPath(
  left: unknown,
  right: unknown,
  path: string,
): { readonly path: string; readonly leftValue: unknown; readonly rightValue: unknown } | undefined {
  if (Object.is(left, right)) return undefined;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return { path, leftValue: left, rightValue: right };
    }
    if (left.length !== right.length) {
      return {
        path: `${path}.length`,
        leftValue: left.length,
        rightValue: right.length,
      };
    }
    for (let index = 0; index < left.length; index += 1) {
      const mismatch = firstMismatchPath(
        left[index],
        right[index],
        `${path}[${index}]`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return { path, leftValue: left, rightValue: right };
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])]
    .sort();
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(leftRecord, key)) {
      return { path: `${path}.${key}`, leftValue: undefined, rightValue: rightRecord[key] };
    }
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) {
      return { path: `${path}.${key}`, leftValue: leftRecord[key], rightValue: undefined };
    }
    const mismatch = firstMismatchPath(
      leftRecord[key],
      rightRecord[key],
      `${path}.${key}`,
    );
    if (mismatch) return mismatch;
  }
  return undefined;
}

function assertComparableValue(path: string, left: unknown, right: unknown): void {
  const mismatch = firstMismatchPath(left, right, path);
  if (!mismatch) return;
  throw new StressLabComparisonError(
    "INCOMPARABLE_RUNS",
    mismatch.path,
    "The verified runs differ in a comparison-controlled fact.",
    mismatch.leftValue,
    mismatch.rightValue,
    [mismatch],
  );
}

function assertSafeMetricValue(
  value: unknown,
  path: string,
): asserts value is number | null {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      path,
      "Published metric and constraint values must be non-negative safe integers or null.",
      value,
    );
  }
}

function safeDifference(right: number, left: number, path: string): number {
  const value = right - left;
  if (!Number.isSafeInteger(value)) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      path,
      "Signed delta exceeds the safe-integer evidence range.",
      left,
      right,
    );
  }
  return value;
}

function relationForDelta(delta: number): ComparisonRelation {
  if (delta > 0) return "RIGHT_HIGHER";
  if (delta < 0) return "RIGHT_LOWER";
  return "EQUAL";
}

function relativeDelta(
  left: number | null,
  right: number | null,
  path: string,
): {
  readonly value: number | null;
  readonly status: RelativeDeltaStatus;
} {
  if (left === null || right === null) {
    return { value: null, status: "NOT_APPLICABLE" };
  }
  if (left === 0) {
    return { value: null, status: "LEFT_ZERO_DENOMINATOR" };
  }
  const delta = safeDifference(right, left, path);
  const magnitudeNumerator = Math.abs(delta) * 10_000;
  if (!Number.isSafeInteger(magnitudeNumerator)) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      path,
      "Relative delta exceeds the safe-integer evidence range.",
      left,
      right,
    );
  }
  const roundedMagnitude = Math.floor(
    (magnitudeNumerator + Math.floor(left / 2)) / left,
  );
  return {
    value: delta < 0 ? -roundedMagnitude : roundedMagnitude,
    status: "DEFINED",
  };
}

function validatePrepared(
  side: "left" | "right",
  prepared: PreparedRunInput,
): PreparedRunInput {
  let regenerated: PreparedRunInput;
  try {
    regenerated = prepareStressLabRunInput(prepared.input);
  } catch (error) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      `${side}.preparedInput`,
      error instanceof Error ? error.message : "Run input validation failed.",
    );
  }
  if (
    regenerated.fingerprint !== prepared.fingerprint ||
    regenerated.canonicalJson !== prepared.canonicalJson
  ) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      `${side}.preparedInput.fingerprint`,
      "Prepared run input does not match its recomputed canonical identity.",
      prepared.fingerprint,
      regenerated.fingerprint,
    );
  }
  return regenerated;
}

function validateOperand(
  side: "left" | "right",
  operand: TrustedComparisonOperand,
): TrustedComparisonOperand {
  const preparedInput = validatePrepared(side, operand.preparedInput);
  if (!isVerifiedRunResultArtifact(operand.verifiedResult)) {
    throw new StressLabComparisonError(
      "UNVERIFIED_RUN_RESULT",
      `${side}.verifiedResult`,
      "Only the exact artifact returned by verifyTrustedSimulationResult is trusted.",
    );
  }
  if (operand.verifiedResult.inputFingerprint !== preparedInput.fingerprint) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      `${side}.verifiedResult.inputFingerprint`,
      "Verified result is not bound to the supplied prepared run input.",
      operand.verifiedResult.inputFingerprint,
      preparedInput.fingerprint,
    );
  }
  return { preparedInput, verifiedResult: operand.verifiedResult };
}

function normalizedDisruptions(
  disruptions: PreparedRunInput["input"]["disruptions"],
): readonly Record<string, unknown>[] {
  return disruptions.map((disruption) => {
    const normalized = clonePlain(disruption) as unknown as Record<string, unknown>;
    delete normalized.id;
    return normalized;
  });
}

function operationalFleetAssumptions(
  fleet: PreparedRunInput["input"]["scenario"]["fleet"],
): SharedComparisonProvenance["operationalAssumptions"] {
  const shared = clonePlain(fleet) as unknown as Record<string, unknown>;
  delete shared.vehicleCount;
  delete shared.seatsPerVehicle;
  return shared as unknown as SharedComparisonProvenance["operationalAssumptions"];
}

function assertComparableRuns(
  left: TrustedComparisonOperand,
  right: TrustedComparisonOperand,
): void {
  const leftInput = left.preparedInput.input;
  const rightInput = right.preparedInput.input;
  const pairs: readonly (readonly [string, unknown, unknown])[] = [
    ["input.inputSchemaVersion", leftInput.inputSchemaVersion, rightInput.inputSchemaVersion],
    ["input.canonicalizationVersion", leftInput.canonicalizationVersion, rightInput.canonicalizationVersion],
    ["input.fingerprintVersion", leftInput.fingerprintVersion, rightInput.fingerprintVersion],
    ["input.presetVersion", leftInput.presetVersion, rightInput.presetVersion],
    ["input.networkVersion", leftInput.networkVersion, rightInput.networkVersion],
    ["input.networkFingerprint", leftInput.networkFingerprint, rightInput.networkFingerprint],
    ["input.network", leftInput.network, rightInput.network],
    ["input.demandTrace.generatorVersion", leftInput.demandTrace.generatorVersion, rightInput.demandTrace.generatorVersion],
    ["input.demandTrace.fingerprint", leftInput.demandTrace.fingerprint, rightInput.demandTrace.fingerprint],
    ["input.demandDefinition", leftInput.demandDefinition, rightInput.demandDefinition],
    ["input.demandTrace.requests", leftInput.demandTrace.requests, rightInput.demandTrace.requests],
    ["input.seed", leftInput.seed, rightInput.seed],
    ["input.horizon", leftInput.horizon, rightInput.horizon],
    ["input.terminalEvaluationSecond", leftInput.terminalEvaluationSecond, rightInput.terminalEvaluationSecond],
    ["input.engineVersion", leftInput.engineVersion, rightInput.engineVersion],
    ["input.metricDefinitionVersion", leftInput.metricDefinitionVersion, rightInput.metricDefinitionVersion],
    ["input.scenario.constraints", leftInput.scenario.constraints, rightInput.scenario.constraints],
    ["input.scenario.fleet.operationalAssumptions", operationalFleetAssumptions(leftInput.scenario.fleet), operationalFleetAssumptions(rightInput.scenario.fleet)],
    ["input.scenario.objectives", leftInput.scenario.objectives, rightInput.scenario.objectives],
    ["input.disruptions", normalizedDisruptions(leftInput.disruptions), normalizedDisruptions(rightInput.disruptions)],
    ["result.resultSchemaVersion", left.verifiedResult.resultSchemaVersion, right.verifiedResult.resultSchemaVersion],
    ["result.eventSchemaVersion", left.verifiedResult.eventSchemaVersion, right.verifiedResult.eventSchemaVersion],
    ["result.engineVersion", left.verifiedResult.engineVersion, right.verifiedResult.engineVersion],
    ["result.tickSemanticsVersion", left.verifiedResult.tickSemanticsVersion, right.verifiedResult.tickSemanticsVersion],
    ["result.controllerId", left.verifiedResult.controllerId, right.verifiedResult.controllerId],
    ["result.controllerVersion", left.verifiedResult.controllerVersion, right.verifiedResult.controllerVersion],
    ["result.metricDefinitionVersion", left.verifiedResult.metricDefinitionVersion, right.verifiedResult.metricDefinitionVersion],
  ];
  for (const [path, leftValue, rightValue] of pairs) {
    assertComparableValue(path, leftValue, rightValue);
  }
}

function evidenceReference(
  operand: TrustedComparisonOperand,
  evidenceIds: readonly ConstraintEvaluation["evidenceIds"][number][] = [],
): ComparisonEvidenceReference {
  return {
    inputFingerprint: operand.preparedInput.fingerprint,
    eventLedgerFingerprint: operand.verifiedResult.eventLedgerFingerprint,
    resultFingerprint: operand.verifiedResult.resultFingerprint,
    evidenceIds: [...evidenceIds],
  };
}

function metricDeltas(
  left: TrustedComparisonOperand,
  right: TrustedComparisonOperand,
): readonly MetricDelta[] {
  const expectedKeys = new Set(METRIC_DEFINITIONS.map(([key]) => key));
  for (const [side, metrics] of [
    ["left", left.verifiedResult.metrics],
    ["right", right.verifiedResult.metrics],
  ] as const) {
    for (const key of Object.keys(metrics)) {
      if (!expectedKeys.has(key as ComparisonMetricKey)) {
        throw new StressLabComparisonError(
          "INVALID_COMPARISON_EVIDENCE",
          `${side}.verifiedResult.metrics.${key}`,
          "Unexpected published metric.",
        );
      }
    }
    if (Object.keys(metrics).length !== METRIC_DEFINITIONS.length) {
      throw new StressLabComparisonError(
        "INVALID_COMPARISON_EVIDENCE",
        `${side}.verifiedResult.metrics`,
        "The verified result does not contain every published H0 metric.",
      );
    }
  }

  return METRIC_DEFINITIONS.map(([metricKey, unit]) => {
    const leftValue = left.verifiedResult.metrics[metricKey];
    const rightValue = right.verifiedResult.metrics[metricKey];
    assertSafeMetricValue(leftValue, `left.verifiedResult.metrics.${metricKey}`);
    assertSafeMetricValue(rightValue, `right.verifiedResult.metrics.${metricKey}`);
    const delta =
      leftValue === null || rightValue === null
        ? null
        : safeDifference(rightValue, leftValue, `metrics.${metricKey}.rightMinusLeft`);
    const relative = relativeDelta(
      leftValue,
      rightValue,
      `metrics.${metricKey}.relativeDeltaBasisPoints`,
    );
    return {
      metricKey,
      unit,
      leftValue,
      rightValue,
      rightMinusLeft: delta,
      relation: delta === null ? "NOT_APPLICABLE" : relationForDelta(delta),
      relativeDeltaBasisPoints: relative.value,
      relativeDeltaStatus: relative.status,
      leftEvidence: evidenceReference(left),
      rightEvidence: evidenceReference(right),
    };
  });
}

function constraintByCode(
  side: "left" | "right",
  constraints: readonly ConstraintEvaluation[],
  code: ConstraintEvaluation["code"],
): ConstraintEvaluation {
  const matches = constraints.filter((constraint) => constraint.code === code);
  if (matches.length !== 1) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      `${side}.verifiedResult.constraints.${code}`,
      "Each H0 constraint must occur exactly once.",
    );
  }
  const value = matches[0];
  if (typeof value.passed !== "boolean" || !Array.isArray(value.evidenceIds)) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      `${side}.verifiedResult.constraints.${code}`,
      "Constraint status and evidence IDs are malformed.",
    );
  }
  assertSafeMetricValue(value.observed, `${side}.verifiedResult.constraints.${code}.observed`);
  assertSafeMetricValue(value.threshold, `${side}.verifiedResult.constraints.${code}.threshold`);
  return value;
}

function transition(leftPassed: boolean, rightPassed: boolean): ConstraintTransition {
  if (leftPassed && rightPassed) return "BOTH_PASS";
  if (!leftPassed && !rightPassed) return "BOTH_FAIL";
  return leftPassed ? "LEFT_PASS_RIGHT_FAIL" : "LEFT_FAIL_RIGHT_PASS";
}

function constraintComparisons(
  left: TrustedComparisonOperand,
  right: TrustedComparisonOperand,
): readonly ConstraintComparison[] {
  if (
    left.verifiedResult.constraints.length !== CONSTRAINT_ORDER.length ||
    right.verifiedResult.constraints.length !== CONSTRAINT_ORDER.length
  ) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      "result.constraints",
      "A comparison requires the complete H0 constraint set.",
    );
  }
  return CONSTRAINT_ORDER.map((constraintCode) => {
    const leftValue = constraintByCode("left", left.verifiedResult.constraints, constraintCode);
    const rightValue = constraintByCode("right", right.verifiedResult.constraints, constraintCode);
    assertComparableValue(
      `result.constraints.${constraintCode}.unit`,
      leftValue.unit,
      rightValue.unit,
    );
    assertComparableValue(
      `result.constraints.${constraintCode}.threshold`,
      leftValue.threshold,
      rightValue.threshold,
    );
    const delta =
      leftValue.observed === null || rightValue.observed === null
        ? null
        : safeDifference(
            rightValue.observed,
            leftValue.observed,
            `constraints.${constraintCode}.rightMinusLeft`,
          );
    return {
      constraintCode,
      unit: leftValue.unit,
      left: {
        passed: leftValue.passed,
        observed: leftValue.observed,
        threshold: leftValue.threshold,
        evidence: evidenceReference(left, leftValue.evidenceIds),
      },
      right: {
        passed: rightValue.passed,
        observed: rightValue.observed,
        threshold: rightValue.threshold,
        evidence: evidenceReference(right, rightValue.evidenceIds),
      },
      rightMinusLeft: delta,
      relation: delta === null ? "NOT_APPLICABLE" : relationForDelta(delta),
      transition: transition(leftValue.passed, rightValue.passed),
      evidenceDiffers:
        canonicalJson(leftValue.evidenceIds) !== canonicalJson(rightValue.evidenceIds),
    };
  });
}

function permittedDifferences(
  left: TrustedComparisonOperand,
  right: TrustedComparisonOperand,
): readonly PermittedScenarioDifference[] {
  const leftInput = left.preparedInput.input;
  const rightInput = right.preparedInput.input;
  const values: PermittedScenarioDifference[] = [];
  if (leftInput.scenario.slot !== rightInput.scenario.slot) {
    values.push({
      path: "scenario.slot",
      kind: "SCENARIO_IDENTITY",
      leftValue: leftInput.scenario.slot,
      rightValue: rightInput.scenario.slot,
    });
  }
  if (leftInput.scenario.label !== rightInput.scenario.label) {
    values.push({
      path: "scenario.label",
      kind: "SCENARIO_IDENTITY",
      leftValue: leftInput.scenario.label,
      rightValue: rightInput.scenario.label,
    });
  }
  if (leftInput.scenario.fleet.vehicleCount !== rightInput.scenario.fleet.vehicleCount) {
    values.push({
      path: "scenario.fleet.vehicleCount",
      kind: "FLEET_CONFIGURATION",
      unit: "VEHICLES",
      leftValue: leftInput.scenario.fleet.vehicleCount,
      rightValue: rightInput.scenario.fleet.vehicleCount,
      rightMinusLeft: safeDifference(
        rightInput.scenario.fleet.vehicleCount,
        leftInput.scenario.fleet.vehicleCount,
        "permittedScenarioDifferences.vehicleCount",
      ),
    });
  }
  if (leftInput.scenario.fleet.seatsPerVehicle !== rightInput.scenario.fleet.seatsPerVehicle) {
    values.push({
      path: "scenario.fleet.seatsPerVehicle",
      kind: "FLEET_CONFIGURATION",
      unit: "SEATS_PER_VEHICLE",
      leftValue: leftInput.scenario.fleet.seatsPerVehicle,
      rightValue: rightInput.scenario.fleet.seatsPerVehicle,
      rightMinusLeft: safeDifference(
        rightInput.scenario.fleet.seatsPerVehicle,
        leftInput.scenario.fleet.seatsPerVehicle,
        "permittedScenarioDifferences.seatsPerVehicle",
      ),
    });
  }
  for (let index = 0; index < leftInput.disruptions.length; index += 1) {
    const leftId = leftInput.disruptions[index].id;
    const rightId = rightInput.disruptions[index].id;
    if (leftId !== rightId) {
      values.push({
        path: "disruptions[].id",
        kind: "SCENARIO_IDENTITY",
        leftValue: leftId,
        rightValue: rightId,
      });
    }
  }
  return values;
}

function sharedProvenance(
  left: TrustedComparisonOperand,
): SharedComparisonProvenance {
  const input = left.preparedInput.input;
  const result = left.verifiedResult;
  return {
    inputSchemaVersion: input.inputSchemaVersion,
    presetVersion: input.presetVersion,
    canonicalizationVersion: input.canonicalizationVersion,
    fingerprintVersion: input.fingerprintVersion,
    networkVersion: input.networkVersion,
    networkFingerprint: input.networkFingerprint,
    demandGeneratorVersion: input.demandTrace.generatorVersion,
    demandFingerprint: input.demandTrace.fingerprint,
    seed: input.seed,
    horizon: clonePlain(input.horizon),
    terminalEvaluationSecond: input.terminalEvaluationSecond,
    engineVersion: result.engineVersion,
    tickSemanticsVersion: result.tickSemanticsVersion,
    controllerId: result.controllerId,
    controllerVersion: result.controllerVersion,
    metricDefinitionVersion: result.metricDefinitionVersion,
    eventSchemaVersion: result.eventSchemaVersion,
    resultSchemaVersion: result.resultSchemaVersion,
    hardConstraints: clonePlain(input.scenario.constraints),
    operationalAssumptions: operationalFleetAssumptions(input.scenario.fleet),
    objectives: [...input.scenario.objectives],
    disruptionPolicy: normalizedDisruptions(input.disruptions) as unknown as
      SharedComparisonProvenance["disruptionPolicy"],
  };
}

function claimsFor(
  metrics: readonly MetricDelta[],
  constraints: readonly ConstraintComparison[],
): readonly EvidenceClaim[] {
  const constraint =
    constraints.find((entry) => entry.transition.includes("RIGHT_")) ??
    constraints.find((entry) => entry.transition === "BOTH_FAIL") ??
    constraints[0];
  const service = metrics.find((entry) => entry.metricKey === "unservedPassengers");
  const energy = metrics.find((entry) => entry.metricKey === "totalEnergyWh");
  if (!constraint || !service || !energy) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      "comparison.claims",
      "Bounded claims require the complete constraint, service, and energy evidence sets.",
    );
  }
  return [
    {
      claimCode: "CONSTRAINT_STATUS",
      subjectKind: "CONSTRAINT",
      subjectId: constraint.constraintCode,
      unit: constraint.unit,
      leftValue: constraint.left.observed,
      rightValue: constraint.right.observed,
      rightMinusLeft: constraint.rightMinusLeft,
      relation: constraint.relation,
      constraintTransition: constraint.transition,
      leftEvidence: clonePlain(constraint.left.evidence),
      rightEvidence: clonePlain(constraint.right.evidence),
    },
    {
      claimCode: "SERVICE_METRIC_DELTA",
      subjectKind: "METRIC",
      subjectId: service.metricKey,
      unit: service.unit,
      leftValue: service.leftValue,
      rightValue: service.rightValue,
      rightMinusLeft: service.rightMinusLeft,
      relation: service.relation,
      constraintTransition: null,
      leftEvidence: clonePlain(service.leftEvidence),
      rightEvidence: clonePlain(service.rightEvidence),
    },
    {
      claimCode: "ENERGY_METRIC_DELTA",
      subjectKind: "METRIC",
      subjectId: energy.metricKey,
      unit: energy.unit,
      leftValue: energy.leftValue,
      rightValue: energy.rightValue,
      rightMinusLeft: energy.rightMinusLeft,
      relation: energy.relation,
      constraintTransition: null,
      leftEvidence: clonePlain(energy.leftEvidence),
      rightEvidence: clonePlain(energy.rightEvidence),
    },
  ];
}

function comparisonIdentityValue(
  comparison: ComparisonIdentityInput,
): Readonly<Record<string, unknown>> {
  const record = comparison as unknown as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  for (const key of actualKeys) {
    if (!COMPARISON_IDENTITY_KEYS.includes(key as (typeof COMPARISON_IDENTITY_KEYS)[number])) {
      throw new StressLabComparisonError(
        "INVALID_COMPARISON_EVIDENCE",
        `comparison.${key}`,
        "Unexpected comparison identity property.",
      );
    }
  }
  for (const key of COMPARISON_IDENTITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new StressLabComparisonError(
        "INVALID_COMPARISON_EVIDENCE",
        `comparison.${key}`,
        "Missing comparison identity property.",
      );
    }
  }
  if (
    comparison.comparisonSchemaVersion !== STRESS_LAB_COMPARISON_SCHEMA_VERSION ||
    comparison.claimTemplateVersion !== STRESS_LAB_COMPARISON_CLAIM_TEMPLATE_VERSION ||
    comparison.compatibility !== "COMPARABLE" ||
    comparison.deltaConvention !== "RIGHT_MINUS_LEFT" ||
    comparison.metricDeltas.length !== METRIC_DEFINITIONS.length ||
    comparison.constraintComparisons.length !== CONSTRAINT_ORDER.length ||
    comparison.claims.length < 1 ||
    comparison.claims.length > 3
  ) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      "comparison",
      "Comparison schema, evidence cardinality, or delta convention is invalid.",
    );
  }
  try {
    canonicalJson(comparison);
  } catch (error) {
    throw new StressLabComparisonError(
      "INVALID_COMPARISON_EVIDENCE",
      "comparison",
      error instanceof Error ? error.message : "Comparison is not canonicalizable.",
    );
  }
  return clonePlain(comparison) as Readonly<Record<string, unknown>>;
}

/**
 * The sole Gate 5 trusted comparison boundary. Incompatible or unattested run
 * evidence throws before any comparison artifact is created.
 */
export function createTrustedRunComparison(
  leftValue: TrustedComparisonOperand,
  rightValue: TrustedComparisonOperand,
): TrustedComparisonArtifact {
  const left = validateOperand("left", leftValue);
  const right = validateOperand("right", rightValue);
  assertComparableRuns(left, right);
  const metrics = metricDeltas(left, right);
  const constraints = constraintComparisons(left, right);
  const identity: ComparisonIdentityInput = {
    comparisonSchemaVersion: STRESS_LAB_COMPARISON_SCHEMA_VERSION,
    claimTemplateVersion: STRESS_LAB_COMPARISON_CLAIM_TEMPLATE_VERSION,
    compatibility: "COMPARABLE",
    deltaConvention: "RIGHT_MINUS_LEFT",
    left: {
      slot: left.preparedInput.input.scenario.slot,
      label: left.preparedInput.input.scenario.label,
      inputFingerprint: left.preparedInput.fingerprint,
      eventLedgerFingerprint: left.verifiedResult.eventLedgerFingerprint,
      resultFingerprint: left.verifiedResult.resultFingerprint,
    },
    right: {
      slot: right.preparedInput.input.scenario.slot,
      label: right.preparedInput.input.scenario.label,
      inputFingerprint: right.preparedInput.fingerprint,
      eventLedgerFingerprint: right.verifiedResult.eventLedgerFingerprint,
      resultFingerprint: right.verifiedResult.resultFingerprint,
    },
    sharedProvenance: sharedProvenance(left),
    permittedScenarioDifferences: permittedDifferences(left, right),
    metricDeltas: metrics,
    constraintComparisons: constraints,
    claims: claimsFor(metrics, constraints),
  };
  const validatedIdentity = comparisonIdentityValue(identity);
  const document = createFingerprintDocument(
    "RUN_COMPARISON_EVIDENCE",
    validatedIdentity,
  );
  const trusted = deepFreeze({
    ...clonePlain(identity),
    canonicalComparisonJson: document.canonicalJson,
    comparisonFingerprint: document.fingerprint,
  }) as TrustedComparisonArtifact;
  trustedComparisonArtifacts.add(trusted);
  return trusted;
}

/**
 * Runtime companion to the TrustedComparisonArtifact brand. A copied, cast,
 * or serialized comparison must be reconstructed through the trusted Gate 5
 * comparison boundary before it can become finding evidence.
 */
export function isTrustedRunComparison(
  value: unknown,
): value is TrustedComparisonArtifact {
  return (
    value !== null &&
    typeof value === "object" &&
    trustedComparisonArtifacts.has(value)
  );
}
