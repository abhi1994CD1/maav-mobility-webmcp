import { afterEach, describe, expect, it, vi } from "vitest";
import type { OperationalPhase } from "@/domain/types";
import { DrainAwareToolRegistry } from "@/infrastructure/webmcp/registry";
import {
  auditInputSchema,
  evaluateInputSchema,
  rollbackInputSchema,
  snapshotInputSchema,
  stageInputSchema,
} from "@/infrastructure/webmcp/schemas";
import { toolsForPhase } from "@/infrastructure/webmcp/tools";

afterEach(() => vi.useRealTimers());

describe("WebMCP schemas", () => {
  it("accepts documented inputs and rejects additional properties", () => {
    expect(snapshotInputSchema.safeParse({ focus: "all" }).success).toBe(true);
    expect(
      snapshotInputSchema.safeParse({ focus: "all", secret: "x" }).success,
    ).toBe(false);
    expect(
      evaluateInputSchema.safeParse({
        expectedRevision: 1,
        objectives: {
          minimumOnTimePercent: 95,
          maximumWaitMinutes: 5,
          preserveAccessibility: true,
          maximumEnergyIncreasePercent: 8,
        },
      }).success,
    ).toBe(true);
    expect(stageInputSchema.safeParse({ planId: "p", expectedRevision: -1 }).success).toBe(false);
    expect(rollbackInputSchema.safeParse({ reason: "", expectedRevision: 5 }).success).toBe(false);
    expect(auditInputSchema.safeParse({ afterSequence: 0, limit: 101 }).success).toBe(false);
  });
});

describe("dynamic tool matrix", () => {
  const expected: Record<OperationalPhase, string[]> = {
    READY: ["get_action_audit_log", "get_network_snapshot"],
    INCIDENT_ACTIVE: [
      "evaluate_recovery_options",
      "get_action_audit_log",
      "get_network_snapshot",
    ],
    OPTIONS_EVALUATED: [
      "get_action_audit_log",
      "get_network_snapshot",
      "stage_recovery_plan",
    ],
    PLAN_STAGED: ["get_action_audit_log", "get_network_snapshot"],
    APPROVED: [
      "commit_approved_recovery",
      "get_action_audit_log",
      "get_network_snapshot",
    ],
    RECOVERED: [
      "get_action_audit_log",
      "get_network_snapshot",
      "rollback_last_recovery",
    ],
    ROLLED_BACK: ["get_action_audit_log", "get_network_snapshot"],
  };

  for (const [phase, names] of Object.entries(expected)) {
    it(`registers the exact ${phase} surface`, () => {
      const tools = toolsForPhase(phase as OperationalPhase);
      expect(tools.map((tool) => tool.name).sort()).toEqual(names);
      expect(tools.some((tool) => tool.name === "activate_demo_incident")).toBe(false);
      for (const tool of tools) {
        expect(tool.title).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(20);
        expect(tool.inputSchema).toBeTruthy();
        expect(tool.annotations).toBeTruthy();
        expect("outputSchema" in tool).toBe(false);
      }
    });
  }

  it("marks only read tools read-only and audit output untrusted", () => {
    const tools = toolsForPhase("INCIDENT_ACTIVE");
    expect(tools.find((tool) => tool.name === "get_network_snapshot")?.annotations)
      .toMatchObject({ readOnlyHint: true, untrustedContentHint: false });
    expect(tools.find((tool) => tool.name === "get_action_audit_log")?.annotations)
      .toMatchObject({ readOnlyHint: true, untrustedContentHint: true });
    expect(tools.find((tool) => tool.name === "evaluate_recovery_options")?.annotations)
      .toMatchObject({ readOnlyHint: false, untrustedContentHint: false });
  });

  it("tolerates Chrome 150 executeTool omitting callback options", async () => {
    const tool = toolsForPhase("INCIDENT_ACTIVE").find(
      (candidate) => candidate.name === "evaluate_recovery_options",
    );
    const executeWithoutOptions = tool?.execute as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>;

    await expect(executeWithoutOptions({})).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
});

describe("drain-aware registry", () => {
  it("defers removal until an in-flight invocation settles", async () => {
    vi.useFakeTimers();
    let registeredTool: WebMCP.ModelContextTool | undefined;
    let registrationSignal: AbortSignal | undefined;
    const modelContext = {
      registerTool: async (
        tool: WebMCP.ModelContextTool,
        options?: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        registeredTool = tool;
        registrationSignal = options?.signal;
      },
    } as unknown as WebMCP.ModelContext;
    const registry = new DrainAwareToolRegistry(modelContext);
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const tool: WebMCP.ModelContextTool = {
      name: "long_tool",
      title: "Long tool",
      description: "Waits until the contract test releases it.",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
      execute: async () => {
        await gate;
        return { ok: true };
      },
    };

    await registry.reconcile([tool]);
    const invocation = registeredTool!.execute({}, { signal: new AbortController().signal });
    expect(registry.inFlightCount("long_tool")).toBe(1);

    await registry.reconcile([]);
    expect(registrationSignal?.aborted).toBe(false);
    expect(registry.registeredToolNames()).toEqual(["long_tool"]);

    finish!();
    await invocation;
    expect(registrationSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(registrationSignal?.aborted).toBe(true);
    expect(registry.registeredToolNames()).toEqual([]);
  });
});
