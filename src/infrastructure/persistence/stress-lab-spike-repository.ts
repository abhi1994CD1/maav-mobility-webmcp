import type {
  StressLabActionSource,
  StressLabScenarioSlot,
  StressLabSpikeRepository,
  StressLabSpikeState,
} from "@/application/stress-lab/spike-service";
import { createStore, type StoreApi } from "zustand/vanilla";

export type StressLabWebMcpStatus =
  | "CHECKING"
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "ERROR";

export interface StressLabSpikeActivity {
  id: number;
  source: StressLabActionSource;
  actionName: "read_lab_state" | "configure_scenario";
  title: string;
  summary: string;
  startedAt: string;
  durationMs?: number;
  status: "RUNNING" | "SUCCEEDED" | "REJECTED";
  resultingRevision?: number;
  detailCode?: string;
}

export interface StressLabSpikeUiState {
  webMcpStatus: StressLabWebMcpStatus;
  webMcpMessage: string;
  selectedSlot?: StressLabScenarioSlot;
  activities: StressLabSpikeActivity[];
  nextActivityId: number;
}

export interface StressLabSpikeStoreState {
  domain: StressLabSpikeState;
  ui: StressLabSpikeUiState;
}

export interface StressLabActivityReporter {
  begin(input: {
    source: StressLabActionSource;
    actionName: StressLabSpikeActivity["actionName"];
    title: string;
    summary: string;
  }): number;
  finish(
    id: number,
    outcome: {
      status: "SUCCEEDED" | "REJECTED";
      resultingRevision: number;
      detailCode: string;
    },
  ): void;
  selectSlot(slot: StressLabScenarioSlot | undefined): void;
}

export function createStressLabSpikeStore(
  initialDomain: StressLabSpikeState,
): StoreApi<StressLabSpikeStoreState> {
  return createStore<StressLabSpikeStoreState>(() => ({
    domain: initialDomain,
    ui: {
      webMcpStatus: "CHECKING",
      webMcpMessage: "Detecting Chrome 150 WebMCP…",
      activities: [],
      nextActivityId: 1,
    },
  }));
}

export class ZustandStressLabSpikeRepository
  implements StressLabSpikeRepository
{
  constructor(private readonly store: StoreApi<StressLabSpikeStoreState>) {}

  getState(): StressLabSpikeState {
    return this.store.getState().domain;
  }

  compareAndSwap(
    expectedRevision: number,
    nextState: StressLabSpikeState,
  ): boolean {
    let committed = false;
    this.store.setState((current) => {
      if (current.domain.revision !== expectedRevision) return current;
      committed = true;
      return { ...current, domain: nextState };
    });
    return committed;
  }
}

export class ZustandStressLabActivityReporter
  implements StressLabActivityReporter
{
  constructor(private readonly store: StoreApi<StressLabSpikeStoreState>) {}

  begin(input: {
    source: StressLabActionSource;
    actionName: StressLabSpikeActivity["actionName"];
    title: string;
    summary: string;
  }): number {
    const startedAt = new Date();
    let activityId = 0;
    this.store.setState((current) => {
      activityId = current.ui.nextActivityId;
      const activity: StressLabSpikeActivity = {
        id: activityId,
        ...input,
        startedAt: startedAt.toISOString(),
        status: "RUNNING",
      };
      return {
        ...current,
        ui: {
          ...current.ui,
          nextActivityId: activityId + 1,
          activities: [activity, ...current.ui.activities].slice(0, 12),
        },
      };
    });
    return activityId;
  }

  finish(
    id: number,
    outcome: {
      status: "SUCCEEDED" | "REJECTED";
      resultingRevision: number;
      detailCode: string;
    },
  ): void {
    const finishedAt = Date.now();
    this.store.setState((current) => ({
      ...current,
      ui: {
        ...current.ui,
        activities: current.ui.activities.map((activity) =>
          activity.id === id
            ? {
                ...activity,
                ...outcome,
                durationMs: Math.max(
                  0,
                  finishedAt - Date.parse(activity.startedAt),
                ),
              }
            : activity,
        ),
      },
    }));
  }

  selectSlot(slot: StressLabScenarioSlot | undefined): void {
    this.store.setState((current) => ({
      ...current,
      ui: { ...current.ui, selectedSlot: slot },
    }));
  }
}

export function setStressLabWebMcpStatus(
  store: StoreApi<StressLabSpikeStoreState>,
  status: StressLabWebMcpStatus,
  message: string,
): void {
  store.setState((current) => ({
    ...current,
    ui: {
      ...current.ui,
      webMcpStatus: status,
      webMcpMessage: message,
    },
  }));
}
