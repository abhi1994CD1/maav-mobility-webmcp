export const STRESS_LAB_SPIKE_DISCLOSURE =
  "PROVISIONAL INTEGRATION-TEST STATE • NO SIMULATION RESULTS";

export const STRESS_LAB_SPIKE_ID = "stress-lab-webmcp-spike-v1";

export type StressLabScenarioSlot = "A" | "B";
export type StressLabActionSource = "HUMAN_UI" | "WEBMCP";

export interface ProvisionalFleetConfiguration {
  vehicleCount: number;
  seatsPerVehicle: number;
}

export interface ProvisionalScenarioConfiguration {
  label: string;
  fleet: ProvisionalFleetConfiguration;
}

export interface ProvisionalScenarioRevision {
  id: string;
  slot: StressLabScenarioSlot;
  createdAtRevision: number;
  source: StressLabActionSource;
  configuration: ProvisionalScenarioConfiguration;
  totalSeats: number;
}

export interface ReadLabStateInput {
  scope?: "SUMMARY" | "SCENARIO";
  objectId?: StressLabScenarioSlot;
}

export interface ConfigureScenarioCommand {
  operationId: string;
  expectedRevision: number;
  slot: StressLabScenarioSlot;
  mode: "REPLACE";
  configuration: ProvisionalScenarioConfiguration;
}

export interface StressLabSpikeState {
  revision: number;
  scenarios: {
    A?: ProvisionalScenarioRevision;
    B?: ProvisionalScenarioRevision;
  };
  operations: Record<string, StressLabOperationRecord>;
}

export interface StressLabOperationRecord {
  toolName: "configure_scenario";
  fingerprint: string;
  result: ConfigureScenarioSuccess;
}

export interface StressLabSpikeRepository {
  getState(): StressLabSpikeState;
  compareAndSwap(
    expectedRevision: number,
    nextState: StressLabSpikeState,
  ): boolean;
}

export interface StressLabDecisionPoint {
  field: string;
  question: string;
  allowedValues: string[];
  recommended?: string;
}

export type StressLabSpikeErrorCode =
  | "INVALID_ARGUMENTS"
  | "NEEDS_CLARIFICATION"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "OPERATION_CANCELLED"
  | "INTERNAL_ERROR";

export interface StressLabSpikeFailure {
  ok: false;
  operationId?: string;
  stateRevision: number;
  error: {
    code: StressLabSpikeErrorCode;
    message: string;
    retryable: boolean;
    field?: string;
    currentRevision?: number;
    missingFields?: string[];
    decisionPoints?: StressLabDecisionPoint[];
    nextAction: string;
  };
}

export interface ReadLabStateSuccess {
  ok: true;
  stateRevision: number;
  status: "COMPLETED";
  summary: {
    experimentId: typeof STRESS_LAB_SPIKE_ID;
    stateKind: "PROVISIONAL_INTEGRATION_TEST";
    disclosure: typeof STRESS_LAB_SPIKE_DISCLOSURE;
    scope: "SUMMARY" | "SCENARIO";
    selectedObjectId?: string;
    scenarios: {
      A: ProvisionalScenarioRevision | null;
      B: ProvisionalScenarioRevision | null;
    };
    simulatorStatus: "NOT_IMPLEMENTED_IN_GATE_2";
  };
  nextActions: ["configure_scenario"];
}

export interface ConfigureScenarioSuccess {
  ok: true;
  operationId: string;
  stateRevision: number;
  status: "COMPLETED" | "REUSED";
  artifactId: string;
  summary: {
    stateKind: "PROVISIONAL_INTEGRATION_TEST";
    disclosure: typeof STRESS_LAB_SPIKE_DISCLOSURE;
    scenario: ProvisionalScenarioRevision;
  };
  nextActions: ["read_lab_state", "configure_scenario"];
}

export type ReadLabStateResult = ReadLabStateSuccess | StressLabSpikeFailure;
export type ConfigureScenarioResult =
  | ConfigureScenarioSuccess
  | StressLabSpikeFailure;

export function createInitialStressLabSpikeState(): StressLabSpikeState {
  return {
    revision: 0,
    scenarios: {},
    operations: {},
  };
}

function cloneScenario(
  scenario: ProvisionalScenarioRevision | undefined,
): ProvisionalScenarioRevision | null {
  if (!scenario) return null;
  return {
    ...scenario,
    configuration: {
      ...scenario.configuration,
      fleet: { ...scenario.configuration.fleet },
    },
  };
}

