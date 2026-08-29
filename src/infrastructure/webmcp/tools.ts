import { CANONICAL_OBJECTIVES } from "@/application/command-center-service";
import type {
  CommandResult,
  OperationalPhase,
  RouteContextSource,
} from "@/domain/types";
import {
  announce,
  beginAgentActivity,
  commandCenterService,
  commandCenterStore,
  finishAgentActivity,
  openPanel,
  setMapFocus,
  triggerRecoveryAnimation,
} from "@/state/runtime";
import {
  auditInputSchema,
  auditJsonSchema,
  commitInputSchema,
  evaluateInputSchema,
  evaluateJsonSchema,
  planJsonSchema,
  rollbackInputSchema,
  rollbackJsonSchema,
  snapshotInputSchema,
  snapshotJsonSchema,
  stageInputSchema,
  zodIssueMessage,
} from "./schemas";

type ToolAction = (
  input: Record<string, unknown>,
  options: WebMCP.ToolExecuteCallbackOptions,
) => Promise<unknown> | unknown;

function visibleExecution(
  toolName: string,
  title: string,
  action: ToolAction,
): WebMCP.ToolExecuteCallback {
  return async (input, options) => {
    const executionOptions =
      options ?? ({ signal: new AbortController().signal } satisfies WebMCP.ToolExecuteCallbackOptions);
    const activityId = beginAgentActivity(toolName, title);
    try {
      const result = await action(input, executionOptions);
      const commandResult = result as CommandResult<unknown>;
      finishAgentActivity(
        activityId,
        commandResult.ok ? "SUCCEEDED" : "FAILED",
        commandResult.ok
          ? `${commandResult.meta.phase} · revision ${commandResult.meta.revision}`
          : commandResult.error.code,
      );
      return result;
    } catch {
      const result = commandCenterService.internalError();
      finishAgentActivity(activityId, "FAILED", result.error.code);
      return result;
    }
  };
}

function routeContextSource(): RouteContextSource {
  return commandCenterStore.getState().ui.routeContext.source;
}

function getSnapshotTool(): WebMCP.ModelContextTool {
  return {
    name: "get_network_snapshot",
    title: "Get network snapshot",
    description:
      "Inspect simulated operations, the active incident, KPIs, constraints, and legal next actions.",
    inputSchema: snapshotJsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: visibleExecution(
      "get_network_snapshot",
      "Inspecting network",
      (input) => {
        const parsed = snapshotInputSchema.safeParse(input);
        if (!parsed.success) {
          return commandCenterService.invalidInput(zodIssueMessage(parsed.error));
        }
        setMapFocus(parsed.data.focus);
        announce(`Network focus: ${parsed.data.focus}.`);
        return commandCenterService.getNetworkSnapshot(
          parsed.data.focus,
          routeContextSource(),
        );
      },
    ),
  };
}

function evaluateTool(): WebMCP.ModelContextTool {
  return {
    name: "evaluate_recovery_options",
    title: "Evaluate recovery options",
    description:
      "Calculate and compare deterministic recovery plans against operator objectives.",
    inputSchema: evaluateJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: visibleExecution(
      "evaluate_recovery_options",
      "Evaluating recovery",
      (input, { signal }) => {
        const parsed = evaluateInputSchema.safeParse(input);
        if (!parsed.success) {
          return commandCenterService.invalidInput(zodIssueMessage(parsed.error));
        }
        const result = commandCenterService.evaluateRecoveryOptions(
          parsed.data.expectedRevision,
          parsed.data.objectives,
          "AGENT",
          signal,
        );
        if (result.ok) {
          openPanel("plans");
          announce("Three deterministic plans evaluated.", "SUCCESS");
        }
        return result;
      },
    ),
  };
}

function stageTool(): WebMCP.ModelContextTool {
  return {
    name: "stage_recovery_plan",
    title: "Stage recovery plan",
    description:
      "Stage one evaluated recovery plan for visible human review without applying it.",
    inputSchema: planJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: visibleExecution(
      "stage_recovery_plan",
      "Staging plan",
      (input, { signal }) => {
        const parsed = stageInputSchema.safeParse(input);
        if (!parsed.success) {
          return commandCenterService.invalidInput(zodIssueMessage(parsed.error));
        }
        const result = commandCenterService.stageRecoveryPlan(
          parsed.data.planId,
          parsed.data.expectedRevision,
          "AGENT",
          signal,
        );
        if (result.ok) {
          openPanel("approval");
          announce("Plan staged. Human approval is required.");
        }
        return result;
      },
    ),
  };
}

function commitTool(): WebMCP.ModelContextTool {
  return {
    name: "commit_approved_recovery",
    title: "Commit approved recovery",
    description: "Apply the exact recovery plan approved in the visible UI.",
    inputSchema: planJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: visibleExecution(
      "commit_approved_recovery",
      "Committing recovery",
      (input, { signal }) => {
        const parsed = commitInputSchema.safeParse(input);
        if (!parsed.success) {
          return commandCenterService.invalidInput(zodIssueMessage(parsed.error));
        }
        const result = commandCenterService.commitApprovedRecovery(
          parsed.data.planId,
          parsed.data.expectedRevision,
          "AGENT",
          signal,
        );
        if (result.ok) {
          triggerRecoveryAnimation();
          openPanel("audit");
          announce("Approved recovery committed and verified.", "SUCCESS");
        }
        return result;
      },
    ),
  };
}

function rollbackTool(): WebMCP.ModelContextTool {
  return {
    name: "rollback_last_recovery",
    title: "Roll back last recovery",
    description:
      "Restore operational state from immediately before the committed recovery.",
    inputSchema: rollbackJsonSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: visibleExecution(
      "rollback_last_recovery",
      "Rolling back recovery",
      (input, { signal }) => {
        const parsed = rollbackInputSchema.safeParse(input);
        if (!parsed.success) {
          return commandCenterService.invalidInput(zodIssueMessage(parsed.error));
        }
        const result = commandCenterService.rollbackLastRecovery(
          parsed.data.reason,
          parsed.data.expectedRevision,
          "AGENT",
          signal,
        );
        if (result.ok) {
          triggerRecoveryAnimation();
          openPanel("audit");
          announce("Operational state rolled back; audit preserved.");
        }
        return result;
      },
    ),
  };
}

function auditTool(): WebMCP.ModelContextTool {
  return {
    name: "get_action_audit_log",
    title: "Get action audit log",
    description:
      "Read bounded action, actor, revision, and outcome records from the append-only audit.",
    inputSchema: auditJsonSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: visibleExecution(
      "get_action_audit_log",
      "Reading audit trail",
      (input) => {
        const parsed = auditInputSchema.safeParse(input);
        if (!parsed.success) {
          return commandCenterService.invalidInput(zodIssueMessage(parsed.error));
        }
        openPanel("audit");
        return commandCenterService.getAuditLog(
          parsed.data.afterSequence,
          parsed.data.limit,
        );
      },
    ),
  };
}

export function toolsForPhase(
  phase: OperationalPhase,
): WebMCP.ModelContextTool[] {
  const tools = [getSnapshotTool()];
  if (phase === "INCIDENT_ACTIVE") tools.push(evaluateTool());
  if (phase === "OPTIONS_EVALUATED") tools.push(stageTool());
  if (phase === "APPROVED") tools.push(commitTool());
  if (phase === "RECOVERED") tools.push(rollbackTool());
  tools.push(auditTool());
  return tools;
}

export function canonicalObjectives() {
  return { ...CANONICAL_OBJECTIVES };
}
