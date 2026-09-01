import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HUMAN_UI_INVOCATION_CONTEXT,
  WEBMCP_INVOCATION_CONTEXT,
  type MutationResult,
  type RunExecutionContext,
  type StressLabSimulationExecutor,
} from "@/application/stress-lab-ports";
import {
  getManualStressLabController,
  selectStressLabPresentation,
  type ManualCommandOutcome,
  type ScenarioDraft,
} from "@/state/stress-lab-hooks";
import { createStressLabRuntime, type StressLabRuntime } from "@/state/stress-lab-runtime";

const GOLDEN = Object.freeze({
  inputA: "sha256-v1:5156b1558d9767d60d1d050df868adb54b8075a0681ccea50dad07071b64afae",
  ledgerA: "sha256-v1:ca01cda9ae8edcf84ee8319304b7bd4853df5ecc5d0d0262d36a03acdfcc875b",
  resultA: "sha256-v1:d9138005105a050eea5974fe1a6ef0b2680204f15662463ca7fa6d08965d40ad",
  inputB: "sha256-v1:e1e6b94a79218c817ac346922309f87f35755bbd3721142d68db58b67111d80c",
  ledgerB: "sha256-v1:4df5d2078a36d16240e4f9e12bbb2403a8a4db92f9034e6c27bcc1a8c5bc2eb3",
  resultB: "sha256-v1:89dbf5e7080850c849d221b6c6646148bdd017db5ac2988285caf49034744511",
  comparison: "sha256-v1:8cee91dea5021953fe1a606daf2c0a240639699b18669642f0ef9f4800f3be37",
  finding: "sha256-v1:f169bf3fd971e2e490378ec1f3a247bfdc73beb713c76f54edbf09fbea9e64ff",
});

function success(outcome: ManualCommandOutcome): MutationResult {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.code);
  return outcome.result;
}

function currentDraft(runtime: StressLabRuntime, slot: "A" | "B"): ScenarioDraft {
  const presentation = selectStressLabPresentation(runtime.store.getState());
  const draft = presentation?.scenarios[slot]?.draft;
  if (!draft) throw new Error(`Scenario ${slot} draft is unavailable.`);
  return draft;
}

async function prepareManualGolden(runtime: StressLabRuntime) {
  const controller = getManualStressLabController(runtime);
  success(await controller.reset());
  expect(selectStressLabPresentation(runtime.store.getState())?.scenarios.A?.disrupted).toBe(true);
  success(await controller.configure("A", currentDraft(runtime, "A")));
  success(await controller.configure("B", currentDraft(runtime, "B")));
  expect(selectStressLabPresentation(runtime.store.getState())?.scenarios.A?.disrupted).toBe(false);
  expect(selectStressLabPresentation(runtime.store.getState())?.scenarios.B?.disrupted).toBe(false);
  success(await controller.inject("A"));
  success(await controller.inject("B"));
  return controller;
}

async function completeManualGolden(runtime: StressLabRuntime) {
  const controller = await prepareManualGolden(runtime);
  const runA = success(await controller.run("A"));
  const runB = success(await controller.run("B"));
  const comparison = success(await controller.compare());
  const finding = success(await controller.stageFinding());
  return { controller, runA, runB, comparison, finding };
}

