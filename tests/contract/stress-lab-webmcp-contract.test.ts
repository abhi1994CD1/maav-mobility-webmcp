import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HUMAN_UI_INVOCATION_CONTEXT,
  type ScenarioMutationResult,
  type RunExecutionContext,
  type StressLabSimulationExecutor,
} from "@/application/stress-lab-ports";
import { StaticStressLabBridgeCoordinator } from "@/infrastructure/webmcp/stress-lab-bridge-runtime";
import {
  stressLabCompareInputSchema,
  stressLabConfigureJsonSchema,
  stressLabConfigureInputSchema,
  stressLabInjectInputSchema,
  stressLabInjectJsonSchema,
  stressLabReadInputSchema,
  stressLabRunInputSchema,
  stressLabStageFindingInputSchema,
} from "@/infrastructure/webmcp/stress-lab-schemas";
import {
  createStressLabWebMcpTools,
  STRESS_LAB_WEBMCP_TOOL_NAMES,
  type StressLabWebMcpResult,
} from "@/infrastructure/webmcp/stress-lab-tools";
import { createStressLabRuntime, type StressLabRuntime } from "@/state/stress-lab-runtime";

const GOLDEN = Object.freeze({
  inputA: "sha256-v1:5156b1558d9767d60d1d050df868adb54b8075a0681ccea50dad07071b64afae",
  inputB: "sha256-v1:e1e6b94a79218c817ac346922309f87f35755bbd3721142d68db58b67111d80c",
  ledgerA: "sha256-v1:ca01cda9ae8edcf84ee8319304b7bd4853df5ecc5d0d0262d36a03acdfcc875b",
  resultA: "sha256-v1:d9138005105a050eea5974fe1a6ef0b2680204f15662463ca7fa6d08965d40ad",
  ledgerB: "sha256-v1:4df5d2078a36d16240e4f9e12bbb2403a8a4db92f9034e6c27bcc1a8c5bc2eb3",
  resultB: "sha256-v1:89dbf5e7080850c849d221b6c6646148bdd017db5ac2988285caf49034744511",
  comparison: "sha256-v1:8cee91dea5021953fe1a606daf2c0a240639699b18669642f0ef9f4800f3be37",
  finding: "sha256-v1:f169bf3fd971e2e490378ec1f3a247bfdc73beb713c76f54edbf09fbea9e64ff",
});

const BASE_CONFIGURATION = Object.freeze({
  label: "Twelve compact pods",
  fleet: Object.freeze({
    vehicleCount: 12,
    seatsPerVehicle: 8,
    batteryCapacityKWh: 70,
    startingBatteryPercent: 82,
    minimumReservePercent: 20,
    energyKWhPerKm: 0.21,
    dwellSeconds: 30,
    initialZoneWeights: Object.freeze({
      sandton: 30,
      parkmore: 15,
      illovo: 20,
      rosebank: 25,
      "melrose-arch": 10,
    }),
  }),
  constraints: Object.freeze({
    maximumWaitSeconds: 180,
    maximumUnservedPassengers: 12,
    minimumBatteryReservePercent: 20,
    maximumRecoverySeconds: 600,
    standingAllowed: false as const,
  }),
  objectives: Object.freeze([
    "LOWER_WAIT" as const,
    "LOWER_ENERGY_PER_PASSENGER_KM" as const,
    "HIGHER_UTILIZATION" as const,
    "FASTER_RECOVERY" as const,
    "LOWER_EMPTY_KM" as const,
  ]),
});

function configuration(slot: "A" | "B") {
  return {
    ...BASE_CONFIGURATION,
    label: slot === "A" ? "Twelve compact pods" : "Ten higher-capacity pods",
    fleet: {
      ...BASE_CONFIGURATION.fleet,
      vehicleCount: slot === "A" ? 12 : 10,
      seatsPerVehicle: slot === "A" ? 8 : 10,
      initialZoneWeights: { ...BASE_CONFIGURATION.fleet.initialZoneWeights },
    },
    constraints: { ...BASE_CONFIGURATION.constraints },
    objectives: [...BASE_CONFIGURATION.objectives],
  };
}

function dependencies(runtime: StressLabRuntime) {
  return {
    service: runtime.service,
    activity: runtime.activity,
    resultCache: runtime.webMcpResultCache,
    readObservedView: () => runtime.readObservedView(),
    waitForObservedRevision: (revision: number) =>
      runtime.waitForObservedRevision(revision),
  };
}

function tools(runtime: StressLabRuntime) {
  return createStressLabWebMcpTools(dependencies(runtime));
}

async function execute(
  definitions: readonly WebMCP.ModelContextTool[],
  name: string,
  input: Record<string, unknown>,
  signal = new AbortController().signal,
): Promise<StressLabWebMcpResult> {
  const tool = definitions.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  const result = (await tool.execute(input, { signal })) as StressLabWebMcpResult;
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1_500);
  return result;
}

async function executeWithoutOptions(
  definitions: readonly WebMCP.ModelContextTool[],
  name: string,
  input: Record<string, unknown>,
): Promise<StressLabWebMcpResult> {
  const tool = definitions.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  const chromeExecute = tool.execute as unknown as (
    inputObject: Record<string, unknown>,
  ) => WebMCP.MaybePromise<unknown>;
  const result = (await chromeExecute(input)) as StressLabWebMcpResult;
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1_500);
  return result;
}

function expectSuccess(result: StressLabWebMcpResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  expect(result.status).toBe("COMPLETED");
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1_500);
  return result;
}

function expectMutationSuccess(result: StressLabWebMcpResult) {
  const success = expectSuccess(result);
  if (!("artifactId" in success)) {
    throw new Error("Expected a mutating-tool success envelope.");
  }
  return success;
}

