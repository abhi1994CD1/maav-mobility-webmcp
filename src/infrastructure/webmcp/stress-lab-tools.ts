import {
  StressLabApplicationError,
  WEBMCP_INVOCATION_CONTEXT,
  type ComparisonMutationResult,
  type FindingMutationResult,
  type RunMutationResult,
  type ScenarioMutationResult,
  type StressLabStateView,
} from "@/application/stress-lab-ports";
import type { StressLabService } from "@/application/stress-lab-service";
import {
  StressLabComparisonError,
  StressLabInputValidationError,
} from "@/domain/stress-lab/types";
import type { StressLabActivityReporter } from "@/infrastructure/persistence/stress-lab-repository";
import {
  WebMcpOperationResultCache,
  webMcpCommandIdentity,
} from "./operation-result-cache";
import type { z } from "zod";
import {
  boundedOperationId,
  stressLabCompareInputSchema,
  stressLabCompareJsonSchema,
  stressLabConfigureInputSchema,
  stressLabConfigureJsonSchema,
  stressLabInjectInputSchema,
  stressLabInjectJsonSchema,
  stressLabReadInputSchema,
  stressLabReadJsonSchema,
  stressLabRunInputSchema,
  stressLabRunJsonSchema,
  stressLabStageFindingInputSchema,
  stressLabStageFindingJsonSchema,
  stressLabZodIssue,
  unsafeInputPath,
  type StressLabReadInput,
} from "./stress-lab-schemas";

export const STRESS_LAB_WEBMCP_TOOL_NAMES = [
  "read_lab_state",
  "configure_scenario",
  "run_scenario",
  "inject_disruption",
  "compare_scenarios",
  "stage_finding",
] as const;

export type StressLabWebMcpToolName =
  (typeof STRESS_LAB_WEBMCP_TOOL_NAMES)[number];

export type StressLabWebMcpSafeErrorCode =
  | StressLabApplicationError["code"]
  | "INCOMPARABLE_RUNS"
  | "INVALID_ARGUMENTS"
  | "PREREQUISITE_NOT_MET"
  | "INTERNAL_ERROR";

export interface StressLabWebMcpFailure {
  readonly ok: false;
  readonly operationId?: string;
  readonly error: {
    readonly code: StressLabWebMcpSafeErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly currentRevision?: number;
    readonly field?: string;
    readonly missingFields?: readonly string[];
    readonly nextAction?: StressLabWebMcpToolName;
  };
}

export interface StressLabWebMcpReadSuccess {
  readonly ok: true;
  readonly stateRevision: number;
  readonly status: "COMPLETED";
  readonly summary: Readonly<Record<string, unknown>>;
  readonly nextActions: readonly StressLabWebMcpToolName[];
}

export interface StressLabWebMcpMutationSuccess {
  readonly ok: true;
  readonly operationId: string;
  readonly stateRevision: number;
  readonly status: "COMPLETED";
  readonly artifactId: string;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly nextActions: readonly StressLabWebMcpToolName[];
}

export type StressLabWebMcpResult =
  | StressLabWebMcpReadSuccess
  | StressLabWebMcpMutationSuccess
  | StressLabWebMcpFailure;

export interface StressLabToolDependencies {
  readonly service: StressLabService;
  readonly activity: StressLabActivityReporter;
  readonly resultCache: WebMcpOperationResultCache;
  readObservedView(): StressLabStateView;
  waitForObservedRevision(revision: number): Promise<void>;
}

const DISCLOSURE = "SYNTHETIC SIMULATION • NO LIVE FLEET CONTROL";

function signalFrom(
  options?: WebMCP.ToolExecuteCallbackOptions,
): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