describe("Gate 8 manual Stress Lab authority", () => {
  it("reuses one runtime controller and exposes cross-surface commits without reload", async () => {
    const runtime = createStressLabRuntime();
    const first = getManualStressLabController(runtime);
    const second = getManualStressLabController(runtime);
    expect(second).toBe(first);
    await runtime.service.resetLab(
      { operationId: "web-reset-not-allowed-shape", expectedRevision: 0 },
      HUMAN_UI_INVOCATION_CONTEXT,
    );
    const viewAfterHuman = runtime.readObservedView();
    expect(viewAfterHuman.revision).toBe(1);
    expect(viewAfterHuman.scenarios.A).not.toBeNull();

    const scenarioA = viewAfterHuman.scenarios.A!;
    await runtime.service.configureScenarioConfiguration(
      {
        operationId: "web-visible-patch",
        expectedRevision: viewAfterHuman.revision,
        slot: "A",
        mode: "PATCH",
        configuration: { label: "WebMCP-visible scenario" },
      },
      WEBMCP_INVOCATION_CONTEXT,
    );
    const presentation = selectStressLabPresentation(runtime.store.getState());
    expect(presentation?.scenarios.A?.label).toBe("WebMCP-visible scenario");
    expect(presentation?.scenarios.A?.id).not.toBe(scenarioA.id);
    expect(runtime.readObservedView().audit.at(-1)?.source).toBe("WEBMCP");
    runtime.dispose();
  });

  it("executes the complete manual golden lifecycle with exact trusted evidence", async () => {
    const runtime = createStressLabRuntime();
    const { controller, runA, runB, comparison, finding } = await completeManualGolden(runtime);
    const view = runtime.readObservedView();
    expect(view.currentRuns.A).toMatchObject({
      id: runA.artifactId,
      inputFingerprint: GOLDEN.inputA,
      eventLedgerFingerprint: GOLDEN.ledgerA,
      resultFingerprint: GOLDEN.resultA,
      metrics: {
        requestedPassengers: 120,
        unservedPassengers: 9,
        maximumWaitSeconds: 1_050,
        totalEnergyWh: 37_799,
        minimumBatteryBasisPoints: 7_633,
        recoveryTimeSeconds: 120,
      },
    });
    expect(view.currentRuns.B).toMatchObject({
      id: runB.artifactId,
      inputFingerprint: GOLDEN.inputB,
      eventLedgerFingerprint: GOLDEN.ledgerB,
      resultFingerprint: GOLDEN.resultB,
      metrics: {
        requestedPassengers: 120,
        unservedPassengers: 11,
        maximumWaitSeconds: 780,
        totalEnergyWh: 31_665,
        minimumBatteryBasisPoints: 7_648,
        recoveryTimeSeconds: 450,
      },
    });
    const state = runtime.repository.getState();
    for (const slot of ["A", "B"] as const) {
      const runId = state.currentRunIds[slot];
      const failedEvent = runId
        ? state.runs[runId]?.eventLedger.events.find(
            (event) => event.type === "VEHICLE_FAILED",
          )
        : undefined;
      const presentation = selectStressLabPresentation(runtime.store.getState());
      expect(presentation?.scenarios[slot]?.resolvedFailureVehicleId).toBe(
        failedEvent?.facts.vehicleId,
      );
      expect(presentation?.scenarios[slot]?.resolvedFailureVehicleId).toMatch(
        new RegExp(`^${slot}-`),
      );
    }
    expect(view.currentComparison).toMatchObject({
      id: comparison.artifactId,
      comparisonFingerprint: GOLDEN.comparison,
    });
    expect(view.currentFinding).toMatchObject({
      id: finding.artifactId,
      selectedOutcome: "TRADE_OFF",
      emphasis: "BALANCED",
      review: "PENDING_REVIEW",
      findingFingerprint: GOLDEN.finding,
    });
    expect(view.currentRuns.A?.constraints.find((entry) => entry.code === "MAXIMUM_WAIT")?.passed).toBe(false);
    expect(view.currentRuns.B?.constraints.find((entry) => entry.code === "MAXIMUM_WAIT")?.passed).toBe(false);
    expect(view.audit.every((entry) => entry.source === "HUMAN_UI")).toBe(true);
    expect(new Set(view.audit.map((entry) => entry.operationId)).size).toBeGreaterThan(8);

    const pending = runtime.repository.getState();
    const replacement = await controller.stageFinding();
    expect(replacement).toEqual({ ok: false, code: "PREREQUISITE_NOT_MET" });
    expect(runtime.repository.getState()).toBe(pending);

    success(await controller.acceptFinding());
    expect(runtime.readObservedView().currentFinding?.review).toBe("ACCEPTED");
    success(await controller.stageFinding());
    expect(runtime.readObservedView().currentFinding?.review).toBe("PENDING_REVIEW");
    success(await controller.challengeFinding("Recheck the service and energy trade-off."));
    expect(runtime.readObservedView().currentFinding).toMatchObject({
      review: "CHALLENGED",
      feedback: "Recheck the service and energy trade-off.",
    });
    expect(runtime.readObservedView().currentComparison?.comparisonFingerprint).toBe(GOLDEN.comparison);
    runtime.dispose();
  }, 40_000);

  it("blocks invalid drafts before service invocation", async () => {
    const runtime = createStressLabRuntime();
    const controller = getManualStressLabController(runtime);
    success(await controller.reset());
    const spy = vi.spyOn(runtime.service, "configureScenarioConfiguration");
    const invalid = { ...currentDraft(runtime, "A"), seatsPerVehicle: 0 };
    expect(await controller.configure("A", invalid)).toEqual({
      ok: false,
      code: "INVALID_COMMAND",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(runtime.readObservedView().revision).toBe(1);
    runtime.dispose();
  });

  it("coalesces double-run clicks and cancellation publishes no ghost result", async () => {
    let release!: () => void;
    let calls = 0;
    let context: RunExecutionContext | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor: StressLabSimulationExecutor = {
      async execute(_input, runContext) {
        calls += 1;
        context = runContext;
        await gate;
        throw new Error("controlled cancellation release");
      },
    };
    const runtime = createStressLabRuntime({ simulationExecutor: executor });
    const controller = await prepareManualGolden(runtime);
    const first = controller.run("A");
    const duplicate = controller.run("A");
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(context).toBeDefined());
    expect(calls).toBe(1);
    const cancelled = await controller.cancel("A");
    expect(cancelled.ok).toBe(true);
    release();
    expect((await first).ok).toBe(false);
    expect(runtime.readObservedView().currentRuns.A).toBeNull();
    await Promise.resolve();
    expect(runtime.readObservedView().currentRuns.A).toBeNull();
    runtime.dispose();
  });

  it("renders exactly application-returned invalidations while preserving B", async () => {
    const runtime = createStressLabRuntime();
    const { controller, runA, runB, comparison, finding } = await completeManualGolden(runtime);
    const changedDraft = { ...currentDraft(runtime, "A"), vehicleCount: 11 };
    const mutation = success(await controller.configure("A", changedDraft));
    expect("invalidatedArtifactIds" in mutation).toBe(true);
    const invalidated = "invalidatedArtifactIds" in mutation
      ? mutation.invalidatedArtifactIds
      : [];
    expect(invalidated).toEqual([
      runA.artifactId,
      comparison.artifactId,
      finding.artifactId,
    ]);
    expect(controller.getSnapshot().lastInvalidatedArtifactIds).toEqual(invalidated);
    expect(runtime.readObservedView().currentRuns.A).toBeNull();
    expect(runtime.readObservedView().currentRuns.B?.id).toBe(runB.artifactId);
    expect(runtime.readObservedView().currentComparison).toBeNull();
    expect(runtime.readObservedView().currentFinding).toBeNull();
    expect(runtime.repository.getState().runs[runA.artifactId!]).toBeDefined();
    expect(runtime.repository.getState().comparisons[comparison.artifactId!]).toBeDefined();
    expect(runtime.repository.getState().findings[finding.artifactId!]).toBeDefined();
    runtime.dispose();
  }, 40_000);

  it("keeps trusted KPI literals and winner logic out of production components", () => {
    const root = resolve(process.cwd(), "src/features/stress-lab");
    const production = [
      "StressLab.tsx",
      "ScenarioPanel.tsx",
      "MetricsPanel.tsx",
      "ComparisonPanel.tsx",
      "FindingReview.tsx",
      "ActivityRail.tsx",
    ].map((file) => readFileSync(resolve(root, file), "utf8")).join("\n");
    expect(production).not.toMatch(/37[,_]?799|31[,_]?665|1[,_]?050|\b780\b|\b7[,_]?633\b|\b7[,_]?648\b/u);
    expect(production).not.toMatch(/winnerScore|bestPlan|optimalPlan/u);
    expect(production).not.toContain("dangerouslySetInnerHTML");
    expect(production).toContain("aria-live");
    expect(production).toContain("PENDING_REVIEW");
    expect(production).toContain("RESOLVED FAILURE TARGET");
    expect(production).toContain("activity.artifactId");
  });
});
