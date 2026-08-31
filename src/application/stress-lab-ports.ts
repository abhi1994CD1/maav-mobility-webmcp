import type {
  DisruptionSpecification,
  EventLedgerEnvelope,
  FindingCandidateArtifact,
  FindingCaveat,
  FindingEmphasis,
  FindingEvidenceClaim,
  FindingSelectedOutcome,
  Fingerprint,
  PreparedRunInput,
  RunResultArtifact,
  ScenarioRevisionId,
  ScenarioSlot,
  StressLabRunInput,
  TrustedComparisonArtifact,
  VerifiedRunResultArtifact,
} from "@/domain/stress-lab/types";

export type StressLabApplicationErrorCode =
  | "HUMAN_AUTHORITY_REQUIRED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_COMMAND"
  | "INVALID_STATE_TRANSITION"
  | "OPERATION_CANCELLED"
  | "REVISION_CONFLICT"
  | "SIMULATION_FAILED"
  | "STALE_COMPARISON"
  | "STALE_FINDING"
  | "STALE_OPERATION"
  | "STALE_RUN"
  | "STALE_SCENARIO_REVISION"
  | "UNKNOWN_COMPARISON"
  | "UNKNOWN_FINDING"
  | "UNKNOWN_RUN"
  | "UNKNOWN_SCENARIO_REVISION"
  | "UNVERIFIED_RESULT";

export class StressLabApplicationError extends Error {
  readonly code: StressLabApplicationErrorCode;
  readonly target: string;
  readonly retryable: boolean;
  readonly expectedRevision?: number;
  readonly currentRevision?: number;
  readonly expectedFingerprint?: Fingerprint;
  readonly currentFingerprint?: Fingerprint;

  constructor(
    code: StressLabApplicationErrorCode,
    target: string,
    message: string,
    details: {
      readonly retryable?: boolean;
      readonly expectedRevision?: number;
      readonly currentRevision?: number;
      readonly expectedFingerprint?: Fingerprint;
      readonly currentFingerprint?: Fingerprint;
    } = {},
  ) {
    super(message);
    this.name = "StressLabApplicationError";
    this.code = code;
    this.target = target;
    this.retryable = details.retryable ?? false;
    this.expectedRevision = details.expectedRevision;
    this.currentRevision = details.currentRevision;
    this.expectedFingerprint = details.expectedFingerprint;
    this.currentFingerprint = details.currentFingerprint;
  }
}

export interface ScenarioRevisionRef {
  readonly slot: ScenarioSlot;
  readonly revision: number;
  readonly preparedInputFingerprint: Fingerprint;
}

export interface ScenarioRevisionRecord {
  readonly id: ScenarioRevisionId;
  readonly ref: ScenarioRevisionRef;
  readonly preparedInput: PreparedRunInput;
  readonly createdAtApplicationRevision: number;
}

export type StressLabActionSource = "HUMAN_UI" | "WEBMCP";

export interface StressLabInvocationContext {
  readonly source: StressLabActionSource;
}

export const HUMAN_UI_INVOCATION_CONTEXT = Object.freeze({
  source: "HUMAN_UI",
} as const satisfies StressLabInvocationContext);

export const WEBMCP_INVOCATION_CONTEXT = Object.freeze({
  source: "WEBMCP",
} as const satisfies StressLabInvocationContext);

export type OperationTarget = `RUN:${ScenarioSlot}` | "COMPARISON";

export interface OperationToken {
  readonly operationId: string;
  readonly source: StressLabActionSource;
  readonly inputFingerprint: Fingerprint;
  readonly target: OperationTarget;
  readonly generation: number;
  readonly capturedScenarioRevisions: readonly ScenarioRevisionRef[];
  readonly artifactId: string;
}

export interface CurrentRunRecord {
  readonly id: string;
  readonly scenarioRevisionId: ScenarioRevisionId;
  readonly scenarioRevisionRef: ScenarioRevisionRef;
  readonly preparedInput: PreparedRunInput;
  readonly eventLedger: EventLedgerEnvelope;
  readonly verifiedResult: VerifiedRunResultArtifact;
  readonly publishedAtApplicationRevision: number;
}