function summaryForInput(
  toolName: StressLabWebMcpToolName,
  input: Record<string, unknown>,
): string {
  const safeScalar = (value: unknown, fallback = "invalid"): string => {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) ? String(value) : fallback;
    }
    return typeof value === "string" && /^[A-Za-z0-9._:-]{1,64}$/u.test(value)
      ? value
      : fallback;
  };
  switch (toolName) {
    case "configure_scenario":
      return `slot=${safeScalar(input.slot)};mode=${safeScalar(input.mode)}`;
    case "run_scenario":
      return `scenarioRevisionId=${safeScalar(input.scenarioRevisionId)}`;
    case "inject_disruption": {
      const disruption = input.disruption as Record<string, unknown> | undefined;
      const target = disruption?.target as Record<string, unknown> | undefined;
      return `scenarioRevisionId=${safeScalar(input.scenarioRevisionId)};atSecond=${safeScalar(disruption?.atSecond)};target=${safeScalar(target?.kind)}`;
    }
    case "compare_scenarios":
      return `runAId=${safeScalar(input.runAId)};runBId=${safeScalar(input.runBId)}`;
    case "stage_finding":
      return `comparisonId=${safeScalar(input.comparisonId)};outcome=${safeScalar(input.selectedOutcome)};emphasis=${safeScalar(input.emphasis)}`;
    case "read_lab_state":
      return `scope=${safeScalar(input.scope ?? "SUMMARY")}`;
  }
}

function safeBegin(
  activity: StressLabActivityReporter,
  toolName: StressLabWebMcpToolName,
  input: Record<string, unknown>,
): number | undefined {
  try {
    return activity.begin({
      toolName,
      ...(boundedOperationId(input)
        ? { operationId: boundedOperationId(input) }
        : {}),
      argumentSummary: summaryForInput(toolName, input),
    });
  } catch {
    return undefined;
  }
}

function safeAdvance(
  activity: StressLabActivityReporter,
  id: number | undefined,
  status: "VALIDATED" | "RUNNING",
): void {
  if (id === undefined) return;
  try {
    activity.advance(id, status);
  } catch {
    // Transient activity is best-effort and cannot affect tool truth.
  }
}

function safeFinish(
  activity: StressLabActivityReporter,
  id: number | undefined,
  result: StressLabWebMcpResult,
): void {
  if (id === undefined) return;
  try {
    if (result.ok) {
      activity.finish(id, {
        status: "COMMITTED",
        resultingRevision: result.stateRevision,
        ...("artifactId" in result ? { artifactId: result.artifactId } : {}),
      });
    } else {
      activity.finish(id, {
        status:
          result.error.code === "OPERATION_CANCELLED"
            ? "CANCELLED"
            : "FAILED",
        safeErrorCode: result.error.code,
        ...(result.error.currentRevision === undefined
          ? {}
          : { resultingRevision: result.error.currentRevision }),
      });
    }
  } catch {
    // Transient activity is best-effort and cannot affect tool truth.
  }
}

function safeFocus(
  activity: StressLabActivityReporter,
  objectId: string | undefined,
): void {
  try {
    activity.focus(objectId);
  } catch {
    // Transient focus is best-effort and cannot affect tool truth.
  }
}

function cancelled(
  operationId: string | undefined,
  currentRevision: number,
): StressLabWebMcpFailure {
  return {
    ok: false,
    ...(operationId ? { operationId } : {}),
    error: {
      code: "OPERATION_CANCELLED",
      message: "The operation was cancelled before publication.",
      retryable: true,
      currentRevision,
    },
  };
}

function invalidArguments(
  input: unknown,
  details: {
    readonly message: string;
    readonly field?: string;
    readonly missingFields?: readonly string[];
  },
): StressLabWebMcpFailure {
  const operationId = boundedOperationId(input);
  return {
    ok: false,
    ...(operationId ? { operationId } : {}),
    error: {
      code: "INVALID_ARGUMENTS",
      message: details.message,
      retryable: false,
      ...(details.field ? { field: details.field } : {}),
      ...(details.missingFields
        ? { missingFields: details.missingFields }
        : {}),
    },
  };
}

