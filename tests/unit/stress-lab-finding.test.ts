import { beforeAll, describe, expect, it, vi } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import {
  createTrustedRunComparison,
  type TrustedComparisonOperand,
} from "@/domain/stress-lab/comparison";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import {
  createFindingCandidate,
  deriveFindingPolicySelection,
  FINDING_METRIC_SELECTION_REGISTRY,
  StressLabFindingError,
  type FindingPolicySelection,
} from "@/domain/stress-lab/finding";
import { verifyTrustedSimulationResult } from "@/domain/stress-lab/result-verification";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import {
  disruptionId,
  type ComparisonMetricKey,
  type ConstraintComparison,
  type DeterministicSimulationResult,
  type EventLedgerEnvelope,
  type FindingEmphasis,
  type FindingEvidenceClaim,
  type FindingSelectedOutcome,
  type MetricDelta,
  type PreparedRunInput,
  type RunResultArtifact,
  type StressLabRunInput,
  type TrustedComparisonArtifact,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

const OUTCOMES = Object.freeze([
  "A",
  "B",
  "TRADE_OFF",
  "INCONCLUSIVE",
] as const satisfies readonly FindingSelectedOutcome[]);

const EMPHASES = Object.freeze([
  "BALANCED",
  "SERVICE",
  "ENERGY",
  "RESILIENCE",
] as const satisfies readonly FindingEmphasis[]);

type PolicyEvidence = Pick<
  TrustedComparisonArtifact,
  "metricDeltas" | "constraintComparisons" | "sharedProvenance"
>;

function ledgerEnvelope(
  result: DeterministicSimulationResult,
): EventLedgerEnvelope {
  return {
    eventSchemaVersion: result.eventSchemaVersion,
    inputFingerprint: result.inputFingerprint,
    engineVersion: result.engineVersion,
    tickSemanticsVersion: result.tickSemanticsVersion,
    controllerId: result.controllerId,
    controllerVersion: result.controllerVersion,
    events: result.events,
    fingerprint: result.eventLedgerFingerprint,
  };
}

function artifactFromResult(
  result: DeterministicSimulationResult,
): RunResultArtifact {
  return {
    resultSchemaVersion: result.resultSchemaVersion,
    eventSchemaVersion: result.eventSchemaVersion,
    inputFingerprint: result.inputFingerprint,
    engineVersion: result.engineVersion,
    tickSemanticsVersion: result.tickSemanticsVersion,
    controllerId: result.controllerId,
    controllerVersion: result.controllerVersion,
    metricDefinitionVersion: result.metricDefinitionVersion,
    eventLedgerFingerprint: result.eventLedgerFingerprint,
    snapshots: result.snapshots,
    terminalState: result.terminalState,
    metrics: result.metrics,
    constraints: result.constraints,
    canonicalResultJson: result.canonicalResultJson,
    resultFingerprint: result.resultFingerprint,
  };
}

function verifiedOperand(
  preparedInput: PreparedRunInput,
): TrustedComparisonOperand {
  const result = runDeterministicSimulation(preparedInput);
  return {
    preparedInput,
    verifiedResult: verifyTrustedSimulationResult(
      preparedInput,
      ledgerEnvelope(result),
      artifactFromResult(result),
    ),
  };
}

function cloneInput(prepared: PreparedRunInput): StressLabRunInput {
  return JSON.parse(prepared.canonicalJson).value as StressLabRunInput;
}

function inputForSlot(
  prepared: PreparedRunInput,
  slot: "A" | "B",
): PreparedRunInput {
  const input = cloneInput(prepared);
  return prepareStressLabRunInput({
    ...input,
    scenarioSlot: slot,
    scenario: {
      ...input.scenario,
      slot,
      label: slot === "A" ? "Finding witness A" : "Finding witness B",
    },
    disruptions: input.disruptions.map((disruption) => ({
      ...disruption,
      id: disruptionId(`finding-${slot}-failure`),
    })),
  });
}

function expectFindingError(
  action: () => unknown,
  code: StressLabFindingError["code"],
): StressLabFindingError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(StressLabFindingError);
    expect((error as StressLabFindingError).code).toBe(code);
    return error as StressLabFindingError;
  }
  throw new Error(`Expected ${code}.`);
}

function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.keys(value).every((key) =>
    isDeepFrozen((value as Record<string, unknown>)[key], seen),
  );
}

function relationFor(left: number | null, right: number | null) {
  if (left === null || right === null) return "NOT_APPLICABLE" as const;
  if (right > left) return "RIGHT_HIGHER" as const;
  if (right < left) return "RIGHT_LOWER" as const;
  return "EQUAL" as const;
}

