"use client";

import { useEffect } from "react";
import {
  commandCenterStore,
  setWebMcpStatus,
} from "@/state/runtime";
import { DrainAwareToolRegistry } from "./registry";
import { toolsForPhase } from "./tools";

interface BridgeRuntime {
  registry: DrainAwareToolRegistry;
  refs: number;
  previousPhase: ReturnType<typeof commandCenterStore.getState>["domain"]["phase"];
  unsubscribe: () => void;
  cleanupTimer?: number;
}

let activeRuntime: BridgeRuntime | undefined;

function acquireBridge(modelContext: WebMCP.ModelContext): () => void {
  if (activeRuntime) {
    activeRuntime.refs += 1;
    if (activeRuntime.cleanupTimer) {
      window.clearTimeout(activeRuntime.cleanupTimer);
      activeRuntime.cleanupTimer = undefined;
    }
    return releaseBridge;
  }

  const registry = new DrainAwareToolRegistry(modelContext);
  const runtime: BridgeRuntime = {
    registry,
    refs: 1,
    previousPhase: commandCenterStore.getState().domain.phase,
    unsubscribe: () => undefined,
  };
  activeRuntime = runtime;

  const reconcile = async () => {
    try {
      const definitions = toolsForPhase(runtime.previousPhase);
      await registry.reconcile(definitions);
      if (activeRuntime === runtime) {
        setWebMcpStatus(
          "AVAILABLE",
          `${definitions.length} Chrome WebMCP tools active`,
        );
      }
    } catch (error) {
      if (activeRuntime !== runtime) return;
      const errorName = error instanceof Error ? error.name : "RegistrationError";
      const message =
        errorName === "NotAllowedError"
          ? "WebMCP blocked by the tools Permissions Policy."
          : `${errorName}: WebMCP registration failed.`;
      setWebMcpStatus("ERROR", message);
    }
  };

  void reconcile();
  runtime.unsubscribe = commandCenterStore.subscribe((state) => {
    if (state.domain.phase === runtime.previousPhase) return;
    runtime.previousPhase = state.domain.phase;
    void reconcile();
  });

  return releaseBridge;
}

function releaseBridge(): void {
  const runtime = activeRuntime;
  if (!runtime) return;
  runtime.refs -= 1;
  if (runtime.refs > 0) return;

  runtime.cleanupTimer = window.setTimeout(() => {
    if (activeRuntime !== runtime || runtime.refs > 0) return;
    runtime.unsubscribe();
    void runtime.registry.destroy();
    activeRuntime = undefined;
  }, 50);
}

export function WebMcpBridge() {
  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) {
      setWebMcpStatus(
        "UNAVAILABLE",
        "WebMCP unavailable — manual demo controls remain enabled.",
      );
      return;
    }

    return acquireBridge(modelContext);
  }, []);

  return null;
}
