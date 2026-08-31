import { beforeAll, describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import {
  createTrustedRunComparison,
  type TrustedComparisonOperand,
} from "@/domain/stress-lab/comparison";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import {
  runDeterministicSimulation,
  runDeterministicSimulationWithController,
} from "@/domain/stress-lab/engine";
import { createFingerprintDocument } from "@/domain/stress-lab/fingerprint";
import { REFERENCE_DISPATCH_CONTROLLER } from "@/domain/stress-lab/reference-controller";
import { verifyTrustedSimulationResult } from "@/domain/stress-lab/result-verification";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import {
  controllerId,
  controllerVersion,
  count,
  disruptionId,
  fingerprint,
  simulatedSecond,
  StressLabComparisonError,
  type DeterministicSimulationResult,
  type DispatchControllerV1,
  type EventLedgerEnvelope,
  type PreparedRunInput,
  type RunResultArtifact,
  type StressLabRunInput,
  type VerifiedRunResultArtifact,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

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
  result = runDeterministicSimulation(preparedInput),
): TrustedComparisonOperand {
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

function withScenarioIdentity(
  prepared: PreparedRunInput,
  slot: "A" | "B",
): StressLabRunInput {
  const input = cloneInput(prepared);
  return {
    ...input,
    scenarioSlot: slot,
    scenario: {
      ...input.scenario,
      slot,
      label: slot === "A" ? "Tiny left" : "Tiny right",
    },
    disruptions: input.disruptions.map((disruption) => ({
      ...disruption,
      id: disruptionId(`tiny-${slot}-failure`),
    })),
  };
}

function changedDemandInput(
  prepared: PreparedRunInput,
  requestCount: number,
): PreparedRunInput {
  const input = withScenarioIdentity(prepared, "B");
  const requests = input.demandTrace.requests.slice(0, requestCount);
  const definition = {
    ...input.demandDefinition,
    requestCount: count(requestCount),
  };
  const traceWithoutFingerprint = {
    seed: input.demandTrace.seed,
    generatorVersion: input.demandTrace.generatorVersion,
    requests,
  };
  return prepareStressLabRunInput({
    ...input,
    demandDefinition: definition,
    demandTrace: {
      ...traceWithoutFingerprint,
      fingerprint: computeDemandTraceFingerprint(
        definition,
        input.horizon,
        traceWithoutFingerprint,
      ),
    },
  });
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => reverseKeys(entry));
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, reverseKeys(entry)]),
    );
  }
  return value;
}

function expectComparisonError(
  action: () => unknown,
  code: StressLabComparisonError["code"],
  pathPattern: RegExp,
): StressLabComparisonError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(StressLabComparisonError);
    const comparisonError = error as StressLabComparisonError;
    expect(comparisonError.code).toBe(code);
    expect(comparisonError.path).toMatch(pathPattern);
    return comparisonError;
  }
  throw new Error("Expected comparison to fail closed.");
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

