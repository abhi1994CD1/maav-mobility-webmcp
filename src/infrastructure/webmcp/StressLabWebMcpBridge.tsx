"use client";

import { useEffect } from "react";
import {
  stressLabSpikeActivity,
  stressLabSpikeService,
  updateStressLabWebMcpStatus,
} from "@/state/stress-lab-spike-runtime";
import {
  getStressLabBridgeCoordinator,
  unsupportedStressLabWebMcpStatus,
} from "./stress-lab-bridge-runtime";
import { createStressLabSpikeTools } from "./stress-lab-tools";

const stressLabTools = createStressLabSpikeTools({
  service: stressLabSpikeService,
  activity: stressLabSpikeActivity,
});

export function StressLabWebMcpBridge() {
  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) {
      const status = unsupportedStressLabWebMcpStatus();
      updateStressLabWebMcpStatus(status.status, status.message);
      return;
    }

    const lease = getStressLabBridgeCoordinator().acquire(
      modelContext,
      stressLabTools,
      (status) =>
        updateStressLabWebMcpStatus(status.status, status.message),
    );
    return lease.release;
  }, []);

  return null;
}
