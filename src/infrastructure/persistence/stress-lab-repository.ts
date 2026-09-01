import type {
  StressLabApplicationRepository,
  StressLabApplicationState,
  StressLabStateView,
} from "@/application/stress-lab-ports";
import { createStore, type StoreApi } from "zustand/vanilla";

export type StressLabWebMcpStatus =
  | "CHECKING"
  | "AVAILABLE"
  | "UNAVAILABLE"
  | "ERROR";

export type WebMcpActivityStatus =
  | "RECEIVED"
  | "VALIDATED"
  | "RUNNING"
  | "COMMITTED"
  | "FAILED"
  | "CANCELLED";

export interface WebMcpActivityTransition {
  readonly status: WebMcpActivityStatus;
  readonly at: string;
}

export interface StressLabWebMcpActivity {
  readonly id: number;
  readonly toolName: string;
  readonly source: "WEBMCP";
  readonly operationId?: string;
  readonly argumentSummary: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly transitions: readonly WebMcpActivityTransition[];
  readonly resultingRevision?: number;
  readonly artifactId?: string;
  readonly safeErrorCode?: string;
}

export interface StressLabRuntimeUiState {
  readonly webMcpStatus: StressLabWebMcpStatus;
  readonly webMcpMessage: string;
  readonly observedView: StressLabStateView | null;
  readonly focusedObjectId?: string;
  readonly activities: readonly StressLabWebMcpActivity[];
  readonly nextActivityId: number;
}

export interface StressLabRuntimeStoreState {
  readonly application: StressLabApplicationState;
  readonly ui: StressLabRuntimeUiState;
}

export interface StressLabActivityClock {
  nowMilliseconds(): number;
}

export interface WebMcpActivityTerminal {
  readonly status: "COMMITTED" | "FAILED" | "CANCELLED";
  readonly resultingRevision?: number;
  readonly artifactId?: string;
  readonly safeErrorCode?: string;
}

export interface StressLabActivityReporter {
  begin(input: {
    readonly toolName: string;
    readonly operationId?: string;
    readonly argumentSummary: string;
  }): number;
  advance(id: number, status: "VALIDATED" | "RUNNING"): void;
  finish(id: number, terminal: WebMcpActivityTerminal): void;
  focus(objectId: string | undefined): void;
}

const SYSTEM_ACTIVITY_CLOCK: StressLabActivityClock = Object.freeze({
  nowMilliseconds: () => Date.now(),
});

function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function isTerminal(status: WebMcpActivityStatus | undefined): boolean {
  return status === "COMMITTED" || status === "FAILED" || status === "CANCELLED";
}

export function createStressLabRuntimeStore(
  initialApplicationState: StressLabApplicationState,
): StoreApi<StressLabRuntimeStoreState> {
  return createStore<StressLabRuntimeStoreState>(() => ({
    application: initialApplicationState,
    ui: {
      webMcpStatus: "CHECKING",
      webMcpMessage: "Checking Chrome WebMCP availability…",
      observedView: null,
      activities: [],
      nextActivityId: 1,
    },
  }));
}

export class ZustandStressLabRepository
  implements StressLabApplicationRepository
{
  constructor(private readonly store: StoreApi<StressLabRuntimeStoreState>) {}

  getState(): StressLabApplicationState {
    return this.store.getState().application;
  }

  compareAndSwap(
    expectedRevision: number,
    nextState: StressLabApplicationState,
  ): boolean {
    let committed = false;
    this.store.setState((current) => {
      if (current.application.revision !== expectedRevision) return current;
      if (nextState.revision !== expectedRevision + 1) {
        throw new Error("Stress Lab commits must advance one application revision.");
      }
      committed = true;
      return { ...current, application: nextState };
    });
    return committed;
  }

  subscribe(listener: (state: StressLabApplicationState) => void): () => void {
    return this.store.subscribe((next, previous) => {
      if (next.application !== previous.application) {
        listener(next.application);
      }
    });
  }
}

