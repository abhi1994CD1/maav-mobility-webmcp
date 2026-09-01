import { DrainAwareToolRegistry } from "./registry";
import { STRESS_LAB_WEBMCP_TOOL_NAMES } from "./stress-lab-tools";

export type StressLabBridgeStatus =
  | {
      readonly status: "CHECKING";
      readonly message: "Registering six static Chrome WebMCP tools…";
    }
  | {
      readonly status: "AVAILABLE";
      readonly message: "6 static Chrome WebMCP tools registered";
    }
  | {
      readonly status: "UNAVAILABLE";
      readonly message: "WebMCP unavailable — manual mode active";
    }
  | {
      readonly status: "ERROR";
      readonly message: string;
    };

type StatusListener = (status: StressLabBridgeStatus) => void;

interface ActiveStressLabBridgeRuntime {
  readonly modelContext: WebMCP.ModelContext;
  readonly registry: DrainAwareToolRegistry;
  readonly listeners: Set<StatusListener>;
  refs: number;
  status: StressLabBridgeStatus;
  ready: Promise<void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

export interface StressLabBridgeLease {
  readonly ready: Promise<void>;
  release(): void;
}

const STRICT_MODE_DRAIN_GRACE_MS = 100;
const EXPECTED_NAMES = [...STRESS_LAB_WEBMCP_TOOL_NAMES].sort();

function sortedNames(definitions: readonly { readonly name: string }[]): string[] {
  return definitions.map((definition) => definition.name).sort();
}

function hasExactCatalog(definitions: readonly WebMCP.ModelContextTool[]): boolean {
  const names = sortedNames(definitions);
  return (
    names.length === EXPECTED_NAMES.length &&
    new Set(names).size === names.length &&
    names.every((name, index) => name === EXPECTED_NAMES[index])
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
    if (!hasExactCatalog(definitions)) {
      listener({
        status: "ERROR",
        message: "Stress Lab WebMCP catalog is invalid — manual mode active",
      });
      return { ready: Promise.resolve(), release: () => undefined };
    }

    const current = this.runtime;
    if (current) {
      if (current.modelContext !== modelContext) {
        listener({
          status: "ERROR",
          message:
            "A different WebMCP document context is still draining — manual mode active",
        });
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

    const runtime: ActiveStressLabBridgeRuntime = {
      modelContext,
      registry: new DrainAwareToolRegistry(modelContext),
      refs: 1,
      listeners: new Set([listener]),
      status: {
        status: "CHECKING",
        message: "Registering six static Chrome WebMCP tools…",
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
      const visible = await runtime.modelContext.getTools();
      const visibleNames = sortedNames(visible);
      if (
        visibleNames.length !== EXPECTED_NAMES.length ||
        !visibleNames.every((name, index) => name === EXPECTED_NAMES[index])
      ) {
        throw new Error("Registered WebMCP catalog does not match the six-tool contract.");
      }
      if (this.runtime !== runtime) return;
      this.publish(runtime, {
        status: "AVAILABLE",
        message: "6 static Chrome WebMCP tools registered",
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

declare global {
  interface Window {
    __maavStressLabBridgeCoordinatorV2?: StaticStressLabBridgeCoordinator;
  }
}

export function getStressLabBridgeCoordinator(): StaticStressLabBridgeCoordinator {
  if (typeof window === "undefined") {
    throw new Error("Stress Lab WebMCP registration is browser-only.");
  }
  window.__maavStressLabBridgeCoordinatorV2 ??=
    new StaticStressLabBridgeCoordinator();
  return window.__maavStressLabBridgeCoordinatorV2;
}