function mapApplicationError(
  error: unknown,
  operationId: string | undefined,
  currentRevision: number,
): StressLabWebMcpFailure {
  if (error instanceof StressLabComparisonError) {
    return {
      ok: false,
      ...(operationId ? { operationId } : {}),
      error: {
        code: "INCOMPARABLE_RUNS",
        message: "The current verified runs are not comparable.",
        retryable: false,
        currentRevision,
        field: error.path,
        nextAction: "read_lab_state",
      },
    };
  }
  if (error instanceof StressLabInputValidationError) {
    return invalidArguments(
      operationId ? { operationId } : {},
      { message: "The command violates the bounded Stress Lab input contract." },
    );
  }
  if (!(error instanceof StressLabApplicationError)) {
    return {
      ok: false,
      ...(operationId ? { operationId } : {}),
      error: {
        code: "INTERNAL_ERROR",
        message: "The Stress Lab operation failed safely.",
        retryable: false,
        currentRevision,
      },
    };
  }

  const prerequisiteCodes = new Set([
    "INVALID_STATE_TRANSITION",
    "UNKNOWN_SCENARIO_REVISION",
    "UNKNOWN_RUN",
    "UNKNOWN_COMPARISON",
    "UNKNOWN_FINDING",
  ]);
  const code: StressLabWebMcpSafeErrorCode =
    error.code === "INVALID_COMMAND"
      ? "INVALID_ARGUMENTS"
      : prerequisiteCodes.has(error.code)
        ? "PREREQUISITE_NOT_MET"
        : error.code;
  const messages: Record<StressLabWebMcpSafeErrorCode, string> = {
    HUMAN_AUTHORITY_REQUIRED: "This action requires the visible human interface.",
    IDEMPOTENCY_CONFLICT: "The operation ID is already bound to different arguments or source.",
    INVALID_COMMAND: "The application command is invalid.",
    INVALID_STATE_TRANSITION: "The requested lifecycle transition is not currently legal.",
    OPERATION_CANCELLED: "The operation was cancelled before publication.",
    REVISION_CONFLICT: "The expected application revision is stale.",
    SIMULATION_FAILED: "The deterministic simulation did not publish a result.",
    STALE_COMPARISON: "The comparison is stale.",
    STALE_FINDING: "The finding is stale.",
    STALE_OPERATION: "A newer operation owns this publication target.",
    STALE_RUN: "The run is stale.",
    STALE_SCENARIO_REVISION: "The scenario revision is stale.",
    UNKNOWN_COMPARISON: "The comparison does not exist.",
    UNKNOWN_FINDING: "The finding does not exist.",
    UNKNOWN_RUN: "The run does not exist.",
    UNKNOWN_SCENARIO_REVISION: "The scenario revision does not exist.",
    UNVERIFIED_RESULT: "The result failed trusted verification.",
    INCOMPARABLE_RUNS: "The current verified runs are not comparable.",
    INVALID_ARGUMENTS: "The command violates the bounded input contract.",
    PREREQUISITE_NOT_MET: "Required current evidence is not available yet.",
    INTERNAL_ERROR: "The Stress Lab operation failed safely.",
  };
  const message =
    code === "PREREQUISITE_NOT_MET" && error.target.startsWith("finding-")
      ? "Accept or Challenge the current finding in the human UI before staging another finding."
      : messages[code];
  return {
    ok: false,
    ...(operationId ? { operationId } : {}),
    error: {
      code,
      message,
      retryable: error.retryable,
      currentRevision: error.currentRevision ?? currentRevision,
      ...(code === "REVISION_CONFLICT" ? { field: "expectedRevision" } : {}),
      nextAction: "read_lab_state",
    },
  };
}

function nextActions(view: StressLabStateView): StressLabWebMcpToolName[] {
  const actions: StressLabWebMcpToolName[] = [
    "read_lab_state",
    "configure_scenario",
  ];
  if (view.scenarios.A || view.scenarios.B) {
    actions.push("inject_disruption", "run_scenario");
  }
  if (view.currentRuns.A?.isCurrent && view.currentRuns.B?.isCurrent) {
    actions.push("compare_scenarios");
  }
  if (view.currentComparison?.isCurrent) actions.push("stage_finding");
  return actions;
}

function compactRun(
  run: StressLabStateView["currentRuns"]["A"],
): Record<string, unknown> | null {
  if (!run) return null;
  return {
    id: run.id,
    current: run.isCurrent,
    inputFingerprint: run.inputFingerprint,
    resultFingerprint: run.resultFingerprint,
    metrics: {
      servedPassengers: run.metrics.servedPassengers,
      inServiceAtHorizonPassengers:
        run.metrics.inServiceAtHorizonPassengers,
      unservedPassengers: run.metrics.unservedPassengers,
      maximumWaitSeconds: run.metrics.maximumWaitSeconds,
      totalEnergyWh: run.metrics.totalEnergyWh,
      minimumBatteryBasisPoints: run.metrics.minimumBatteryBasisPoints,
      recoveryTimeSeconds: run.metrics.recoveryTimeSeconds,
    },
    constraints: run.constraints.map(({ code, passed }) => ({ code, passed })),
  };
}

