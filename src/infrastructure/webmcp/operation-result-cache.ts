import { StressLabApplicationError } from "@/application/stress-lab-ports";

interface CachedWebMcpResult<Result> {
  readonly commandIdentity: string;
  readonly promise: Promise<Result>;
}

export class WebMcpOperationResultCache {
  private readonly records = new Map<string, CachedWebMcpResult<unknown>>();

  execute<Result>(
    operationId: string,
    commandIdentity: string,
    action: () => Promise<Result>,
  ): Promise<Result> {
    const existing = this.records.get(operationId);
    if (existing) {
      if (existing.commandIdentity !== commandIdentity) {
        return Promise.reject(
          new StressLabApplicationError(
            "IDEMPOTENCY_CONFLICT",
            operationId,
            "The WebMCP operation ID is bound to different arguments.",
          ),
        );
      }
      return existing.promise as Promise<Result>;
    }
    const promise = Promise.resolve().then(action);
    this.records.set(operationId, { commandIdentity, promise });
    return promise;
  }

  size(): number {
    return this.records.size;
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareCodeUnits)
        .map((key) => [
          key,
          canonicalValue((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

export function webMcpCommandIdentity(
  toolName: string,
  input: unknown,
): string {
  return JSON.stringify({ toolName, input: canonicalValue(input) });
}
