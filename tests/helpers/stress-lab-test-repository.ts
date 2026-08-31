import {
  createInitialStressLabApplicationState,
} from "@/application/stress-lab-service";
import type {
  StressLabApplicationRepository,
  StressLabApplicationState,
} from "@/application/stress-lab-ports";

export class StressLabTestRepository
  implements StressLabApplicationRepository
{
  private state: StressLabApplicationState;
  private readonly listeners = new Set<
    (state: StressLabApplicationState) => void
  >();

  constructor(
    initialState: StressLabApplicationState =
      createInitialStressLabApplicationState(),
  ) {
    this.state = initialState;
  }

  getState(): StressLabApplicationState {
    return this.state;
  }

  compareAndSwap(
    expectedRevision: number,
    nextState: StressLabApplicationState,
  ): boolean {
    if (this.state.revision !== expectedRevision) return false;
    if (nextState.revision !== expectedRevision + 1) {
      throw new Error("Test repository requires one revision per commit.");
    }
    this.state = nextState;
    for (const listener of [...this.listeners]) listener(this.state);
    return true;
  }

  subscribe(
    listener: (state: StressLabApplicationState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
