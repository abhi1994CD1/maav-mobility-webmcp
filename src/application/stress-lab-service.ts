import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { createTrustedRunComparison } from "@/domain/stress-lab/comparison";
import { runDeterministicSimulationAsync } from "@/domain/stress-lab/engine";
import { createFindingCandidate } from "@/domain/stress-lab/finding";
import { fingerprintCanonical } from "@/domain/stress-lab/fingerprint";
import {
  isVerifiedRunResultArtifact,
  verifyTrustedSimulationResult,
} from "@/domain/stress-lab/result-verification";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import {
  comparisonId,
  findingId,
  operationId,
  runId,
  scenarioRevisionId,
  StressLabArtifactVerificationError,
  StressLabComparisonError,
  StressLabSimulationCancelledError,
  type DeterministicSimulationResult,
  type EventLedgerEnvelope,
  type FindingEmphasis,
  type FindingSelectedOutcome,
  type Fingerprint,
  type PreparedRunInput,
  type RunResultArtifact,
  type ScenarioSlot,
} from "@/domain/stress-lab/types";
import { OperationCache } from "./operation-cache";
import {
  HUMAN_UI_INVOCATION_CONTEXT,
  StressLabApplicationError,
  WEBMCP_INVOCATION_CONTEXT,
  type AcceptFindingCommand,
  type ApplicationAuditEntry,
  type CancelRunCommand,
  type ChallengeFindingCommand,
  type CompareScenariosCommand,
  type ComparisonMutationResult,
  type ConfigureScenarioCommand,
  type CurrentComparisonRecord,
  type CurrentRunRecord,
  type FindingMutationResult,
  type HumanReviewRecord,
  type InjectDisruptionCommand,
  type MutationResult,
  type OperationProgress,
  type OperationTarget,
  type OperationToken,
  type ResetLabCommand,
  type RunMutationResult,
  type RunScenarioCommand,
  type ScenarioMutationResult,
  type ScenarioRevisionRecord,
  type ScenarioRevisionRef,
  type StageFindingCommand,
  type StagedFindingRecord,
  type StressLabApplicationRepository,
  type StressLabApplicationState,
  type StressLabInvocationContext,
  type StressLabComparisonExecutor,
  type StressLabSimulationExecutor,
  type StressLabStateView,
} from "./stress-lab-ports";

const APPLICATION_COMMAND_SCOPE = "APPLICATION_COMMAND";
const MAX_PUBLICATION_ATTEMPTS = 8;

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

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  target: string,
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      target,
      `${target} must be a plain object.`,
    );
  }
  const actualKeys = Object.keys(value).sort(compareCodeUnits);
  const allowed = new Set(expectedKeys);
  const unexpected = actualKeys.find((key) => !allowed.has(key));
  if (unexpected) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      `${target}.${unexpected}`,
      `Unexpected command property ${unexpected}.`,
    );
  }
  const missing = expectedKeys.find(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missing) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      `${target}.${missing}`,
      `Missing command property ${missing}.`,
    );
  }
}

function assertExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      "expectedRevision",
      "expectedRevision must be a non-negative safe integer.",
    );
  }
}

function assertSlot(value: unknown): asserts value is ScenarioSlot {
  if (value !== "A" && value !== "B") {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      "slot",
      "slot must be A or B.",
    );
  }
}

function assertFindingOutcome(
  value: unknown,
): asserts value is FindingSelectedOutcome {
  if (
    value !== "A" &&
    value !== "B" &&
    value !== "TRADE_OFF" &&
    value !== "INCONCLUSIVE"
  ) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      "selectedOutcome",
      "selectedOutcome must be A, B, TRADE_OFF, or INCONCLUSIVE.",
    );
  }
}

function assertFindingEmphasis(value: unknown): asserts value is FindingEmphasis {
  if (
    value !== "BALANCED" &&
    value !== "SERVICE" &&
    value !== "ENERGY" &&
    value !== "RESILIENCE"
  ) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      "emphasis",
      "emphasis must be BALANCED, SERVICE, ENERGY, or RESILIENCE.",
    );
  }
}

function assertBoundedFeedback(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > 280 ||
    /[<>\u0000-\u001F\u007F]/u.test(value)
  ) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      "feedback",
      "Challenge feedback must be 1–280 plain-text characters.",
    );
  }
  return value.trim();
}

function commandInputFingerprint(
  commandName: string,
  value: Readonly<Record<string, unknown>>,
): Fingerprint {
  return fingerprintCanonical(APPLICATION_COMMAND_SCOPE, {
    commandName,
    ...value,
  });
}

function assertTrustedInvocationContext(
  context: unknown,
): asserts context is StressLabInvocationContext {
  if (
    context !== HUMAN_UI_INVOCATION_CONTEXT &&
    context !== WEBMCP_INVOCATION_CONTEXT
  ) {
    throw new StressLabApplicationError(
      "INVALID_COMMAND",
      "invocationContext",
      "A trusted application invocation context is required.",
    );
  }
}

function assertHumanInvocation(
  context: StressLabInvocationContext,
  commandName: string,
): void {
  if (context.source !== "HUMAN_UI") {
    throw new StressLabApplicationError(
      "HUMAN_AUTHORITY_REQUIRED",
      commandName,
      `${commandName} requires a visible human UI invocation.`,
    );
  }
}

function sameRevisionRef(
  left: ScenarioRevisionRef,
  right: ScenarioRevisionRef,
): boolean {
  return (
    left.slot === right.slot &&
    left.revision === right.revision &&
    left.preparedInputFingerprint === right.preparedInputFingerprint
  );
}