async function expectVisibleRevisionWithoutOptions(
  definitions: readonly WebMCP.ModelContextTool[],
  revision: number,
) {
  const read = expectSuccess(
    await executeWithoutOptions(definitions, "read_lab_state", {}),
  );
  expect(read.stateRevision).toBe(revision);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Gate 7 strict static contracts", () => {
  it("supports the actual Chrome one-argument callback shape safely", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);

    const summary = expectSuccess(
      await executeWithoutOptions(definitions, "read_lab_state", {}),
    );
    const scoped = expectSuccess(
      await executeWithoutOptions(definitions, "read_lab_state", {
        scope: "SUMMARY",
      }),
    );
    expect(summary.stateRevision).toBe(0);
    expect(scoped.stateRevision).toBe(0);

    const invalid = await executeWithoutOptions(definitions, "read_lab_state", {
      scope: "UNKNOWN",
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENTS" },
    });
    expect(runtime.readObservedView().revision).toBe(0);
    expect(runtime.readObservedView().audit).toEqual([]);

    const readActivities = runtime.store.getState().ui.activities.filter(
      (entry) => entry.toolName === "read_lab_state",
    );
    expect(readActivities).toHaveLength(3);
    const committedActivities = readActivities.filter(
      (activity) => activity.transitions.at(-1)?.status === "COMMITTED",
    );
    const failedActivities = readActivities.filter(
      (activity) => activity.transitions.at(-1)?.status === "FAILED",
    );
    expect(committedActivities).toHaveLength(2);
    expect(failedActivities).toHaveLength(1);
    for (const activity of committedActivities) {
      expect(activity.transitions.map((entry) => entry.status)).toEqual([
        "RECEIVED",
        "VALIDATED",
        "RUNNING",
        "COMMITTED",
      ]);
    }
    expect(failedActivities[0]?.transitions.map((entry) => entry.status)).toEqual([
      "RECEIVED",
      "FAILED",
    ]);
    expect(
      readActivities.every((activity) =>
        ["COMMITTED", "FAILED", "CANCELLED"].includes(
          activity.transitions.at(-1)?.status ?? "",
        ),
      ),
    ).toBe(true);
    runtime.dispose();
  });

  it("contains unexpected one-argument callback failures", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    vi.spyOn(runtime.service, "readLabState").mockImplementationOnce(() => {
      throw new Error("SECRET_CALLBACK_FAILURE /Users/private/stack");
    });

    const result = await executeWithoutOptions(
      definitions,
      "read_lab_state",
      {},
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET_CALLBACK_FAILURE|Users\/private|stack/u,
    );
    expect(
      runtime.store.getState().ui.activities[0]?.transitions.map(
        (entry) => entry.status,
      ),
    ).toEqual(["RECEIVED", "VALIDATED", "RUNNING", "FAILED"]);
    runtime.dispose();
  });

  it("publishes exactly six stable tools with the approved annotations", () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    expect(definitions.map((tool) => tool.name).sort()).toEqual(
      [...STRESS_LAB_WEBMCP_TOOL_NAMES].sort(),
    );
    expect(new Set(definitions.map((tool) => tool.name)).size).toBe(6);
    expect(definitions.some((tool) => /accept|challenge|reset|delete|rollback/u.test(tool.name))).toBe(false);
    for (const definition of definitions) {
      expect(definition.description.length).toBeLessThan(500);
      expect(definition.inputSchema).toBeTruthy();
      expect("outputSchema" in definition).toBe(false);
      expect(definition.annotations?.readOnlyHint).toBe(
        definition.name === "read_lab_state",
      );
      const pending: unknown[] = [definition.inputSchema];
      while (pending.length > 0) {
        const value = pending.pop();
        if (value === null || typeof value !== "object") continue;
        const record = value as Record<string, unknown>;
        if (typeof record.description === "string") {
          expect(record.description.length).toBeLessThan(150);
        }
        pending.push(...Object.values(record));
      }
    }
    expect(definitions.find((tool) => tool.name === "read_lab_state")?.annotations)
      .toMatchObject({ readOnlyHint: true, untrustedContentHint: true });
    expect(definitions.find((tool) => tool.name === "configure_scenario")?.annotations)
      .toMatchObject({ readOnlyHint: false, untrustedContentHint: true });
    const read = definitions.find((tool) => tool.name === "read_lab_state");
    expect(read?.description).toContain("current RUN by objectId");
    expect(read?.description).toContain("presentation only");
    const inject = definitions.find((tool) => tool.name === "inject_disruption");
    expect(inject?.description).toContain(
      "Copy the required constant type, target kind, and rule exactly",
    );
    expect(inject?.description).toContain("atSecond is seconds after 08:30; use 720 for 08:42");
    expect(inject?.description).toContain("If the user did not choose A or B, ask before calling.");
    expect(inject?.description).toContain("Both requires two sequential calls");
    expect(inject?.description).toContain("distinct operation IDs and the latest revision");
    expect(JSON.stringify(inject?.inputSchema)).not.toMatch(/"VEHICLE_ID"/u);
    expect(inject?.description).not.toMatch(/vehicle ID|VEHICLE_ID/u);
    const stage = definitions.find((tool) => tool.name === "stage_finding");
    expect(stage?.description).toContain("explicitly requested by the user");
    expect(stage?.description).toContain("vague assent is not authority");
    expect(JSON.stringify(stage?.inputSchema)).toContain(
      "never infer it from vague assent",
    );
    runtime.dispose();
  });

  it("publishes a closed-world, agent-readable seed-07 configuration schema", () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const configure = definitions.find(
      (definition) => definition.name === "configure_scenario",
    );
    const replacement = stressLabConfigureJsonSchema.oneOf[0];
    const fleet = replacement.properties.configuration.properties.fleet;
    const weights = fleet.properties.initialZoneWeights;

    expect(configure?.description).toContain(
      "A is 12x8; B is 10x10",
    );
    expect(configure?.description).toContain("use mode REPLACE and exact labels");
    expect(configure?.description).toContain("never add suffixes");
    expect(configure?.description).toContain(
      "weights sandton 30, parkmore 15, illovo 20, rosebank 25, melrose-arch 10",
    );
    expect(configure?.description).toContain("all five objectives");
    expect(configure?.description).toContain("PATCH preserves an existing disruption");
    expect(configure?.description).toContain("Never infer patch values from vague assent");
    expect(replacement.properties.configuration.properties.label).toMatchObject({
      description: expect.stringContaining("do not add slot suffixes"),
      examples: ["Twelve compact pods", "Ten higher-capacity pods"],
    });
    expect(Object.keys(weights.properties)).toEqual([
      "sandton",
      "parkmore",
      "illovo",
      "rosebank",
      "melrose-arch",
    ]);
    expect(weights.required).toEqual([
      "sandton",
      "parkmore",
      "illovo",
      "rosebank",
      "melrose-arch",
    ]);
    expect(weights.additionalProperties).toBe(false);
    expect(weights.description).toContain("total exactly 100");
    expect(weights.properties).toMatchObject({
      sandton: { default: 30 },
      parkmore: { default: 15 },
      illovo: { default: 20 },
      rosebank: { default: 25 },
      "melrose-arch": { default: 10 },
    });
    expect(fleet.properties.vehicleCount.examples).toEqual([12, 10]);
    expect(fleet.properties.seatsPerVehicle.examples).toEqual([8, 10]);
    expect(fleet.properties.batteryCapacityKWh.default).toBe(70);
    expect(
      replacement.properties.configuration.properties.constraints.properties,
    ).toMatchObject({
      maximumWaitSeconds: { default: 180 },
      maximumUnservedPassengers: { default: 12 },
      minimumBatteryReservePercent: { default: 20 },
      maximumRecoverySeconds: { default: 600 },
      standingAllowed: { const: false },
    });
    expect(JSON.stringify(configure?.inputSchema)).not.toMatch(/zone1|zone2|zone3/u);
    expect(stressLabStageFindingInputSchema.safeParse({
      operationId: "explicit-stage",
      expectedRevision: 1,
      comparisonId: "comparison-1",
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    }).success).toBe(true);
    runtime.dispose();
  });

  it("accepts both golden configurations and rejects authored-zone drift", () => {
    const command = (slot: "A" | "B", weights: Record<string, number>) => ({
      operationId: `configure-${slot.toLowerCase()}`,
      expectedRevision: slot === "A" ? 0 : 1,
      slot,
      mode: "REPLACE" as const,
      configuration: {
        ...configuration(slot),
        fleet: {
          ...configuration(slot).fleet,
          initialZoneWeights: weights,
        },
      },
    });
    const goldenWeights = { ...configuration("A").fleet.initialZoneWeights };

    expect(
      stressLabConfigureInputSchema.safeParse(
        command("A", { ...goldenWeights }),
      ).success,
    ).toBe(true);
    expect(
      stressLabConfigureInputSchema.safeParse(
        command("B", { ...goldenWeights }),
      ).success,
    ).toBe(true);

    const invalidWeights = [
      { ...goldenWeights, zone1: 1, sandton: 29 },
      {
        sandton: 40,
        parkmore: 15,
        illovo: 20,
        rosebank: 25,
      },
      { ...goldenWeights, sandton: 29 },
      { ...goldenWeights, sandton: 31 },
      { ...goldenWeights, sandton: 29.5, "melrose-arch": 10.5 },
    ];
    for (const weights of invalidWeights) {
      expect(
        stressLabConfigureInputSchema.safeParse(command("A", weights)).success,
      ).toBe(false);
    }

    const totalIssue = stressLabConfigureInputSchema.safeParse(
      command("A", { ...goldenWeights, sandton: 29 }),
    );
    expect(totalIssue.success).toBe(false);
    if (totalIssue.success) throw new Error("Expected total-99 weights to fail.");
    expect(totalIssue.error.issues.map((issue) => issue.message)).toContain(
      "The five authored zone weights must total exactly 100.",
    );

    expect(
      stressLabConfigureInputSchema.safeParse({
        operationId: "patch-zone-weights",
        expectedRevision: 1,
        slot: "A",
        mode: "PATCH",
        configuration: {
          fleet: { initialZoneWeights: { sandton: 100 } },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid authored-zone maps before service authority or mutation", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const serviceSpy = vi.spyOn(
      runtime.service,
      "configureScenarioConfiguration",
    );
    const before = runtime.repository.getState();
    const golden = configuration("A");
    const invalidWeights = [
      { ...golden.fleet.initialZoneWeights, zone1: 1, sandton: 29 },
      { ...golden.fleet.initialZoneWeights, sandton: 29 },
      { ...golden.fleet.initialZoneWeights, sandton: 31 },
    ];

    for (const [index, initialZoneWeights] of invalidWeights.entries()) {
      const result = await executeWithoutOptions(
        definitions,
        "configure_scenario",
        {
          operationId: `invalid-zone-map-${index}`,
          expectedRevision: 0,
          slot: "A",
          mode: "REPLACE",
          configuration: {
            ...golden,
            fleet: { ...golden.fleet, initialZoneWeights },
          },
        },
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_ARGUMENTS" },
      });
    }

    expect(serviceSpy).not.toHaveBeenCalled();
    expect(runtime.repository.getState()).toBe(before);
    expect(runtime.readObservedView().revision).toBe(0);
    expect(runtime.readObservedView().audit).toEqual([]);
    for (const activity of runtime.store.getState().ui.activities) {
      expect(activity.transitions.map((transition) => transition.status)).toEqual([
        "RECEIVED",
        "FAILED",
      ]);
    }
    runtime.dispose();
  });

  it("accepts one canonical witness per schema and rejects structural drift", () => {
    const witnesses = [
      [stressLabReadInputSchema, { scope: "SUMMARY" }],
      [stressLabConfigureInputSchema, {
        operationId: "configure-a",
        expectedRevision: 0,
        slot: "A",
        mode: "REPLACE",
        configuration: configuration("A"),
      }],
      [stressLabRunInputSchema, {
        operationId: "run-a",
        expectedRevision: 1,
        scenarioRevisionId: "scenario-A-r1",
      }],
      [stressLabInjectInputSchema, {
        operationId: "inject-a",
        expectedRevision: 1,
        scenarioRevisionId: "scenario-A-r1",
        disruption: {
          type: "VEHICLE_FAILURE",
          target: {
            kind: "DETERMINISTIC_RULE",
            rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
          },
          atSecond: 720,
        },
      }],
      [stressLabCompareInputSchema, {
        operationId: "compare",
        expectedRevision: 6,
        runAId: "run-A-1",
        runBId: "run-B-2",
      }],
      [stressLabStageFindingInputSchema, {
        operationId: "stage",
        expectedRevision: 8,
        comparisonId: "comparison-1",
        selectedOutcome: "TRADE_OFF",
        emphasis: "BALANCED",
      }],
    ] as const;
    for (const [schema, witness] of witnesses) {
      expect(schema.safeParse(witness).success).toBe(true);
      expect(schema.safeParse({ ...witness, unexpected: true }).success).toBe(false);
    }
    expect(stressLabReadInputSchema.safeParse({ operationId: "not-allowed" }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      expectedRevision: 0.5,
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      operationId: "x".repeat(65),
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      configuration: {
        ...configuration("A"),
        fleet: { ...configuration("A").fleet, vehicleCount: 31 },
      },
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      configuration: {
        ...configuration("A"),
        fleet: { ...configuration("A").fleet, seatsPerVehicle: 0 },
      },
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      configuration: {
        ...configuration("A"),
        fleet: { ...configuration("A").fleet, batteryCapacityKWh: Number.POSITIVE_INFINITY },
      },
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      configuration: {
        ...configuration("A"),
        fleet: { ...configuration("A").fleet, energyKWhPerKm: 0.2105 },
      },
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      configuration: { ...configuration("A"), label: "unsafe\nlabel" },
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      ...witnesses[1][1],
      configuration: { ...configuration("A"), fleet: { ...configuration("A").fleet, source: "WEBMCP" } },
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      operationId: "patch-a",
      expectedRevision: 1,
      slot: "A",
      mode: "PATCH",
      configuration: {},
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      operationId: "patch-a",
      expectedRevision: 1,
      slot: "A",
      mode: "PATCH",
      configuration: { label: "Updated compact pods" },
    }).success).toBe(true);
    expect(stressLabConfigureInputSchema.safeParse({
      operationId: "patch-a",
      expectedRevision: 1,
      slot: "A",
      mode: "PATCH",
      configuration: { fleet: { vehicleCount: 11, source: "WEBMCP" } },
    }).success).toBe(false);
    expect(stressLabConfigureInputSchema.safeParse({
      operationId: "patch-a",
      expectedRevision: 1,
      slot: "A",
      mode: "PATCH",
      configuration: { networkVersion: "forbidden" },
    }).success).toBe(false);
    expect(stressLabStageFindingInputSchema.safeParse({
      ...witnesses[5][1],
      claimIds: ["invented"],
      score: 99,
    }).success).toBe(false);
    expect(stressLabInjectInputSchema.safeParse({
      ...witnesses[3][1],
      disruption: { ...witnesses[3][1].disruption, atSecond: 1_800 },
    }).success).toBe(false);
    expect(stressLabInjectInputSchema.safeParse({
      ...witnesses[3][1],
      disruption: { ...witnesses[3][1].disruption, atSecond: 721 },
    }).success).toBe(false);
  });

  it("rejects hostile and prototype-pollution-shaped input before service invocation", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const serviceSpy = vi.spyOn(runtime.service, "configureScenarioConfiguration");
    const hostile = {
      operationId: "hostile-a",
      expectedRevision: 0,
      slot: "A",
      mode: "REPLACE",
      configuration: {
        ...configuration("A"),
        label: "<img src=x onerror=alert(1)>",
      },
    };
    const hostileResult = await execute(definitions, "configure_scenario", hostile);
    expect(hostileResult).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });

    const polluted = Object.assign(Object.create({ polluted: true }), hostile);
    const pollutionResult = await execute(definitions, "configure_scenario", polluted);
    expect(pollutionResult).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(serviceSpy).not.toHaveBeenCalled();
    expect(runtime.readObservedView().revision).toBe(0);
    expect(runtime.readObservedView().audit).toEqual([]);
    runtime.dispose();
  });

  it("keeps scenario revision and deterministic target required in both public schemas", () => {
    const valid = {
      operationId: "strict-inject",
      expectedRevision: 0,
      scenarioRevisionId: "scenario-A-r1",
      disruption: {
        type: "VEHICLE_FAILURE" as const,
        target: {
          kind: "DETERMINISTIC_RULE" as const,
          rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID" as const,
        },
        atSecond: 720,
      },
    };
    expect(stressLabInjectInputSchema.safeParse(valid).success).toBe(true);
    expect(stressLabInjectInputSchema.safeParse({
      operationId: valid.operationId,
      expectedRevision: valid.expectedRevision,
      disruption: valid.disruption,
    }).success).toBe(false);
    expect(stressLabInjectInputSchema.safeParse({
      operationId: valid.operationId,
      expectedRevision: valid.expectedRevision,
      scenarioRevisionId: valid.scenarioRevisionId,
      disruption: {
        type: valid.disruption.type,
        atSecond: valid.disruption.atSecond,
      },
    }).success).toBe(false);
    expect(stressLabInjectJsonSchema.required).toContain("scenarioRevisionId");
    expect(stressLabInjectJsonSchema.properties.disruption.required).toContain("target");
    expect(stressLabInjectJsonSchema.properties.disruption.properties.atSecond).toEqual({
      type: "integer",
      description: "Seconds after 08:30; use 720 for 08:42. Must be a 30-second increment.",
      default: 720,
      minimum: 0,
      maximum: 1_799,
      multipleOf: 30,
    });
    expect(stressLabInjectJsonSchema.properties.disruption.properties.target).toEqual({
      type: "object",
      properties: {
        kind: { const: "DETERMINISTIC_RULE" },
        rule: { const: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID" },
      },
      required: ["kind", "rule"],
      additionalProperties: false,
    });
    expect(JSON.stringify(stressLabInjectJsonSchema)).not.toMatch(/"VEHICLE_ID"/u);
  });

  it("rejects clock-minute 522 with actionable 08:42 guidance before service authority", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const spy = vi.spyOn(runtime.service, "injectPublicDisruption");
    const before = runtime.repository.getState();
    const input = {
      operationId: "invalid-clock-minute",
      expectedRevision: 0,
      scenarioRevisionId: "scenario-A-r1",
      disruption: {
        type: "VEHICLE_FAILURE",
        target: {
          kind: "DETERMINISTIC_RULE",
          rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
        },
        atSecond: 522,
      },
    };

    const parsed = stressLabInjectInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("Expected clock-minute disruption input to fail.");
    expect(parsed.error.issues).toContainEqual(expect.objectContaining({
      path: ["disruption", "atSecond"],
      message: "Use seconds after 08:30 in 30-second increments; 08:42 is atSecond 720.",
    }));

    const result = await executeWithoutOptions(definitions, "inject_disruption", input);
    expect(result).toMatchObject({
      ok: false,
      operationId: "invalid-clock-minute",
      error: {
        code: "INVALID_ARGUMENTS",
        field: "disruption.atSecond",
        message: expect.stringContaining("08:42 is atSecond 720"),
      },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(runtime.repository.getState()).toBe(before);
    expect(runtime.readObservedView().revision).toBe(0);
    expect(runtime.readObservedView().audit).toEqual([]);
    const activity = runtime.store.getState().ui.activities.find(
      (entry) => entry.operationId === "invalid-clock-minute",
    );
    expect(activity?.transitions.map((transition) => transition.status)).toEqual([
      "RECEIVED",
      "FAILED",
    ]);
    runtime.dispose();
  });

  it("rejects malformed, legacy-target, and compound inputs before service authority", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const spy = vi.spyOn(runtime.service, "injectPublicDisruption");
    const before = runtime.repository.getState();
    const missingScenario = await execute(definitions, "inject_disruption", {
      operationId: "missing-scenario",
      expectedRevision: 0,
      disruption: {
        type: "VEHICLE_FAILURE",
        target: {
          kind: "DETERMINISTIC_RULE",
          rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
        },
        atSecond: 720,
      },
    });
    const missingTarget = await execute(definitions, "inject_disruption", {
      operationId: "missing-target",
      expectedRevision: 0,
      scenarioRevisionId: "scenario-A-r1",
      disruption: { type: "VEHICLE_FAILURE", atSecond: 720 },
    });
    const legacyTarget = await execute(definitions, "inject_disruption", {
      operationId: "legacy-target",
      expectedRevision: 0,
      scenarioRevisionId: "scenario-A-r1",
      disruption: {
        type: "VEHICLE_FAILURE",
        target: { kind: "VEHICLE_ID", vehicleId: "A-01" },
        atSecond: 720,
      },
    });
    const compoundScenario = await execute(definitions, "inject_disruption", {
      operationId: "compound-scenario",
      expectedRevision: 0,
      scenarioRevisionId: "BOTH",
      disruption: {
        type: "VEHICLE_FAILURE",
        target: {
          kind: "DETERMINISTIC_RULE",
          rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
        },
        atSecond: 720,
      },
    });
    for (const result of [missingScenario, missingTarget, legacyTarget, compoundScenario]) {
      expect(result).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
      expect(result).not.toMatchObject({ error: { code: "NEEDS_CLARIFICATION" } });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(runtime.repository.getState()).toBe(before);
    expect(runtime.readObservedView().audit).toEqual([]);
    for (const operationId of [
      "missing-scenario",
      "missing-target",
      "legacy-target",
      "compound-scenario",
    ]) {
      const activity = runtime.store.getState().ui.activities.find(
        (entry) => entry.operationId === operationId,
      );
      expect(activity?.transitions.map((transition) => transition.status)).toEqual([
        "RECEIVED",
        "FAILED",
      ]);
    }
    runtime.dispose();
  });

  it("lets a pre-aborted malformed call terminate as cancelled before validation", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const spy = vi.spyOn(runtime.service, "injectPublicDisruption");
    const controller = new AbortController();
    controller.abort();
    const result = await execute(definitions, "inject_disruption", {
      operationId: "cancel-before-clarification",
      expectedRevision: 0,
      scenarioRevisionId: "scenario-A-r1",
      disruption: { type: "VEHICLE_FAILURE", atSecond: 720 },
    }, controller.signal);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "OPERATION_CANCELLED" },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(runtime.readObservedView().revision).toBe(0);
    runtime.dispose();
  });

  it("keeps invalid argument summaries bounded and literal-data safe", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const secretMarker = "<img src=x onerror=SECRET_MARKER>";
    await execute(definitions, "run_scenario", {
      operationId: "safe-summary",
      expectedRevision: 0,
      scenarioRevisionId: secretMarker,
    });
    const activity = runtime.store.getState().ui.activities.find(
      (entry) => entry.operationId === "safe-summary",
    );
    expect(activity?.argumentSummary).toBe("scenarioRevisionId=invalid");
    expect(JSON.stringify(activity)).not.toContain("SECRET_MARKER");
    runtime.dispose();
  });
});