function metricValues(
  source: MetricDelta,
  leftValue: number | null,
  rightValue: number | null,
): MetricDelta {
  const rightMinusLeft =
    leftValue === null || rightValue === null ? null : rightValue - leftValue;
  return {
    ...source,
    leftValue,
    rightValue,
    rightMinusLeft,
    relation: relationFor(leftValue, rightValue),
    relativeDeltaBasisPoints: null,
    relativeDeltaStatus:
      leftValue === null || rightValue === null
        ? "NOT_APPLICABLE"
        : leftValue === 0
          ? "LEFT_ZERO_DENOMINATOR"
          : "DEFINED",
  };
}

function neutralPolicyEvidence(comparison: TrustedComparisonArtifact): PolicyEvidence {
  return {
    metricDeltas: comparison.metricDeltas.map((row) =>
      metricValues(row, 100, 100),
    ),
    constraintComparisons: comparison.constraintComparisons.map((row) => ({
      ...row,
      left: {
        ...row.left,
        passed: true,
        observed: row.constraintCode === "MAXIMUM_RECOVERY" ? 100 : 0,
      },
      right: {
        ...row.right,
        passed: true,
        observed: row.constraintCode === "MAXIMUM_RECOVERY" ? 100 : 0,
      },
      rightMinusLeft: 0,
      relation: "EQUAL",
      transition: "BOTH_PASS",
    })),
    sharedProvenance: comparison.sharedProvenance,
  };
}

function withMetric(
  evidence: PolicyEvidence,
  metricKey: ComparisonMetricKey,
  leftValue: number | null,
  rightValue: number | null,
): PolicyEvidence {
  return {
    ...evidence,
    metricDeltas: evidence.metricDeltas.map((row) =>
      row.metricKey === metricKey
        ? metricValues(row, leftValue, rightValue)
        : row,
    ),
  };
}

function withConstraint(
  evidence: PolicyEvidence,
  constraintCode: ConstraintComparison["constraintCode"],
  leftPassed: boolean,
  rightPassed: boolean,
  leftObserved: number | null = 0,
  rightObserved: number | null = 0,
): PolicyEvidence {
  return {
    ...evidence,
    constraintComparisons: evidence.constraintComparisons.map((row) => {
      if (row.constraintCode !== constraintCode) return row;
      return {
        ...row,
        left: { ...row.left, passed: leftPassed, observed: leftObserved },
        right: { ...row.right, passed: rightPassed, observed: rightObserved },
        rightMinusLeft:
          leftObserved === null || rightObserved === null
            ? null
            : rightObserved - leftObserved,
        relation: relationFor(leftObserved, rightObserved),
        transition:
          leftPassed === rightPassed
            ? leftPassed
              ? "BOTH_PASS"
              : "BOTH_FAIL"
            : leftPassed
              ? "LEFT_PASS_RIGHT_FAIL"
              : "LEFT_FAIL_RIGHT_PASS",
      };
    }),
  };
}

function withRecoveredValues(
  evidence: PolicyEvidence,
  leftValue: number | null,
  rightValue: number | null,
  leftPassed: boolean,
  rightPassed: boolean,
): PolicyEvidence {
  return withConstraint(
    withMetric(evidence, "recoveryTimeSeconds", leftValue, rightValue),
    "MAXIMUM_RECOVERY",
    leftPassed,
    rightPassed,
    leftValue,
    rightValue,
  );
}

function selectedServiceMetric(selection: FindingPolicySelection) {
  return selection.serviceOrResilienceDifference?.source.metricKey;
}

function selectedEfficiencyMetric(selection: FindingPolicySelection) {
  return selection.materialEnergyOrUtilizationDifference?.source.metricKey;
}