function compactReadSummary(
  view: StressLabStateView,
  input: StressLabReadInput,
): Record<string, unknown> {
  const base = {
    disclosure: DISCLOSURE,
    scope: input.scope ?? "SUMMARY",
    scenarios: {
      A: view.scenarios.A
        ? {
            id: view.scenarios.A.id,
            revision: view.scenarios.A.ref.revision,
            label: view.scenarios.A.label,
          }
        : null,
      B: view.scenarios.B
        ? {
            id: view.scenarios.B.id,
            revision: view.scenarios.B.ref.revision,
            label: view.scenarios.B.label,
          }
        : null,
    },
  };
  switch (input.scope) {
    case "RUN":
      return { ...base, runs: { A: compactRun(view.currentRuns.A), B: compactRun(view.currentRuns.B) } };
    case "COMPARISON":
      return { ...base, comparison: view.currentComparison };
    case "FINDING":
      return {
        ...base,
        finding: view.currentFinding
          ? {
              id: view.currentFinding.id,
              current: view.currentFinding.isCurrent,
              findingFingerprint: view.currentFinding.findingFingerprint,
              selectedOutcome: view.currentFinding.selectedOutcome,
              emphasis: view.currentFinding.emphasis,
              review: view.currentFinding.review,
            }
          : null,
      };
    case "SCENARIO":
    case "SUMMARY":
    case undefined:
      return {
        ...base,
        runs: {
          A: view.currentRuns.A?.id ?? null,
          B: view.currentRuns.B?.id ?? null,
        },
        comparison: view.currentComparison?.id ?? null,
        finding: view.currentFinding
          ? { id: view.currentFinding.id, review: view.currentFinding.review }
          : null,
      };
  }
}

function readSuccess(
  view: StressLabStateView,
  input: StressLabReadInput,
): StressLabWebMcpReadSuccess {
  return {
    ok: true,
    stateRevision: view.revision,
    status: "COMPLETED",
    summary: compactReadSummary(view, input),
    nextActions: nextActions(view),
  };
}

function mutationSummary(
  result:
    | ScenarioMutationResult
    | RunMutationResult
    | ComparisonMutationResult
    | FindingMutationResult,
  view: StressLabStateView,
): Record<string, unknown> {
  if ("findingFingerprint" in result) {
    return {
      comparisonFingerprint: result.comparisonFingerprint,
      findingFingerprint: result.findingFingerprint,
      selectedOutcome: result.selectedOutcome,
      emphasis: result.emphasis,
      review: "PENDING_REVIEW",
      claimIds: result.claims.map((claim) => claim.claimId),
      caveatCodes: result.caveats.map((caveat) => caveat.code),
    };
  }
  if ("comparisonFingerprint" in result) {
    return { comparisonFingerprint: result.comparisonFingerprint };
  }
  if ("resultFingerprint" in result) {
    const run =
      view.currentRuns.A?.id === result.artifactId
        ? view.currentRuns.A
        : view.currentRuns.B?.id === result.artifactId
          ? view.currentRuns.B
          : null;
    return {
      inputFingerprint: result.inputFingerprint,
      eventLedgerFingerprint: result.eventLedgerFingerprint,
      resultFingerprint: result.resultFingerprint,
      ...(run ? { evidence: compactRun(run) } : {}),
    };
  }
  return {
    scenarioRevisionRef: result.scenarioRevisionRef,
    invalidatedArtifactIds: result.invalidatedArtifactIds,
  };
}

async function mutationSuccess(
  dependencies: StressLabToolDependencies,
  result:
    | ScenarioMutationResult
    | RunMutationResult
    | ComparisonMutationResult
    | FindingMutationResult,
): Promise<StressLabWebMcpMutationSuccess> {
  await dependencies.waitForObservedRevision(result.stateRevision);
  const view = dependencies.readObservedView();
  return {
    ok: true,
    operationId: result.operationId,
    stateRevision: result.stateRevision,
    status: "COMPLETED",
    artifactId: result.artifactId,
    summary: mutationSummary(result, view),
    nextActions: nextActions(view),
  };
}