describe("Gate 7 authoritative adapter", () => {
  it("passes application-authoritative invalidation IDs through without inference", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const emptyResult = Object.freeze({
      operationId: "sentinel-empty",
      stateRevision: 0,
      status: "COMPLETED" as const,
      artifactId: "scenario-A-r1",
      scenarioRevisionRef: Object.freeze({
        slot: "A" as const,
        revision: 1,
        preparedInputFingerprint: GOLDEN.inputA,
      }),
      invalidatedArtifactIds: Object.freeze([]),
    }) as unknown as ScenarioMutationResult;
    const orderedResult = Object.freeze({
      operationId: "sentinel-ordered",
      stateRevision: 0,
      status: "COMPLETED" as const,
      artifactId: "scenario-A-r2",
      scenarioRevisionRef: Object.freeze({
        slot: "A" as const,
        revision: 2,
        preparedInputFingerprint: GOLDEN.inputA,
      }),
      invalidatedArtifactIds: Object.freeze([
        "run-A-7",
        "comparison-4",
        "finding-2",
      ]),
    }) as unknown as ScenarioMutationResult;
    const configureSpy = vi
      .spyOn(runtime.service, "configureScenarioConfiguration")
      .mockResolvedValueOnce(emptyResult);
    const injectSpy = vi
      .spyOn(runtime.service, "injectPublicDisruption")
      .mockResolvedValueOnce(orderedResult);

    const empty = expectMutationSuccess(await execute(definitions, "configure_scenario", {
      operationId: "sentinel-empty",
      expectedRevision: 0,
      slot: "A",
      mode: "REPLACE",
      configuration: configuration("A"),
    }));
    const ordered = expectMutationSuccess(await execute(definitions, "inject_disruption", {
      operationId: "sentinel-ordered",
      expectedRevision: 0,
      scenarioRevisionId: "scenario-A-r1",
      disruption: {
        type: "VEHICLE_FAILURE",
        target: {
          kind: "DETERMINISTIC_RULE",
          rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
        },
        atSecond: 720,
      },
    }));

    expect(empty.summary).toEqual({
      scenarioRevisionRef: emptyResult.scenarioRevisionRef,
      invalidatedArtifactIds: [],
    });
    expect(ordered.summary).toEqual({
      scenarioRevisionRef: orderedResult.scenarioRevisionRef,
      invalidatedArtifactIds: ["run-A-7", "comparison-4", "finding-2"],
    });
    expect(configureSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy).toHaveBeenCalledTimes(1);
    expect(runtime.repository.getState().revision).toBe(0);
    runtime.dispose();
  });

  it("completes the real golden flow with one-argument callbacks and preserves every accepted fingerprint", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const initial = expectSuccess(await executeWithoutOptions(definitions, "read_lab_state", {}));
    expect(initial).not.toHaveProperty("operationId");
    expect(initial).not.toHaveProperty("artifactId");

    const configureA = expectMutationSuccess(await executeWithoutOptions(definitions, "configure_scenario", {
      operationId: "web-configure-a",
      expectedRevision: initial.stateRevision,
      slot: "A",
      mode: "REPLACE",
      configuration: configuration("A"),
    }));
    await expectVisibleRevisionWithoutOptions(definitions, configureA.stateRevision);
    const configureB = expectMutationSuccess(await executeWithoutOptions(definitions, "configure_scenario", {
      operationId: "web-configure-b",
      expectedRevision: configureA.stateRevision,
      slot: "B",
      mode: "REPLACE",
      configuration: configuration("B"),
    }));
    await expectVisibleRevisionWithoutOptions(definitions, configureB.stateRevision);

    const injectSpy = vi.spyOn(runtime.service, "injectPublicDisruption");
    const injectA = expectMutationSuccess(await executeWithoutOptions(definitions, "inject_disruption", {
      operationId: "web-inject-a",
      expectedRevision: configureB.stateRevision,
      scenarioRevisionId: configureA.artifactId,
      disruption: {
        type: "VEHICLE_FAILURE",
        target: { kind: "DETERMINISTIC_RULE", rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID" },
        atSecond: 720,
      },
    }));
    await expectVisibleRevisionWithoutOptions(definitions, injectA.stateRevision);
    const injectB = expectMutationSuccess(await executeWithoutOptions(definitions, "inject_disruption", {
      operationId: "web-inject-b",
      expectedRevision: injectA.stateRevision,
      scenarioRevisionId: configureB.artifactId,
      disruption: {
        type: "VEHICLE_FAILURE",
        target: { kind: "DETERMINISTIC_RULE", rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID" },
        atSecond: 720,
      },
    }));
    await expectVisibleRevisionWithoutOptions(definitions, injectB.stateRevision);
    expect(injectA.summary).toMatchObject({ invalidatedArtifactIds: [] });
    expect(injectB.summary).toMatchObject({ invalidatedArtifactIds: [] });
    expect(injectA.operationId).not.toBe(injectB.operationId);
    expect(injectB.stateRevision).toBe(injectA.stateRevision + 1);
    expect(injectSpy).toHaveBeenCalledTimes(2);
    for (const [command] of injectSpy.mock.calls) {
      expect(command.disruption.target).toEqual({
        kind: "DETERMINISTIC_RULE",
        rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
      });
      expect(command.disruption.target).not.toHaveProperty("vehicleId");
    }

    const runA = expectMutationSuccess(await executeWithoutOptions(definitions, "run_scenario", {
      operationId: "web-run-a",
      expectedRevision: injectB.stateRevision,
      scenarioRevisionId: injectA.artifactId,
    }));
    await expectVisibleRevisionWithoutOptions(definitions, runA.stateRevision);
    expect(runA.summary).toMatchObject({
      inputFingerprint: GOLDEN.inputA,
      eventLedgerFingerprint: GOLDEN.ledgerA,
      resultFingerprint: GOLDEN.resultA,
    });
    const authoritativeRunA = runtime.repository.getState().runs[runA.artifactId];
    const failedVehicleEventA = authoritativeRunA?.eventLedger.events.find(
      (event) => event.type === "VEHICLE_FAILED",
    );
    expect(failedVehicleEventA?.facts.vehicleId).toMatch(/^A-[0-9]{2}$/u);
    expect(JSON.stringify(injectSpy.mock.calls[0]?.[0])).not.toContain(
      failedVehicleEventA?.facts.vehicleId,
    );
    const runB = expectMutationSuccess(await executeWithoutOptions(definitions, "run_scenario", {
      operationId: "web-run-b",
      expectedRevision: runA.stateRevision,
      scenarioRevisionId: injectB.artifactId,
    }));
    await expectVisibleRevisionWithoutOptions(definitions, runB.stateRevision);
    expect(runB.summary).toMatchObject({
      inputFingerprint: GOLDEN.inputB,
      eventLedgerFingerprint: GOLDEN.ledgerB,
      resultFingerprint: GOLDEN.resultB,
    });

    const comparison = expectMutationSuccess(await executeWithoutOptions(definitions, "compare_scenarios", {
      operationId: "web-compare",
      expectedRevision: runB.stateRevision,
      runAId: runA.artifactId,
      runBId: runB.artifactId,
    }));
    await expectVisibleRevisionWithoutOptions(definitions, comparison.stateRevision);
    expect(comparison.summary).toEqual({ comparisonFingerprint: GOLDEN.comparison });

    const finding = expectMutationSuccess(await executeWithoutOptions(definitions, "stage_finding", {
      operationId: "web-stage",
      expectedRevision: comparison.stateRevision,
      comparisonId: comparison.artifactId,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    }));
    await expectVisibleRevisionWithoutOptions(definitions, finding.stateRevision);
    expect(finding.summary).toMatchObject({
      comparisonFingerprint: GOLDEN.comparison,
      findingFingerprint: GOLDEN.finding,
      review: "PENDING_REVIEW",
    });
    const pendingState = runtime.repository.getState();
    const exactRetry = await executeWithoutOptions(definitions, "stage_finding", {
      operationId: "web-stage",
      expectedRevision: comparison.stateRevision,
      comparisonId: comparison.artifactId,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    expect(exactRetry).toEqual(finding);
    const replacement = await executeWithoutOptions(definitions, "stage_finding", {
      operationId: "web-stage-replacement",
      expectedRevision: finding.stateRevision,
      comparisonId: comparison.artifactId,
      selectedOutcome: "A",
      emphasis: "SERVICE",
    });
    expect(replacement).toMatchObject({
      ok: false,
      error: {
        code: "PREREQUISITE_NOT_MET",
        message: "Accept or Challenge the current finding in the human UI before staging another finding.",
      },
    });
    expect(runtime.repository.getState()).toBe(pendingState);
    expect(runtime.readObservedView().audit.every((entry) => entry.source === "WEBMCP")).toBe(true);
    expect(definitions.map((tool) => tool.name).sort()).toEqual(
      [...STRESS_LAB_WEBMCP_TOOL_NAMES].sort(),
    );
    runtime.dispose();
  }, 40_000);

  it("injects WEBMCP authority and rejects stale revisions without mutation", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const stale = await execute(definitions, "configure_scenario", {
      operationId: "stale-configure",
      expectedRevision: 2,
      slot: "A",
      mode: "REPLACE",
      configuration: configuration("A"),
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "REVISION_CONFLICT", currentRevision: 0 },
    });
    expect(runtime.readObservedView().revision).toBe(0);
    expect(runtime.readObservedView().audit).toEqual([]);
    runtime.dispose();
  });

  it("keeps equivalent HUMAN_UI and WEBMCP configuration evidence identical", async () => {
    const webRuntime = createStressLabRuntime({
      activityClock: { nowMilliseconds: () => 1_000 },
    });
    const humanRuntime = createStressLabRuntime({
      activityClock: { nowMilliseconds: () => 9_000 },
    });
    const command = {
      operationId: "equivalent-configure",
      expectedRevision: 0,
      slot: "A" as const,
      mode: "REPLACE" as const,
      configuration: configuration("A"),
    };
    const webResult = expectMutationSuccess(
      await execute(tools(webRuntime), "configure_scenario", command),
    );
    const humanResult = await humanRuntime.service.configureScenarioConfiguration(
      command,
      HUMAN_UI_INVOCATION_CONTEXT,
    );
    expect(webResult.artifactId).toBe(humanResult.artifactId);
    expect(webResult.stateRevision).toBe(humanResult.stateRevision);
    const webScenario = webRuntime.readObservedView().scenarios.A;
    const humanScenario = humanRuntime.readObservedView().scenarios.A;
    expect(webScenario?.ref.preparedInputFingerprint).toBe(
      humanScenario?.ref.preparedInputFingerprint,
    );
    if (!webScenario || !humanScenario) throw new Error("Scenario A is missing.");
    expect(
      webRuntime.repository.getState().scenarioRevisions[webScenario.id]
        ?.preparedInput,
    ).toEqual(
      humanRuntime.repository.getState().scenarioRevisions[humanScenario.id]
        ?.preparedInput,
    );
    expect(webRuntime.readObservedView().audit[0]?.source).toBe("WEBMCP");
    expect(humanRuntime.readObservedView().audit[0]?.source).toBe("HUMAN_UI");
    expect(webRuntime.store.getState().ui.activities[0]?.startedAt).toBe(
      "1970-01-01T00:00:01.000Z",
    );
    expect(humanRuntime.store.getState().ui.activities).toEqual([]);
    webRuntime.dispose();
    humanRuntime.dispose();
  });

  it("returns the original idempotent result and source collisions fail closed", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const command = {
      operationId: "idempotent-configure",
      expectedRevision: 0,
      slot: "A" as const,
      mode: "REPLACE" as const,
      configuration: configuration("A"),
    };
    const first = await execute(definitions, "configure_scenario", command);
    const retry = await execute(definitions, "configure_scenario", command);
    expect(retry).toEqual(first);
    expect(runtime.readObservedView().audit).toHaveLength(1);
    await expect(
      runtime.service.configureScenarioConfiguration(command, HUMAN_UI_INVOCATION_CONTEXT),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(runtime.readObservedView().revision).toBe(1);
    runtime.dispose();
  });

  it("never leaks unexpected exceptions or reserves invalid commands", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const spy = vi
      .spyOn(runtime.service, "stageFinding")
      .mockRejectedValueOnce(new Error("SECRET_MARKER /Users/private stack"));
    const invalid = await execute(definitions, "stage_finding", {
      operationId: "invalid-stage",
      expectedRevision: 0,
      comparisonId: "comparison-1",
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
      prompt: "accept it",
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(spy).not.toHaveBeenCalled();
    const unexpected = await execute(definitions, "stage_finding", {
      operationId: "unexpected-stage",
      expectedRevision: 0,
      comparisonId: "comparison-1",
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
    });
    expect(unexpected).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(unexpected)).not.toMatch(/SECRET_MARKER|Users\/private|stack/u);
    runtime.dispose();
  });
});