function commandFingerprint(command: ConfigureScenarioCommand): string {
  return JSON.stringify({
    expectedRevision: command.expectedRevision,
    slot: command.slot,
    mode: command.mode,
    configuration: {
      label: command.configuration.label.trim(),
      fleet: {
        vehicleCount: command.configuration.fleet.vehicleCount,
        seatsPerVehicle: command.configuration.fleet.seatsPerVehicle,
      },
    },
  });
}

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const UNSAFE_LABEL_PATTERN = /[<>\u0000-\u001F\u007F]/u;

function validateConfigureCommand(
  command: ConfigureScenarioCommand,
): { field: string; message: string } | undefined {
  if (
    typeof command.operationId !== "string" ||
    command.operationId.length < 1 ||
    command.operationId.length > 64 ||
    !OPERATION_ID_PATTERN.test(command.operationId)
  ) {
    return {
      field: "operationId",
      message:
        "operationId must use 1–64 letters, numbers, dots, colons, underscores, or hyphens.",
    };
  }
  if (
    !Number.isInteger(command.expectedRevision) ||
    command.expectedRevision < 0
  ) {
    return {
      field: "expectedRevision",
      message: "expectedRevision must be a non-negative integer.",
    };
  }
  if (command.slot !== "A" && command.slot !== "B") {
    return { field: "slot", message: "slot must be A or B." };
  }
  if (command.mode !== "REPLACE") {
    return {
      field: "mode",
      message: "Gate 2 supports REPLACE mode only.",
    };
  }

  const label = command.configuration?.label;
  if (
    typeof label !== "string" ||
    label.trim().length < 1 ||
    label.trim().length > 48 ||
    UNSAFE_LABEL_PATTERN.test(label)
  ) {
    return {
      field: "configuration.label",
      message:
        "configuration.label must be 1–48 plain-text characters without markup or control characters.",
    };
  }

  const vehicleCount = command.configuration?.fleet?.vehicleCount;
  if (
    !Number.isInteger(vehicleCount) ||
    vehicleCount < 0 ||
    vehicleCount > 30
  ) {
    return {
      field: "configuration.fleet.vehicleCount",
      message: "vehicleCount must be an integer from 0 to 30.",
    };
  }

  const seatsPerVehicle = command.configuration?.fleet?.seatsPerVehicle;
  if (
    !Number.isInteger(seatsPerVehicle) ||
    seatsPerVehicle < 1 ||
    seatsPerVehicle > 20
  ) {
    return {
      field: "configuration.fleet.seatsPerVehicle",
      message: "seatsPerVehicle must be an integer from 1 to 20.",
    };
  }
}

function failure(
  stateRevision: number,
  code: StressLabSpikeErrorCode,
  message: string,
  nextAction: string,
  options: {
    operationId?: string;
    retryable?: boolean;
    field?: string;
    currentRevision?: number;
    missingFields?: string[];
    decisionPoints?: StressLabDecisionPoint[];
  } = {},
): StressLabSpikeFailure {
  return {
    ok: false,
    ...(options.operationId ? { operationId: options.operationId } : {}),
    stateRevision,
    error: {
      code,
      message,
      retryable: options.retryable ?? true,
      ...(options.field ? { field: options.field } : {}),
      ...(options.currentRevision === undefined
        ? {}
        : { currentRevision: options.currentRevision }),
      ...(options.missingFields
        ? { missingFields: [...options.missingFields] }
        : {}),
      ...(options.decisionPoints
        ? {
            decisionPoints: options.decisionPoints.map((point) => ({
              ...point,
              allowedValues: [...point.allowedValues],
            })),
          }
        : {}),
      nextAction,
    },
  };
}

export class StressLabSpikeService {
  constructor(private readonly repository: StressLabSpikeRepository) {}

  readLabState(
    input: ReadLabStateInput,
    signal?: AbortSignal,
  ): ReadLabStateResult {
    const current = this.repository.getState();
    if (signal?.aborted) return this.operationCancelled();

    return {
      ok: true,
      stateRevision: current.revision,
      status: "COMPLETED",
      summary: {
        experimentId: STRESS_LAB_SPIKE_ID,
        stateKind: "PROVISIONAL_INTEGRATION_TEST",
        disclosure: STRESS_LAB_SPIKE_DISCLOSURE,
        scope: input.scope ?? "SUMMARY",
        ...(input.objectId ? { selectedObjectId: input.objectId } : {}),
        scenarios: {
          A: cloneScenario(current.scenarios.A),
          B: cloneScenario(current.scenarios.B),
        },
        simulatorStatus: "NOT_IMPLEMENTED_IN_GATE_2",
      },
      nextActions: ["configure_scenario"],
    };
  }

