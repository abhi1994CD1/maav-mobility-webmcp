interface RegistrationRecord {
  controller: AbortController;
  definition: WebMCP.ModelContextTool;
  inFlight: number;
  pendingRemoval: boolean;
  removalTimer?: ReturnType<typeof setTimeout>;
}

const POST_SETTLEMENT_DRAIN_GRACE_MS = 50;

export class DrainAwareToolRegistry {
  private readonly records = new Map<string, RegistrationRecord>();
  private readonly drainResolvers = new Set<() => void>();

  constructor(private readonly modelContext: WebMCP.ModelContext) {}

  async reconcile(definitions: WebMCP.ModelContextTool[]): Promise<void> {
    if (new Set(definitions.map((definition) => definition.name)).size !== definitions.length) {
      throw new Error("WebMCP tool definitions must use unique names.");
    }
    const desired = new Map(
      definitions.map((definition) => [definition.name, definition]),
    );

    for (const [name, record] of this.records) {
      if (desired.has(name)) {
        if (record.removalTimer) {
          clearTimeout(record.removalTimer);
          record.removalTimer = undefined;
        }
        record.pendingRemoval = false;
        continue;
      }
      if (record.inFlight > 0) {
        record.pendingRemoval = true;
      } else {
        this.remove(name, record);
      }
    }

    for (const definition of definitions) {
      if (this.records.has(definition.name)) continue;
      await this.register(definition);
    }
  }

  registeredToolNames(): string[] {
    return [...this.records.keys()].sort();
  }

  inFlightCount(name: string): number {
    return this.records.get(name)?.inFlight ?? 0;
  }

  async destroy(): Promise<void> {
    await this.reconcile([]);
    if (this.records.size === 0) return;
    await new Promise<void>((resolve) => {
      this.drainResolvers.add(resolve);
    });
  }

  private async register(definition: WebMCP.ModelContextTool): Promise<void> {
    const controller = new AbortController();
    const record: RegistrationRecord = {
      controller,
      definition,
      inFlight: 0,
      pendingRemoval: false,
    };
    this.records.set(definition.name, record);

    const wrapped: WebMCP.ModelContextTool = {
      ...definition,
      execute: async (input, options) => {
        record.inFlight += 1;
        try {
          return await definition.execute(input, options);
        } finally {
          record.inFlight -= 1;
          if (record.inFlight === 0 && record.pendingRemoval) {
            this.schedulePostSettlementRemoval(definition.name, record);
          }
        }
      },
    };

    try {
      await this.modelContext.registerTool(wrapped, {
        signal: controller.signal,
      });
    } catch (error) {
      if (this.records.get(definition.name) === record) {
        this.records.delete(definition.name);
      }
      controller.abort();
      throw error;
    }
  }

  private remove(name: string, record: RegistrationRecord): void {
    if (this.records.get(name) !== record) return;
    if (record.removalTimer) clearTimeout(record.removalTimer);
    record.controller.abort();
    this.records.delete(name);
    if (this.records.size === 0) {
      for (const resolve of this.drainResolvers) resolve();
      this.drainResolvers.clear();
    }
  }

  private schedulePostSettlementRemoval(
    name: string,
    record: RegistrationRecord,
  ): void {
    if (record.removalTimer) return;
    record.removalTimer = setTimeout(() => {
      record.removalTimer = undefined;
      if (record.inFlight === 0 && record.pendingRemoval) {
        this.remove(name, record);
      }
    }, POST_SETTLEMENT_DRAIN_GRACE_MS);
  }
}