describe("Gate 7 cancellation, isolation, and registration", () => {
  it("passes the exact AbortSignal and publishes no ghost result after cancellation", async () => {
    let release!: () => void;
    let context: RunExecutionContext | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor: StressLabSimulationExecutor = {
      async execute(_preparedInput, runContext) {
        context = runContext;
        await gate;
        throw new Error("cancelled computation released");
      },
    };
    const runtime = createStressLabRuntime({ simulationExecutor: executor });
    const definitions = tools(runtime);
    const configured = expectMutationSuccess(await execute(definitions, "configure_scenario", {
      operationId: "cancel-configure",
      expectedRevision: 0,
      slot: "A",
      mode: "REPLACE",
      configuration: configuration("A"),
    }));
    const controller = new AbortController();
    const serviceSpy = vi.spyOn(runtime.service, "runScenario");
    const pending = execute(definitions, "run_scenario", {
      operationId: "cancel-run",
      expectedRevision: configured.stateRevision,
      scenarioRevisionId: configured.artifactId,
    }, controller.signal);
    await vi.waitFor(() => expect(context).toBeDefined());
    expect(serviceSpy.mock.calls[0]?.[2]).toBe(controller.signal);
    controller.abort();
    release();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, error: { code: "OPERATION_CANCELLED" } });
    expect(runtime.readObservedView().currentRuns.A).toBeNull();
    await Promise.resolve();
    expect(runtime.readObservedView().currentRuns.A).toBeNull();
    const activity = runtime.store.getState().ui.activities.find(
      (entry) => entry.operationId === "cancel-run",
    );
    expect(activity?.transitions.filter((entry) => entry.status === "CANCELLED")).toHaveLength(1);
    runtime.dispose();
  });

  it("coalesces identical calls before the one-job gate and rejects a different active run", async () => {
    let release!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor: StressLabSimulationExecutor = {
      async execute() {
        calls += 1;
        await gate;
        throw new Error("controlled terminal failure");
      },
    };
    const runtime = createStressLabRuntime({ simulationExecutor: executor });
    const definitions = tools(runtime);
    const configured = expectMutationSuccess(await execute(definitions, "configure_scenario", {
      operationId: "coalesce-configure",
      expectedRevision: 0,
      slot: "A",
      mode: "REPLACE",
      configuration: configuration("A"),
    }));
    const command = {
      operationId: "coalesced-run",
      expectedRevision: configured.stateRevision,
      scenarioRevisionId: configured.artifactId,
    };
    const first = execute(definitions, "run_scenario", command);
    await vi.waitFor(() => expect(calls).toBe(1));
    const identical = execute(definitions, "run_scenario", { ...command });
    const competing = await execute(definitions, "run_scenario", {
      ...command,
      operationId: "competing-run",
      expectedRevision: runtime.readObservedView().revision,
    });
    expect(competing).toMatchObject({
      ok: false,
      error: { code: "PREREQUISITE_NOT_MET" },
    });
    release();
    const [firstResult, identicalResult] = await Promise.all([first, identical]);
    expect(identicalResult).toEqual(firstResult);
    expect(calls).toBe(1);
    expect(runtime.readObservedView().currentRuns.A).toBeNull();
    runtime.dispose();
  });

  it("cancels before validation with zero service or domain activity", async () => {
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const spy = vi.spyOn(runtime.service, "runScenario");
    const controller = new AbortController();
    controller.abort();
    const result = await execute(definitions, "run_scenario", {
      operationId: "pre-cancel",
      expectedRevision: 0,
      scenarioRevisionId: "scenario-A-r1",
    }, controller.signal);
    expect(result).toMatchObject({ ok: false, error: { code: "OPERATION_CANCELLED" } });
    expect(spy).not.toHaveBeenCalled();
    expect(runtime.readObservedView().revision).toBe(0);
    runtime.dispose();
  });

  it("keeps independent runtime state per tab composition", async () => {
    const first = createStressLabRuntime();
    const second = createStressLabRuntime();
    const result = expectMutationSuccess(await execute(tools(first), "configure_scenario", {
      operationId: "tab-one-configure",
      expectedRevision: 0,
      slot: "A",
      mode: "REPLACE",
      configuration: configuration("A"),
    }));
    expect(result.stateRevision).toBe(1);
    expect(first.readObservedView().revision).toBe(1);
    expect(second.readObservedView().revision).toBe(0);
    expect(second.readObservedView().scenarios.A).toBeNull();
    first.dispose();
    second.dispose();
  });

  it("registers the catalog once across remounts and unregisters after draining", async () => {
    vi.useFakeTimers();
    const registrations: { tool: WebMCP.ModelContextTool; signal?: AbortSignal }[] = [];
    const modelContext = {
      registerTool: async (
        tool: WebMCP.ModelContextTool,
        options?: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        registrations.push({ tool, signal: options?.signal });
      },
      getTools: async () =>
        registrations
          .filter((entry) => !entry.signal?.aborted)
          .map((entry) => entry.tool) as unknown as WebMCP.RegisteredTool[],
    } as unknown as WebMCP.ModelContext;
    const runtime = createStressLabRuntime();
    const definitions = tools(runtime);
    const coordinator = new StaticStressLabBridgeCoordinator();
    const statuses: string[] = [];
    const first = coordinator.acquire(modelContext, definitions, (status) => statuses.push(status.status));
    await first.ready;
    const second = coordinator.acquire(modelContext, [...definitions].reverse(), () => undefined);
    await second.ready;
    expect(registrations).toHaveLength(6);
    expect(coordinator.registeredToolNames()).toEqual([...STRESS_LAB_WEBMCP_TOOL_NAMES].sort());
    expect(statuses).toContain("AVAILABLE");
    first.release();
    second.release();
    await vi.advanceTimersByTimeAsync(100);
    expect(registrations.every((entry) => entry.signal?.aborted)).toBe(true);
    runtime.dispose();
  });

  it("rolls back every earlier registration when catalog registration fails", async () => {
    const registrations: {
      tool: WebMCP.ModelContextTool;
      signal?: AbortSignal;
    }[] = [];
    let attempts = 0;
    const modelContext = {
      registerTool: async (
        tool: WebMCP.ModelContextTool,
        options?: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        attempts += 1;
        if (attempts === 4) throw new DOMException("blocked", "NotAllowedError");
        registrations.push({ tool, signal: options?.signal });
      },
      getTools: async () =>
        registrations
          .filter((entry) => !entry.signal?.aborted)
          .map((entry) => entry.tool) as unknown as WebMCP.RegisteredTool[],
    } as unknown as WebMCP.ModelContext;
    const runtime = createStressLabRuntime();
    const coordinator = new StaticStressLabBridgeCoordinator();
    const statuses: string[] = [];
    const lease = coordinator.acquire(modelContext, tools(runtime), (status) => {
      statuses.push(status.status);
    });
    await lease.ready;
    expect(attempts).toBe(4);
    expect(registrations.every((entry) => entry.signal?.aborted)).toBe(true);
    expect(coordinator.registeredToolNames()).toEqual([]);
    expect(statuses).toEqual(["CHECKING", "ERROR"]);
    lease.release();
    runtime.dispose();
  });
});
