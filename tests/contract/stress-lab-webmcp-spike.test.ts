import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialStressLabSpikeState,
  StressLabSpikeService,
  type ConfigureScenarioCommand,
} from "@/application/stress-lab/spike-service";
import {
  createStressLabSpikeStore,
  ZustandStressLabActivityReporter,
  ZustandStressLabSpikeRepository,
} from "@/infrastructure/persistence/stress-lab-spike-repository";
import { StaticStressLabBridgeCoordinator } from "@/infrastructure/webmcp/stress-lab-bridge-runtime";
import {
  stressLabConfigureInputSchema,
  stressLabReadInputSchema,
} from "@/infrastructure/webmcp/stress-lab-schemas";
import { createStressLabSpikeTools } from "@/infrastructure/webmcp/stress-lab-tools";

afterEach(() => vi.useRealTimers());

function createHarness() {
  const store = createStressLabSpikeStore(createInitialStressLabSpikeState());
  const repository = new ZustandStressLabSpikeRepository(store);
  const service = new StressLabSpikeService(repository);
  const activity = new ZustandStressLabActivityReporter(store);
  const tools = createStressLabSpikeTools({ service, activity });
  return { store, service, tools };
}

function goldenCommand(
  overrides: Partial<ConfigureScenarioCommand> = {},
): ConfigureScenarioCommand {
  return {
    operationId: "gate2-a-r1",
    expectedRevision: 0,
    slot: "A",
    mode: "REPLACE",
    configuration: {
      label: "Twelve compact pods",
      fleet: { vehicleCount: 12, seatsPerVehicle: 8 },
    },
    ...overrides,
  };
}

function asToolInput(
  command: ConfigureScenarioCommand,
): Record<string, unknown> {
  return { ...command };
}

