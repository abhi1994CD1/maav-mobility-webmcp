import type {
  StressLabWebMcpActivity,
  WebMcpActivityStatus,
} from "@/infrastructure/persistence/stress-lab-repository";

export type ScenarioVisualAction = "configure" | "inject" | "run";

export type WebMcpVisualTarget =
  | {
      readonly kind: "SCENARIO";
      readonly activityId: number;
      readonly slot: "A" | "B";
      readonly action: ScenarioVisualAction;
    }
  | {
      readonly kind: "SURFACE";
      readonly activityId: number;
      readonly surface: "COMPARISON" | "FINDING";
    };

export interface WebMcpReplayFocus {
  readonly activityId: number;
  readonly slot: "A" | "B";
  readonly runId: string;
}

function configuredSlot(argumentSummary: string): "A" | "B" | null {
  const match = /(?:^|;)slot=([AB])(?:;|$)/u.exec(argumentSummary);
  return match?.[1] === "A" || match?.[1] === "B" ? match[1] : null;
}

function scenarioRevisionSlot(argumentSummary: string): "A" | "B" | null {
  const match =
    /(?:^|;)scenarioRevisionId=scenario-([AB])-r[1-9][0-9]*(?:;|$)/u.exec(
      argumentSummary,
    );
  return match?.[1] === "A" || match?.[1] === "B" ? match[1] : null;
}

export function webMcpVisualTargetFor(
  activity: StressLabWebMcpActivity,
): WebMcpVisualTarget | null {
  if (activity.toolName === "configure_scenario") {
    const slot = configuredSlot(activity.argumentSummary);
    return slot
      ? { kind: "SCENARIO", activityId: activity.id, slot, action: "configure" }
      : null;
  }
  if (activity.toolName === "inject_disruption") {
    const slot = scenarioRevisionSlot(activity.argumentSummary);
    return slot
      ? { kind: "SCENARIO", activityId: activity.id, slot, action: "inject" }
      : null;
  }
  if (activity.toolName === "run_scenario") {
    const slot = scenarioRevisionSlot(activity.argumentSummary);
    return slot
      ? { kind: "SCENARIO", activityId: activity.id, slot, action: "run" }
      : null;
  }
  if (activity.toolName === "compare_scenarios") {
    return { kind: "SURFACE", activityId: activity.id, surface: "COMPARISON" };
  }
  if (activity.toolName === "stage_finding") {
    return { kind: "SURFACE", activityId: activity.id, surface: "FINDING" };
  }
  return null;
}

export function latestWebMcpActivityStatus(
  activity: StressLabWebMcpActivity,
): WebMcpActivityStatus {
  return activity.transitions.at(-1)?.status ?? "RECEIVED";
}

export function isTerminalWebMcpActivityStatus(
  status: WebMcpActivityStatus,
): boolean {
  return status === "COMMITTED" || status === "FAILED" || status === "CANCELLED";
}

export function webMcpReplayFocusFor(
  activity: StressLabWebMcpActivity,
  focusedObjectId: string | undefined,
  currentRunIds: Readonly<Partial<Record<"A" | "B", string>>>,
): WebMcpReplayFocus | null {
  if (
    activity.toolName !== "read_lab_state" ||
    activity.argumentSummary !== "scope=RUN" ||
    latestWebMcpActivityStatus(activity) !== "COMMITTED" ||
    !focusedObjectId
  ) {
    return null;
  }
  const slot = currentRunIds.A === focusedObjectId
    ? "A"
    : currentRunIds.B === focusedObjectId
      ? "B"
      : null;
  return slot
    ? Object.freeze({ activityId: activity.id, slot, runId: focusedObjectId })
    : null;
}
