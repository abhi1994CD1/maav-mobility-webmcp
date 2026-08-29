import type { CommandCenterRepository } from "@/application/ports";
import type { CommandCenterState } from "@/domain/types";

export class TestRepository implements CommandCenterRepository {
  constructor(private state: CommandCenterState) {}

  getState(): CommandCenterState {
    return this.state;
  }

  replaceState(state: CommandCenterState): void {
    this.state = state;
  }
}