function toolNamed(
  tools: readonly WebMCP.ModelContextTool[],
  name: string,
): WebMCP.ModelContextTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing test tool: ${name}`);
  return tool;
}

describe("Gate 2 Stress Lab WebMCP schemas", () => {
  it("accepts the bounded contracts and rejects unknown fields", () => {
    expect(stressLabReadInputSchema.safeParse({}).success).toBe(true);
    expect(
      stressLabReadInputSchema.safeParse({ scope: "SUMMARY", secret: true })
        .success,
    ).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse(goldenCommand()).success).toBe(
      true,
    );
    expect(
      stressLabConfigureInputSchema.safeParse({
        ...goldenCommand(),
        unknown: "rejected",
      }).success,
    ).toBe(false);
  });
});

describe("Gate 2 Stress Lab WebMCP catalog", () => {
  it("exposes exactly two narrow tools with the required metadata", () => {
    const { tools } = createHarness();
    expect(tools.map((tool) => tool.name)).toEqual([
      "read_lab_state",
      "configure_scenario",
    ]);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true });
    expect(tools[1].annotations).toMatchObject({ readOnlyHint: false });

    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect("outputSchema" in tool).toBe(false);
    }
  });

  it("keeps tool adapters thin and free from direct Zustand mutation", () => {
    const source = readFileSync(
      "src/infrastructure/webmcp/stress-lab-tools.ts",
      "utf8",
    );
    expect(source).not.toMatch(/from ["']zustand/u);
    expect(source).not.toContain(".setState(");
    expect(source).not.toContain("createStore(");
  });
});

describe("Gate 2 shared application boundary", () => {
  it("reads compact provisional state without changing the revision", async () => {
    const { store, tools } = createHarness();
    const result = await toolNamed(tools, "read_lab_state").execute(
      { scope: "SUMMARY" },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      ok: true,
      stateRevision: 0,
      summary: {
        stateKind: "PROVISIONAL_INTEGRATION_TEST",
        simulatorStatus: "NOT_IMPLEMENTED_IN_GATE_2",
        scenarios: { A: null, B: null },
      },
    });
    expect(store.getState().domain.revision).toBe(0);
    expect(JSON.stringify(result)).not.toContain("undefined");
  });

  it("commits a WebMCP mutation before returning and records provenance", async () => {
    const { store, tools } = createHarness();
    const result = await toolNamed(tools, "configure_scenario").execute(
      asToolInput(goldenCommand()),
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      ok: true,
      operationId: "gate2-a-r1",
      stateRevision: 1,
      status: "COMPLETED",
      summary: {
        scenario: {
          slot: "A",
          source: "WEBMCP",
          totalSeats: 96,
        },
      },
    });
    expect(store.getState().domain).toMatchObject({
      revision: 1,
      scenarios: { A: { source: "WEBMCP", totalSeats: 96 } },
    });
    expect(store.getState().ui.activities[0]).toMatchObject({
      source: "WEBMCP",
      actionName: "configure_scenario",
      status: "SUCCEEDED",
      resultingRevision: 1,
    });

    const readBack = await toolNamed(tools, "read_lab_state").execute(
      { scope: "SCENARIO", objectId: "A" },
      { signal: new AbortController().signal },
    );
    expect(readBack).toMatchObject({
      ok: true,
      stateRevision: 1,
      summary: { scenarios: { A: { totalSeats: 96 } } },
    });
  });

  it("uses the same service and repository for a manual mutation", () => {
    const { store, service } = createHarness();
    const result = service.configureScenario(
      goldenCommand({ operationId: "manual-a-r1" }),
      "HUMAN_UI",
    );

    expect(result).toMatchObject({ ok: true, stateRevision: 1 });
    expect(store.getState().domain.scenarios.A).toMatchObject({
      source: "HUMAN_UI",
      totalSeats: 96,
    });
  });

  it("rejects invalid, ambiguous, stale, and cancelled writes without mutation", async () => {
    const { store, tools } = createHarness();
    const configure = toolNamed(tools, "configure_scenario");

    const invalid = await configure.execute(
      { ...goldenCommand(), unknown: true },
      { signal: new AbortController().signal },
    );
    expect(invalid).toMatchObject({
      ok: false,
      stateRevision: 0,
      error: { code: "INVALID_ARGUMENTS" },
    });

    const ambiguous = await configure.execute(
      { operationId: "ambiguous-1", expectedRevision: 0 },
      { signal: new AbortController().signal },
    );
    expect(ambiguous).toMatchObject({
      ok: false,
      stateRevision: 0,
      error: {
        code: "NEEDS_CLARIFICATION",
        missingFields: expect.arrayContaining(["slot", "mode", "configuration"]),
      },
    });

    const stale = await configure.execute(
      asToolInput(
        goldenCommand({ operationId: "stale-1", expectedRevision: 9 }),
      ),
      { signal: new AbortController().signal },
    );
    expect(stale).toMatchObject({
      ok: false,
      stateRevision: 0,
      error: { code: "REVISION_CONFLICT", currentRevision: 0 },
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = await configure.execute(
      asToolInput(goldenCommand({ operationId: "cancelled-1" })),
      { signal: controller.signal },
    );
    expect(cancelled).toMatchObject({
      ok: false,
      stateRevision: 0,
      error: { code: "OPERATION_CANCELLED" },
    });
    expect(store.getState().domain).toMatchObject({
      revision: 0,
      scenarios: {},
      operations: {},
    });
  });

  it("provides retry-safe idempotency and rejects operation ID reuse", async () => {
    const { store, tools } = createHarness();
    const configure = toolNamed(tools, "configure_scenario");
    const options = { signal: new AbortController().signal };

    const first = await configure.execute(asToolInput(goldenCommand()), options);
    const retry = await configure.execute(asToolInput(goldenCommand()), options);
    const conflict = await configure.execute(
      asToolInput(
        goldenCommand({
          configuration: {
            label: "Different request",
            fleet: { vehicleCount: 10, seatsPerVehicle: 10 },
          },
        }),
      ),
      options,
    );

    expect(first).toMatchObject({ ok: true, status: "COMPLETED" });
    expect(retry).toMatchObject({
      ok: true,
      status: "REUSED",
      stateRevision: 1,
    });
    expect(conflict).toMatchObject({
      ok: false,
      stateRevision: 1,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(store.getState().domain.revision).toBe(1);
  });

  it("validates manual service calls independently of adapter typing", () => {
    const { store, service } = createHarness();
    const invalid = service.configureScenario(
      goldenCommand({
        configuration: {
          label: "<unsafe>",
          fleet: { vehicleCount: 12, seatsPerVehicle: 8 },
        },
      }),
      "HUMAN_UI",
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENTS", field: "configuration.label" },
    });
    expect(store.getState().domain.revision).toBe(0);
  });
});

describe("Gate 2 static registration lifecycle", () => {
  it("preserves the canonical coordinator and shared state across module reload", async () => {
    const runtimeGlobal = globalThis as typeof globalThis & {
      __maavStressLabSpikeRuntimeV1?: unknown;
      __maavStressLabBridgeCoordinatorV1?: unknown;
    };
    delete runtimeGlobal.__maavStressLabSpikeRuntimeV1;
    delete runtimeGlobal.__maavStressLabBridgeCoordinatorV1;
    vi.resetModules();

    const firstRuntime = await import("@/state/stress-lab-spike-runtime");
    const firstBridge = await import(
      "@/infrastructure/webmcp/stress-lab-bridge-runtime"
    );
    const firstCoordinator = firstBridge.getStressLabBridgeCoordinator();
    const firstStore = firstRuntime.stressLabSpikeStore;

    vi.resetModules();
    const reloadedRuntime = await import("@/state/stress-lab-spike-runtime");
    const reloadedBridge = await import(
      "@/infrastructure/webmcp/stress-lab-bridge-runtime"
    );

    expect(reloadedRuntime.stressLabSpikeStore).toBe(firstStore);
    expect(reloadedBridge.getStressLabBridgeCoordinator()).toBe(
      firstCoordinator,
    );

    delete runtimeGlobal.__maavStressLabSpikeRuntimeV1;
    delete runtimeGlobal.__maavStressLabBridgeCoordinatorV1;
    vi.resetModules();
  });

  it("does not duplicate tools across Strict Mode remounts", async () => {
    vi.useFakeTimers();
    const registrations: Array<{
      tool: WebMCP.ModelContextTool;
      signal?: AbortSignal;
    }> = [];
    const modelContext = {
      registerTool: vi.fn(
        async (
          tool: WebMCP.ModelContextTool,
          options?: WebMCP.ModelContextRegisterToolOptions,
        ) => {
          registrations.push({ tool, signal: options?.signal });
        },
      ),
    } as unknown as WebMCP.ModelContext;
    const { tools } = createHarness();
    const coordinator = new StaticStressLabBridgeCoordinator();
    const listener = vi.fn();

    const first = coordinator.acquire(modelContext, tools, listener);
    const second = coordinator.acquire(modelContext, tools, listener);
    await Promise.all([first.ready, second.ready]);
    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      "read_lab_state",
      "configure_scenario",
    ]);

    first.release();
    second.release();
    await vi.advanceTimersByTimeAsync(50);
    const remount = coordinator.acquire(modelContext, tools, listener);
    await remount.ready;
    expect(modelContext.registerTool).toHaveBeenCalledTimes(2);
    expect(coordinator.registeredToolNames()).toEqual([
      "configure_scenario",
      "read_lab_state",
    ]);

    remount.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(registrations.every(({ signal }) => signal?.aborted)).toBe(true);
  });

  it("fails closed instead of registering a widened catalog", async () => {
    const modelContext = {
      registerTool: vi.fn(async () => undefined),
    } as unknown as WebMCP.ModelContext;
    const { tools } = createHarness();
    const coordinator = new StaticStressLabBridgeCoordinator();
    const listener = vi.fn();
    const lease = coordinator.acquire(modelContext, [tools[0]], listener);
    await lease.ready;

    expect(modelContext.registerTool).not.toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith({
      status: "ERROR",
      message: "Gate 2 WebMCP catalog is invalid — manual mode active",
    });
  });
});
