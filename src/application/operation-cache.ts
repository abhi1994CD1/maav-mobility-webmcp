export interface OperationIdentity {
  readonly operationId: string;
  readonly commandName: string;
  readonly commandFingerprint: string;
}

interface CachedOperation<Result> extends OperationIdentity {
  readonly promise: Promise<Result>;
}

/**
 * Tab-scoped in-process idempotency. A pending record is installed before the
 * command starts so subscriber re-entry coalesces onto the same promise.
 */
export class OperationCache {
  private readonly records = new Map<string, CachedOperation<unknown>>();

  constructor(
    private readonly conflict: (
      operationId: string,
      existingCommandName: string,
      requestedCommandName: string,
    ) => Error,
  ) {}

  execute<Result>(
    identity: OperationIdentity,
    command: () => Promise<Result> | Result,
  ): Promise<Result> {
    const existing = this.records.get(identity.operationId);
    if (existing) {
      if (
        existing.commandName !== identity.commandName ||
        existing.commandFingerprint !== identity.commandFingerprint
      ) {
        return Promise.reject(
          this.conflict(
            identity.operationId,
            existing.commandName,
            identity.commandName,
          ),
        );
      }
      return existing.promise as Promise<Result>;
    }

    let resolvePromise!: (result: Result) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<Result>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    this.records.set(identity.operationId, { ...identity, promise });

    try {
      Promise.resolve(command()).then(resolvePromise, rejectPromise);
    } catch (error) {
      rejectPromise(error);
    }
    return promise;
  }

  size(): number {
    return this.records.size;
  }
}