function validate<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): { success: true; data: z.infer<Schema> } | { success: false; failure: StressLabWebMcpFailure } {
  const unsafe = unsafeInputPath(input);
  if (unsafe) {
    return {
      success: false,
      failure: invalidArguments(input, {
        message: "Input must be a closed plain-data object.",
        field: unsafe,
      }),
    };
  }
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : {
        success: false,
        failure: invalidArguments(input, stressLabZodIssue(parsed.error)),
      };
}

function executeTool<Input, Result extends StressLabWebMcpResult>(
  dependencies: StressLabToolDependencies,
  toolName: StressLabWebMcpToolName,
  schema: z.ZodType<Input>,
  input: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions | undefined,
  invoke: (parsed: Input, signal: AbortSignal) => Promise<Result>,
): Promise<StressLabWebMcpResult> {
  const activityId = safeBegin(dependencies.activity, toolName, input);
  const operationId = boundedOperationId(input);
  const signal = signalFrom(options);
  if (signal.aborted) {
    const result = cancelled(
      operationId,
      dependencies.readObservedView().revision,
    );
    safeFinish(dependencies.activity, activityId, result);
    return Promise.resolve(result);
  }
  const parsed = validate(schema, input);
  if (!parsed.success) {
    safeFinish(dependencies.activity, activityId, parsed.failure);
    return Promise.resolve(parsed.failure);
  }
  safeAdvance(dependencies.activity, activityId, "VALIDATED");
  safeAdvance(dependencies.activity, activityId, "RUNNING");
  const perform = async (): Promise<StressLabWebMcpResult> => {
    try {
      return await invoke(parsed.data, signal);
    } catch (error) {
      return mapApplicationError(
        error,
        operationId,
        dependencies.readObservedView().revision,
      );
    }
  };
  const resultPromise =
    toolName === "read_lab_state" || !operationId
      ? perform()
      : dependencies.resultCache.execute(
          operationId,
          webMcpCommandIdentity(toolName, parsed.data),
          perform,
        );
  return resultPromise
    .then((result) => {
      safeFinish(dependencies.activity, activityId, result);
      return result;
    })
    .catch((error) => {
      const result = mapApplicationError(
        error,
        operationId,
        dependencies.readObservedView().revision,
      );
      safeFinish(dependencies.activity, activityId, result);
      return result;
    });
}

function readTool(dependencies: StressLabToolDependencies): WebMCP.ModelContextTool {
  return {
    name: "read_lab_state",
    title: "Read MAAV Stress Lab state",
    description:
      "Read compact authoritative Stress Lab state without mutation. Reading one current RUN by objectId focuses and starts its visible committed replay; this changes presentation only.",
    inputSchema: stressLabReadJsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input, options) =>
      executeTool(
        dependencies,
        "read_lab_state",
        stressLabReadInputSchema,
        input,
        options,
        async (parsed) => {
          const view = dependencies.service.readLabState();
          safeFocus(dependencies.activity, parsed.objectId);
          return readSuccess(view, parsed);
        },
      ),
  };
}

function configureTool(
  dependencies: StressLabToolDependencies,
): WebMCP.ModelContextTool {
  return {
    name: "configure_scenario",
    title: "Configure a Stress Lab scenario",
    description:
      "Configure seed-07 Scenario A or B. For golden setup use mode REPLACE and exact labels: A \"Twelve compact pods\"; B \"Ten higher-capacity pods\"; never add suffixes. A is 12x8; B is 10x10. Shared: 70 kWh, 82% start, 20% reserve, 0.21 kWh/km, 30 s dwell; weights sandton 30, parkmore 15, illovo 20, rosebank 25, melrose-arch 10; wait 180 s, unserved 12, recovery 600 s, standing false; all five objectives. PATCH preserves an existing disruption. Never infer patch values from vague assent; ask first.",
    inputSchema: stressLabConfigureJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: (input, options) =>
      executeTool(
        dependencies,
        "configure_scenario",
        stressLabConfigureInputSchema,
        input,
        options,
        async (parsed) =>
          mutationSuccess(
            dependencies,
            await dependencies.service.configureScenarioConfiguration(
              parsed,
              WEBMCP_INVOCATION_CONTEXT,
            ),
          ),
      ),
  };
}