export interface CurrentComparisonRecord {
  readonly id: string;
  readonly leftRunId: string;
  readonly rightRunId: string;
  readonly scenarioRevisionRefs: readonly [
    ScenarioRevisionRef,
    ScenarioRevisionRef,
  ];
  readonly artifact: TrustedComparisonArtifact;
  readonly publishedAtApplicationRevision: number;
}

export interface StagedFindingRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly comparisonFingerprint: Fingerprint;
  readonly scenarioRevisionRefs: readonly [
    ScenarioRevisionRef,
    ScenarioRevisionRef,
  ];
  readonly runIdentities: readonly {
    readonly inputFingerprint: Fingerprint;
    readonly eventLedgerFingerprint: Fingerprint;
    readonly resultFingerprint: Fingerprint;
  }[];
  readonly candidate: FindingCandidateArtifact;
  readonly stagedAtApplicationRevision: number;
}

export interface HumanReviewRecord {
  readonly findingId: string;
  readonly decision: "PENDING_REVIEW" | "ACCEPTED" | "CHALLENGED";
  readonly feedback?: string;
  readonly decidedAtApplicationRevision?: number;
}

export interface ApplicationAuditEntry {
  readonly sequence: number;
  readonly source: StressLabActionSource;
  readonly inputFingerprint: Fingerprint;
  readonly action:
    | "SCENARIO_CONFIGURED"
    | "DISRUPTION_INJECTED"
    | "RUN_STARTED"
    | "RUN_PUBLISHED"
    | "RUN_CANCELLED"
    | "RUN_FAILED"
    | "COMPARISON_STARTED"
    | "COMPARISON_PUBLISHED"
    | "COMPARISON_FAILED"
    | "FINDING_STAGED"
    | "FINDING_ACCEPTED"
    | "FINDING_CHALLENGED"
    | "LAB_RESET";
  readonly operationId: string;
  readonly target: string;
  readonly priorRevision: number;
  readonly resultingRevision: number;
  readonly status: "COMPLETED" | "RUNNING" | "CANCELLED" | "FAILED";
  readonly artifactIds: readonly string[];
  readonly safeErrorCode?: StressLabApplicationErrorCode | "INCOMPARABLE_RUNS";
}

export interface StressLabApplicationState {
  readonly revision: number;
  readonly scenarioRevisionCounters: Readonly<Record<ScenarioSlot, number>>;
  readonly nextRunSequence: number;
  readonly nextComparisonSequence: number;
  readonly nextFindingSequence: number;
  readonly currentScenarioRevisionIds: Readonly<
    Partial<Record<ScenarioSlot, ScenarioRevisionId>>
  >;
  readonly scenarioRevisions: Readonly<
    Record<string, ScenarioRevisionRecord>
  >;
  readonly currentRunIds: Readonly<Partial<Record<ScenarioSlot, string>>>;
  readonly runs: Readonly<Record<string, CurrentRunRecord>>;
  readonly currentComparisonId?: string;
  readonly comparisons: Readonly<Record<string, CurrentComparisonRecord>>;
  readonly currentFindingId?: string;
  readonly findings: Readonly<Record<string, StagedFindingRecord>>;
  readonly reviews: Readonly<Record<string, HumanReviewRecord>>;
  readonly activeOperations: Readonly<
    Partial<Record<OperationTarget, OperationToken>>
  >;
  readonly targetGenerations: Readonly<
    Partial<Record<OperationTarget, number>>
  >;
  readonly audit: readonly ApplicationAuditEntry[];
}

export interface StressLabApplicationRepository {
  getState(): StressLabApplicationState;
  compareAndSwap(
    expectedRevision: number,
    nextState: StressLabApplicationState,
  ): boolean;
  subscribe(listener: (state: StressLabApplicationState) => void): () => void;
}

export interface OperationProgress {
  readonly operationId: string;
  readonly target: OperationTarget;
  readonly completedUnits: number;
  readonly totalUnits: number;
}

export interface RunExecutionContext {
  readonly signal: { readonly aborted: boolean };
  reportProgress(completedUnits: number, totalUnits: number): boolean;
}

export interface StressLabSimulationExecutor {
  execute(
    preparedInput: PreparedRunInput,
    context: RunExecutionContext,
  ): Promise<{
    readonly eventLedger: EventLedgerEnvelope;
    readonly result: RunResultArtifact;
  }>;
}

