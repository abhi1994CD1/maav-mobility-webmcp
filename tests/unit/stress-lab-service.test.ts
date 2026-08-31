import { beforeAll, describe, expect, it } from "vitest";
import {
  StressLabService,
} from "@/application/stress-lab-service";
import {
  StressLabApplicationError,
  type CompareScenariosCommand,
  type RunExecutionContext,
  type StressLabComparisonExecutor,
  type StressLabSimulationExecutor,
} from "@/application/stress-lab-ports";
import {
  createGoldenExperimentInputs,
  MORNING_PEAK_RESILIENCE_V2_FINGERPRINT,
  SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
} from "@/data/scenarios/sandton-rosebank-v1";
import {
  createTrustedRunComparison,
} from "@/domain/stress-lab/comparison";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import {
  computeNetworkFixtureFingerprint,
  prepareStressLabRunInput,
} from "@/domain/stress-lab/run-input";
import {
  isVerifiedRunResultArtifact,
} from "@/domain/stress-lab/result-verification";
import {
  disruptionId,
  networkVersion,
  StressLabComparisonError,
  type DeterministicSimulationResult,
  type EventLedgerEnvelope,
  type PreparedRunInput,
  type RunResultArtifact,
  type ScenarioSlot,
  type StressLabRunInput,
  type VerifiedRunResultArtifact,
} from "@/domain/stress-lab/types";
import {
  createTinyTriangleRun,
} from "../helpers/stress-lab-v2-fixtures";
import { StressLabTestRepository } from "../helpers/stress-lab-test-repository";

const GOLDEN_IDENTITIES = Object.freeze({
  network:
    "sha256-v1:ff982fc42bc6ae8bb6d1f110a44925e392f2f44e2ebbdf9f0f8054080d4df5d0",
  demand:
    "sha256-v1:f7fd7e72e6ba7befe1b3eb578e20387b89a9b7a274c67b65ddebdfd62ee22302",
  inputA:
    "sha256-v1:5156b1558d9767d60d1d050df868adb54b8075a0681ccea50dad07071b64afae",
  inputB:
    "sha256-v1:e1e6b94a79218c817ac346922309f87f35755bbd3721142d68db58b67111d80c",
  ledgerA:
    "sha256-v1:ca01cda9ae8edcf84ee8319304b7bd4853df5ecc5d0d0262d36a03acdfcc875b",
  resultA:
    "sha256-v1:d9138005105a050eea5974fe1a6ef0b2680204f15662463ca7fa6d08965d40ad",
  ledgerB:
    "sha256-v1:4df5d2078a36d16240e4f9e12bbb2403a8a4db92f9034e6c27bcc1a8c5bc2eb3",
  resultB:
    "sha256-v1:89dbf5e7080850c849d221b6c6646148bdd017db5ac2988285caf49034744511",
  comparison:
    "sha256-v1:8cee91dea5021953fe1a606daf2c0a240639699b18669642f0ef9f4800f3be37",
});

class Deferred<Value> {
  readonly promise: Promise<Value>;
  private resolveValue!: (value: Value) => void;
  private rejectValue!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<Value>((resolve, reject) => {
      this.resolveValue = resolve;
      this.rejectValue = reject;
    });
  }

  resolve(value: Value): void {
    this.resolveValue(value);
  }

  reject(reason: unknown): void {
    this.rejectValue(reason);
  }
}

