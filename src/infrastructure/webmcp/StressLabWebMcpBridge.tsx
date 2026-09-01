"use client";

import { useEffect } from "react";
import { getBrowserStressLabRuntime } from "@/state/stress-lab-runtime";
import {
  getStressLabBridgeCoordinator,
  unsupportedStressLabWebMcpStatus,
} from "./stress-lab-bridge-runtime";
import { createStressLabWebMcpTools } from "./stress-lab-tools";

export function StressLabWebMcpBridge() {
  useEffect(() => {
    const runtime = getBrowserStressLabRuntime();
    const modelContext = document.modelContext;
    const isSecureTopLevelDocument =
      window.isSecureContext &&
      window.top === window &&
      document.defaultView === window;
    if (!modelContext || !isSecureTopLevelDocument) {
      const status = unsupportedStressLabWebMcpStatus();
      runtime.updateWebMcpStatus(status.status, status.message);
      return;
    }

    const stressLabTools = createStressLabWebMcpTools({
      service: runtime.service,
      activity: runtime.activity,
      resultCache: runtime.webMcpResultCache,
      readObservedView: () => runtime.readObservedView(),
      waitForObservedRevision: (revision) =>
        runtime.waitForObservedRevision(revision),
    });

    const lease = getStressLabBridgeCoordinator().acquire(
      modelContext,
      stressLabTools,
      (status) => runtime.updateWebMcpStatus(status.status, status.message),
    );
    return lease.release;
  }, []);

  return null;
}
