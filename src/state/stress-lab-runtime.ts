import {
  createInitialStressLabApplicationState,
  StressLabService,
} from "@/application/stress-lab-service";
import type {
  StressLabComparisonExecutor,
  StressLabSimulationExecutor,
} from "@/application/stress-lab-ports";
import {
  createStressLabRuntimeStore,
  publishObservedStressLabView,
  setStressLabWebMcpStatus,
  ZustandStressLabActivityReporter,
  ZustandStressLabRepository,
  type StressLabActivityClock,
  type StressLabRuntimeStoreState,
  type StressLabWebMcpStatus,
} from "@/infrastructure/persistence/stress-lab-repository";
import type { StoreApi } from "zustand/vanilla";
import { WebMcpOperationResultCache } from "@/infrastructure/webmcp/operation-result-cache";

export interface StressLabRuntime {
  readonly store: StoreApi<StressLabRuntimeStoreState>;
  readonly repository: ZustandStressLabRepository;
  readonly service: StressLabService;
  readonly activity: ZustandStressLabActivityReporter;
  readonly webMcpResultCache: WebMcpOperationResultCache;
  readObservedView(): NonNullable<StressLabRuntimeStoreState["ui"]["observedView"]>;
  nextManualOperationId(action: string): string;
  waitForObservedRevision(revision: number): Promise<void>;
  updateWebMcpStatus(status: StressLabWebMcpStatus, message: string): void;
  dispose(): void;
}

export function createStressLabRuntime(options: {
  readonly activityClock?: StressLabActivityClock;
  readonly simulationExecutor?: StressLabSimulationExecutor;
  readonly comparisonExecutor?: StressLabComparisonExecutor;
} = {}): StressLabRuntime {
  const store = createStressLabRuntimeStore(
    createInitialStressLabApplicationState(),
  );
  const repository = new ZustandStressLabRepository(store);
  const service = new StressLabService(
    repository,
    options.simulationExecutor,
    options.comparisonExecutor,
  );
  const activity = options.activityClock
    ? new ZustandStressLabActivityReporter(store, options.activityClock)
    : new ZustandStressLabActivityReporter(store);
  const webMcpResultCache = new WebMcpOperationResultCache();
  const unsubscribeView = service.subscribe((view) => {
    publishObservedStressLabView(store, view);
  });
  publishObservedStressLabView(store, service.readLabState());
  let manualOperationSequence = 1;

  return {
    store,
    repository,
    service,
    activity,
    webMcpResultCache,
    readObservedView() {
      const view = store.getState().ui.observedView;
      if (!view) throw new Error("Stress Lab runtime view is not initialized.");
      return view;
    },
    nextManualOperationId(action) {
      const safeAction = action
        .toLowerCase()
        .replace(/[^a-z0-9-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 32) || "command";
      const operationId = `human-${safeAction}-${manualOperationSequence}`;
      manualOperationSequence += 1;
      return operationId;
    },
    waitForObservedRevision(revision) {
      if ((store.getState().ui.observedView?.revision ?? -1) >= revision) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const unsubscribe = store.subscribe((state) => {
          if ((state.ui.observedView?.revision ?? -1) >= revision) {
            unsubscribe();
            resolve();
          }
        });
      });
    },
    updateWebMcpStatus(status, message) {
      setStressLabWebMcpStatus(store, status, message);
    },
    dispose() {
      unsubscribeView();
      service.dispose();
    },
  };
}

declare global {
  interface Window {
    __maavStressLabRuntimeV1?: StressLabRuntime;
  }
}

export function getBrowserStressLabRuntime(): StressLabRuntime {
  if (typeof window === "undefined") {
    throw new Error("Stress Lab browser runtime is available in a browser tab only.");
  }
  window.__maavStressLabRuntimeV1 ??= createStressLabRuntime();
  return window.__maavStressLabRuntimeV1;
}
