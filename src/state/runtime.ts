import { CommandCenterService } from "@/application/command-center-service";
import { createInitialCommandCenterState } from "@/domain/scenario";
import type { RouteContext, SnapshotFocus } from "@/domain/types";
import {
  createCommandCenterStore,
  type AgentActivityItem,
  type CommandCenterUiState,
  type PanelId,
  type WebMcpStatus,
  ZustandCommandCenterRepository,
} from "@/infrastructure/persistence/zustand-repository";

export const commandCenterStore = createCommandCenterStore(
  createInitialCommandCenterState(),
);

export const commandCenterRepository = new ZustandCommandCenterRepository(
  commandCenterStore,
);

export const commandCenterService = new CommandCenterService(
  commandCenterRepository,
);

export function patchUi(patch: Partial<CommandCenterUiState>): void {
  commandCenterStore.setState((current) => ({
    ...current,
    ui: { ...current.ui, ...patch },
  }));
}

export function setMapFocus(focus: SnapshotFocus): void {
  patchUi({ mapFocus: focus });
}

export function openPanel(openPanel: PanelId): void {
  patchUi({ openPanel });
}

export function setRouteContext(routeContext: RouteContext): void {
  patchUi({ routeContext });
}

export function setWebMcpStatus(
  webMcpStatus: WebMcpStatus,
  webMcpMessage: string,
): void {
  patchUi({ webMcpStatus, webMcpMessage });
}

export function announce(
  message: string,
  tone: "INFO" | "SUCCESS" | "ERROR" = "INFO",
): void {
  patchUi({ notice: { message, tone } });
}

export function triggerRecoveryAnimation(): void {
  patchUi({
    animationNonce: commandCenterStore.getState().ui.animationNonce + 1,
  });
}

export function beginAgentActivity(
  toolName: string,
  title: string,
): number {
  const current = commandCenterStore.getState();
  const id = current.ui.nextActivityId;
  const item: AgentActivityItem = {
    id,
    toolName,
    title,
    status: "RUNNING",
    detail: "Invocation accepted",
  };
  commandCenterStore.setState({
    ...current,
    ui: {
      ...current.ui,
      nextActivityId: id + 1,
      agentActivity: [item, ...current.ui.agentActivity].slice(0, 8),
    },
  });
  return id;
}

export function finishAgentActivity(
  id: number,
  status: "SUCCEEDED" | "FAILED",
  detail: string,
): void {
  const current = commandCenterStore.getState();
  commandCenterStore.setState({
    ...current,
    ui: {
      ...current.ui,
      agentActivity: current.ui.agentActivity.map((item) =>
        item.id === id ? { ...item, status, detail } : item,
      ),
    },
  });
}

export function resetEphemeralUi(): void {
  const current = commandCenterStore.getState();
  patchUi({
    mapFocus: "all",
    selectedFeatureId: undefined,
    openPanel: "incident",
    animationNonce: current.ui.animationNonce + 1,
    notice: {
      tone: "INFO",
      message: "Canonical scenario restored. Activate the incident when ready.",
    },
  });
}
