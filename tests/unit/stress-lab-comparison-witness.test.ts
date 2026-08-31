import { beforeAll, describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import {
  createTrustedRunComparison,
  type TrustedComparisonOperand,
} from "@/domain/stress-lab/comparison";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import { verifyTrustedSimulationResult } from "@/domain/stress-lab/result-verification";
import type {
  DeterministicSimulationResult,
  EventLedgerEnvelope,
  PreparedRunInput,
  RunResultArtifact,
} from "@/domain/stress-lab/types";

function verifiedOperand(preparedInput: PreparedRunInput): TrustedComparisonOperand {
  const result = runDeterministicSimulation(preparedInput);
  const ledger: EventLedgerEnvelope = {
    eventSchemaVersion: result.eventSchemaVersion,
    inputFingerprint: result.inputFingerprint,
    engineVersion: result.engineVersion,
    tickSemanticsVersion: result.tickSemanticsVersion,
    controllerId: result.controllerId,
    controllerVersion: result.controllerVersion,
    events: result.events,
    fingerprint: result.eventLedgerFingerprint,
  };
  const artifact: RunResultArtifact = artifactFrom(result);
  return {
    preparedInput,
    verifiedResult: verifyTrustedSimulationResult(preparedInput, ledger, artifact),
  };
}

function artifactFrom(result: DeterministicSimulationResult): RunResultArtifact {
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

/*
 * Hand-audited witness values. This expected table does not call or reuse the
 * production delta, relative-delta, or constraint-transition implementation.
 */
const EXPECTED_WITNESS = Object.freeze({
  metrics: Object.freeze({
    servedPassengers: Object.freeze({
      leftValue: 82,
      rightValue: 81,
      rightMinusLeft: -1,
      relativeDeltaBasisPoints: -122,
      relation: "RIGHT_LOWER",
    }),
    unservedPassengers: Object.freeze({
      leftValue: 9,
      rightValue: 11,
      rightMinusLeft: 2,
      relativeDeltaBasisPoints: 2_222,
      relation: "RIGHT_HIGHER",
    }),
    maximumWaitSeconds: Object.freeze({
      leftValue: 1_050,
      rightValue: 780,
      rightMinusLeft: -270,
      relativeDeltaBasisPoints: -2_571,
      relation: "RIGHT_LOWER",
    }),
    totalEnergyWh: Object.freeze({
      leftValue: 37_799,
      rightValue: 31_665,
      rightMinusLeft: -6_134,
      relativeDeltaBasisPoints: -1_623,
      relation: "RIGHT_LOWER",
    }),
    reserveViolations: Object.freeze({
      leftValue: 0,
      rightValue: 0,
      rightMinusLeft: 0,
      relativeDeltaBasisPoints: null,
      relativeDeltaStatus: "LEFT_ZERO_DENOMINATOR",
      relation: "EQUAL",
    }),
  }),
  constraints: Object.freeze({
    MAXIMUM_WAIT: Object.freeze({
      leftObserved: 1_050,
      rightObserved: 780,
      rightMinusLeft: -270,
      transition: "BOTH_FAIL",
    }),
    MAXIMUM_UNSERVED: Object.freeze({
      leftObserved: 9,
      rightObserved: 11,
      rightMinusLeft: 2,
      transition: "BOTH_PASS",
    }),
  }),
});

describe("Gate 5 independent comparison witness", () => {
  let comparison: ReturnType<typeof createTrustedRunComparison>;

  beforeAll(() => {
    const inputs = createGoldenExperimentInputs();
    comparison = createTrustedRunComparison(
      verifiedOperand(inputs.runs.A),
      verifiedOperand(inputs.runs.B),
    );
  }, 60_000);

  it("matches literal hand-calculated signed and basis-point deltas", () => {
    for (const [metricKey, expected] of Object.entries(EXPECTED_WITNESS.metrics)) {
      const actual = comparison.metricDeltas.find(
        (entry) => entry.metricKey === metricKey,
      );
      expect(actual).toBeDefined();
      expect(actual).toMatchObject(expected);
    }
  });

  it("matches literal constraint transitions without a winner score", () => {
    for (const [constraintCode, expected] of Object.entries(
      EXPECTED_WITNESS.constraints,
    )) {
      const actual = comparison.constraintComparisons.find(
        (entry) => entry.constraintCode === constraintCode,
      );
      expect(actual).toBeDefined();
      expect({
        leftObserved: actual?.left.observed,
        rightObserved: actual?.right.observed,
        rightMinusLeft: actual?.rightMinusLeft,
        transition: actual?.transition,
      }).toEqual(expected);
    }
    expect(comparison).not.toHaveProperty("winner");
    expect(comparison).not.toHaveProperty("score");
    expect(comparison).not.toHaveProperty("ranking");
  });
});
