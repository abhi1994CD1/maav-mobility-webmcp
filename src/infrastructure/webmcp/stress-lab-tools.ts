import type {
  ConfigureScenarioResult,
  ReadLabStateResult,
  StressLabSpikeService,
} from "@/application/stress-lab/spike-service";
import type { StressLabActivityReporter } from "@/infrastructure/persistence/stress-lab-spike-repository";
import {
  parseStressLabConfigureIntent,
  stressLabConfigureInputSchema,
  stressLabConfigureJsonSchema,
  stressLabReadInputSchema,
  stressLabReadJsonSchema,
  stressLabZodIssueMessage,
} from "./stress-lab-schemas";

interface StressLabToolDependencies {
  service: StressLabSpikeService;
  activity: StressLabActivityReporter;
}

type StressLabToolResult = ReadLabStateResult | ConfigureScenarioResult;

function executionSignal(
  options: WebMCP.ToolExecuteCallbackOptions | undefined,
): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

function safeActivityBegin(
  activity: StressLabActivityReporter,
  input: Parameters<StressLabActivityReporter["begin"]>[0],
): number | undefined {
  try {
    return activity.begin(input);
  } catch {
    return undefined;
  }
}

function safeActivityFinish(
  activity: StressLabActivityReporter,
  id: number | undefined,
  result: StressLabToolResult,
): void {
  if (id === undefined) return;
  try {
    activity.finish(id, {
      status: result.ok ? "SUCCEEDED" : "REJECTED",
      resultingRevision: result.stateRevision,
      detailCode: result.ok
        ? "artifactId" in result
          ? result.artifactId
          : result.status
        : result.error.code,
    });
  } catch {
    // Activity is best-effort UI state. It cannot change the authoritative result.
  }
}

function safeSelectSlot(
  activity: StressLabActivityReporter,
  slot: "A" | "B" | undefined,
): void {
  try {
    activity.selectSlot(slot);
  } catch {
    // Selection is ephemeral presentation state and cannot alter tool truth.
  }
}

function readLabStateTool({
  service,
  activity,
}: StressLabToolDependencies): WebMCP.ModelContextTool {
  return {
    name: "read_lab_state",
    title: "Read MAAV Stress Lab state",
    description:
      "Inspect the current provisional MAAV experiment revision, Scenario A/B configuration, synthetic disclosure, and safe next actions without changing state.",
    inputSchema: stressLabReadJsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, options) => {
      const activityId = safeActivityBegin(activity, {
        source: "WEBMCP",
        actionName: "read_lab_state",
        title: "Inspect provisional lab state",
        summary: "Browser agent requested a bounded state summary",
      });

      let result: ReadLabStateResult;
      try {
        const parsed = stressLabReadInputSchema.safeParse(input);
        if (!parsed.success) {
          result = service.invalidArguments(
            stressLabZodIssueMessage(parsed.error),
          );
        } else {
          const signal = executionSignal(options);
          result = service.readLabState(parsed.data, signal);
          if (result.ok && parsed.data.scope === "SCENARIO") {
            safeSelectSlot(activity, parsed.data.objectId);
          }
        }
      } catch {
        result = service.internalError();
      }

      safeActivityFinish(activity, activityId, result);
      return result;
    },
  };
}

function configureScenarioTool({
  service,
  activity,
}: StressLabToolDependencies): WebMCP.ModelContextTool {
  return {
    name: "configure_scenario",
    title: "Configure a provisional scenario",
    description:
      "Replace Scenario A or B with one bounded synthetic fleet configuration through the shared revision-safe application service; this Gate 2 proof does not run a simulation.",
    inputSchema: stressLabConfigureJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, options) => {
      const activityId = safeActivityBegin(activity, {
        source: "WEBMCP",
        actionName: "configure_scenario",
        title: "Configure provisional scenario",
        summary: "Browser agent requested a bounded scenario replacement",
      });

      let result: ConfigureScenarioResult;
      try {
        const intent = parseStressLabConfigureIntent(input);
        if (!intent.validShape) {
          const parsed = stressLabConfigureInputSchema.safeParse(input);
          result = service.invalidArguments(
            parsed.success
              ? "Input does not match the documented configuration contract."
              : stressLabZodIssueMessage(parsed.error),
          );
        } else if (intent.missingFields.length > 0) {
          result = service.needsClarification(
            intent.operationId,
            intent.missingFields,
            [
              {
                field: "slot",
                question: "Which provisional scenario should be replaced?",
                allowedValues: ["A", "B"],
                recommended: "A",
              },
              {
                field: "configuration",
                question:
                  "Provide a label, vehicle count from 0 to 30, and seats per vehicle from 1 to 20.",
                allowedValues: ["bounded complete replacement"],
                recommended: "use the visible golden template",
              },
            ],
          );
        } else {
          const parsed = stressLabConfigureInputSchema.safeParse(input);
          if (!parsed.success) {
            result = service.invalidArguments(
              stressLabZodIssueMessage(parsed.error),
              intent.operationId,
            );
          } else {
            result = service.configureScenario(
              parsed.data,
              "WEBMCP",
              executionSignal(options),
            );
            if (result.ok) safeSelectSlot(activity, parsed.data.slot);
          }
        }
      } catch {
        result = service.internalError(intentOperationId(input));
      }

      safeActivityFinish(activity, activityId, result);
      return result;
    },
  };
}

function intentOperationId(input: Record<string, unknown>): string | undefined {
  return typeof input.operationId === "string" ? input.operationId : undefined;
}

export function createStressLabSpikeTools(
  dependencies: StressLabToolDependencies,
): [WebMCP.ModelContextTool, WebMCP.ModelContextTool] {
  return [
    readLabStateTool(dependencies),
    configureScenarioTool(dependencies),
  ];
}