function runTool(dependencies: StressLabToolDependencies): WebMCP.ModelContextTool {
  return {
    name: "run_scenario",
    title: "Run a deterministic scenario",
    description:
      "Run one current scenario through the deterministic engine and publish only a verified result.",
    inputSchema: stressLabRunJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input, options) =>
      executeTool(
        dependencies,
        "run_scenario",
        stressLabRunInputSchema,
        input,
        options,
        async (parsed, signal) => {
          const active = dependencies
            .readObservedView()
            .activeOperations.find(
              (operation) =>
                operation.source === "WEBMCP" && operation.target.startsWith("RUN:"),
            );
          if (active && active.operationId !== parsed.operationId) {
            throw new StressLabApplicationError(
              "INVALID_STATE_TRANSITION",
              "run_scenario",
              "A WebMCP simulation is already active in this tab.",
              { retryable: true },
            );
          }
          return mutationSuccess(
            dependencies,
            await dependencies.service.runScenario(
              parsed,
              WEBMCP_INVOCATION_CONTEXT,
              signal,
            ),
          );
        },
      ),
  };
}

function injectTool(
  dependencies: StressLabToolDependencies,
): WebMCP.ModelContextTool {
  return {
    name: "inject_disruption",
    title: "Inject an equivalent vehicle failure",
    description:
      "Mutate one explicit current scenario with the deterministic vehicle-failure rule. Copy the required constant type, target kind, and rule exactly; do not invent alternatives. atSecond is seconds after 08:30; use 720 for 08:42. If the user did not choose A or B, ask before calling. Both requires two sequential calls with distinct operation IDs and the latest revision.",
    inputSchema: stressLabInjectJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input, options) =>
      executeTool(
        dependencies,
        "inject_disruption",
        stressLabInjectInputSchema,
        input,
        options,
        async (parsed) =>
          mutationSuccess(
            dependencies,
            await dependencies.service.injectPublicDisruption(
              parsed,
              WEBMCP_INVOCATION_CONTEXT,
            ),
          ),
      ),
  };
}

function compareTool(
  dependencies: StressLabToolDependencies,
): WebMCP.ModelContextTool {
  return {
    name: "compare_scenarios",
    title: "Compare verified scenarios",
    description:
      "Create one trusted neutral comparison from explicit current Scenario A and B run artifacts.",
    inputSchema: stressLabCompareJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input, options) =>
      executeTool(
        dependencies,
        "compare_scenarios",
        stressLabCompareInputSchema,
        input,
        options,
        async (parsed) =>
          mutationSuccess(
            dependencies,
            await dependencies.service.compareScenarios(
              {
                operationId: parsed.operationId,
                expectedRevision: parsed.expectedRevision,
                leftRunId: parsed.runAId,
                rightRunId: parsed.runBId,
              },
              WEBMCP_INVOCATION_CONTEXT,
            ),
          ),
      ),
  };
}

function stageFindingTool(
  dependencies: StressLabToolDependencies,
): WebMCP.ModelContextTool {
  return {
    name: "stage_finding",
    title: "Stage a bounded finding",
    description:
      "Stage deterministic evidence from the current comparison for visible human review; never approve it. Use only an outcome and emphasis explicitly requested by the user; vague assent is not authority to choose either.",
    inputSchema: stressLabStageFindingJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input, options) =>
      executeTool(
        dependencies,
        "stage_finding",
        stressLabStageFindingInputSchema,
        input,
        options,
        async (parsed) =>
          mutationSuccess(
            dependencies,
            await dependencies.service.stageFinding(
              parsed,
              WEBMCP_INVOCATION_CONTEXT,
            ),
          ),
      ),
  };
}

export function createStressLabWebMcpTools(
  dependencies: StressLabToolDependencies,
): readonly WebMCP.ModelContextTool[] {
  return Object.freeze([
    readTool(dependencies),
    configureTool(dependencies),
    runTool(dependencies),
    injectTool(dependencies),
    compareTool(dependencies),
    stageFindingTool(dependencies),
  ]);
}
