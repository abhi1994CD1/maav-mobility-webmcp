import { DrainAwareToolRegistry } from "./registry";

export type StressLabBridgeStatus =
  | {
      status: "CHECKING";
      message: "Registering two static Chrome WebMCP tools…";
    }
  | {
      status: "AVAILABLE";
      message: "2 static Chrome WebMCP tools registered";
    }
  | {
      status: "UNAVAILABLE";
      message: "WebMCP unavailable — manual mode active";
    }
  | {
      status: "ERROR";
      message: string;
    };

type StatusListener = (status: StressLabBridgeStatus) => void;

interface ActiveStressLabBridgeRuntime {
  modelContext: WebMCP.ModelContext;
  registry: DrainAwareToolRegistry;
  refs: number;
  listeners: Set<StatusListener>;
  status: StressLabBridgeStatus;
  ready: Promise<void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

export interface StressLabBridgeLease {
  ready: Promise<void>;
  release(): void;
}

const STRICT_MODE_DRAIN_GRACE_MS = 100;
const GATE_2_TOOL_NAMES = ["read_lab_state", "configure_scenario"] as const;

function hasExactGateTwoCatalog(
  definitions: readonly WebMCP.ModelContextTool[],
): boolean {
  return (
    definitions.length === GATE_2_TOOL_NAMES.length &&
    definitions.every(
      (definition, index) => definition.name === GATE_2_TOOL_NAMES[index],
    )
  );
}

export function unsupportedStressLabWebMcpStatus(): StressLabBridgeStatus {
  return {
    status: "UNAVAILABLE",
    message: "WebMCP unavailable — manual mode active",
  };
}

function registrationErrorStatus(error: unknown): StressLabBridgeStatus {
  const name = error instanceof Error ? error.name : "RegistrationError";
  return {
    status: "ERROR",
    message:
      name === "NotAllowedError"
        ? "WebMCP blocked by the tools Permissions Policy"
        : "Chrome WebMCP registration failed — manual mode active",
  };
}

export class StaticStressLabBridgeCoordinator {
  private runtime?: ActiveStressLabBridgeRuntime;

  acquire(
    modelContext: WebMCP.ModelContext,
    definitions: readonly WebMCP.ModelContextTool[],
    listener: StatusListener,
  ): StressLabBridgeLease {
    if (!hasExactGateTwoCatalog(definitions)) {
      const status: StressLabBridgeStatus = {
        status: "ERROR",
        message: "Gate 2 WebMCP catalog is invalid — manual mode active",
      };
      listener(status);
      return { ready: Promise.resolve(), release: () => undefined };
    }

    const current = this.runtime;
    if (current) {
      if (current.modelContext !== modelContext) {
        const status: StressLabBridgeStatus = {
          status: "ERROR",
          message:
            "A different WebMCP document context is still draining — manual mode active",
        };
        listener(status);
        return { ready: Promise.resolve(), release: () => undefined };
      }
      current.refs += 1;
      current.listeners.add(listener);
      if (current.cleanupTimer) {
        clearTimeout(current.cleanupTimer);
        current.cleanupTimer = undefined;
      }
      listener(current.status);
      return {
        ready: current.ready,
        release: () => this.release(current, listener),
      };
    }

    const registry = new DrainAwareToolRegistry(modelContext);
    const runtime: ActiveStressLabBridgeRuntime = {
      modelContext,
      registry,
      refs: 1,
      listeners: new Set([listener]),
      status: {
        status: "CHECKING",
        message: "Registering two static Chrome WebMCP tools…",
      },
      ready: Promise.resolve(),
    };
    this.runtime = runtime;
    listener(runtime.status);

    runtime.ready = this.register(runtime, definitions);
    return {
      ready: runtime.ready,
      release: () => this.release(runtime, listener),
    };
  }

  registeredToolNames(): string[] {
    return this.runtime?.registry.registeredToolNames() ?? [];
  }

  private async register(
    runtime: ActiveStressLabBridgeRuntime,
    definitions: readonly WebMCP.ModelContextTool[],
  ): Promise<void> {
    try {
      await runtime.registry.reconcile([...definitions]);
      if (this.runtime !== runtime) return;
      this.publish(runtime, {
        status: "AVAILABLE",
        message: "2 static Chrome WebMCP tools registered",
      });
    } catch (error) {
      await runtime.registry.destroy();
      if (this.runtime !== runtime) return;
      this.publish(runtime, registrationErrorStatus(error));
    }
  }

  private publish(
    runtime: ActiveStressLabBridgeRuntime,
    status: StressLabBridgeStatus,
  ): void {
    runtime.status = status;
    for (const listener of runtime.listeners) listener(status);
  }

  private release(
    runtime: ActiveStressLabBridgeRuntime,
    listener: StatusListener,
  ): void {
    if (this.runtime !== runtime) return;
    runtime.listeners.delete(listener);
    runtime.refs = Math.max(0, runtime.refs - 1);
    if (runtime.refs > 0 || runtime.cleanupTimer) return;

    runtime.cleanupTimer = setTimeout(() => {
      runtime.cleanupTimer = undefined;
      if (this.runtime !== runtime || runtime.refs > 0) return;
      void runtime.ready
        .catch(() => undefined)
        .then(() => runtime.registry.destroy())
        .finally(() => {
          if (this.runtime === runtime && runtime.refs === 0) {
            this.runtime = undefined;
          }
        });
    }, STRICT_MODE_DRAIN_GRACE_MS);
  }
}

interface StressLabBridgeGlobal {
  __maavStressLabBridgeCoordinatorV1?: StaticStressLabBridgeCoordinator;
}

export function getStressLabBridgeCoordinator(): StaticStressLabBridgeCoordinator {
  const globalScope = globalThis as typeof globalThis & StressLabBridgeGlobal;
  globalScope.__maavStressLabBridgeCoordinatorV1 ??=
    new StaticStressLabBridgeCoordinator();
  return globalScope.__maavStressLabBridgeCoordinatorV1;
}