function swapEvidence(evidence: PolicyEvidence): PolicyEvidence {
  return {
    metricDeltas: evidence.metricDeltas.map((row) => ({
      ...row,
      leftValue: row.rightValue,
      rightValue: row.leftValue,
      rightMinusLeft:
        row.rightMinusLeft === null
          ? null
          : row.rightMinusLeft === 0
            ? 0
            : -row.rightMinusLeft,
      relation:
        row.relation === "RIGHT_HIGHER"
          ? "RIGHT_LOWER"
          : row.relation === "RIGHT_LOWER"
            ? "RIGHT_HIGHER"
            : row.relation,
      leftEvidence: row.rightEvidence,
      rightEvidence: row.leftEvidence,
    })),
    constraintComparisons: evidence.constraintComparisons.map((row) => ({
      ...row,
      left: row.right,
      right: row.left,
      rightMinusLeft:
        row.rightMinusLeft === null
          ? null
          : row.rightMinusLeft === 0
            ? 0
            : -row.rightMinusLeft,
      relation:
        row.relation === "RIGHT_HIGHER"
          ? "RIGHT_LOWER"
          : row.relation === "RIGHT_LOWER"
            ? "RIGHT_HIGHER"
            : row.relation,
      transition:
        row.transition === "LEFT_PASS_RIGHT_FAIL"
          ? "LEFT_FAIL_RIGHT_PASS"
          : row.transition === "LEFT_FAIL_RIGHT_PASS"
            ? "LEFT_PASS_RIGHT_FAIL"
            : row.transition,
    })),
    sharedProvenance: evidence.sharedProvenance,
  };
}

function assertClaimMatchesComparison(
  claim: FindingEvidenceClaim,
  comparison: TrustedComparisonArtifact,
): void {
  if (claim.subjectKind === "CONSTRAINT") {
    const source = comparison.constraintComparisons.find(
      (entry) => entry.constraintCode === claim.constraintCode,
    );
    expect(source).toBeDefined();
    expect(claim).toMatchObject({
      unit: source!.unit,
      left: source!.left,
      right: source!.right,
      rightMinusLeft: source!.rightMinusLeft,
      relation: source!.relation,
      constraintTransition: source!.transition,
    });
    return;
  }
  const source = comparison.metricDeltas.find(
    (entry) => entry.metricKey === claim.metricKey,
  );
  expect(source).toBeDefined();
  expect(claim).toMatchObject({
    unit: source!.unit,
    leftValue: source!.leftValue,
    rightValue: source!.rightValue,
    rightMinusLeft: source!.rightMinusLeft,
    relation: source!.relation,
    relativeDeltaBasisPoints: source!.relativeDeltaBasisPoints,
    relativeDeltaStatus: source!.relativeDeltaStatus,
    leftEvidence: source!.leftEvidence,
    rightEvidence: source!.rightEvidence,
  });
}