function resultArtifactFrom(
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

function ledgerEnvelopeFrom(
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

const DEFAULT_SIMULATION_EXECUTOR: StressLabSimulationExecutor = {
  async execute(preparedInput, context) {
    const totalTicks =
      preparedInput.input.terminalEvaluationSecond /
        preparedInput.input.horizon.tickSeconds +
      1;
    context.reportProgress(0, totalTicks);
    const result = await runDeterministicSimulationAsync(preparedInput, {
      signal: context.signal,
    });
    context.reportProgress(totalTicks, totalTicks);
    return {
      eventLedger: ledgerEnvelopeFrom(result),
      result: resultArtifactFrom(result),
    };
  },
};

const DEFAULT_COMPARISON_EXECUTOR: StressLabComparisonExecutor = {
  async execute() {
    // Deliberately empty. Tests may defer this scheduling seam, but the service
    // itself always invokes the Gate 5 trust boundary after the wait settles.
  },
};

class PublicationCancellationSignal {
  private locallyAborted = false;
  private abortReasonValue: "CANCELLED" | "SUPERSEDED" | undefined;

  constructor(private readonly externalSignal?: { readonly aborted: boolean }) {}

  get aborted(): boolean {
    return this.locallyAborted || Boolean(this.externalSignal?.aborted);
  }

  get reason(): "CANCELLED" | "SUPERSEDED" | "EXTERNAL" | undefined {
    if (this.abortReasonValue) return this.abortReasonValue;
    return this.externalSignal?.aborted ? "EXTERNAL" : undefined;
  }

  abort(reason: "CANCELLED" | "SUPERSEDED"): void {
    this.locallyAborted = true;
    this.abortReasonValue = reason;
  }
}

export function createInitialStressLabApplicationState(): StressLabApplicationState {
  return deepFreeze({
    revision: 0,
    scenarioRevisionCounters: { A: 0, B: 0 },
    nextRunSequence: 1,
    nextComparisonSequence: 1,
    nextFindingSequence: 1,
    currentScenarioRevisionIds: {},
    scenarioRevisions: {},
    currentRunIds: {},
    runs: {},
    comparisons: {},
    findings: {},
    reviews: {},
    activeOperations: {},
    targetGenerations: {},
    audit: [],
  });
}

function currentScenarioRecord(
  state: StressLabApplicationState,
  slot: ScenarioSlot,
): ScenarioRevisionRecord | undefined {
  const id = state.currentScenarioRevisionIds[slot];
  return id ? state.scenarioRevisions[id] : undefined;
}

function isScenarioRefCurrent(
  state: StressLabApplicationState,
  ref: ScenarioRevisionRef,
): boolean {
  const record = currentScenarioRecord(state, ref.slot);
  return Boolean(record && sameRevisionRef(record.ref, ref));
}

function isRunCurrent(
  state: StressLabApplicationState,
  record: CurrentRunRecord,
): boolean {
  return (
    state.currentRunIds[record.scenarioRevisionRef.slot] === record.id &&
    isScenarioRefCurrent(state, record.scenarioRevisionRef) &&
    record.preparedInput.fingerprint ===
      record.scenarioRevisionRef.preparedInputFingerprint &&
    isVerifiedRunResultArtifact(record.verifiedResult)
  );
}

function isComparisonCurrent(
  state: StressLabApplicationState,
  record: CurrentComparisonRecord,
): boolean {
  const left = state.runs[record.leftRunId];
  const right = state.runs[record.rightRunId];
  return Boolean(
    state.currentComparisonId === record.id &&
      left &&
      right &&
      isRunCurrent(state, left) &&
      isRunCurrent(state, right) &&
      sameRevisionRef(record.scenarioRevisionRefs[0], left.scenarioRevisionRef) &&
      sameRevisionRef(record.scenarioRevisionRefs[1], right.scenarioRevisionRef) &&
      record.artifact.left.resultFingerprint ===
        left.verifiedResult.resultFingerprint &&
      record.artifact.right.resultFingerprint ===
        right.verifiedResult.resultFingerprint
  );
}

function isFindingCurrent(
  state: StressLabApplicationState,
  record: StagedFindingRecord,
): boolean {
  const comparison = state.comparisons[record.comparisonId];
  return Boolean(
    state.currentFindingId === record.id &&
      comparison &&
      isComparisonCurrent(state, comparison) &&
      record.comparisonFingerprint === comparison.artifact.comparisonFingerprint &&
      sameRevisionRef(
        record.scenarioRevisionRefs[0],
        comparison.scenarioRevisionRefs[0],
      ) &&
      sameRevisionRef(
        record.scenarioRevisionRefs[1],
        comparison.scenarioRevisionRefs[1],
      )
  );
}

function scenarioView(
  state: StressLabApplicationState,
  slot: ScenarioSlot,
): StressLabStateView["scenarios"][ScenarioSlot] {
  const record = currentScenarioRecord(state, slot);
  if (!record) return null;
  return {
    id: record.id,
    ref: clonePlain(record.ref),
    label: record.preparedInput.input.scenario.label,
  };
}

function runView(
  state: StressLabApplicationState,
  slot: ScenarioSlot,
): StressLabStateView["currentRuns"][ScenarioSlot] {
  const id = state.currentRunIds[slot];
  const record = id ? state.runs[id] : undefined;
  if (!record) return null;
  return {
    id: record.id,
    isCurrent: isRunCurrent(state, record),
    scenarioRevisionRef: clonePlain(record.scenarioRevisionRef),
    inputFingerprint: record.preparedInput.fingerprint,
    eventLedgerFingerprint: record.verifiedResult.eventLedgerFingerprint,
    resultFingerprint: record.verifiedResult.resultFingerprint,
    metrics: clonePlain(record.verifiedResult.metrics),
    constraints: clonePlain(record.verifiedResult.constraints),
  };
}

function revisionConflict(
  expectedRevision: number,
  currentRevision: number,
): StressLabApplicationError {
  return new StressLabApplicationError(
    "REVISION_CONFLICT",
    "applicationRevision",
    `Expected application revision ${expectedRevision}, but the current revision is ${currentRevision}.`,
    {
      retryable: true,
      expectedRevision,
      currentRevision,
    },
  );
}

function idempotencyConflict(
  operationIdValue: string,
  existingCommandName: string,
  requestedCommandName: string,
): StressLabApplicationError {
  return new StressLabApplicationError(
    "IDEMPOTENCY_CONFLICT",
    operationIdValue,
    `Operation ${operationIdValue} was already used for ${existingCommandName}; it cannot be reused for ${requestedCommandName}.`,
  );
}

export class StressLabService {
  private readonly operationCache: OperationCache;
  private readonly cancellationSignals = new Map<
    string,
    PublicationCancellationSignal
  >();
  private readonly progress = new Map<string, OperationProgress>();
  private readonly viewListeners = new Set<(view: StressLabStateView) => void>();
  private readonly unsubscribeRepository: () => void;

  constructor(
    private readonly repository: StressLabApplicationRepository,
    private readonly simulationExecutor: StressLabSimulationExecutor =
      DEFAULT_SIMULATION_EXECUTOR,
    private readonly comparisonExecutor: StressLabComparisonExecutor =
      DEFAULT_COMPARISON_EXECUTOR,
    operationCache?: OperationCache,
  ) {
    this.operationCache =
      operationCache ?? new OperationCache(idempotencyConflict);
    this.unsubscribeRepository = this.repository.subscribe(() => {
      this.notifyViewListeners();
    });
  }

  dispose(): void {
    this.unsubscribeRepository();
    this.viewListeners.clear();
  }

  subscribe(listener: (view: StressLabStateView) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  readLabState(): StressLabStateView {
    const state = this.repository.getState();
    const currentComparisonRecord = state.currentComparisonId
      ? state.comparisons[state.currentComparisonId]
      : undefined;
    const currentFindingRecord = state.currentFindingId
      ? state.findings[state.currentFindingId]
      : undefined;
    const comparisonView = currentComparisonRecord
      ? {
          id: currentComparisonRecord.id,
          isCurrent: isComparisonCurrent(state, currentComparisonRecord),
          comparisonFingerprint:
            currentComparisonRecord.artifact.comparisonFingerprint,
        }
      : null;
    const findingView = currentFindingRecord
      ? (() => {
          const review = state.reviews[currentFindingRecord.id];
          return {
            id: currentFindingRecord.id,
            isCurrent: isFindingCurrent(state, currentFindingRecord),
            comparisonFingerprint:
              currentFindingRecord.comparisonFingerprint,
            findingFingerprint:
              currentFindingRecord.candidate.findingFingerprint,
            selectedOutcome: currentFindingRecord.candidate.selectedOutcome,
            emphasis: currentFindingRecord.candidate.emphasis,
            claims: clonePlain(currentFindingRecord.candidate.claims),
            caveats: clonePlain(currentFindingRecord.candidate.caveats),
            review: review?.decision ?? "PENDING_REVIEW",
            ...(review?.feedback ? { feedback: review.feedback } : {}),
          };
        })()
      : null;

    return deepFreeze({
      revision: state.revision,
      scenarios: {
        A: scenarioView(state, "A"),
        B: scenarioView(state, "B"),
      },
      currentRuns: {
        A: runView(state, "A"),
        B: runView(state, "B"),
      },
      currentComparison: comparisonView,
      currentFinding: findingView,
      activeOperations: Object.values(state.activeOperations)
        .filter((entry): entry is OperationToken => Boolean(entry))
        .map((entry) => clonePlain(entry))
        .sort((left, right) => compareCodeUnits(left.target, right.target)),
      progress: [...this.progress.values()]
        .map((entry) => clonePlain(entry))
        .sort((left, right) => compareCodeUnits(left.target, right.target)),
      audit: state.audit.map((entry) => clonePlain(entry)),
      historical: {
        runIds: Object.keys(state.runs).sort(compareCodeUnits),
        comparisonIds: Object.keys(state.comparisons).sort(compareCodeUnits),
        findingIds: Object.keys(state.findings).sort(compareCodeUnits),
      },
    });
  }

  private notifyViewListeners(): void {
    if (this.viewListeners.size === 0) return;
    const view = this.readLabState();
    for (const listener of [...this.viewListeners]) listener(view);
  }

  private assertRevision(expectedRevision: number): StressLabApplicationState {
    assertExpectedRevision(expectedRevision);
    const current = this.repository.getState();
    if (current.revision !== expectedRevision) {
      throw revisionConflict(expectedRevision, current.revision);
    }
    return current;
  }

  private appendAudit(
    current: StressLabApplicationState,
    nextRevision: number,
    source: ApplicationAuditEntry["source"],
    inputFingerprint: Fingerprint,
    action: ApplicationAuditEntry["action"],
    operationIdValue: string,
    target: string,
    status: ApplicationAuditEntry["status"],
    artifactIds: readonly string[],
    safeErrorCode?: ApplicationAuditEntry["safeErrorCode"],
  ): readonly ApplicationAuditEntry[] {
    return [
      ...current.audit,
      {
        sequence: current.audit.length + 1,
        source,
        inputFingerprint,
        action,
        operationId: operationIdValue,
        target,
        priorRevision: current.revision,
        resultingRevision: nextRevision,
        status,
        artifactIds: [...artifactIds],
        ...(safeErrorCode ? { safeErrorCode } : {}),
      },
    ];
  }

  private commitExpected(
    expectedRevision: number,
    audit: {
      readonly source: ApplicationAuditEntry["source"];
      readonly inputFingerprint: Fingerprint;
      readonly action: ApplicationAuditEntry["action"];
      readonly operationId: string;
      readonly target: string;
      readonly status: ApplicationAuditEntry["status"];
      readonly artifactIds: readonly string[];
      readonly safeErrorCode?: ApplicationAuditEntry["safeErrorCode"];
    },
    transition: (
      current: StressLabApplicationState,
      nextRevision: number,
    ) => StressLabApplicationState,
  ): StressLabApplicationState {
    const current = this.assertRevision(expectedRevision);
    const nextRevision = current.revision + 1;
    const candidate = transition(current, nextRevision);
    const next = deepFreeze({
      ...candidate,
      revision: nextRevision,
      audit: this.appendAudit(
        current,
        nextRevision,
        audit.source,
        audit.inputFingerprint,
        audit.action,
        audit.operationId,
        audit.target,
        audit.status,
        audit.artifactIds,
        audit.safeErrorCode,
      ),
    });
    if (!this.repository.compareAndSwap(current.revision, next)) {
      throw revisionConflict(
        expectedRevision,
        this.repository.getState().revision,
      );
    }
    return next;
  }

  private assertTokenCurrent(
    state: StressLabApplicationState,
    token: OperationToken,
  ): void {
    const active = state.activeOperations[token.target];
    if (
      !active ||
      active.operationId !== token.operationId ||
      active.generation !== token.generation ||
      state.targetGenerations[token.target] !== token.generation
    ) {
      throw new StressLabApplicationError(
        "STALE_OPERATION",
        token.target,
        `Operation ${token.operationId} no longer owns ${token.target}.`,
        { retryable: true },
      );
    }
    for (const ref of token.capturedScenarioRevisions) {
      if (!isScenarioRefCurrent(state, ref)) {
        const current = currentScenarioRecord(state, ref.slot);
        throw new StressLabApplicationError(
          "STALE_SCENARIO_REVISION",
          ref.slot,
          `Scenario ${ref.slot} changed while ${token.operationId} was running.`,
          {
            retryable: true,
            expectedRevision: ref.revision,
            currentRevision: current?.ref.revision,
            expectedFingerprint: ref.preparedInputFingerprint,
            currentFingerprint: current?.ref.preparedInputFingerprint,
          },
        );
      }
    }
  }

  private commitOperationTerminal(
    token: OperationToken,
    audit: {
      readonly action: ApplicationAuditEntry["action"];
      readonly status: ApplicationAuditEntry["status"];
      readonly artifactIds: readonly string[];
      readonly safeErrorCode?: ApplicationAuditEntry["safeErrorCode"];
    },
    transition: (
      current: StressLabApplicationState,
      nextRevision: number,
    ) => StressLabApplicationState,
  ): StressLabApplicationState {
    for (let attempt = 0; attempt < MAX_PUBLICATION_ATTEMPTS; attempt += 1) {
      const current = this.repository.getState();
      this.assertTokenCurrent(current, token);
      const nextRevision = current.revision + 1;
      const candidate = transition(current, nextRevision);
      const next = deepFreeze({
        ...candidate,
        revision: nextRevision,
        audit: this.appendAudit(
          current,
          nextRevision,
          token.source,
          token.inputFingerprint,
          audit.action,
          token.operationId,
          token.target,
          audit.status,
          audit.artifactIds,
          audit.safeErrorCode,
        ),
      });
      if (this.repository.compareAndSwap(current.revision, next)) return next;
    }
    throw new StressLabApplicationError(
      "STALE_OPERATION",
      token.target,
      "The operation could not enter a stable serialized publication boundary.",
      { retryable: true },
    );
  }

  private bumpGeneration(
    state: StressLabApplicationState,
    target: OperationTarget,
  ): number {
    return (state.targetGenerations[target] ?? 0) + 1;
  }

  private abortOperation(
    operationIdValue: string | undefined,
    reason: "CANCELLED" | "SUPERSEDED",
  ): void {
    if (!operationIdValue) return;
    this.cancellationSignals.get(operationIdValue)?.abort(reason);
    this.progress.delete(operationIdValue);
  }

  private reportProgress(
    token: OperationToken,
    completedUnits: number,
    totalUnits: number,
  ): boolean {
    if (
      !Number.isSafeInteger(completedUnits) ||
      !Number.isSafeInteger(totalUnits) ||
      totalUnits < 1 ||
      completedUnits < 0 ||
      completedUnits > totalUnits
    ) {
      throw new StressLabApplicationError(
        "INVALID_COMMAND",
        "operationProgress",
        "Progress must use bounded safe-integer units.",
      );
    }
    const state = this.repository.getState();
    const active = state.activeOperations[token.target];
    if (
      !active ||
      active.operationId !== token.operationId ||
      active.generation !== token.generation
    ) {
      return false;
    }
    this.progress.set(
      token.operationId,
      deepFreeze({
        operationId: token.operationId,
        target: token.target,
        completedUnits,
        totalUnits,
      }),
    );
    this.notifyViewListeners();
    return true;
  }

  private requireCurrentScenarioById(
    state: StressLabApplicationState,
    scenarioRevisionIdValue: string,
  ): ScenarioRevisionRecord {
    const record = state.scenarioRevisions[scenarioRevisionIdValue];
    if (!record) {
      throw new StressLabApplicationError(
        "UNKNOWN_SCENARIO_REVISION",
        scenarioRevisionIdValue,
        `Scenario revision ${scenarioRevisionIdValue} does not exist.`,
      );
    }
    if (state.currentScenarioRevisionIds[record.ref.slot] !== record.id) {
      const current = currentScenarioRecord(state, record.ref.slot);
      throw new StressLabApplicationError(
        "STALE_SCENARIO_REVISION",
        scenarioRevisionIdValue,
        `Scenario revision ${scenarioRevisionIdValue} is historical, not current.`,
        {
          retryable: true,
          expectedRevision: record.ref.revision,
          currentRevision: current?.ref.revision,
          expectedFingerprint: record.ref.preparedInputFingerprint,
          currentFingerprint: current?.ref.preparedInputFingerprint,
        },
      );
    }
    return record;
  }

  private operation<Result>(
    operationIdValue: string,
    commandName: string,
    source: ApplicationAuditEntry["source"],
    inputFingerprint: Fingerprint,
    action: () => Promise<Result> | Result,
  ): Promise<Result> {
    operationId(operationIdValue);
    return this.operationCache.execute(
      {
        operationId: operationIdValue,
        commandName,
        source,
        inputFingerprint,
      },
      action,
    );
  }

  private scenarioTransition(
    current: StressLabApplicationState,
    nextRevision: number,
    slot: ScenarioSlot,
    preparedInput: PreparedRunInput,
  ): {
    readonly state: StressLabApplicationState;
    readonly record: ScenarioRevisionRecord;
    readonly supersededOperationIds: readonly string[];
  } {
    const scenarioRevision = current.scenarioRevisionCounters[slot] + 1;
    const id = scenarioRevisionId(`scenario-${slot}-r${scenarioRevision}`);
    const ref = deepFreeze({
      slot,
      revision: scenarioRevision,
      preparedInputFingerprint: preparedInput.fingerprint,
    });
    const record = deepFreeze({
      id,
      ref,
      preparedInput,
      createdAtApplicationRevision: nextRevision,
    });
    const runTarget = `RUN:${slot}` as const;
    const supersededOperationIds = [
      current.activeOperations[runTarget]?.operationId,
      current.activeOperations.COMPARISON?.operationId,
    ].filter((value): value is string => Boolean(value));
    const activeOperations = { ...current.activeOperations };
    delete activeOperations[runTarget];
    delete activeOperations.COMPARISON;
    const currentRunIds = { ...current.currentRunIds };
    delete currentRunIds[slot];
    const state = deepFreeze({
      ...current,
      scenarioRevisionCounters: {
        ...current.scenarioRevisionCounters,
        [slot]: scenarioRevision,
      },
      currentScenarioRevisionIds: {
        ...current.currentScenarioRevisionIds,
        [slot]: id,
      },
      scenarioRevisions: {
        ...current.scenarioRevisions,
        [id]: record,
      },
      currentRunIds,
      currentComparisonId: undefined,
      currentFindingId: undefined,
      activeOperations,
      targetGenerations: {
        ...current.targetGenerations,
        [runTarget]: this.bumpGeneration(current, runTarget),
        COMPARISON: this.bumpGeneration(current, "COMPARISON"),
      },
    });
    return { state, record, supersededOperationIds };
  }

  configureScenario(
    command: ConfigureScenarioCommand,
    context: StressLabInvocationContext,
  ): Promise<ScenarioMutationResult> {
    assertTrustedInvocationContext(context);
    assertPlainExactKeys(
      command,
      ["operationId", "expectedRevision", "slot", "input"],
      "configureScenario",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    assertSlot(command.slot);
    const preparedInput = prepareStressLabRunInput(command.input);
    if (preparedInput.input.scenarioSlot !== command.slot) {
      throw new StressLabApplicationError(
        "INVALID_COMMAND",
        "input.scenarioSlot",
        "The prepared input slot must match the configured application slot.",
      );
    }
    const inputFingerprint = commandInputFingerprint("configureScenario", {
      expectedRevision: command.expectedRevision,
      slot: command.slot,
      preparedInputFingerprint: preparedInput.fingerprint,
    });
    return this.operation(
      command.operationId,
      "configureScenario",
      context.source,
      inputFingerprint,
      () => {
        const before = this.assertRevision(command.expectedRevision);
        const anticipatedArtifactId = scenarioRevisionId(
          `scenario-${command.slot}-r${before.scenarioRevisionCounters[command.slot] + 1}`,
        );
        let transitionResult:
          | ReturnType<StressLabService["scenarioTransition"]>
          | undefined;
        const next = this.commitExpected(
          command.expectedRevision,
          {
            source: context.source,
            inputFingerprint,
            action: "SCENARIO_CONFIGURED",
            operationId: command.operationId,
            target: `SCENARIO:${command.slot}`,
            status: "COMPLETED",
            artifactIds: [anticipatedArtifactId],
          },
          (current, nextRevision) => {
            transitionResult = this.scenarioTransition(
              current,
              nextRevision,
              command.slot,
              preparedInput,
            );
            return transitionResult.state;
          },
        );
        if (!transitionResult) {
          throw new StressLabApplicationError(
            "INVALID_STATE_TRANSITION",
            command.slot,
            "Scenario revision was not constructed.",
          );
        }
        for (const superseded of transitionResult.supersededOperationIds) {
          this.abortOperation(superseded, "SUPERSEDED");
        }
        return deepFreeze({
          operationId: command.operationId,
          stateRevision: next.revision,
          status: "COMPLETED" as const,
          artifactId: transitionResult.record.id,
          scenarioRevisionRef: clonePlain(transitionResult.record.ref),
        });
      },
    );
  }

  injectDisruption(
    command: InjectDisruptionCommand,
    context: StressLabInvocationContext,
  ): Promise<ScenarioMutationResult> {
    assertTrustedInvocationContext(context);
    assertPlainExactKeys(
      command,
      [
        "operationId",
        "expectedRevision",
        "scenarioRevisionId",
        "disruption",
      ],
      "injectDisruption",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    scenarioRevisionId(command.scenarioRevisionId);
    const inputFingerprint = commandInputFingerprint("injectDisruption", {
      expectedRevision: command.expectedRevision,
      scenarioRevisionId: command.scenarioRevisionId,
      disruption: command.disruption,
    });
    return this.operation(
      command.operationId,
      "injectDisruption",
      context.source,
      inputFingerprint,
      () => {
        const before = this.assertRevision(command.expectedRevision);
        const existingBefore = this.requireCurrentScenarioById(
          before,
          command.scenarioRevisionId,
        );
        const anticipatedArtifactId = scenarioRevisionId(
          `scenario-${existingBefore.ref.slot}-r${before.scenarioRevisionCounters[existingBefore.ref.slot] + 1}`,
        );
        let transitionResult:
          | ReturnType<StressLabService["scenarioTransition"]>
          | undefined;
        const next = this.commitExpected(
          command.expectedRevision,
          {
            source: context.source,
            inputFingerprint,
            action: "DISRUPTION_INJECTED",
            operationId: command.operationId,
            target: command.scenarioRevisionId,
            status: "COMPLETED",
            artifactIds: [anticipatedArtifactId],
          },
          (current, nextRevision) => {
            const existing = this.requireCurrentScenarioById(
              current,
              command.scenarioRevisionId,
            );
            const prepared = prepareStressLabRunInput({
              ...existing.preparedInput.input,
              disruptions: [
                ...existing.preparedInput.input.disruptions,
                command.disruption,
              ],
            });
            transitionResult = this.scenarioTransition(
              current,
              nextRevision,
              existing.ref.slot,
              prepared,
            );
            return transitionResult.state;
          },
        );
        if (!transitionResult) {
          throw new StressLabApplicationError(
            "INVALID_STATE_TRANSITION",
            command.scenarioRevisionId,
            "Disrupted scenario revision was not constructed.",
          );
        }
        for (const superseded of transitionResult.supersededOperationIds) {
          this.abortOperation(superseded, "SUPERSEDED");
        }
        return deepFreeze({
          operationId: command.operationId,
          stateRevision: next.revision,
          status: "COMPLETED" as const,
          artifactId: transitionResult.record.id,
          scenarioRevisionRef: clonePlain(transitionResult.record.ref),
        });
      },
    );
  }

  runScenario(
    command: RunScenarioCommand,
    context: StressLabInvocationContext,
    externalSignal?: { readonly aborted: boolean },
  ): Promise<RunMutationResult> {
    assertTrustedInvocationContext(context);
    assertPlainExactKeys(
      command,
      ["operationId", "expectedRevision", "scenarioRevisionId"],
      "runScenario",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    scenarioRevisionId(command.scenarioRevisionId);
    const inputFingerprint = commandInputFingerprint("runScenario", {
      expectedRevision: command.expectedRevision,
      scenarioRevisionId: command.scenarioRevisionId,
    });
    return this.operation(
      command.operationId,
      "runScenario",
      context.source,
      inputFingerprint,
      () => this.executeRun(command, context, inputFingerprint, externalSignal),
    );
  }

  private async executeRun(
    command: RunScenarioCommand,
    context: StressLabInvocationContext,
    inputFingerprint: Fingerprint,
    externalSignal?: { readonly aborted: boolean },
  ): Promise<RunMutationResult> {
    const current = this.assertRevision(command.expectedRevision);
    const scenario = this.requireCurrentScenarioById(
      current,
      command.scenarioRevisionId,
    );
    const target = `RUN:${scenario.ref.slot}` as const;
    const generation = this.bumpGeneration(current, target);
    const artifactId = runId(`run-${scenario.ref.slot}-${current.nextRunSequence}`);
    const token = deepFreeze({
      operationId: command.operationId,
      source: context.source,
      inputFingerprint,
      target,
      generation,
      capturedScenarioRevisions: [clonePlain(scenario.ref)],
      artifactId,
    });
    const signal = new PublicationCancellationSignal(externalSignal);
    const supersededOperationId = current.activeOperations[target]?.operationId;
    this.cancellationSignals.set(command.operationId, signal);
    this.progress.set(
      command.operationId,
      deepFreeze({
        operationId: command.operationId,
        target,
        completedUnits: 0,
        totalUnits:
          scenario.preparedInput.input.terminalEvaluationSecond /
            scenario.preparedInput.input.horizon.tickSeconds +
          1,
      }),
    );
    try {
      this.commitExpected(
        command.expectedRevision,
        {
          source: context.source,
          inputFingerprint,
          action: "RUN_STARTED",
          operationId: command.operationId,
          target,
          status: "RUNNING",
          artifactIds: [artifactId],
        },
        (state) => ({
          ...state,
          nextRunSequence: state.nextRunSequence + 1,
          activeOperations: {
            ...state.activeOperations,
            [target]: token,
          },
          targetGenerations: {
            ...state.targetGenerations,
            [target]: generation,
          },
        }),
      );
    } catch (error) {
      this.cancellationSignals.delete(command.operationId);
      this.progress.delete(command.operationId);
      throw error;
    }
    this.abortOperation(supersededOperationId, "SUPERSEDED");

    try {
      if (signal.aborted) throw new StressLabSimulationCancelledError();
      const computed = await this.simulationExecutor.execute(
        scenario.preparedInput,
        {
          signal,
          reportProgress: (completedUnits, totalUnits) =>
            this.reportProgress(token, completedUnits, totalUnits),
        },
      );
      if (signal.aborted) throw new StressLabSimulationCancelledError();
      const verifiedResult = verifyTrustedSimulationResult(
        scenario.preparedInput,
        computed.eventLedger,
        computed.result,
      );
      if (signal.aborted) throw new StressLabSimulationCancelledError();
      this.progress.delete(command.operationId);
      const next = this.commitOperationTerminal(
        token,
        {
          action: "RUN_PUBLISHED",
          status: "COMPLETED",
          artifactIds: [artifactId],
        },
        (state, nextRevision) => {
          const activeScenario = this.requireCurrentScenarioById(
            state,
            command.scenarioRevisionId,
          );
          if (
            activeScenario.preparedInput.fingerprint !==
            scenario.ref.preparedInputFingerprint
          ) {
            throw new StressLabApplicationError(
              "STALE_SCENARIO_REVISION",
              command.scenarioRevisionId,
              "The scenario input fingerprint changed before publication.",
              {
                retryable: true,
                expectedFingerprint: scenario.ref.preparedInputFingerprint,
                currentFingerprint: activeScenario.preparedInput.fingerprint,
              },
            );
          }
          const record: CurrentRunRecord = deepFreeze({
            id: artifactId,
            scenarioRevisionId: scenario.id,
            scenarioRevisionRef: clonePlain(scenario.ref),
            preparedInput: scenario.preparedInput,
            eventLedger: computed.eventLedger,
            verifiedResult,
            publishedAtApplicationRevision: nextRevision,
          });
          const activeOperations = { ...state.activeOperations };
          delete activeOperations[target];
          return {
            ...state,
            runs: { ...state.runs, [artifactId]: record },
            currentRunIds: {
              ...state.currentRunIds,
              [scenario.ref.slot]: artifactId,
            },
            currentComparisonId: undefined,
            currentFindingId: undefined,
            activeOperations,
          };
        },
      );
      this.cancellationSignals.delete(command.operationId);
      return deepFreeze({
        operationId: command.operationId,
        stateRevision: next.revision,
        status: "PUBLISHED" as const,
        artifactId,
        inputFingerprint: scenario.preparedInput.fingerprint,
        eventLedgerFingerprint: verifiedResult.eventLedgerFingerprint,
        resultFingerprint: verifiedResult.resultFingerprint,
      });
    } catch (error) {
      return this.failRun(token, signal, error);
    } finally {
      this.progress.delete(command.operationId);
      this.cancellationSignals.delete(command.operationId);
    }
  }

  private failRun(
    token: OperationToken,
    signal: PublicationCancellationSignal,
    error: unknown,
  ): never {
    const current = this.repository.getState();
    const active = current.activeOperations[token.target];
    const tokenStillOwns =
      active?.operationId === token.operationId &&
      active.generation === token.generation;
    const cancelled =
      signal.aborted || error instanceof StressLabSimulationCancelledError;

    if (!tokenStillOwns) {
      if (signal.reason === "CANCELLED" || signal.reason === "EXTERNAL") {
        throw new StressLabApplicationError(
          "OPERATION_CANCELLED",
          token.operationId,
          `Operation ${token.operationId} was cancelled before publication.`,
          { retryable: true },
        );
      }
      throw new StressLabApplicationError(
        "STALE_OPERATION",
        token.target,
        `Operation ${token.operationId} lost publication authority.`,
        { retryable: true },
      );
    }

    this.commitOperationTerminal(
      token,
      {
        action: cancelled ? "RUN_CANCELLED" : "RUN_FAILED",
        status: cancelled ? "CANCELLED" : "FAILED",
        artifactIds: [token.artifactId],
        safeErrorCode: cancelled
          ? "OPERATION_CANCELLED"
          : error instanceof StressLabArtifactVerificationError
            ? "UNVERIFIED_RESULT"
            : "SIMULATION_FAILED",
      },
      (state) => {
        const nextActive = { ...state.activeOperations };
        delete nextActive[token.target];
        return { ...state, activeOperations: nextActive };
      },
    );
    if (cancelled) {
      throw new StressLabApplicationError(
        "OPERATION_CANCELLED",
        token.operationId,
        `Operation ${token.operationId} was cancelled before publication.`,
        { retryable: true },
      );
    }
    if (error instanceof StressLabArtifactVerificationError) {
      throw new StressLabApplicationError(
        "UNVERIFIED_RESULT",
        token.artifactId,
        "The simulation result failed the trusted Gate 4 verification boundary.",
      );
    }
    throw new StressLabApplicationError(
      "SIMULATION_FAILED",
      token.artifactId,
      "The deterministic simulation did not produce a publishable result.",
      { retryable: true },
    );
  }

  cancelRun(
    command: CancelRunCommand,
    context: StressLabInvocationContext,
  ): Promise<MutationResult> {
    assertTrustedInvocationContext(context);
    assertPlainExactKeys(
      command,
      [
        "operationId",
        "expectedRevision",
        "slot",
        "targetOperationId",
      ],
      "cancelRun",
    );
    operationId(command.operationId);
    operationId(command.targetOperationId);
    assertExpectedRevision(command.expectedRevision);
    assertSlot(command.slot);
    const inputFingerprint = commandInputFingerprint("cancelRun", {
      expectedRevision: command.expectedRevision,
      slot: command.slot,
      targetOperationId: command.targetOperationId,
    });
    return this.operation(
      command.operationId,
      "cancelRun",
      context.source,
      inputFingerprint,
      () => {
        const target = `RUN:${command.slot}` as const;
        const next = this.commitExpected(
          command.expectedRevision,
          {
            source: context.source,
            inputFingerprint,
            action: "RUN_CANCELLED",
            operationId: command.operationId,
            target: `${target}:${command.targetOperationId}`,
            status: "CANCELLED",
            artifactIds: [],
            safeErrorCode: "OPERATION_CANCELLED",
          },
          (current) => {
            const active = current.activeOperations[target];
            if (!active || active.operationId !== command.targetOperationId) {
              throw new StressLabApplicationError(
                "INVALID_STATE_TRANSITION",
                target,
                `Run operation ${command.targetOperationId} is not active for Scenario ${command.slot}.`,
              );
            }
            const activeOperations = { ...current.activeOperations };
            delete activeOperations[target];
            return {
              ...current,
              activeOperations,
              targetGenerations: {
                ...current.targetGenerations,
                [target]: this.bumpGeneration(current, target),
              },
            };
          },
        );
        this.abortOperation(command.targetOperationId, "CANCELLED");
        return deepFreeze({
          operationId: command.operationId,
          stateRevision: next.revision,
          status: "CANCELLED" as const,
        });
      },
    );
  }

  private requireCurrentRunById(
    state: StressLabApplicationState,
    runIdValue: string,
  ): CurrentRunRecord {
    const record = state.runs[runIdValue];
    if (!record) {
      throw new StressLabApplicationError(
        "UNKNOWN_RUN",
        runIdValue,
        `Run ${runIdValue} does not exist.`,
      );
    }
    if (!isRunCurrent(state, record)) {
      throw new StressLabApplicationError(
        "STALE_RUN",
        runIdValue,
        `Run ${runIdValue} is historical, not current.`,
        { retryable: true },
      );
    }
    return record;
  }

  compareScenarios(
    command: CompareScenariosCommand,
    context: StressLabInvocationContext,
  ): Promise<ComparisonMutationResult> {
    assertTrustedInvocationContext(context);
    assertPlainExactKeys(
      command,
      ["operationId", "expectedRevision", "leftRunId", "rightRunId"],
      "compareScenarios",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    runId(command.leftRunId);
    runId(command.rightRunId);
    const inputFingerprint = commandInputFingerprint("compareScenarios", {
      expectedRevision: command.expectedRevision,
      leftRunId: command.leftRunId,
      rightRunId: command.rightRunId,
    });
    return this.operation(
      command.operationId,
      "compareScenarios",
      context.source,
      inputFingerprint,
      () => this.executeComparison(command, context, inputFingerprint),
    );
  }

  private async executeComparison(
    command: CompareScenariosCommand,
    context: StressLabInvocationContext,
    inputFingerprint: Fingerprint,
  ): Promise<ComparisonMutationResult> {
    const current = this.assertRevision(command.expectedRevision);
    const left = this.requireCurrentRunById(current, command.leftRunId);
    const right = this.requireCurrentRunById(current, command.rightRunId);
    const target = "COMPARISON" as const;
    const generation = this.bumpGeneration(current, target);
    const artifactId = comparisonId(
      `comparison-${current.nextComparisonSequence}`,
    );
    const token = deepFreeze({
      operationId: command.operationId,
      source: context.source,
      inputFingerprint,
      target,
      generation,
      capturedScenarioRevisions: [
        clonePlain(left.scenarioRevisionRef),
        clonePlain(right.scenarioRevisionRef),
      ],
      artifactId,
    });
    this.commitExpected(
      command.expectedRevision,
      {
        source: context.source,
        inputFingerprint,
        action: "COMPARISON_STARTED",
        operationId: command.operationId,
        target,
        status: "RUNNING",
        artifactIds: [artifactId],
      },
      (state) => ({
        ...state,
        nextComparisonSequence: state.nextComparisonSequence + 1,
        activeOperations: {
          ...state.activeOperations,
          COMPARISON: token,
        },
        targetGenerations: {
          ...state.targetGenerations,
          COMPARISON: generation,
        },
      }),
    );

    try {
      await this.comparisonExecutor.execute(
        {
          preparedInput: left.preparedInput,
          verifiedResult: left.verifiedResult,
        },
        {
          preparedInput: right.preparedInput,
          verifiedResult: right.verifiedResult,
        },
      );
      const artifact = createTrustedRunComparison(
        {
          preparedInput: left.preparedInput,
          verifiedResult: left.verifiedResult,
        },
        {
          preparedInput: right.preparedInput,
          verifiedResult: right.verifiedResult,
        },
      );
      const next = this.commitOperationTerminal(
        token,
        {
          action: "COMPARISON_PUBLISHED",
          status: "COMPLETED",
          artifactIds: [artifactId],
        },
        (state, nextRevision) => {
          const currentLeft = this.requireCurrentRunById(
            state,
            command.leftRunId,
          );
          const currentRight = this.requireCurrentRunById(
            state,
            command.rightRunId,
          );
          if (
            currentLeft.verifiedResult !== left.verifiedResult ||
            currentRight.verifiedResult !== right.verifiedResult
          ) {
            throw new StressLabApplicationError(
              "STALE_RUN",
              artifactId,
              "A comparison operand was replaced before publication.",
              { retryable: true },
            );
          }
          const record: CurrentComparisonRecord = deepFreeze({
            id: artifactId,
            leftRunId: currentLeft.id,
            rightRunId: currentRight.id,
            scenarioRevisionRefs: [
              clonePlain(currentLeft.scenarioRevisionRef),
              clonePlain(currentRight.scenarioRevisionRef),
            ],
            artifact,
            publishedAtApplicationRevision: nextRevision,
          });
          const activeOperations = { ...state.activeOperations };
          delete activeOperations.COMPARISON;
          return {
            ...state,
            comparisons: {
              ...state.comparisons,
              [artifactId]: record,
            },
            currentComparisonId: artifactId,
            currentFindingId: undefined,
            activeOperations,
          };
        },
      );
      return deepFreeze({
        operationId: command.operationId,
        stateRevision: next.revision,
        status: "PUBLISHED" as const,
        artifactId,
        comparisonFingerprint: artifact.comparisonFingerprint,
      });
    } catch (error) {
      const latest = this.repository.getState();
      const active = latest.activeOperations.COMPARISON;
      if (
        !active ||
        active.operationId !== token.operationId ||
        active.generation !== token.generation
      ) {
        throw new StressLabApplicationError(
          "STALE_OPERATION",
          target,
          `Comparison operation ${token.operationId} lost publication authority.`,
          { retryable: true },
        );
      }
      this.commitOperationTerminal(
        token,
        {
          action: "COMPARISON_FAILED",
          status: "FAILED",
          artifactIds: [artifactId],
          safeErrorCode:
            error instanceof StressLabComparisonError
              ? "INCOMPARABLE_RUNS"
              : "INVALID_STATE_TRANSITION",
        },
        (state) => {
          const activeOperations = { ...state.activeOperations };
          delete activeOperations.COMPARISON;
          return { ...state, activeOperations };
        },
      );
      if (error instanceof StressLabComparisonError) throw error;
      if (error instanceof StressLabApplicationError) throw error;
      throw new StressLabApplicationError(
        "INVALID_STATE_TRANSITION",
        artifactId,
        "The comparison did not produce a publishable trusted artifact.",
      );
    }
  }

  private requireCurrentComparisonById(
    state: StressLabApplicationState,
    comparisonIdValue: string,
  ): CurrentComparisonRecord {
    const record = state.comparisons[comparisonIdValue];
    if (!record) {
      throw new StressLabApplicationError(
        "UNKNOWN_COMPARISON",
        comparisonIdValue,
        `Comparison ${comparisonIdValue} does not exist.`,
      );
    }
    if (!isComparisonCurrent(state, record)) {
      throw new StressLabApplicationError(
        "STALE_COMPARISON",
        comparisonIdValue,
        `Comparison ${comparisonIdValue} is historical, not current.`,
        { retryable: true },
      );
    }
    return record;
  }

  stageFinding(
    command: StageFindingCommand,
    context: StressLabInvocationContext,
  ): Promise<FindingMutationResult> {
    assertTrustedInvocationContext(context);
    assertPlainExactKeys(
      command,
      [
        "operationId",
        "expectedRevision",
        "comparisonId",
        "selectedOutcome",
        "emphasis",
      ],
      "stageFinding",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    comparisonId(command.comparisonId);
    assertFindingOutcome(command.selectedOutcome);
    assertFindingEmphasis(command.emphasis);
    const inputFingerprint = commandInputFingerprint("stageFinding", {
      expectedRevision: command.expectedRevision,
      comparisonId: command.comparisonId,
      selectedOutcome: command.selectedOutcome,
      emphasis: command.emphasis,
    });
    return this.operation(
      command.operationId,
      "stageFinding",
      context.source,
      inputFingerprint,
      () => {
        const before = this.assertRevision(command.expectedRevision);
        const anticipatedArtifactId = findingId(
          `finding-${before.nextFindingSequence}`,
        );
        let record: StagedFindingRecord | undefined;
        const next = this.commitExpected(
          command.expectedRevision,
          {
            source: context.source,
            inputFingerprint,
            action: "FINDING_STAGED",
            operationId: command.operationId,
            target: command.comparisonId,
            status: "COMPLETED",
            artifactIds: [anticipatedArtifactId],
          },
          (current, nextRevision) => {
            const comparison = this.requireCurrentComparisonById(
              current,
              command.comparisonId,
            );
            const candidate = createFindingCandidate({
              comparison: comparison.artifact,
              selectedOutcome: command.selectedOutcome,
              emphasis: command.emphasis,
            });
            const id = findingId(`finding-${current.nextFindingSequence}`);
            record = deepFreeze({
              id,
              comparisonId: comparison.id,
              comparisonFingerprint: comparison.artifact.comparisonFingerprint,
              scenarioRevisionRefs: [
                clonePlain(comparison.scenarioRevisionRefs[0]),
                clonePlain(comparison.scenarioRevisionRefs[1]),
              ],
              runIdentities: [
                {
                  inputFingerprint: comparison.artifact.left.inputFingerprint,
                  eventLedgerFingerprint:
                    comparison.artifact.left.eventLedgerFingerprint,
                  resultFingerprint: comparison.artifact.left.resultFingerprint,
                },
                {
                  inputFingerprint: comparison.artifact.right.inputFingerprint,
                  eventLedgerFingerprint:
                    comparison.artifact.right.eventLedgerFingerprint,
                  resultFingerprint:
                    comparison.artifact.right.resultFingerprint,
                },
              ],
              candidate,
              stagedAtApplicationRevision: nextRevision,
            });
            return {
              ...current,
              nextFindingSequence: current.nextFindingSequence + 1,
              findings: { ...current.findings, [id]: record },
              reviews: {
                ...current.reviews,
                [id]: deepFreeze({
                  findingId: id,
                  decision: "PENDING_REVIEW" as const,
                }),
              },
              currentFindingId: id,
            };
          },
        );
        if (!record) {
          throw new StressLabApplicationError(
            "INVALID_STATE_TRANSITION",
            command.comparisonId,
            "The finding evidence was not staged.",
          );
        }
        return deepFreeze({
          operationId: command.operationId,
          stateRevision: next.revision,
          status: "COMPLETED" as const,
          artifactId: record.id,
          comparisonFingerprint: record.comparisonFingerprint,
          findingFingerprint: record.candidate.findingFingerprint,
          selectedOutcome: record.candidate.selectedOutcome,
          emphasis: record.candidate.emphasis,
          claims: clonePlain(record.candidate.claims),
          caveats: clonePlain(record.candidate.caveats),
        });
      },
    );
  }

  private requireCurrentFindingById(
    state: StressLabApplicationState,
    findingIdValue: string,
  ): StagedFindingRecord {
    const record = state.findings[findingIdValue];
    if (!record) {
      throw new StressLabApplicationError(
        "UNKNOWN_FINDING",
        findingIdValue,
        `Finding ${findingIdValue} does not exist.`,
      );
    }
    if (!isFindingCurrent(state, record)) {
      throw new StressLabApplicationError(
        "STALE_FINDING",
        findingIdValue,
        `Finding ${findingIdValue} is historical, not current.`,
        { retryable: true },
      );
    }
    const review = state.reviews[findingIdValue];
    if (!review || review.decision !== "PENDING_REVIEW") {
      throw new StressLabApplicationError(
        "INVALID_STATE_TRANSITION",
        findingIdValue,
        `Finding ${findingIdValue} is no longer pending human review.`,
      );
    }
    return record;
  }

  acceptFinding(
    command: AcceptFindingCommand,
    context: StressLabInvocationContext,
  ): Promise<MutationResult> {
    assertTrustedInvocationContext(context);
    assertHumanInvocation(context, "acceptFinding");
    assertPlainExactKeys(
      command,
      ["operationId", "expectedRevision", "findingId"],
      "acceptFinding",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    findingId(command.findingId);
    const inputFingerprint = commandInputFingerprint("acceptFinding", {
      expectedRevision: command.expectedRevision,
      findingId: command.findingId,
    });
    return this.operation(
      command.operationId,
      "acceptFinding",
      context.source,
      inputFingerprint,
      () => this.reviewFinding(command, context, inputFingerprint, "ACCEPTED"),
    );
  }

  challengeFinding(
    command: ChallengeFindingCommand,
    context: StressLabInvocationContext,
  ): Promise<MutationResult> {
    assertTrustedInvocationContext(context);
    assertHumanInvocation(context, "challengeFinding");
    assertPlainExactKeys(
      command,
      ["operationId", "expectedRevision", "findingId", "feedback"],
      "challengeFinding",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    findingId(command.findingId);
    const feedback = assertBoundedFeedback(command.feedback);
    const inputFingerprint = commandInputFingerprint("challengeFinding", {
      expectedRevision: command.expectedRevision,
      findingId: command.findingId,
      feedback,
    });
    return this.operation(
      command.operationId,
      "challengeFinding",
      context.source,
      inputFingerprint,
      () =>
        this.reviewFinding(
          command,
          context,
          inputFingerprint,
          "CHALLENGED",
          feedback,
        ),
    );
  }

  private reviewFinding(
    command: AcceptFindingCommand | ChallengeFindingCommand,
    context: StressLabInvocationContext,
    inputFingerprint: Fingerprint,
    decision: "ACCEPTED" | "CHALLENGED",
    feedback?: string,
  ): MutationResult {
    const next = this.commitExpected(
      command.expectedRevision,
      {
        source: context.source,
        inputFingerprint,
        action:
          decision === "ACCEPTED"
            ? "FINDING_ACCEPTED"
            : "FINDING_CHALLENGED",
        operationId: command.operationId,
        target: command.findingId,
        status: "COMPLETED",
        artifactIds: [command.findingId],
      },
      (current, nextRevision) => {
        const finding = this.requireCurrentFindingById(
          current,
          command.findingId,
        );
        const review: HumanReviewRecord = deepFreeze({
          findingId: finding.id,
          decision,
          ...(feedback ? { feedback } : {}),
          decidedAtApplicationRevision: nextRevision,
        });
        return {
          ...current,
          reviews: { ...current.reviews, [finding.id]: review },
        };
      },
    );
    return deepFreeze({
      operationId: command.operationId,
      stateRevision: next.revision,
      status: "COMPLETED" as const,
      artifactId: command.findingId,
    });
  }

  resetLab(
    command: ResetLabCommand,
    context: StressLabInvocationContext,
  ): Promise<MutationResult> {
    assertTrustedInvocationContext(context);
    assertHumanInvocation(context, "resetLab");
    assertPlainExactKeys(
      command,
      ["operationId", "expectedRevision"],
      "resetLab",
    );
    operationId(command.operationId);
    assertExpectedRevision(command.expectedRevision);
    const inputFingerprint = commandInputFingerprint("resetLab", {
      expectedRevision: command.expectedRevision,
    });
    return this.operation(
      command.operationId,
      "resetLab",
      context.source,
      inputFingerprint,
      () => {
        const golden = createGoldenExperimentInputs();
        const current = this.assertRevision(command.expectedRevision);
        const superseded = Object.values(current.activeOperations)
          .filter((entry): entry is OperationToken => Boolean(entry))
          .map((entry) => entry.operationId);
        const next = this.commitExpected(
          command.expectedRevision,
          {
            source: context.source,
            inputFingerprint,
            action: "LAB_RESET",
            operationId: command.operationId,
            target: "LAB",
            status: "COMPLETED",
            artifactIds: [],
          },
          (state, nextRevision) => {
            const first = this.scenarioTransition(
              state,
              nextRevision,
              "A",
              golden.runs.A,
            );
            const second = this.scenarioTransition(
              first.state,
              nextRevision,
              "B",
              golden.runs.B,
            );
            return {
              ...second.state,
              currentRunIds: {},
              currentComparisonId: undefined,
              currentFindingId: undefined,
              activeOperations: {},
              targetGenerations: {
                ...second.state.targetGenerations,
                "RUN:A": this.bumpGeneration(state, "RUN:A"),
                "RUN:B": this.bumpGeneration(state, "RUN:B"),
                COMPARISON: this.bumpGeneration(state, "COMPARISON"),
              },
            };
          },
        );
        for (const operation of superseded) {
          this.abortOperation(operation, "SUPERSEDED");
        }
        return deepFreeze({
          operationId: command.operationId,
          stateRevision: next.revision,
          status: "COMPLETED" as const,
        });
      },
    );
  }
}
