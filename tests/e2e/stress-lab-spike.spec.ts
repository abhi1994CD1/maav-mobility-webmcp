import { expect, test, type Page } from "@playwright/test";

const TOOL_NAMES = [
  "compare_scenarios",
  "configure_scenario",
  "inject_disruption",
  "read_lab_state",
  "run_scenario",
  "stage_finding",
] as const;

const CONFIGURATION = {
  label: "Twelve compact pods",
  fleet: {
    vehicleCount: 12,
    seatsPerVehicle: 8,
    batteryCapacityKWh: 70,
    startingBatteryPercent: 82,
    minimumReservePercent: 20,
    energyKWhPerKm: 0.21,
    dwellSeconds: 30,
    initialZoneWeights: {
      sandton: 30,
      parkmore: 15,
      illovo: 20,
      rosebank: 25,
      "melrose-arch": 10,
    },
  },
  constraints: {
    maximumWaitSeconds: 180,
    maximumUnservedPassengers: 12,
    minimumBatteryReservePercent: 20,
    maximumRecoverySeconds: 600,
    standingAllowed: false,
  },
  objectives: [
    "LOWER_WAIT",
    "LOWER_ENERGY_PER_PASSENGER_KM",
    "HIGHER_UTILIZATION",
    "FASTER_RECOVERY",
    "LOWER_EMPTY_KM",
  ],
};

async function installModelContextMock(page: Page) {
  await page.addInitScript(() => {
    const registered = new Map<
      string,
      { tool: WebMCP.ModelContextTool; signal?: AbortSignal }
    >();
    const context = {
      registerTool: async (
        tool: WebMCP.ModelContextTool,
        options?: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        registered.set(tool.name, { tool, signal: options?.signal });
      },
      getTools: async () =>
        [...registered.values()]
          .filter((entry) => !entry.signal?.aborted)
          .map((entry) => entry.tool),
    };
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: context,
    });
    Object.assign(window, { __gate7Tools: registered });
  });
}

async function invoke(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  return page.evaluate(
    async ({ toolName, args }) => {
      const registered = (
        window as typeof window & {
          __gate7Tools: Map<
            string,
            { tool: WebMCP.ModelContextTool; signal?: AbortSignal }
          >;
        }
      ).__gate7Tools;
      const tool = registered.get(toolName)?.tool;
      if (!tool) throw new Error(`Tool not registered: ${toolName}`);
      return tool.execute(args, { signal: new AbortController().signal });
    },
    { toolName: name, args: input },
  ) as Promise<{
    ok: boolean;
    stateRevision: number;
    artifactId?: string;
    summary?: Record<string, unknown>;
    error?: { code: string };
  }>;
}

test("six static tools complete the trusted browser workflow", async ({ page }) => {
  test.setTimeout(60_000);
  await installModelContextMock(page);
  await page.goto("/lab");
  await expect(page.getByText("6 static Chrome WebMCP tools registered")).toBeVisible();

  const catalog = await page.evaluate(async () =>
    (await document.modelContext!.getTools()).map((tool) => tool.name).sort(),
  );
  expect(catalog).toEqual(TOOL_NAMES);

  let read = await invoke(page, "read_lab_state", {});
  expect(read).toMatchObject({ ok: true, stateRevision: 0 });

  const configureA = await invoke(page, "configure_scenario", {
    operationId: "e2e-configure-a",
    expectedRevision: read.stateRevision,
    slot: "A",
    mode: "REPLACE",
    configuration: CONFIGURATION,
  });
  expect(configureA.ok).toBe(true);
  read = await invoke(page, "read_lab_state", {});
  expect(read.stateRevision).toBe(configureA.stateRevision);

  const configureB = await invoke(page, "configure_scenario", {
    operationId: "e2e-configure-b",
    expectedRevision: read.stateRevision,
    slot: "B",
    mode: "REPLACE",
    configuration: {
      ...CONFIGURATION,
      label: "Ten higher-capacity pods",
      fleet: { ...CONFIGURATION.fleet, vehicleCount: 10, seatsPerVehicle: 10 },
    },
  });
  expect(configureB.ok).toBe(true);

  const injectA = await invoke(page, "inject_disruption", {
    operationId: "e2e-inject-a",
    expectedRevision: configureB.stateRevision,
    scenarioRevisionId: configureA.artifactId,
    disruption: {
      type: "VEHICLE_FAILURE",
      target: {
        kind: "DETERMINISTIC_RULE",
        rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
      },
      atSecond: 720,
    },
  });
  expect(injectA.ok).toBe(true);
  const injectB = await invoke(page, "inject_disruption", {
    operationId: "e2e-inject-b",
    expectedRevision: injectA.stateRevision,
    scenarioRevisionId: configureB.artifactId,
    disruption: {
      type: "VEHICLE_FAILURE",
      target: {
        kind: "DETERMINISTIC_RULE",
        rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
      },
      atSecond: 720,
    },
  });
  expect(injectB.ok).toBe(true);

  const runA = await invoke(page, "run_scenario", {
    operationId: "e2e-run-a",
    expectedRevision: injectB.stateRevision,
    scenarioRevisionId: injectA.artifactId,
  });
  expect(runA.ok).toBe(true);
  const runB = await invoke(page, "run_scenario", {
    operationId: "e2e-run-b",
    expectedRevision: runA.stateRevision,
    scenarioRevisionId: injectB.artifactId,
  });
  expect(runB.ok).toBe(true);

  const comparison = await invoke(page, "compare_scenarios", {
    operationId: "e2e-compare",
    expectedRevision: runB.stateRevision,
    runAId: runA.artifactId,
    runBId: runB.artifactId,
  });
  expect(comparison.ok).toBe(true);
  const finding = await invoke(page, "stage_finding", {
    operationId: "e2e-stage",
    expectedRevision: comparison.stateRevision,
    comparisonId: comparison.artifactId,
    selectedOutcome: "TRADE_OFF",
    emphasis: "BALANCED",
  });
  expect(finding).toMatchObject({
    ok: true,
    summary: { review: "PENDING_REVIEW" },
  });

  await expect(page.getByText("PENDING_REVIEW")).toBeVisible();
  await expect(page.getByText("stage_finding", { exact: true })).toBeVisible();
});

test("unsupported WebMCP remains an honest diagnostic fallback", async ({ page }) => {
  await page.goto("/lab");
  await expect(page.getByText("WebMCP unavailable — manual mode active")).toBeVisible();
  await expect(page.getByText("SYNTHETIC SIMULATION • NO LIVE FLEET CONTROL")).toBeVisible();
  await expect(page.getByText("No browser-agent activity yet.")).toBeVisible();
});
