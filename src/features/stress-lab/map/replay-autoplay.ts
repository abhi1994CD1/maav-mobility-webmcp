import type { ScenarioSlot } from "@/domain/stress-lab/types";

export type ReplayAutoplaySource = "HUMAN_UI" | "WEBMCP";

export interface ReplayAutoplayRequest {
  readonly id: string;
  readonly slot: ScenarioSlot;
  readonly runId: string;
  readonly source: ReplayAutoplaySource;
}

export type ReplayAutoplayOutcome =
  | "COMPLETED"
  | "REDUCED_MOTION"
  | "RUN_UNAVAILABLE";

export interface ReplayQueueSettlement {
  readonly settled: boolean;
  readonly next: ReplayAutoplayRequest | null;
  readonly idle: boolean;
}

function immutableRequest(
  request: ReplayAutoplayRequest,
): ReplayAutoplayRequest {
  return Object.freeze({ ...request });
}

export class ReplayAutoplayQueue {
  private active: ReplayAutoplayRequest | null = null;
  private readonly pending: ReplayAutoplayRequest[] = [];
  private readonly knownIds = new Set<string>();

  enqueue(request: ReplayAutoplayRequest): ReplayAutoplayRequest | null {
    if (this.knownIds.has(request.id)) return null;
    const immutable = immutableRequest(request);
    this.knownIds.add(immutable.id);
    if (this.active) {
      this.pending.push(immutable);
      return null;
    }
    this.active = immutable;
    return immutable;
  }

  settle(id: string): ReplayQueueSettlement {
    if (this.active?.id !== id) {
      return Object.freeze({
        settled: false,
        next: this.active,
        idle: this.active === null,
      });
    }
    this.active = this.pending.shift() ?? null;
    return Object.freeze({
      settled: true,
      next: this.active,
      idle: this.active === null,
    });
  }

  hasWork(): boolean {
    return this.active !== null;
  }

  getActive(): ReplayAutoplayRequest | null {
    return this.active;
  }
}