  configureScenario(
    command: ConfigureScenarioCommand,
    source: StressLabActionSource,
    signal?: AbortSignal,
  ): ConfigureScenarioResult {
    let current = this.repository.getState();
    if (signal?.aborted) return this.operationCancelled(command.operationId);

    const validationIssue = validateConfigureCommand(command);
    if (validationIssue) {
      return failure(
        current.revision,
        "INVALID_ARGUMENTS",
        validationIssue.message,
        "Correct the input using the bounded configuration contract, then retry.",
        {
          operationId:
            typeof command.operationId === "string"
              ? command.operationId
              : undefined,
          field: validationIssue.field,
        },
      );
    }

    const fingerprint = commandFingerprint(command);
    const priorOperation = current.operations[command.operationId];
    if (priorOperation) {
      if (
        priorOperation.toolName !== "configure_scenario" ||
        priorOperation.fingerprint !== fingerprint
      ) {
        return failure(
          current.revision,
          "IDEMPOTENCY_CONFLICT",
          "This operation ID was already used with different arguments.",
          "Retry with a new operationId after reading the current lab state.",
          {
            operationId: command.operationId,
            field: "operationId",
          },
        );
      }
      return {
        ...priorOperation.result,
        status: "REUSED",
        summary: {
          ...priorOperation.result.summary,
          scenario: cloneScenario(
            priorOperation.result.summary.scenario,
          ) as ProvisionalScenarioRevision,
        },
        nextActions: [...priorOperation.result.nextActions],
      };
    }

    if (current.revision !== command.expectedRevision) {
      return failure(
        current.revision,
        "REVISION_CONFLICT",
        "The experiment changed after it was inspected.",
        "Call read_lab_state and retry with the returned stateRevision.",
        {
          operationId: command.operationId,
          field: "expectedRevision",
          currentRevision: current.revision,
        },
      );
    }

    const resultingRevision = current.revision + 1;
    const scenario: ProvisionalScenarioRevision = {
      id: `scenario-${command.slot}-r${resultingRevision}`,
      slot: command.slot,
      createdAtRevision: resultingRevision,
      source,
      configuration: {
        label: command.configuration.label.trim(),
        fleet: { ...command.configuration.fleet },
      },
      totalSeats:
        command.configuration.fleet.vehicleCount *
        command.configuration.fleet.seatsPerVehicle,
    };
    const result: ConfigureScenarioSuccess = {
      ok: true,
      operationId: command.operationId,
      stateRevision: resultingRevision,
      status: "COMPLETED",
      artifactId: scenario.id,
      summary: {
        stateKind: "PROVISIONAL_INTEGRATION_TEST",
        disclosure: STRESS_LAB_SPIKE_DISCLOSURE,
        scenario: cloneScenario(scenario) as ProvisionalScenarioRevision,
      },
      nextActions: ["read_lab_state", "configure_scenario"],
    };
    const nextState: StressLabSpikeState = {
      revision: resultingRevision,
      scenarios: {
        ...current.scenarios,
        [command.slot]: scenario,
      },
      operations: {
        ...current.operations,
        [command.operationId]: {
          toolName: "configure_scenario",
          fingerprint,
          result,
        },
      },
    };

    if (signal?.aborted) return this.operationCancelled(command.operationId);
    if (!this.repository.compareAndSwap(current.revision, nextState)) {
      current = this.repository.getState();
      return failure(
        current.revision,
        "REVISION_CONFLICT",
        "Another action committed this experiment revision first.",
        "Call read_lab_state and retry with a new operationId.",
        {
          operationId: command.operationId,
          field: "expectedRevision",
          currentRevision: current.revision,
        },
      );
    }

    return result;
  }

  invalidArguments(
    message: string,
    operationId?: string,
    field?: string,
  ): StressLabSpikeFailure {
    return failure(
      this.repository.getState().revision,
      "INVALID_ARGUMENTS",
      message,
      "Correct the input using the tool schema, then retry.",
      { operationId, field },
    );
  }

  needsClarification(
    operationId: string | undefined,
    missingFields: string[],
    decisionPoints: StressLabDecisionPoint[],
  ): StressLabSpikeFailure {
    return failure(
      this.repository.getState().revision,
      "NEEDS_CLARIFICATION",
      "Essential scenario configuration intent is missing.",
      "Ask the human for the bounded missing choices, then retry with a new operationId.",
      { operationId, missingFields, decisionPoints },
    );
  }

  operationCancelled(operationId?: string): StressLabSpikeFailure {
    return failure(
      this.repository.getState().revision,
      "OPERATION_CANCELLED",
      "The operation was cancelled before it committed.",
      "Read the current lab state before deciding whether to retry.",
      { operationId },
    );
  }

  internalError(operationId?: string): StressLabSpikeFailure {
    return failure(
      this.repository.getState().revision,
      "INTERNAL_ERROR",
      "The provisional command could not be completed.",
      "Read the current state and use the manual controls if the failure persists.",
      { operationId },
    );
  }
}
