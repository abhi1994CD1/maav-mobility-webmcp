"use client";

import type { CommandCenterStoreState } from "@/infrastructure/persistence/zustand-repository";
import { useStore } from "zustand";
import { commandCenterStore } from "./runtime";

export function useCommandCenterStore<T>(
  selector: (state: CommandCenterStoreState) => T,
): T {
  return useStore(commandCenterStore, selector);
}