function ledgerFrom(result: DeterministicSimulationResult): EventLedgerEnvelope {
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

function executionFor(prepared: PreparedRunInput) {
  const result = runDeterministicSimulation(prepared);
  return { eventLedger: ledgerFrom(result), result: artifactFrom(result) };
}

class ControlledSimulationExecutor implements StressLabSimulationExecutor {
  readonly calls: {
    readonly preparedInput: PreparedRunInput;
    readonly context: RunExecutionContext;
    readonly deferred: Deferred<ReturnType<typeof executionFor>>;
  }[] = [];

  execute(preparedInput: PreparedRunInput, context: RunExecutionContext) {
    const deferred = new Deferred<ReturnType<typeof executionFor>>();
    this.calls.push({ preparedInput, context, deferred });
    return deferred.promise;
  }

  succeed(index: number): void {
    const call = this.calls[index];
    call.deferred.resolve(executionFor(call.preparedInput));
  }

  fail(index: number, error = new Error("controlled failure")): void {
    this.calls[index].deferred.reject(error);
  }
}

class ControlledComparisonExecutor implements StressLabComparisonExecutor {
  readonly calls: {
    readonly left: {
      readonly preparedInput: PreparedRunInput;
      readonly verifiedResult: VerifiedRunResultArtifact;
    };
    readonly right: {
      readonly preparedInput: PreparedRunInput;
      readonly verifiedResult: VerifiedRunResultArtifact;
    };
    readonly deferred: Deferred<void>;
  }[] = [];

  execute(
    left: {
      readonly preparedInput: PreparedRunInput;
      readonly verifiedResult: VerifiedRunResultArtifact;
    },
    right: {
      readonly preparedInput: PreparedRunInput;
      readonly verifiedResult: VerifiedRunResultArtifact;
    },
  ) {
    const deferred = new Deferred<void>();
    this.calls.push({ left, right, deferred });
    return deferred.promise;
  }

  succeed(index: number): void {
    this.calls[index].deferred.resolve();
  }

  fail(index: number, error: unknown): void {
    this.calls[index].deferred.reject(error);
  }
}

const IMMEDIATE_SIMULATION_EXECUTOR: StressLabSimulationExecutor = {
  async execute(preparedInput, context) {
    context.reportProgress(0, 1);
    const result = executionFor(preparedInput);
    context.reportProgress(1, 1);
    return result;
  },
};

const IMMEDIATE_COMPARISON_EXECUTOR: StressLabComparisonExecutor = {
  async execute() {
    return undefined;
  },
};

function cloneInput(prepared: PreparedRunInput): StressLabRunInput {
  return JSON.parse(prepared.canonicalJson).value as StressLabRunInput;
}

function inputForSlot(
  prepared: PreparedRunInput,
  slot: ScenarioSlot,
): PreparedRunInput {
  const input = cloneInput(prepared);
  return prepareStressLabRunInput({
    ...input,
    scenarioSlot: slot,
    scenario: {
      ...input.scenario,
      slot,
      label: slot === "A" ? "Tiny Scenario A" : "Tiny Scenario B",
    },
    disruptions: input.disruptions.map((disruption) => ({
      ...disruption,
      id: disruptionId(`tiny-${slot}-failure`),
    })),
  });
}

function incompatibleNetworkInput(
  prepared: PreparedRunInput,
  slot: ScenarioSlot,
): PreparedRunInput {
  const input = cloneInput(inputForSlot(prepared, slot));
  const version = networkVersion("tiny-other-v1");
  const network = {
    ...input.network,
    networkVersion: version,
  };
  return prepareStressLabRunInput({
    ...input,
    networkVersion: version,
    network,
    networkFingerprint: computeNetworkFixtureFingerprint(network),
  });
}

async function configure(
  service: StressLabService,
  prepared: PreparedRunInput,
  operationIdValue: string,
) {
  const revision = service.readLabState().revision;
  return service.configureScenario({
    operationId: operationIdValue,
    expectedRevision: revision,
    slot: prepared.input.scenarioSlot,
    input: prepared.input,
  });
}

function runCurrent(
  service: StressLabService,
  slot: ScenarioSlot,
  operationIdValue: string,
) {
  const view = service.readLabState();
  const scenario = view.scenarios[slot];
  if (!scenario) throw new Error(`Scenario ${slot} is not configured.`);
  return service.runScenario({
    operationId: operationIdValue,
    expectedRevision: view.revision,
    scenarioRevisionId: scenario.id,
  });
}

async function expectApplicationError(
  promise: Promise<unknown>,
  code: StressLabApplicationError["code"],
): Promise<StressLabApplicationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(StressLabApplicationError);
    expect((error as StressLabApplicationError).code).toBe(code);
    return error as StressLabApplicationError;
  }
  throw new Error(`Expected ${code}.`);
}