describe("Gate 5 finding-policy-v1", () => {
  let comparison: TrustedComparisonArtifact;

  beforeAll(() => {
    const inputs = createGoldenExperimentInputs();
    comparison = createTrustedRunComparison(
      verifiedOperand(inputs.runs.A),
      verifiedOperand(inputs.runs.B),
    );
  }, 60_000);

  it("defines one exhaustive immutable registry without preselecting output rows", () => {
    const metricKeys = [...comparison.metricDeltas]
      .map((row) => row.metricKey)
      .sort();
    expect(Object.keys(FINDING_METRIC_SELECTION_REGISTRY).sort()).toEqual(
      metricKeys,
    );
    for (const row of comparison.metricDeltas) {
      const policy = FINDING_METRIC_SELECTION_REGISTRY[row.metricKey];
      expect(policy.metricKey).toBe(row.metricKey);
      expect(policy.unit).toBe(row.unit);
      expect(Object.isFrozen(policy)).toBe(true);
    }
    expect(FINDING_METRIC_SELECTION_REGISTRY).toMatchObject({
      unservedPassengers: {
        family: "SERVICE",
        improvementDirection: "LOWER",
      },
      recoveryTimeSeconds: {
        family: "RESILIENCE",
        improvementDirection: "LOWER",
      },
      totalEnergyWh: {
        family: "ENERGY",
        materialityRule: "TOTAL_ENERGY",
      },
      energyWhPerPassengerKilometre: {
        family: "ENERGY",
        materialityRule: "ENERGY_PER_PASSENGER_KILOMETRE",
      },
      utilizationBasisPoints: {
        family: "UTILIZATION",
        materialityRule: "CAPACITY_UTILIZATION",
      },
      requestedPassengers: { eligible: false, exclusionReason: "CONTROLLED_INPUT" },
      servedPassengers: { eligible: false, exclusionReason: "REDUNDANT_OUTCOME" },
    });
  });

  it("selects only genuine constraint differences with canonical precedence", () => {
    let evidence = neutralPolicyEvidence(comparison);
    evidence = withConstraint(evidence, "MAXIMUM_WAIT", false, false, 500, 600);
    evidence = withConstraint(
      evidence,
      "MINIMUM_RESERVE",
      true,
      false,
      4_000,
      1_000,
    );
    evidence = withConstraint(
      evidence,
      "MAXIMUM_UNSERVED",
      false,
      true,
      3,
      0,
    );
    const reordered: PolicyEvidence = {
      ...evidence,
      constraintComparisons: [...evidence.constraintComparisons].reverse(),
    };
    expect(
      deriveFindingPolicySelection(evidence, "BALANCED").constraintDifference
        ?.constraintCode,
    ).toBe("MAXIMUM_UNSERVED");
    expect(
      deriveFindingPolicySelection(reordered, "BALANCED").constraintDifference,
    ).toEqual(
      deriveFindingPolicySelection(evidence, "BALANCED").constraintDifference,
    );

    const onlySharedFailure = withConstraint(
      neutralPolicyEvidence(comparison),
      "MAXIMUM_WAIT",
      false,
      false,
      500,
      600,
    );
    expect(
      deriveFindingPolicySelection(onlySharedFailure, "BALANCED")
        .constraintDifference,
    ).toBeUndefined();
    expect(
      deriveFindingPolicySelection(
        neutralPolicyEvidence(comparison),
        "BALANCED",
      ).constraintDifference,
    ).toBeUndefined();
  });

  it("uses exact normalized magnitude, canonical ties, and permutation independence", () => {
    let evidence = neutralPolicyEvidence(comparison);
    evidence = withMetric(evidence, "averageWaitSeconds", 1_000, 2_000);
    evidence = withMetric(evidence, "unservedPassengers", 1, 6);
    const selection = deriveFindingPolicySelection(evidence, "SERVICE");
    expect(selectedServiceMetric(selection)).toBe("unservedPassengers");
    // Independent literal proof: 5/6 is greater than 1000/2000.
    expect(BigInt(5) * BigInt(2_000)).toBeGreaterThan(
      BigInt(1_000) * BigInt(6),
    );

    let tie = neutralPolicyEvidence(comparison);
    tie = withMetric(tie, "averageWaitSeconds", 100, 200);
    tie = withMetric(tie, "maximumWaitSeconds", 50, 100);
    expect(selectedServiceMetric(deriveFindingPolicySelection(tie, "SERVICE"))).toBe(
      "averageWaitSeconds",
    );
    const reversed: PolicyEvidence = {
      ...tie,
      metricDeltas: [...tie.metricDeltas].reverse(),
    };
    expect(deriveFindingPolicySelection(reversed, "SERVICE")).toEqual(
      deriveFindingPolicySelection(tie, "SERVICE"),
    );

    let zeroCases = neutralPolicyEvidence(comparison);
    zeroCases = withMetric(zeroCases, "averageWaitSeconds", 0, 0);
    zeroCases = withMetric(zeroCases, "p95WaitSeconds", 100, 100);
    zeroCases = withMetric(zeroCases, "maximumWaitSeconds", null, null);
    zeroCases = withMetric(zeroCases, "unservedPassengers", 0, 5);
    expect(
      selectedServiceMetric(deriveFindingPolicySelection(zeroCases, "SERVICE")),
    ).toBe("unservedPassengers");
  });

  it("keeps A/B swapping symmetric while reversing direction and identity", () => {
    const forwardSelection = deriveFindingPolicySelection(comparison, "BALANCED");
    const reverseComparison = createTrustedRunComparison(
      verifiedOperand(createGoldenExperimentInputs().runs.B),
      verifiedOperand(createGoldenExperimentInputs().runs.A),
    );
    const reverseSelection = deriveFindingPolicySelection(
      reverseComparison,
      "BALANCED",
    );
    expect(selectedServiceMetric(reverseSelection)).toBe(
      selectedServiceMetric(forwardSelection),
    );
    expect(selectedEfficiencyMetric(reverseSelection)).toBe(
      selectedEfficiencyMetric(forwardSelection),
    );
    expect(
      reverseSelection.serviceOrResilienceDifference?.favouredSide,
    ).toBe("B");
    const forward = createFindingCandidate({
      comparison,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    const reverse = createFindingCandidate({
      comparison: reverseComparison,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    expect(reverse.findingFingerprint).not.toBe(forward.findingFingerprint);
    expect(
      deriveFindingPolicySelection(
        swapEvidence(neutralPolicyEvidence(comparison)),
        "BALANCED",
      ).recoveryStates,
    ).toEqual({ A: "RECOVERED", B: "RECOVERED" });
  }, 60_000);

  it("implements typed recovery state precedence and fails closed on impossible applicability", () => {
    let recoveredVersusNot = neutralPolicyEvidence(comparison);
    recoveredVersusNot = withRecoveredValues(
      recoveredVersusNot,
      120,
      null,
      false,
      false,
    );
    recoveredVersusNot = withMetric(
      recoveredVersusNot,
      "minimumBatteryBasisPoints",
      1,
      100,
    );
    const categorical = deriveFindingPolicySelection(
      recoveredVersusNot,
      "RESILIENCE",
    );
    expect(categorical.recoveryStates).toEqual({
      A: "RECOVERED",
      B: "NOT_RECOVERED",
    });
    expect(selectedServiceMetric(categorical)).toBe("recoveryTimeSeconds");
    expect(categorical.serviceOrResilienceDifference?.favouredSide).toBe("A");

    let bothRecovered = neutralPolicyEvidence(comparison);
    bothRecovered = withRecoveredValues(
      bothRecovered,
      100,
      400,
      true,
      true,
    );
    bothRecovered = withMetric(
      bothRecovered,
      "minimumBatteryBasisPoints",
      100,
      120,
    );
    expect(
      selectedServiceMetric(
        deriveFindingPolicySelection(bothRecovered, "RESILIENCE"),
      ),
    ).toBe("recoveryTimeSeconds");

    const bothNotRecovered = withRecoveredValues(
      neutralPolicyEvidence(comparison),
      null,
      null,
      false,
      false,
    );
    expect(
      deriveFindingPolicySelection(bothNotRecovered, "RESILIENCE")
        .recoveryStates,
    ).toEqual({ A: "NOT_RECOVERED", B: "NOT_RECOVERED" });

    const impossible = withRecoveredValues(
      neutralPolicyEvidence(comparison),
      null,
      null,
      true,
      true,
    );
    expectFindingError(
      () => deriveFindingPolicySelection(impossible, "RESILIENCE"),
      "INVALID_FINDING_EVIDENCE",
    );
  });

  it("honours emphasis tiers without letting outcome select evidence", () => {
    let evidence = neutralPolicyEvidence(comparison);
    evidence = withMetric(evidence, "unservedPassengers", 10, 12);
    evidence = withMetric(evidence, "minimumBatteryBasisPoints", 10, 100);
    expect(selectedServiceMetric(deriveFindingPolicySelection(evidence, "SERVICE"))).toBe(
      "unservedPassengers",
    );
    expect(
      selectedServiceMetric(deriveFindingPolicySelection(evidence, "RESILIENCE")),
    ).toBe("minimumBatteryBasisPoints");
    expect(
      selectedServiceMetric(deriveFindingPolicySelection(evidence, "BALANCED")),
    ).toBe("minimumBatteryBasisPoints");
    expect(selectedServiceMetric(deriveFindingPolicySelection(evidence, "ENERGY"))).toBe(
      "minimumBatteryBasisPoints",
    );

    for (const emphasis of EMPHASES) {
      const claimKeys = OUTCOMES.map((selectedOutcome) =>
        createFindingCandidate({ comparison, selectedOutcome, emphasis }).claims.map(
          (claim) =>
            claim.subjectKind === "METRIC"
              ? claim.metricKey
              : claim.constraintCode,
        ),
      );
      expect(claimKeys.every((keys) => JSON.stringify(keys) === JSON.stringify(claimKeys[0]))).toBe(
        true,
      );
    }
  });

  it("enforces exact energy and utilization materiality boundaries", () => {
    const base = neutralPolicyEvidence(comparison);
    const selected = (
      metricKey: ComparisonMetricKey,
      left: number | null,
      right: number | null,
    ) =>
      selectedEfficiencyMetric(
        deriveFindingPolicySelection(
          withMetric(base, metricKey, left, right),
          "BALANCED",
        ),
      );

    expect(selected("totalEnergyWh", 1_901, 2_000)).toBeUndefined();
    expect(selected("totalEnergyWh", 2_000, 2_100)).toBeUndefined();
    expect(selected("totalEnergyWh", 1_900, 2_000)).toBe("totalEnergyWh");
    expect(selected("totalEnergyWh", 1_899, 2_000)).toBe("totalEnergyWh");

    const energyPerPassengerKilometreBoundaries = [
      {
        label: "20 to 20 is below the absolute threshold",
        left: 20,
        right: 20,
        difference: 0,
        scale: 20,
        material: false,
      },
      {
        label: "20 to 21 reaches one unit but remains below five percent",
        left: 20,
        right: 21,
        difference: 1,
        scale: 21,
        material: false,
      },
      {
        label: "19 to 20 is exactly five percent",
        left: 19,
        right: 20,
        difference: 1,
        scale: 20,
        material: true,
      },
      {
        label: "18 to 19 is immediately above five percent",
        left: 18,
        right: 19,
        difference: 1,
        scale: 19,
        material: true,
      },
      {
        label: "20 to 22 is immediately above the absolute threshold",
        left: 20,
        right: 22,
        difference: 2,
        scale: 22,
        material: true,
      },
    ] as const;
    for (const boundary of energyPerPassengerKilometreBoundaries) {
      const absoluteBoundary = BigInt(boundary.difference) >= BigInt(1);
      const relativeBoundary =
        BigInt(20) * BigInt(boundary.difference) >= BigInt(boundary.scale);
      expect(
        absoluteBoundary && relativeBoundary,
        boundary.label,
      ).toBe(boundary.material);
      expect(
        selected(
          "energyWhPerPassengerKilometre",
          boundary.left,
          boundary.right,
        ),
        boundary.label,
      ).toBe(
        boundary.material
          ? "energyWhPerPassengerKilometre"
          : undefined,
      );
    }
    expect(selected("energyWhPerPassengerKilometre", 0, 1)).toBe(
      "energyWhPerPassengerKilometre",
    );
    expect(selected("energyWhPerPassengerKilometre", null, null)).toBeUndefined();

    expect(selected("utilizationBasisPoints", 1_000, 1_099)).toBeUndefined();
    expect(selected("utilizationBasisPoints", 1_000, 1_100)).toBe(
      "utilizationBasisPoints",
    );
    expect(selected("utilizationBasisPoints", 1_000, 1_101)).toBe(
      "utilizationBasisPoints",
    );
  });

  it("classifies only genuine opposing evidence as a trade-off", () => {
    let opposing = neutralPolicyEvidence(comparison);
    opposing = withMetric(opposing, "unservedPassengers", 5, 10);
    opposing = withMetric(opposing, "totalEnergyWh", 2_000, 1_000);
    expect(
      deriveFindingPolicySelection(opposing, "SERVICE").evidenceRelationship,
    ).toBe("OPPOSING_TRADE_OFF");

    let aligned = neutralPolicyEvidence(comparison);
    aligned = withMetric(aligned, "unservedPassengers", 5, 10);
    aligned = withMetric(aligned, "totalEnergyWh", 1_000, 2_000);
    expect(
      deriveFindingPolicySelection(aligned, "SERVICE").evidenceRelationship,
    ).toBe("ALIGNED_MATERIAL_DIFFERENCE");

    let largerAligned = withMetric(
      aligned,
      "energyWhPerPassengerKilometre",
      100,
      80,
    );
    // The smaller opposing row cannot displace the larger aligned row.
    expect(
      selectedEfficiencyMetric(
        deriveFindingPolicySelection(largerAligned, "SERVICE"),
      ),
    ).toBe("totalEnergyWh");
    expect(
      deriveFindingPolicySelection(largerAligned, "SERVICE")
        .evidenceRelationship,
    ).toBe("ALIGNED_MATERIAL_DIFFERENCE");

    largerAligned = withMetric(
      largerAligned,
      "energyWhPerPassengerKilometre",
      1_000,
      100,
    );
    // The largest row now genuinely opposes the service evidence.
    expect(
      selectedEfficiencyMetric(
        deriveFindingPolicySelection(largerAligned, "SERVICE"),
      ),
    ).toBe("energyWhPerPassengerKilometre");
    expect(
      deriveFindingPolicySelection(largerAligned, "SERVICE")
        .evidenceRelationship,
    ).toBe("OPPOSING_TRADE_OFF");

    let alignedForB = neutralPolicyEvidence(comparison);
    alignedForB = withMetric(alignedForB, "unservedPassengers", 10, 5);
    alignedForB = withMetric(alignedForB, "totalEnergyWh", 2_000, 1_000);
    expect(
      deriveFindingPolicySelection(alignedForB, "SERVICE")
        .evidenceRelationship,
    ).toBe("ALIGNED_MATERIAL_DIFFERENCE");

    const noMaterial = withMetric(
      neutralPolicyEvidence(comparison),
      "totalEnergyWh",
      1_901,
      2_000,
    );
    expect(
      deriveFindingPolicySelection(noMaterial, "SERVICE").evidenceRelationship,
    ).toBe("NO_MATERIAL_EFFICIENCY_DIFFERENCE");
  });

  it("builds the corrected golden pending-review evidence with an independent witness", () => {
    const before = comparison.canonicalComparisonJson;
    const candidate = createFindingCandidate({
      comparison,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    expect(candidate).toMatchObject({
      findingSchemaVersion: "finding-schema-v1",
      findingTemplateVersion: "finding-template-v1",
      findingPolicyVersion: "finding-policy-v1",
      comparisonFingerprint:
        "sha256-v1:8cee91dea5021953fe1a606daf2c0a240639699b18669642f0ef9f4800f3be37",
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
      evidenceRelationship: "OPPOSING_TRADE_OFF",
    });
    expect(candidate.findingFingerprint).toBe(
      "sha256-v1:f169bf3fd971e2e490378ec1f3a247bfdc73beb713c76f54edbf09fbea9e64ff",
    );
    expect(candidate.findingFingerprint).not.toBe(
      "sha256-v1:bde811ed10ef01e711d510f0a6aebe53e387634d5c54ad23d7b989fd93e44b94",
    );
    expect(candidate.claims).toMatchObject([
      {
        selectionSlot: "SERVICE_RESILIENCE_DIFFERENCE",
        subjectKind: "METRIC",
        metricKey: "recoveryTimeSeconds",
        leftValue: 120,
        rightValue: 450,
        rightMinusLeft: 330,
        favouredSide: "A",
        recoveryStateComparison: { A: "RECOVERED", B: "RECOVERED" },
      },
      {
        selectionSlot: "ENERGY_UTILIZATION_DIFFERENCE",
        subjectKind: "METRIC",
        metricKey: "totalEnergyWh",
        leftValue: 37_799,
        rightValue: 31_665,
        rightMinusLeft: -6_134,
        favouredSide: "B",
      },
    ]);
    expect(candidate.claims).toHaveLength(2);
    expect(
      candidate.claims.some(
        (claim) =>
          claim.subjectKind === "CONSTRAINT" &&
          claim.constraintTransition === "BOTH_FAIL",
      ),
    ).toBe(false);
    expect(candidate.caveats).toContainEqual({
      code: "HARD_CONSTRAINT_FAILURES_PRESENT",
      templateId: "hard-constraint-failures-v1",
      leftFailedConstraintCodes: ["MAXIMUM_WAIT"],
      rightFailedConstraintCodes: ["MAXIMUM_WAIT"],
    });
    // Literal ranking witnesses, independent of production selector helpers.
    expect(BigInt(330) * BigInt(1_050)).toBeGreaterThan(
      BigInt(270) * BigInt(450),
    );
    expect(BigInt(6_134) * BigInt(115)).toBeGreaterThan(
      BigInt(16) * BigInt(37_799),
    );
    expect(BigInt(6_134) * BigInt(2_289)).toBeGreaterThan(
      BigInt(165) * BigInt(37_799),
    );
    expect(BigInt(6_134)).toBeGreaterThanOrEqual(BigInt(100));
    expect(BigInt(20) * BigInt(6_134)).toBeGreaterThanOrEqual(
      BigInt(37_799),
    );
    expect(comparison.canonicalComparisonJson).toBe(before);
    expect(isDeepFrozen(candidate)).toBe(true);
  });

  it("exercises all 16 outcome/emphasis combinations with traceable immutable evidence", () => {
    for (const selectedOutcome of OUTCOMES) {
      for (const emphasis of EMPHASES) {
        const first = createFindingCandidate({
          comparison,
          selectedOutcome,
          emphasis,
        });
        const second = createFindingCandidate({
          emphasis,
          selectedOutcome,
          comparison,
        });
        expect(second).toEqual(first);
        expect(first.claims.length).toBeLessThanOrEqual(3);
        expect(new Set(first.claims.map((claim) => claim.claimId)).size).toBe(
          first.claims.length,
        );
        for (const claim of first.claims) {
          assertClaimMatchesComparison(claim, comparison);
        }
        expect(first.canonicalFindingJson).not.toMatch(
          /winner|recommendation|ranking|weighted|score|optimizer/iu,
        );
        expect(isDeepFrozen(first)).toBe(true);
      }
    }
  });

  it("keeps shared failures and incomplete recovery visible in caveats", () => {
    const golden = createFindingCandidate({
      comparison,
      selectedOutcome: "A",
      emphasis: "SERVICE",
    });
    expect(golden.caveats).toContainEqual({
      code: "HARD_CONSTRAINT_FAILURES_PRESENT",
      templateId: "hard-constraint-failures-v1",
      leftFailedConstraintCodes: ["MAXIMUM_WAIT"],
      rightFailedConstraintCodes: ["MAXIMUM_WAIT"],
    });

    const tiny = createTinyTriangleRun({ passengerCount: 4, vehicleCount: 1 });
    const bothNotRecovered = createTrustedRunComparison(
      verifiedOperand(inputForSlot(tiny, "A")),
      verifiedOperand(inputForSlot(tiny, "B")),
    );
    expect(
      bothNotRecovered.metricDeltas.find(
        (row) => row.metricKey === "recoveryTimeSeconds",
      ),
    ).toMatchObject({ leftValue: null, rightValue: null });
    const candidate = createFindingCandidate({
      comparison: bothNotRecovered,
      selectedOutcome: "INCONCLUSIVE",
      emphasis: "RESILIENCE",
    });
    expect(candidate.caveats).toContainEqual({
      code: "RECOVERY_NOT_COMPLETED",
      templateId: "recovery-not-completed-v1",
      sides: ["A", "B"],
    });

    const noDisruptionInput = createTinyTriangleRun({
      disruption: false,
      passengerCount: 0,
    });
    const noDisruption = createTrustedRunComparison(
      verifiedOperand(inputForSlot(noDisruptionInput, "A")),
      verifiedOperand(inputForSlot(noDisruptionInput, "B")),
    );
    const notApplicable = createFindingCandidate({
      comparison: noDisruption,
      selectedOutcome: "INCONCLUSIVE",
      emphasis: "RESILIENCE",
    });
    expect(
      notApplicable.claims.some(
        (claim) =>
          claim.subjectKind === "METRIC" &&
          claim.metricKey === "recoveryTimeSeconds",
      ),
    ).toBe(false);
    expect(notApplicable.caveats).toContainEqual(
      expect.objectContaining({
        code: "NOT_APPLICABLE_EVIDENCE_PRESENT",
        metricKeys: expect.arrayContaining(["recoveryTimeSeconds"]),
      }),
    );
  }, 30_000);

  it("does not let TRADE_OFF or INCONCLUSIVE manufacture evidence wording", () => {
    const identical = createTrustedRunComparison(
      verifiedOperand(createGoldenExperimentInputs().runs.A),
      verifiedOperand(createGoldenExperimentInputs().runs.A),
    );
    const tradeOff = createFindingCandidate({
      comparison: identical,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    expect(tradeOff.claims).toHaveLength(0);
    expect(tradeOff.evidenceRelationship).toBe(
      "NO_MATERIAL_EFFICIENCY_DIFFERENCE",
    );
    expect(tradeOff.caveats).toContainEqual({
      code: "PROPOSED_TRADE_OFF_NOT_ESTABLISHED",
      templateId: "proposed-trade-off-not-established-v1",
      evidenceRelationship: "NO_MATERIAL_EFFICIENCY_DIFFERENCE",
    });
    const inconclusive = createFindingCandidate({
      comparison,
      selectedOutcome: "INCONCLUSIVE",
      emphasis: "BALANCED",
    });
    expect(inconclusive.claims).toEqual(
      createFindingCandidate({
        comparison,
        selectedOutcome: "A",
        emphasis: "BALANCED",
      }).claims,
    );
  }, 60_000);

  it("binds policy/outcome/emphasis while excluding wall-clock and caller metadata", () => {
    const base = createFindingCandidate({
      comparison,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1);
    const early = createFindingCandidate({
      comparison,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    now.mockReturnValue(9_999_999_999_999);
    const late = createFindingCandidate({
      comparison,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    now.mockRestore();
    expect(early.findingFingerprint).toBe(base.findingFingerprint);
    expect(late.findingFingerprint).toBe(base.findingFingerprint);
    expect(
      new Set(
        OUTCOMES.map((selectedOutcome) =>
          createFindingCandidate({
            comparison,
            selectedOutcome,
            emphasis: "BALANCED",
          }).findingFingerprint,
        ),
      ),
    ).toHaveLength(OUTCOMES.length);
    expect(base.canonicalFindingJson).not.toMatch(
      /operationId|applicationRevision|wallClock|browser|webmcp/iu,
    );
  });

  it("rejects untrusted comparisons and closed-world input violations", () => {
    expectFindingError(
      () =>
        createFindingCandidate({
          comparison: { ...comparison } as TrustedComparisonArtifact,
          selectedOutcome: "TRADE_OFF",
          emphasis: "BALANCED",
        }),
      "UNTRUSTED_COMPARISON",
    );
    expectFindingError(
      () =>
        createFindingCandidate({
          comparison,
          selectedOutcome: "TRADE_OFF",
          emphasis: "BALANCED",
          conclusion: "A wins",
        } as never),
      "INVALID_FINDING_INPUT",
    );
    expectFindingError(
      () =>
        createFindingCandidate({
          comparison,
          selectedOutcome: "WINNER",
          emphasis: "BALANCED",
        } as never),
      "INVALID_FINDING_INPUT",
    );
  });
});