export interface StressLabComparisonExecutor {
  execute(
    left: {
      readonly preparedInput: PreparedRunInput;
      readonly verifiedResult: VerifiedRunResultArtifact;
    },
    right: {
      readonly preparedInput: PreparedRunInput;
      readonly verifiedResult: VerifiedRunResultArtifact;
    },
  ): Promise<void>;
}

export interface ConfigureScenarioCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly slot: ScenarioSlot;
  readonly input: StressLabRunInput;
}

export interface InjectDisruptionCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly scenarioRevisionId: string;
  readonly disruption: DisruptionSpecification;
}

export interface RunScenarioCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly scenarioRevisionId: string;
}

export interface CancelRunCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly slot: ScenarioSlot;
  readonly targetOperationId: string;
}

export interface CompareScenariosCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly leftRunId: string;
  readonly rightRunId: string;
}

export interface StageFindingCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly comparisonId: string;
  readonly selectedOutcome: FindingSelectedOutcome;
  readonly emphasis: FindingEmphasis;
}

export interface AcceptFindingCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly findingId: string;
}

export interface ChallengeFindingCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
  readonly findingId: string;
  readonly feedback: string;
}

export interface ResetLabCommand {
  readonly operationId: string;
  readonly expectedRevision: number;
}

export interface MutationResult {
  readonly operationId: string;
  readonly stateRevision: number;
  readonly status: "COMPLETED" | "PUBLISHED" | "CANCELLED";
  readonly artifactId?: string;
}

export interface ScenarioMutationResult extends MutationResult {
  readonly artifactId: string;
  readonly scenarioRevisionRef: ScenarioRevisionRef;
}

export interface RunMutationResult extends MutationResult {
  readonly status: "PUBLISHED";
  readonly artifactId: string;
  readonly inputFingerprint: Fingerprint;
  readonly eventLedgerFingerprint: Fingerprint;
  readonly resultFingerprint: Fingerprint;
}

export interface ComparisonMutationResult extends MutationResult {
  readonly status: "PUBLISHED";
  readonly artifactId: string;
  readonly comparisonFingerprint: Fingerprint;
}

export interface FindingMutationResult extends MutationResult {
  readonly artifactId: string;
  readonly comparisonFingerprint: Fingerprint;
  readonly findingFingerprint: Fingerprint;
  readonly selectedOutcome: FindingSelectedOutcome;
  readonly emphasis: FindingEmphasis;
  readonly claims: readonly FindingEvidenceClaim[];
  readonly caveats: readonly FindingCaveat[];
}

export interface StressLabStateView {
  readonly revision: number;
  readonly scenarios: Readonly<
    Record<
      ScenarioSlot,
      | {
          readonly id: string;
          readonly ref: ScenarioRevisionRef;
          readonly label: string;
        }
      | null
    >
  >;
  readonly currentRuns: Readonly<
    Record<
      ScenarioSlot,
      | {
          readonly id: string;
          readonly isCurrent: boolean;
          readonly scenarioRevisionRef: ScenarioRevisionRef;
          readonly inputFingerprint: Fingerprint;
          readonly eventLedgerFingerprint: Fingerprint;
          readonly resultFingerprint: Fingerprint;
          readonly metrics: VerifiedRunResultArtifact["metrics"];
          readonly constraints: VerifiedRunResultArtifact["constraints"];
        }
      | null
    >
  >;
  readonly currentComparison:
    | {
        readonly id: string;
        readonly isCurrent: boolean;
        readonly comparisonFingerprint: Fingerprint;
      }
    | null;
  readonly currentFinding:
    | {
        readonly id: string;
        readonly isCurrent: boolean;
        readonly comparisonFingerprint: Fingerprint;
        readonly findingFingerprint: Fingerprint;
        readonly selectedOutcome: FindingSelectedOutcome;
        readonly emphasis: FindingEmphasis;
        readonly claims: readonly FindingEvidenceClaim[];
        readonly caveats: readonly FindingCaveat[];
        readonly review: HumanReviewRecord["decision"];
        readonly feedback?: string;
      }
    | null;
  readonly activeOperations: readonly OperationToken[];
  readonly progress: readonly OperationProgress[];
  readonly audit: readonly ApplicationAuditEntry[];
  readonly historical: {
    readonly runIds: readonly string[];
    readonly comparisonIds: readonly string[];
    readonly findingIds: readonly string[];
  };
}
