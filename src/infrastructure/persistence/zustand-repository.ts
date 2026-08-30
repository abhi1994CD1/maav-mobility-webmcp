import type { CommandCenterRepository } from "@/application/ports";
import type { CommandCenterState, SnapshotFocus } from "@/domain/types";
import {
  createAuthoredRouteContext,
  type RoutePresentationContext,
} from "@/infrastructure/google/route-context-contract";
import { createStore, type StoreApi } from "zustand/vanilla";

export type PanelId = "incident" | "plans" | "approval" | "audit";
export type WebMcpStatus = "CHECKING" | "AVAILABLE" | "UNAVAILABLE" | "ERROR";

export interface AgentActivityItem {
  id: number;
  toolName: string;
  title: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  detail: string;
}

export interface CommandCenterUiState {
  mapFocus: SnapshotFocus;
  selectedFeatureId?: string;
  openPanel: PanelId;
  animationNonce: number;
  agentActivity: AgentActivityItem[];
  nextActivityId: number;
  webMcpStatus: WebMcpStatus;
  webMcpMessage: string;
  routeContext: RoutePresentationContext;
  notice?: { tone: "INFO" | "SUCCESS" | "ERROR"; message: string };
}

export interface CommandCenterStoreState {
  domain: CommandCenterState;
  ui: CommandCenterUiState;
}

export function createCommandCenterStore(
  initialDomain: CommandCenterState,
): StoreApi<CommandCenterStoreState> {
  return createStore<CommandCenterStoreState>(() => ({
    domain: initialDomain,
    ui: {
      mapFocus: "all",
      openPanel: "incident",
      animationNonce: 0,
      agentActivity: [],
      nextActivityId: 1,
      webMcpStatus: "CHECKING",
      webMcpMessage: "Detecting Chrome 150 WebMCP…",
      routeContext: createAuthoredRouteContext("CLIENT_UNAVAILABLE"),
    },
  }));
}

export class ZustandCommandCenterRepository
  implements CommandCenterRepository
{
  constructor(
    private readonly store: StoreApi<CommandCenterStoreState>,
  ) {}

  getState(): CommandCenterState {
    return this.store.getState().domain;
  }

  replaceState(state: CommandCenterState): void {
    this.store.setState((current) => ({ ...current, domain: state }));
  }
}
