"use client";

import type { StressLabSpikeStoreState } from "@/infrastructure/persistence/stress-lab-spike-repository";
import { useStore } from "zustand";
import { stressLabSpikeStore } from "./stress-lab-spike-runtime";

export function useStressLabSpikeStore<T>(
  selector: (state: StressLabSpikeStoreState) => T,
): T {
  return useStore(stressLabSpikeStore, selector);
}