async function createCurrentTinyRuns(options?: {
  readonly simulationExecutor?: StressLabSimulationExecutor;
  readonly comparisonExecutor?: StressLabComparisonExecutor;
  readonly right?: PreparedRunInput;
}) {
  const repository = new StressLabTestRepository();
  const service = new StressLabService(
    repository,
    options?.simulationExecutor ?? IMMEDIATE_SIMULATION_EXECUTOR,
    options?.comparisonExecutor ?? IMMEDIATE_COMPARISON_EXECUTOR,
  );
  const base = createTinyTriangleRun({ disruption: true });
  const left = inputForSlot(base, "A");
  const right = options?.right ?? inputForSlot(base, "B");
  await configure(service, left, "configure-a");
  await configure(service, right, "configure-b");
  const runA = await runCurrent(service, "A", "run-a");
  const runB = await runCurrent(service, "B", "run-b");
  return { repository, service, left, right, runA, runB };
}

describe("Gate 6 revision-safe application authority", () => {
  let goldenInputs: ReturnType<typeof createGoldenExperimentInputs>;

  beforeAll(() => {
    goldenInputs = createGoldenExperimentInputs();
  });

  it("executes the complete golden A/B evidence flow and keeps human review separate", async () => {
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository);
    await configure(service, goldenInputs.runs.A, "golden-config-a");
    await configure(service, goldenInputs.runs.B, "golden-config-b");
    const runA = await runCurrent(service, "A", "golden-run-a");
    const runB = await runCurrent(service, "B", "golden-run-b");
    const comparison = await service.compareScenarios({
      operationId: "golden-compare",
      expectedRevision: service.readLabState().revision,
      leftRunId: runA.artifactId,
      rightRunId: runB.artifactId,
    });

    const comparisonView = service.readLabState().currentComparison;
    expect(comparisonView?.isCurrent).toBe(true);
    const finding = await service.stageFinding({
      operationId: "golden-stage",
      expectedRevision: service.readLabState().revision,
      comparisonId: comparison.artifactId,
      selectedClaimIds: comparisonView!.claimIds,
    });
    const trustedBeforeReview = {
      runA: service.readLabState().currentRuns.A?.resultFingerprint,
      runB: service.readLabState().currentRuns.B?.resultFingerprint,
      comparison: service.readLabState().currentComparison?.comparisonFingerprint,
      evidence: finding.evidenceDigest,
    };
    await service.acceptFinding({
      operationId: "golden-human-accept",
      expectedRevision: service.readLabState().revision,
      findingId: finding.artifactId,
    });

    const final = service.readLabState();
    expect(final.currentFinding?.review).toBe("ACCEPTED");
    expect({
      runA: final.currentRuns.A?.resultFingerprint,
      runB: final.currentRuns.B?.resultFingerprint,
      comparison: final.currentComparison?.comparisonFingerprint,
      evidence: final.currentFinding?.evidenceDigest,
    }).toEqual(trustedBeforeReview);
    expect(SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT).toBe(
      GOLDEN_IDENTITIES.network,
    );
    expect(goldenInputs.sharedDemandTrace.fingerprint).toBe(
      GOLDEN_IDENTITIES.demand,
    );
    expect(MORNING_PEAK_RESILIENCE_V2_FINGERPRINT).toBe(
      "sha256-v1:a79212caf3b4ea6b30a34ab995b6b6b78db519187dcae5beca4b96893f7af3ea",
    );
    expect(runA).toMatchObject({
      inputFingerprint: GOLDEN_IDENTITIES.inputA,
      eventLedgerFingerprint: GOLDEN_IDENTITIES.ledgerA,
      resultFingerprint: GOLDEN_IDENTITIES.resultA,
    });
    expect(runB).toMatchObject({
      inputFingerprint: GOLDEN_IDENTITIES.inputB,
      eventLedgerFingerprint: GOLDEN_IDENTITIES.ledgerB,
      resultFingerprint: GOLDEN_IDENTITIES.resultB,
    });
    expect(comparison.comparisonFingerprint).toBe(
      GOLDEN_IDENTITIES.comparison,
    );
    expect(repository.getState().reviews[finding.artifactId].decision).toBe(
      "ACCEPTED",
    );
  }, 60_000);

  it("uses monotonic scenario revisions so edit/revert cannot create an ABA publication", async () => {
    const executor = new ControlledSimulationExecutor();
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, executor);
    const input = inputForSlot(createTinyTriangleRun(), "A");
    const first = await configure(service, input, "aba-config-1");
    const oldRun = runCurrent(service, "A", "aba-run-old");
    const second = await configure(service, input, "aba-config-2");
    const third = await configure(service, input, "aba-config-3");
    expect([
      first.scenarioRevisionRef.revision,
      second.scenarioRevisionRef.revision,
      third.scenarioRevisionRef.revision,
    ]).toEqual([1, 2, 3]);
    expect(first.scenarioRevisionRef.preparedInputFingerprint).toBe(
      third.scenarioRevisionRef.preparedInputFingerprint,
    );
    executor.succeed(0);
    await expectApplicationError(oldRun, "STALE_OPERATION");
    expect(service.readLabState().currentRuns.A).toBeNull();
  });

  it("publishes only the newer operation when the first starts first and finishes last", async () => {
    const executor = new ControlledSimulationExecutor();
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, executor);
    await configure(service, inputForSlot(createTinyTriangleRun(), "A"), "latest-config");
    const first = runCurrent(service, "A", "latest-run-1");
    const second = runCurrent(service, "A", "latest-run-2");
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[0].context.reportProgress(1, 2)).toBe(false);
    executor.succeed(1);
    const secondResult = await second;
    executor.succeed(0);
    await expectApplicationError(first, "STALE_OPERATION");
    expect(service.readLabState().currentRuns.A?.id).toBe(
      secondResult.artifactId,
    );
    expect(
      repository
        .getState()
        .audit.filter((entry) => entry.action === "RUN_PUBLISHED"),
    ).toHaveLength(1);

    const staleFailure = runCurrent(service, "A", "latest-run-3");
    const newest = runCurrent(service, "A", "latest-run-4");
    expect(executor.calls[2].context.reportProgress(1, 2)).toBe(false);
    executor.succeed(3);
    const newestResult = await newest;
    executor.fail(2);
    await expectApplicationError(staleFailure, "STALE_OPERATION");
    expect(service.readLabState().currentRuns.A?.id).toBe(
      newestResult.artifactId,
    );
  });

  it("treats explicit cancellation and completion ordering as deterministic", async () => {
    const executor = new ControlledSimulationExecutor();
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, executor);
    await configure(service, inputForSlot(createTinyTriangleRun(), "A"), "cancel-config");
    const cancelledRun = runCurrent(service, "A", "cancel-run");
    const runningRevision = service.readLabState().revision;
    await service.cancelRun({
      operationId: "cancel-command",
      expectedRevision: runningRevision,
      slot: "A",
      targetOperationId: "cancel-run",
    });
    executor.succeed(0);
    await expectApplicationError(cancelledRun, "OPERATION_CANCELLED");
    expect(service.readLabState().currentRuns.A).toBeNull();

    const completedRun = runCurrent(service, "A", "complete-before-cancel");
    executor.succeed(1);
    await completedRun;
    const beforeLateCancel = service.readLabState().revision;
    await expectApplicationError(
      service.cancelRun({
        operationId: "late-cancel-command",
        expectedRevision: beforeLateCancel,
        slot: "A",
        targetOperationId: "complete-before-cancel",
      }),
      "INVALID_STATE_TRANSITION",
    );
    expect(service.readLabState().revision).toBe(beforeLateCancel);
  });

  it("accepts duplicate completion only once and preserves an earlier run after rerun failure", async () => {
    const executor = new ControlledSimulationExecutor();
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, executor);
    await configure(service, inputForSlot(createTinyTriangleRun(), "A"), "failure-config");
    const firstPromise = runCurrent(service, "A", "first-good-run");
    executor.succeed(0);
    executor.succeed(0);
    const first = await firstPromise;
    const publishedRevision = service.readLabState().revision;
    expect(
      repository
        .getState()
        .audit.filter((entry) => entry.action === "RUN_PUBLISHED"),
    ).toHaveLength(1);

    const failedRerun = runCurrent(service, "A", "failed-rerun");
    executor.fail(1);
    await expectApplicationError(failedRerun, "SIMULATION_FAILED");
    expect(service.readLabState().currentRuns.A?.id).toBe(first.artifactId);
    expect(service.readLabState().revision).toBe(publishedRevision + 2);
  });

  it("propagates external cancellation and rejects unverifiable executor output", async () => {
    const executor = new ControlledSimulationExecutor();
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, executor);
    await configure(service, inputForSlot(createTinyTriangleRun(), "A"), "external-config");
    const scenario = service.readLabState().scenarios.A!;
    const signal = { aborted: false };
    const cancelled = service.runScenario(
      {
        operationId: "external-cancel-run",
        expectedRevision: service.readLabState().revision,
        scenarioRevisionId: scenario.id,
      },
      signal,
    );
    signal.aborted = true;
    executor.succeed(0);
    await expectApplicationError(cancelled, "OPERATION_CANCELLED");
    expect(service.readLabState().currentRuns.A).toBeNull();

    const invalidExecutor: StressLabSimulationExecutor = {
      async execute(preparedInput) {
        const computed = executionFor(preparedInput);
        return {
          ...computed,
          result: {
            ...computed.result,
            resultFingerprint: computed.result.inputFingerprint,
          },
        };
      },
    };
    const invalidService = new StressLabService(
      new StressLabTestRepository(),
      invalidExecutor,
    );
    await configure(
      invalidService,
      inputForSlot(createTinyTriangleRun(), "A"),
      "invalid-result-config",
    );
    await expectApplicationError(
      runCurrent(invalidService, "A", "invalid-result-run"),
      "UNVERIFIED_RESULT",
    );
    expect(invalidService.readLabState().currentRuns.A).toBeNull();
  });

  it("provides compare-and-swap and idempotency guarantees without partial mutation", async () => {
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, IMMEDIATE_SIMULATION_EXECUTOR);
    const input = inputForSlot(createTinyTriangleRun(), "A");
    const command = {
      operationId: "idempotent-config",
      expectedRevision: 0,
      slot: "A" as const,
      input: input.input,
    };
    const firstPromise = service.configureScenario(command);
    const duplicatePromise = service.configureScenario(command);
    expect(duplicatePromise).toBe(firstPromise);
    const first = await firstPromise;
    const duplicate = await duplicatePromise;
    expect(duplicate).toBe(first);
    expect(service.readLabState().revision).toBe(1);

    await expectApplicationError(
      service.configureScenario({
        ...command,
        slot: "B",
        input: inputForSlot(input, "B").input,
      }),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(service.readLabState().revision).toBe(1);

    await expectApplicationError(
      service.resetLab({
        operationId: command.operationId,
        expectedRevision: service.readLabState().revision,
      }),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(service.readLabState().revision).toBe(1);

    const beforeWrongRevision = repository.getState();
    await expectApplicationError(
      service.configureScenario({
        operationId: "wrong-revision",
        expectedRevision: 0,
        slot: "A",
        input: input.input,
      }),
      "REVISION_CONFLICT",
    );
    expect(service.readLabState().revision).toBe(1);
    expect(repository.getState()).toBe(beforeWrongRevision);
  });

  it("serializes subscriber re-entry and returns independently frozen views", async () => {
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, IMMEDIATE_SIMULATION_EXECUTOR);
    const base = createTinyTriangleRun();
    const a = inputForSlot(base, "A");
    const b = inputForSlot(base, "B");
    let reentrant: Promise<unknown> | undefined;
    const unsubscribe = service.subscribe((view) => {
      if (view.revision === 1 && !view.scenarios.B && !reentrant) {
        reentrant = service.configureScenario({
          operationId: "subscriber-config-b",
          expectedRevision: view.revision,
          slot: "B",
          input: b.input,
        });
      }
    });
    await configure(service, a, "subscriber-config-a");
    await reentrant;
    unsubscribe();
    expect(service.readLabState().revision).toBe(2);
    expect(service.readLabState().scenarios.B).not.toBeNull();

    const view = service.readLabState();
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.scenarios)).toBe(true);
    expect(() => {
      (view.scenarios.A as { label: string }).label = "tampered";
    }).toThrow();
    expect(service.readLabState().scenarios.A?.label).toBe("Tiny Scenario A");
  });

  it("prevents either operand edit from publishing an in-flight comparison", async () => {
    for (const slot of ["A", "B"] as const) {
      const comparisonExecutor = new ControlledComparisonExecutor();
      const harness = await createCurrentTinyRuns({ comparisonExecutor });
      const command: CompareScenariosCommand = {
        operationId: `stale-compare-${slot}`,
        expectedRevision: harness.service.readLabState().revision,
        leftRunId: harness.runA.artifactId,
        rightRunId: harness.runB.artifactId,
      };
      const comparisonPromise = harness.service.compareScenarios(command);
      await configure(
        harness.service,
        slot === "A" ? harness.left : harness.right,
        `edit-${slot.toLowerCase()}-during-compare`,
      );
      comparisonExecutor.succeed(0);
      await expectApplicationError(comparisonPromise, "STALE_OPERATION");
      expect(harness.service.readLabState().currentComparison).toBeNull();
      expect(
        Object.keys(harness.repository.getState().comparisons),
      ).toHaveLength(0);
    }
  });

  it("propagates the exact Gate 5 incompatibility and publishes no comparison", async () => {
    const base = createTinyTriangleRun();
    const incompatible = incompatibleNetworkInput(base, "B");
    const harness = await createCurrentTinyRuns({ right: incompatible });
    const revisionBefore = harness.service.readLabState().revision;
    let caught: unknown;
    try {
      await harness.service.compareScenarios({
        operationId: "incompatible-compare",
        expectedRevision: revisionBefore,
        leftRunId: harness.runA.artifactId,
        rightRunId: harness.runB.artifactId,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StressLabComparisonError);
    expect((caught as StressLabComparisonError).code).toBe(
      "INCOMPARABLE_RUNS",
    );
    expect((caught as StressLabComparisonError).path).toBe(
      "input.networkVersion",
    );
    expect(harness.service.readLabState().currentComparison).toBeNull();
    expect(Object.keys(harness.repository.getState().comparisons)).toHaveLength(0);
    expect(harness.service.readLabState().revision).toBe(revisionBefore + 2);
  });

  it("retains exact same-process Gate 4 attestations and rejects copied substitutes", async () => {
    const comparisonExecutor = new ControlledComparisonExecutor();
    const harness = await createCurrentTinyRuns({ comparisonExecutor });
    const compare = harness.service.compareScenarios({
      operationId: "attestation-compare",
      expectedRevision: harness.service.readLabState().revision,
      leftRunId: harness.runA.artifactId,
      rightRunId: harness.runB.artifactId,
    });
    const call = comparisonExecutor.calls[0];
    const storedLeft = harness.repository.getState().runs[harness.runA.artifactId];
    const storedRight = harness.repository.getState().runs[harness.runB.artifactId];
    expect(call.left.verifiedResult).toBe(storedLeft.verifiedResult);
    expect(call.right.verifiedResult).toBe(storedRight.verifiedResult);
    expect(isVerifiedRunResultArtifact(call.left.verifiedResult)).toBe(true);
    const publicLeft = harness.service.readLabState().currentRuns.A!;
    expect(publicLeft).not.toHaveProperty("verifiedResult");
    expect(publicLeft).not.toHaveProperty("eventLedger");
    expect(isVerifiedRunResultArtifact(publicLeft)).toBe(false);
    expect(() =>
      createTrustedRunComparison(
        {
          preparedInput: call.left.preparedInput,
          verifiedResult: publicLeft as unknown as VerifiedRunResultArtifact,
        },
        call.right,
      ),
    ).toThrowError(StressLabComparisonError);
    const copied = {
      ...call.left.verifiedResult,
    } as VerifiedRunResultArtifact;
    expect(isVerifiedRunResultArtifact(copied)).toBe(false);
    expect(() =>
      createTrustedRunComparison(
        { preparedInput: call.left.preparedInput, verifiedResult: copied },
        call.right,
      ),
    ).toThrowError(StressLabComparisonError);
    comparisonExecutor.succeed(0);
    await compare;
  });

  it("stages only trusted claim IDs and transitively stales finding and review authority", async () => {
    const harness = await createCurrentTinyRuns();
    const comparison = await harness.service.compareScenarios({
      operationId: "finding-compare",
      expectedRevision: harness.service.readLabState().revision,
      leftRunId: harness.runA.artifactId,
      rightRunId: harness.runB.artifactId,
    });
    const claimIds = harness.service.readLabState().currentComparison!.claimIds;
    const beforeNumericAttack = harness.service.readLabState().revision;
    await expectApplicationError(
      Promise.resolve().then(() =>
        harness.service.stageFinding({
          operationId: "numeric-claim-attack",
          expectedRevision: beforeNumericAttack,
          comparisonId: comparison.artifactId,
          selectedClaimIds: claimIds,
          leftValue: 999,
        } as never),
      ),
      "INVALID_COMMAND",
    );
    expect(harness.service.readLabState().revision).toBe(beforeNumericAttack);

    await expectApplicationError(
      harness.service.stageFinding({
        operationId: "unknown-claim",
        expectedRevision: beforeNumericAttack,
        comparisonId: comparison.artifactId,
        selectedClaimIds: ["claim-invented"],
      }),
      "INVALID_COMMAND",
    );
    expect(harness.service.readLabState().revision).toBe(beforeNumericAttack);

    const finding = await harness.service.stageFinding({
      operationId: "valid-finding",
      expectedRevision: beforeNumericAttack,
      comparisonId: comparison.artifactId,
      selectedClaimIds: claimIds.slice(0, 2),
    });
    const stored = harness.repository.getState().findings[finding.artifactId];
    const trustedComparison =
      harness.repository.getState().comparisons[comparison.artifactId].artifact;
    expect(stored.selectedClaims).toEqual(trustedComparison.claims.slice(0, 2));
    expect(stored.selectedClaims[0]).toBe(trustedComparison.claims[0]);
    const fingerprintsBefore = {
      comparison: trustedComparison.comparisonFingerprint,
      results: [
        harness.runA.resultFingerprint,
        harness.runB.resultFingerprint,
      ],
    };
    await harness.service.challengeFinding({
      operationId: "human-challenge",
      expectedRevision: harness.service.readLabState().revision,
      findingId: finding.artifactId,
      feedback: "Revisit the explicit service and energy trade-off.",
    });
    expect(harness.service.readLabState().currentFinding?.review).toBe(
      "CHALLENGED",
    );
    expect({
      comparison: trustedComparison.comparisonFingerprint,
      results: [
        harness.runA.resultFingerprint,
        harness.runB.resultFingerprint,
      ],
    }).toEqual(fingerprintsBefore);

    const freshComparison = await harness.service.compareScenarios({
      operationId: "finding-compare-2",
      expectedRevision: harness.service.readLabState().revision,
      leftRunId: harness.runA.artifactId,
      rightRunId: harness.runB.artifactId,
    });
    const freshFinding = await harness.service.stageFinding({
      operationId: "finding-2",
      expectedRevision: harness.service.readLabState().revision,
      comparisonId: freshComparison.artifactId,
      selectedClaimIds:
        harness.service.readLabState().currentComparison!.claimIds,
    });
    await configure(harness.service, harness.left, "stale-finding-edit");
    expect(harness.service.readLabState().currentRuns.A).toBeNull();
    expect(harness.service.readLabState().currentRuns.B?.isCurrent).toBe(true);
    expect(harness.service.readLabState().currentComparison).toBeNull();
    expect(harness.service.readLabState().currentFinding).toBeNull();
    await expectApplicationError(
      harness.service.stageFinding({
        operationId: "stage-stale-comparison",
        expectedRevision: harness.service.readLabState().revision,
        comparisonId: freshComparison.artifactId,
        selectedClaimIds: claimIds,
      }),
      "STALE_COMPARISON",
    );
    await expectApplicationError(
      harness.service.acceptFinding({
        operationId: "stale-human-accept",
        expectedRevision: harness.service.readLabState().revision,
        findingId: freshFinding.artifactId,
      }),
      "STALE_FINDING",
    );
    expect(harness.service.readLabState().currentFinding).toBeNull();
  });

  it("keeps trusted fingerprints independent of application operation IDs", async () => {
    const first = await createCurrentTinyRuns();
    const firstComparison = await first.service.compareScenarios({
      operationId: "first-operation-id",
      expectedRevision: first.service.readLabState().revision,
      leftRunId: first.runA.artifactId,
      rightRunId: first.runB.artifactId,
    });

    const repository = new StressLabTestRepository();
    const service = new StressLabService(
      repository,
      IMMEDIATE_SIMULATION_EXECUTOR,
      IMMEDIATE_COMPARISON_EXECUTOR,
    );
    await configure(service, first.left, "different-config-a");
    await configure(service, first.right, "different-config-b");
    const runA = await runCurrent(service, "A", "different-run-a");
    const runB = await runCurrent(service, "B", "different-run-b");
    const secondComparison = await service.compareScenarios({
      operationId: "second-operation-id",
      expectedRevision: service.readLabState().revision,
      leftRunId: runA.artifactId,
      rightRunId: runB.artifactId,
    });
    expect({
      inputA: runA.inputFingerprint,
      ledgerA: runA.eventLedgerFingerprint,
      resultA: runA.resultFingerprint,
      inputB: runB.inputFingerprint,
      ledgerB: runB.eventLedgerFingerprint,
      resultB: runB.resultFingerprint,
      comparison: secondComparison.comparisonFingerprint,
    }).toEqual({
      inputA: first.runA.inputFingerprint,
      ledgerA: first.runA.eventLedgerFingerprint,
      resultA: first.runA.resultFingerprint,
      inputB: first.runB.inputFingerprint,
      ledgerB: first.runB.eventLedgerFingerprint,
      resultB: first.runB.resultFingerprint,
      comparison: firstComparison.comparisonFingerprint,
    });
  });

  it("creates disruption revisions and deterministic reset revisions without reusing authority", async () => {
    const repository = new StressLabTestRepository();
    const service = new StressLabService(repository, IMMEDIATE_SIMULATION_EXECUTOR);
    const disrupted = inputForSlot(createTinyTriangleRun(), "A");
    const baseline = prepareStressLabRunInput({
      ...disrupted.input,
      disruptions: [],
    });
    const configured = await configure(service, baseline, "baseline-config");
    const injected = await service.injectDisruption({
      operationId: "inject-failure",
      expectedRevision: service.readLabState().revision,
      scenarioRevisionId: configured.artifactId,
      disruption: disrupted.input.disruptions[0],
    });
    expect(injected.scenarioRevisionRef.revision).toBe(2);
    expect(injected.scenarioRevisionRef.preparedInputFingerprint).toBe(
      disrupted.fingerprint,
    );
    const reset = await service.resetLab({
      operationId: "human-reset",
      expectedRevision: service.readLabState().revision,
    });
    expect(reset.status).toBe("COMPLETED");
    const view = service.readLabState();
    expect(view.scenarios.A?.ref.revision).toBe(3);
    expect(view.scenarios.B?.ref.revision).toBe(1);
    expect(view.scenarios.A?.ref.preparedInputFingerprint).toBe(
      GOLDEN_IDENTITIES.inputA,
    );
    expect(view.scenarios.B?.ref.preparedInputFingerprint).toBe(
      GOLDEN_IDENTITIES.inputB,
    );
    expect(view.currentRuns.A).toBeNull();
    expect(view.currentComparison).toBeNull();
  });
});