export class ZustandStressLabActivityReporter
  implements StressLabActivityReporter
{
  constructor(
    private readonly store: StoreApi<StressLabRuntimeStoreState>,
    private readonly clock: StressLabActivityClock = SYSTEM_ACTIVITY_CLOCK,
  ) {}

  begin(input: {
    readonly toolName: string;
    readonly operationId?: string;
    readonly argumentSummary: string;
  }): number {
    const now = this.clock.nowMilliseconds();
    const at = isoTime(now);
    let id = 0;
    this.store.setState((current) => {
      id = current.ui.nextActivityId;
      const activity: StressLabWebMcpActivity = Object.freeze({
        id,
        toolName: input.toolName,
        source: "WEBMCP",
        ...(input.operationId ? { operationId: input.operationId } : {}),
        argumentSummary: input.argumentSummary,
        startedAt: at,
        transitions: Object.freeze([
          Object.freeze({ status: "RECEIVED" as const, at }),
        ]),
      });
      return {
        ...current,
        ui: {
          ...current.ui,
          nextActivityId: id + 1,
          activities: Object.freeze(
            [activity, ...current.ui.activities].slice(0, 24),
          ),
        },
      };
    });
    return id;
  }

  advance(id: number, status: "VALIDATED" | "RUNNING"): void {
    const at = isoTime(this.clock.nowMilliseconds());
    this.store.setState((current) => ({
      ...current,
      ui: {
        ...current.ui,
        activities: Object.freeze(
          current.ui.activities.map((activity) => {
            const last = activity.transitions.at(-1)?.status;
            if (
              activity.id !== id ||
              (last !== "RECEIVED" && last !== "VALIDATED") ||
              isTerminal(last)
            ) {
              return activity;
            }
            if (status === "VALIDATED" && last !== "RECEIVED") return activity;
            if (status === "RUNNING" && last !== "VALIDATED") return activity;
            return Object.freeze({
              ...activity,
              transitions: Object.freeze([
                ...activity.transitions,
                Object.freeze({ status, at }),
              ]),
            });
          }),
        ),
      },
    }));
  }

  finish(id: number, terminal: WebMcpActivityTerminal): void {
    const now = this.clock.nowMilliseconds();
    const at = isoTime(now);
    this.store.setState((current) => ({
      ...current,
      ui: {
        ...current.ui,
        activities: Object.freeze(
          current.ui.activities.map((activity) => {
            const last = activity.transitions.at(-1)?.status;
            if (activity.id !== id || isTerminal(last)) return activity;
            return Object.freeze({
              ...activity,
              transitions: Object.freeze([
                ...activity.transitions,
                Object.freeze({ status: terminal.status, at }),
              ]),
              endedAt: at,
              durationMs: Math.max(0, now - Date.parse(activity.startedAt)),
              ...(terminal.resultingRevision === undefined
                ? {}
                : { resultingRevision: terminal.resultingRevision }),
              ...(terminal.artifactId
                ? { artifactId: terminal.artifactId }
                : {}),
              ...(terminal.safeErrorCode
                ? { safeErrorCode: terminal.safeErrorCode }
                : {}),
            });
          }),
        ),
      },
    }));
  }

  focus(objectId: string | undefined): void {
    this.store.setState((current) => ({
      ...current,
      ui: { ...current.ui, focusedObjectId: objectId },
    }));
  }
}

export function publishObservedStressLabView(
  store: StoreApi<StressLabRuntimeStoreState>,
  view: StressLabStateView,
): void {
  store.setState((current) => ({
    ...current,
    ui: { ...current.ui, observedView: view },
  }));
}

export function setStressLabWebMcpStatus(
  store: StoreApi<StressLabRuntimeStoreState>,
  status: StressLabWebMcpStatus,
  message: string,
): void {
  store.setState((current) => ({
    ...current,
    ui: { ...current.ui, webMcpStatus: status, webMcpMessage: message },
  }));
}
