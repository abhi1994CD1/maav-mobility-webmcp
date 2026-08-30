import { expect, test } from "@playwright/test";

interface BrowserToolResult {
  ok: boolean;
  stateRevision: number;
  error?: { code: string };
}

async function installModelContextMock(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const registered = new Map<string, WebMCP.ModelContextTool>();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: async (tool: WebMCP.ModelContextTool) => {
          registered.set(tool.name, tool);
        },
        getTools: async () => [...registered.values()],
      },
    });
    Object.assign(window, {
      __gate2Tools: registered,
      __gate2RegistrationNames: [] as string[],
    });
    const originalRegister = document.modelContext!.registerTool.bind(
      document.modelContext,
    );
    document.modelContext!.registerTool = async (tool, options) => {
      (
        window as typeof window & { __gate2RegistrationNames: string[] }
      ).__gate2RegistrationNames.push(tool.name);
      return originalRegister(tool, options);
    };
  });
}

async function invokeTool(
  page: import("@playwright/test").Page,
  name: string,
  input: Record<string, unknown>,
): Promise<BrowserToolResult> {
  return page.evaluate(
    async ({ toolName, args }) => {
      const tools = (
        window as typeof window & {
          __gate2Tools: Map<string, WebMCP.ModelContextTool>;
        }
      ).__gate2Tools;
      const tool = tools.get(toolName);
      if (!tool) throw new Error(`Tool not registered: ${toolName}`);
      return (await tool.execute(args, {
        signal: new AbortController().signal,
      })) as BrowserToolResult;
    },
    { toolName: name, args: input },
  );
}

test("WebMCP adapter and manual UI operate the same visible Gate 2 state", async ({
  page,
}) => {
  await installModelContextMock(page);
  await page.goto("/lab");
  await expect(page.getByText("PROVISIONAL INTEGRATION-TEST STATE")).toBeVisible();
  await expect(page.getByText("2 static Chrome WebMCP tools registered")).toBeVisible();

  const catalog = await page.evaluate(async () =>
    (await document.modelContext!.getTools!()).map((tool) => tool.name),
  );
  expect(catalog).toEqual(["read_lab_state", "configure_scenario"]);

  const initial = await invokeTool(page, "read_lab_state", {
    scope: "SUMMARY",
  });
  expect(initial).toMatchObject({ ok: true, stateRevision: 0 });

  const configured = await invokeTool(page, "configure_scenario", {
    operationId: "browser-gate2-a-r1",
    expectedRevision: 0,
    slot: "A",
    mode: "REPLACE",
    configuration: {
      label: "Agent-configured compact pods",
      fleet: { vehicleCount: 12, seatsPerVehicle: 8 },
    },
  });
  expect(configured).toMatchObject({ ok: true, stateRevision: 1 });
  await expect(page.getByRole("heading", { name: "Agent-configured compact pods" })).toBeVisible();
  await expect(page.getByText("WEBMCP • SUCCEEDED • REV 1")).toBeVisible();
  await expect(page.getByLabel("Workspace revision 1")).toBeVisible();

  const readBack = await invokeTool(page, "read_lab_state", {
    scope: "SCENARIO",
    objectId: "A",
  });
  expect(readBack).toMatchObject({ ok: true, stateRevision: 1 });

  const invalid = await invokeTool(page, "configure_scenario", {
    operationId: "browser-invalid",
    expectedRevision: 1,
    slot: "A",
    mode: "REPLACE",
    configuration: {
      label: "Invalid extra field",
      fleet: { vehicleCount: 12, seatsPerVehicle: 8 },
    },
    forbidden: true,
  });
  expect(invalid).toMatchObject({
    ok: false,
    stateRevision: 1,
    error: { code: "INVALID_ARGUMENTS" },
  });
  await expect(page.getByLabel("Workspace revision 1")).toBeVisible();
  await expect(page.getByText("WEBMCP • REJECTED • REV 1")).toBeVisible();

  await page.getByRole("button", { name: "Configure Scenario B" }).click();
  await expect(page.getByRole("heading", { name: "Ten higher-capacity pods" })).toBeVisible();
  await expect(page.getByText("HUMAN_UI • SUCCEEDED • REV 2")).toBeVisible();
  await expect(page.getByLabel("Workspace revision 2")).toBeVisible();

  const registrations = await page.evaluate(
    () =>
      (
        window as typeof window & { __gate2RegistrationNames: string[] }
      ).__gate2RegistrationNames,
  );
  expect(registrations).toEqual(["read_lab_state", "configure_scenario"]);
});

test("unsupported WebMCP degrades honestly while manual mode remains usable", async ({
  page,
}) => {
  await page.goto("/lab");
  await expect(page.getByText("WebMCP unavailable — manual mode active")).toBeVisible();
  await page.getByRole("button", { name: "Configure Scenario A" }).click();
  await expect(page.getByRole("heading", { name: "Twelve compact pods" })).toBeVisible();
  await expect(page.getByLabel("Workspace revision 1")).toBeVisible();
  await expect(page.getByText("HUMAN_UI • SUCCEEDED • REV 1")).toBeVisible();
});
