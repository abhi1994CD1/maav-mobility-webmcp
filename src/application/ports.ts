import type { CommandCenterState } from "@/domain/types";

export interface CommandCenterRepository {
  getState(): CommandCenterState;
  replaceState(state: CommandCenterState): void;
}