describe("Gate 5 trusted deterministic comparison", () => {
  let goldenA: TrustedComparisonOperand;
  let goldenB: TrustedComparisonOperand;

  beforeAll(() => {
    const inputs = createGoldenExperimentInputs();
    goldenA = verifiedOperand(inputs.runs.A);
    goldenB = verifiedOperand(inputs.runs.B);
  }, 60_000);

  it("compares accepted Scenario A and B with explicit permitted fleet differences", () => {
    const comparison = createTrustedRunComparison(goldenA, goldenB);

    expect(comparison.compatibility).toBe("COMPARABLE");
    expect(comparison.deltaConvention).toBe("RIGHT_MINUS_LEFT");
    expect(comparison.metricDeltas).toHaveLength(19);
    expect(comparison.constraintComparisons).toHaveLength(5);
    expect(comparison.claims).toHaveLength(3);
    expect(comparison.permittedScenarioDifferences).toEqual([
      {
        path: "scenario.slot",
        kind: "SCENARIO_IDENTITY",
        leftValue: "A",
        rightValue: "B",
      },
      {
        path: "scenario.label",
        kind: "SCENARIO_IDENTITY",
        leftValue: "Twelve compact pods",
        rightValue: "Ten higher-capacity pods",
      },
      {
        path: "scenario.fleet.vehicleCount",
        kind: "FLEET_CONFIGURATION",
        unit: "VEHICLES",
        leftValue: 12,
        rightValue: 10,
        rightMinusLeft: -2,
      },
      {
        path: "scenario.fleet.seatsPerVehicle",
        kind: "FLEET_CONFIGURATION",
        unit: "SEATS_PER_VEHICLE",
        leftValue: 8,
        rightValue: 10,
        rightMinusLeft: 2,
      },
      {
        path: "disruptions[].id",
        kind: "SCENARIO_IDENTITY",
        leftValue: "failure-A-0842",
        rightValue: "failure-B-0842",
      },
    ]);
    expect(comparison.sharedProvenance.demandFingerprint).toBe(
      goldenA.preparedInput.input.demandTrace.fingerprint,
    );
    expect(comparison.sharedProvenance.demandFingerprint).toBe(
      goldenB.preparedInput.input.demandTrace.fingerprint,
    );
    expect(comparison.comparisonFingerprint).toBe(
      "sha256-v1:8cee91dea5021953fe1a606daf2c0a240639699b18669642f0ef9f4800f3be37",
    );
  });

  it("requires the runtime-attested verified result rather than a cast or hash", () => {
    const rawResult = runDeterministicSimulation(goldenA.preparedInput);
    const rawArtifact = artifactFromResult(rawResult) as VerifiedRunResultArtifact;

    expectComparisonError(
      () =>
        createTrustedRunComparison(
          { preparedInput: goldenA.preparedInput, verifiedResult: rawArtifact },
          goldenB,
        ),
      "UNVERIFIED_RUN_RESULT",
      /^left\.verifiedResult$/u,
    );
    expectComparisonError(
      () =>
        createTrustedRunComparison(
          {
            preparedInput: goldenA.preparedInput,
            verifiedResult: {
              ...rawArtifact,
              resultFingerprint: fingerprint(
                "sha256-v1:0000000000000000000000000000000000000000000000000000000000000000",
              ),
            } as VerifiedRunResultArtifact,
          },
          goldenB,
        ),
      "UNVERIFIED_RUN_RESULT",
      /^left\.verifiedResult$/u,
    );
  });

  it("rejects mismatched network and demand identities with exact values", () => {
    const tiny = verifiedOperand(createTinyTriangleRun({ disruption: false }));
    const networkError = expectComparisonError(
      () => createTrustedRunComparison(goldenA, tiny),
      "INCOMPARABLE_RUNS",
      /^input\.networkVersion$/u,
    );
    expect(networkError.leftValue).toBe("sandton-rosebank-v1");
    expect(networkError.rightValue).toBe("tiny-triangle-v1");

    const tinyLeftPrepared = createTinyTriangleRun({ disruption: false });
    const tinyRightPrepared = changedDemandInput(tinyLeftPrepared, 2);
    const demandError = expectComparisonError(
      () =>
        createTrustedRunComparison(
          verifiedOperand(tinyLeftPrepared),
          verifiedOperand(tinyRightPrepared),
        ),
      "INCOMPARABLE_RUNS",
      /^input\.demandTrace\.fingerprint$/u,
    );
    expect(demandError.leftValue).not.toBe(demandError.rightValue);
  });

  it("rejects mismatched disruption, constraints, and undeclared objectives", () => {
    const base = createTinyTriangleRun();
    const left = verifiedOperand(base);

    const disruptionInput = withScenarioIdentity(base, "B");
    const disruptionPrepared = prepareStressLabRunInput({
      ...disruptionInput,
      disruptions: disruptionInput.disruptions.map((disruption) => ({
        ...disruption,
        atSecond: simulatedSecond(120),
      })),
    });
    expectComparisonError(
      () => createTrustedRunComparison(left, verifiedOperand(disruptionPrepared)),
      "INCOMPARABLE_RUNS",
      /^input\.disruptions\[0\]\.atSecond$/u,
    );

    const constraintInput = withScenarioIdentity(base, "B");
    const constraintPrepared = prepareStressLabRunInput({
      ...constraintInput,
      scenario: {
        ...constraintInput.scenario,
        constraints: {
          ...constraintInput.scenario.constraints,
          maximumUnservedPassengers: count(2),
        },
      },
    });
    expectComparisonError(
      () => createTrustedRunComparison(left, verifiedOperand(constraintPrepared)),
      "INCOMPARABLE_RUNS",
      /^input\.scenario\.constraints\.maximumUnservedPassengers$/u,
    );

    const objectiveInput = withScenarioIdentity(base, "B");
    const objectivePrepared = prepareStressLabRunInput({
      ...objectiveInput,
      scenario: {
        ...objectiveInput.scenario,
        objectives: ["LOWER_WAIT", "LOWER_EMPTY_KM"],
      },
    });
    expectComparisonError(
      () => createTrustedRunComparison(left, verifiedOperand(objectivePrepared)),
      "INCOMPARABLE_RUNS",
      /^input\.scenario\.objectives\.length$/u,
    );
  });

  it("rejects incompatible controller and result-schema evidence before comparison", () => {
    const prepared = createTinyTriangleRun({ disruption: false });
    const reference = verifiedOperand(prepared);
    const alternateController: DispatchControllerV1 = Object.freeze({
      controllerId: controllerId("comparison-controller-proof"),
      controllerVersion: controllerVersion("same-policy-v2"),
      decide: REFERENCE_DISPATCH_CONTROLLER.decide,
    });
    const alternateResult = runDeterministicSimulationWithController(
      prepared,
      alternateController,
    );
    const alternate = verifiedOperand(prepared, alternateResult);
    expectComparisonError(
      () => createTrustedRunComparison(reference, alternate),
      "INCOMPARABLE_RUNS",
      /^result\.controllerId$/u,
    );

    const raw = runDeterministicSimulation(prepared);
    expect(() =>
      verifyTrustedSimulationResult(prepared, ledgerEnvelope(raw), {
        ...artifactFromResult(raw),
        resultSchemaVersion: "simulation-result-schema-v999" as RunResultArtifact["resultSchemaVersion"],
      }),
    ).toThrow(/schema or semantic version is unsupported/u);
  });

  it("emits zero deltas for identical runs and deterministic zero-denominator semantics", () => {
    const comparison = createTrustedRunComparison(goldenA, goldenA);
    expect(comparison.permittedScenarioDifferences).toEqual([]);
    expect(comparison.metricDeltas.every((metric) => metric.rightMinusLeft === 0)).toBe(true);
    expect(comparison.constraintComparisons.every((entry) => entry.rightMinusLeft === 0)).toBe(true);

    const zeroPrepared = createTinyTriangleRun({
      disruption: false,
      passengerCount: 0,
      vehicleCount: 0,
    });
    const zero = verifiedOperand(zeroPrepared);
    const zeroComparison = createTrustedRunComparison(zero, zero);
    const requested = zeroComparison.metricDeltas.find(
      (entry) => entry.metricKey === "requestedPassengers",
    );
    const average = zeroComparison.metricDeltas.find(
      (entry) => entry.metricKey === "averageWaitSeconds",
    );
    expect(requested).toMatchObject({
      leftValue: 0,
      rightValue: 0,
      rightMinusLeft: 0,
      relativeDeltaBasisPoints: null,
      relativeDeltaStatus: "LEFT_ZERO_DENOMINATOR",
    });
    expect(average).toMatchObject({
      leftValue: null,
      rightValue: null,
      rightMinusLeft: null,
      relativeDeltaBasisPoints: null,
      relativeDeltaStatus: "NOT_APPLICABLE",
    });
  });

  it("reverses every signed absolute delta when operands are swapped", () => {
    const forward = createTrustedRunComparison(goldenA, goldenB);
    const reverse = createTrustedRunComparison(goldenB, goldenA);
    for (let index = 0; index < forward.metricDeltas.length; index += 1) {
      expect(reverse.metricDeltas[index].leftValue).toBe(forward.metricDeltas[index].rightValue);
      expect(reverse.metricDeltas[index].rightValue).toBe(forward.metricDeltas[index].leftValue);
      const delta = forward.metricDeltas[index].rightMinusLeft;
      expect(reverse.metricDeltas[index].rightMinusLeft).toBe(
        delta === null ? null : delta === 0 ? 0 : -delta,
      );
    }
    for (let index = 0; index < forward.constraintComparisons.length; index += 1) {
      const delta = forward.constraintComparisons[index].rightMinusLeft;
      expect(reverse.constraintComparisons[index].rightMinusLeft).toBe(
        delta === null ? null : delta === 0 ? 0 : -delta,
      );
    }
    expect(reverse.comparisonFingerprint).not.toBe(forward.comparisonFingerprint);
  });

  it("classifies pass/fail transitions and keeps both-pass and both-fail explicit", () => {
    const leftPrepared = createTinyTriangleRun({
      disruption: false,
      passengerCount: 4,
      vehicleCount: 2,
    });
    const rightInput = withScenarioIdentity(leftPrepared, "B");
    const rightPrepared = prepareStressLabRunInput({
      ...rightInput,
      scenario: {
        ...rightInput.scenario,
        fleet: {
          ...rightInput.scenario.fleet,
          vehicleCount: count(0),
        },
      },
    });
    const comparison = createTrustedRunComparison(
      verifiedOperand(leftPrepared),
      verifiedOperand(rightPrepared),
    );
    expect(comparison.constraintComparisons.map((entry) => entry.transition)).toContain(
      "LEFT_PASS_RIGHT_FAIL",
    );
    expect(comparison.constraintComparisons.map((entry) => entry.transition)).toContain(
      "BOTH_PASS",
    );
    expect(
      createTrustedRunComparison(goldenA, goldenB).constraintComparisons.map(
        (entry) => entry.transition,
      ),
    ).toContain("BOTH_FAIL");
  });

  it("uses canonical key ordering and changes identity for a meaningful fleet result", () => {
    const comparison = createTrustedRunComparison(goldenA, goldenB);
    const parsedDocument = JSON.parse(comparison.canonicalComparisonJson) as {
      value: Record<string, unknown>;
    };
    const reordered = reverseKeys(parsedDocument.value);
    expect(
      createFingerprintDocument("RUN_COMPARISON_EVIDENCE", reordered).fingerprint,
    ).toBe(comparison.comparisonFingerprint);

    const changedInput = withScenarioIdentity(goldenB.preparedInput, "B");
    const changedPrepared = prepareStressLabRunInput({
      ...changedInput,
      scenario: {
        ...changedInput.scenario,
        fleet: {
          ...changedInput.scenario.fleet,
          vehicleCount: count(11),
        },
      },
    });
    const changed = createTrustedRunComparison(
      goldenA,
      verifiedOperand(changedPrepared),
    );
    expect(changed.comparisonFingerprint).not.toBe(comparison.comparisonFingerprint);
  }, 30_000);

  it("fails closed on non-finite casts and never mutates or aliases trusted inputs", () => {
    const beforeLeft = JSON.stringify(goldenA);
    const beforeRight = JSON.stringify(goldenB);
    const forged = {
      ...goldenA.verifiedResult,
      metrics: {
        ...goldenA.verifiedResult.metrics,
        totalEnergyWh: Number.NaN,
      },
    } as VerifiedRunResultArtifact;
    expectComparisonError(
      () =>
        createTrustedRunComparison(
          { preparedInput: goldenA.preparedInput, verifiedResult: forged },
          goldenB,
        ),
      "UNVERIFIED_RUN_RESULT",
      /^left\.verifiedResult$/u,
    );
    const infinity = {
      ...goldenA.verifiedResult,
      metrics: {
        ...goldenA.verifiedResult.metrics,
        totalEnergyWh: Number.POSITIVE_INFINITY,
      },
    } as VerifiedRunResultArtifact;
    expectComparisonError(
      () =>
        createTrustedRunComparison(
          { preparedInput: goldenA.preparedInput, verifiedResult: infinity },
          goldenB,
        ),
      "UNVERIFIED_RUN_RESULT",
      /^left\.verifiedResult$/u,
    );

    const output = createTrustedRunComparison(goldenA, goldenB);
    expect(JSON.stringify(goldenA)).toBe(beforeLeft);
    expect(JSON.stringify(goldenB)).toBe(beforeRight);
    expect(isDeepFrozen(output)).toBe(true);
    expect(output.sharedProvenance.horizon).not.toBe(
      goldenA.preparedInput.input.horizon,
    );
    expect(output.metricDeltas[0].leftEvidence).not.toBe(goldenA.verifiedResult);
  });

  it("is byte-identical across repeated Node runs", () => {
    const expected = createTrustedRunComparison(goldenA, goldenB);
    for (let repetition = 0; repetition < 10; repetition += 1) {
      const next = createTrustedRunComparison(goldenA, goldenB);
      expect(next.canonicalComparisonJson).toBe(expected.canonicalComparisonJson);
      expect(next.comparisonFingerprint).toBe(expected.comparisonFingerprint);
    }
  });
});
