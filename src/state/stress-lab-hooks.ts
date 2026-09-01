"use client";

import { useSyncExternalStore } from "react";
import {
  HUMAN_UI_INVOCATION_CONTEXT,
  StressLabApplicationError,
  type MutationResult,
  type PublicScenarioConfiguration,
  type StressLabApplicationState,
  type StressLabStateView,
} from "@/application/stress-lab-ports";
import type { ScenarioSlot } from "@/domain/stress-lab/types";
import type { StressLabRuntimeStoreState } from "@/infrastructure/persistence/stress-lab-repository";
import type { StressLabRuntime } from "@/state/stress-lab-runtime";

export interface ScenarioDraft {
  readonly vehicleCount: number;
  readonly seatsPerVehicle: number;
  readonly batteryCapacityKWh: number;
  readonly startingBatteryPercent: number;
  readonly minimumReservePercent: number;
  readonly energyKWhPerKm: number;
  readonly dwellSeconds: number;
  readonly maximumWaitSeconds: number;
  readonly maximumUnservedPassengers: number;
  readonly maximumRecoverySeconds: number;
}

export type ScenarioDraftErrors = Readonly<Partial<Record<keyof ScenarioDraft, string>>>;

export interface ScenarioPresentation {
  readonly id: string;
  readonly slot: ScenarioSlot;
  readonly label: string;
  readonly revision: number;
  readonly inputFingerprint: string;
  readonly configured: boolean;
  readonly disrupted: boolean;
  readonly resolvedFailureVehicleId?: string;
  readonly draft: ScenarioDraft;
}

export interface StressLabPresentation {
  readonly view: StressLabStateView;
  readonly application: StressLabApplicationState;
  readonly scenarios: Readonly<Record<ScenarioSlot, ScenarioPresentation | null>>;
  readonly comparison: StressLabApplicationState["comparisons"][string] | null;
  readonly finding: StressLabApplicationState["findings"][string] | null;
  readonly webMcpStatus: StressLabRuntimeStoreState["ui"]["webMcpStatus"];
  readonly webMcpMessage: string;
  readonly webMcpActivities: StressLabRuntimeStoreState["ui"]["activities"];
}

export type ManualActivityStatus =
  | "RECEIVED"
  | "VALIDATED"
  | "RUNNING"
  | "COMMITTED"
  | "FAILED"
  | "CANCELLED";

export interface ManualActivity {
  readonly operationId: string;
  readonly source: "HUMAN_UI";
  readonly action: string;
  readonly target: string;
  readonly transitions: readonly ManualActivityStatus[];
  readonly resultingRevision?: number;
  readonly artifactId?: string;
  readonly safeErrorCode?: string;
}

export interface ManualControllerSnapshot {
  readonly activeActions: readonly string[];
  readonly activities: readonly ManualActivity[];
  readonly notice: string;
  readonly error: string;
  readonly lastInvalidatedArtifactIds: readonly string[];
}

export type ManualCommandOutcome =
  | { readonly ok: true; readonly result: MutationResult }
  | { readonly ok: false; readonly code: string };

const EMPTY_MANUAL_SNAPSHOT: ManualControllerSnapshot = Object.freeze({
  activeActions: Object.freeze([]),
  activities: Object.freeze([]),
  notice: "",
  error: "",
  lastInvalidatedArtifactIds: Object.freeze([]),
});

function toScenarioPresentation(
  application: StressLabApplicationState,
  slot: ScenarioSlot,
): ScenarioPresentation | null {
  const id = application.currentScenarioRevisionIds[slot];
  const record = id ? application.scenarioRevisions[id] : undefined;
  if (!record) return null;
  const input = record.preparedInput.input;
  const currentRunId = application.currentRunIds[slot];
  const currentRun = currentRunId ? application.runs[currentRunId] : undefined;
  const failedEvent = currentRun?.eventLedger.events.find(
    (event) => event.type === "VEHICLE_FAILED",
  );
  const resolvedFailureVehicleId =
    typeof failedEvent?.facts.vehicleId === "string"
      ? failedEvent.facts.vehicleId
      : undefined;
  return Object.freeze({
    id: record.id,
    slot,
    label: input.scenario.label,
    revision: record.ref.revision,
    inputFingerprint: record.preparedInput.fingerprint,
    configured: application.audit.some(
      (entry) =>
        (entry.action === "SCENARIO_CONFIGURED" ||
          entry.action === "DISRUPTION_INJECTED") &&
        entry.artifactIds.includes(record.id),
    ),
    disrupted: input.disruptions.length > 0,
    ...(resolvedFailureVehicleId ? { resolvedFailureVehicleId } : {}),
    draft: Object.freeze({
      vehicleCount: input.scenario.fleet.vehicleCount,
      seatsPerVehicle: input.scenario.fleet.seatsPerVehicle,
      batteryCapacityKWh: input.scenario.fleet.batteryCapacityWh / 1_000,
      startingBatteryPercent:
        input.scenario.fleet.startingBatteryBasisPoints / 100,
      minimumReservePercent:
        input.scenario.fleet.minimumReserveBasisPoints / 100,
      energyKWhPerKm: input.scenario.fleet.energyWhPerKilometre / 1_000,
      dwellSeconds: input.scenario.fleet.dwellSeconds,
      maximumWaitSeconds: input.scenario.constraints.maximumWaitSeconds,
      maximumUnservedPassengers:
        input.scenario.constraints.maximumUnservedPassengers,
      maximumRecoverySeconds:
        input.scenario.constraints.maximumRecoverySeconds,
    }),
  });
}

export function selectStressLabPresentation(
  state: StressLabRuntimeStoreState,
): StressLabPresentation | null {
  const view = state.ui.observedView;
  if (!view) return null;
  const comparisonId = state.application.currentComparisonId;
  const findingId = state.application.currentFindingId;
  return Object.freeze({
    view,
    application: state.application,
    scenarios: Object.freeze({
      A: toScenarioPresentation(state.application, "A"),
      B: toScenarioPresentation(state.application, "B"),
    }),
    comparison: comparisonId
      ? (state.application.comparisons[comparisonId] ?? null)
      : null,
    finding: findingId
      ? (state.application.findings[findingId] ?? null)
      : null,
    webMcpStatus: state.ui.webMcpStatus,
    webMcpMessage: state.ui.webMcpMessage,
    webMcpActivities: state.ui.activities,
  });
}

function integerError(value: number, minimum: number, maximum: number): string | null {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return `Enter a whole number from ${minimum} to ${maximum}.`;
  }
  return null;
}

function scaledError(
  value: number,
  scale: number,
  minimum: number,
  maximum: number,
): string | null {
  if (
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value * scale) ||
    value < minimum ||
    value > maximum
  ) {
    return `Enter a value from ${minimum} to ${maximum} with at most ${Math.log10(scale)} decimal places.`;
  }
  return null;
}

export function validateScenarioDraft(draft: ScenarioDraft): ScenarioDraftErrors {
  const errors: Partial<Record<keyof ScenarioDraft, string>> = {};
  const entries: readonly [keyof ScenarioDraft, string | null][] = [
    ["vehicleCount", integerError(draft.vehicleCount, 0, 30)],
    ["seatsPerVehicle", integerError(draft.seatsPerVehicle, 1, 20)],
    ["batteryCapacityKWh", scaledError(draft.batteryCapacityKWh, 1_000, 0.001, 1_000_000)],
    ["startingBatteryPercent", scaledError(draft.startingBatteryPercent, 100, 0, 100)],
    ["minimumReservePercent", scaledError(draft.minimumReservePercent, 100, 0, 100)],
    ["energyKWhPerKm", scaledError(draft.energyKWhPerKm, 1_000, 0.001, 100)],
    ["dwellSeconds", integerError(draft.dwellSeconds, 0, 86_400)],
    ["maximumWaitSeconds", integerError(draft.maximumWaitSeconds, 0, 86_400)],
    [
      "maximumUnservedPassengers",
      integerError(draft.maximumUnservedPassengers, 0, 1_000_000),
    ],
    ["maximumRecoverySeconds", integerError(draft.maximumRecoverySeconds, 0, 86_400)],
  ];
  for (const [key, error] of entries) {
    if (error) errors[key] = error;
  }
  if (
    !errors.minimumReservePercent &&
    !errors.startingBatteryPercent &&
    draft.minimumReservePercent > draft.startingBatteryPercent
  ) {
    errors.minimumReservePercent = "Reserve cannot exceed starting battery.";
  }
  return Object.freeze(errors);
}

function replacementConfiguration(
  state: StressLabApplicationState,
  slot: ScenarioSlot,
  draft: ScenarioDraft,
): PublicScenarioConfiguration {
  const scenarioId = state.currentScenarioRevisionIds[slot];
  const record = scenarioId ? state.scenarioRevisions[scenarioId] : undefined;
  if (!record) {
    throw new StressLabApplicationError(
      "PREREQUISITE_NOT_MET",
      slot,
      `Scenario ${slot} must be initialized before configuration.`,
    );
  }
  const input = record.preparedInput.input;
  return Object.freeze({
    label: input.scenario.label,
    fleet: Object.freeze({
      vehicleCount: draft.vehicleCount,
      seatsPerVehicle: draft.seatsPerVehicle,
      batteryCapacityKWh: draft.batteryCapacityKWh,
      startingBatteryPercent: draft.startingBatteryPercent,
      minimumReservePercent: draft.minimumReservePercent,
      energyKWhPerKm: draft.energyKWhPerKm,
      dwellSeconds: draft.dwellSeconds,
      initialZoneWeights: Object.freeze(
        Object.fromEntries(
          input.scenario.fleet.initialZoneWeights.map((entry) => [
            entry.zoneId,
            entry.weight,
          ]),
        ),
      ),
    }),
    constraints: Object.freeze({
      maximumWaitSeconds: draft.maximumWaitSeconds,
      maximumUnservedPassengers: draft.maximumUnservedPassengers,
      minimumBatteryReservePercent: draft.minimumReservePercent,
      maximumRecoverySeconds: draft.maximumRecoverySeconds,
      standingAllowed: false as const,
    }),
    objectives: Object.freeze([...input.scenario.objectives]),
  });
}

function safeError(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof StressLabApplicationError) {
    const messages: Partial<Record<typeof error.code, string>> = {
      REVISION_CONFLICT: "The workspace changed. Review the current revision and retry.",
      PREREQUISITE_NOT_MET: "Complete the required prior step before continuing.",
      OPERATION_CANCELLED: "The operation was cancelled before publication.",
      STALE_SCENARIO_REVISION: "This scenario revision is no longer current.",
      STALE_RUN: "A selected run is no longer current.",
      STALE_COMPARISON: "The comparison is no longer current.",
      STALE_FINDING: "The finding is no longer current.",
      IDEMPOTENCY_CONFLICT: "This operation identity was already used for different work.",
      INVALID_COMMAND: "The submitted values are outside the approved Stress Lab contract.",
      INVALID_STATE_TRANSITION: "The requested workflow transition is not currently legal.",
      SIMULATION_FAILED: "The deterministic run failed closed without publishing evidence.",
    };
    return {
      code: error.code,
      message: messages[error.code] ?? "The application authority rejected this operation.",
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The operation failed safely. No unverified evidence was published.",
  };
}

function artifactIdOf(result: MutationResult): string | undefined {
  return result.artifactId;
}

export class ManualStressLabController {
  private snapshot: ManualControllerSnapshot = EMPTY_MANUAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Map<string, Promise<ManualCommandOutcome>>();

  constructor(private readonly runtime: StressLabRuntime) {}

  getSnapshot = (): ManualControllerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(next: ManualControllerSnapshot): void {
    this.snapshot = Object.freeze({
      ...next,
      activeActions: Object.freeze([...next.activeActions]),
      activities: Object.freeze([...next.activities]),
      lastInvalidatedArtifactIds: Object.freeze([
        ...next.lastInvalidatedArtifactIds,
      ]),
    });
    for (const listener of [...this.listeners]) listener();
  }

  private updateActivity(
    operationId: string,
    status: ManualActivityStatus,
    details: {
      readonly resultingRevision?: number;
      readonly artifactId?: string;
      readonly safeErrorCode?: string;
    } = {},
  ): void {
    this.publish({
      ...this.snapshot,
      activities: this.snapshot.activities.map((activity) =>
        activity.operationId === operationId
          ? Object.freeze({
              ...activity,
              transitions: Object.freeze([...activity.transitions, status]),
              ...details,
            })
          : activity,
      ),
    });
  }

  private execute(
    key: string,
    target: string,
    task: (operationId: string) => Promise<MutationResult>,
  ): Promise<ManualCommandOutcome> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operationId = this.runtime.nextManualOperationId(key);
    const activity: ManualActivity = Object.freeze({
      operationId,
      source: "HUMAN_UI",
      action: key,
      target,
      transitions: Object.freeze(["RECEIVED" as const]),
    });
    this.publish({
      ...this.snapshot,
      activeActions: [...this.snapshot.activeActions, key],
      activities: [activity, ...this.snapshot.activities].slice(0, 24),
      notice: "",
      error: "",
      lastInvalidatedArtifactIds: [],
    });
    this.updateActivity(operationId, "VALIDATED");
    this.updateActivity(operationId, "RUNNING");

    const pending = (async (): Promise<ManualCommandOutcome> => {
      try {
        const result = await task(operationId);
        await this.runtime.waitForObservedRevision(result.stateRevision);
        const invalidatedArtifactIds =
          "invalidatedArtifactIds" in result &&
          Array.isArray(result.invalidatedArtifactIds)
            ? [...result.invalidatedArtifactIds]
            : [];
        this.updateActivity(operationId, "COMMITTED", {
          resultingRevision: result.stateRevision,
          ...(artifactIdOf(result) ? { artifactId: artifactIdOf(result) } : {}),
        });
        this.publish({
          ...this.snapshot,
          notice: `${key.replaceAll("-", " ")} committed at revision ${result.stateRevision}.`,
          error: "",
          lastInvalidatedArtifactIds: invalidatedArtifactIds,
        });
        return { ok: true, result };
      } catch (error) {
        const failure = safeError(error);
        const status =
          failure.code === "OPERATION_CANCELLED" ? "CANCELLED" : "FAILED";
        this.updateActivity(operationId, status, {
          safeErrorCode: failure.code,
        });
        this.publish({
          ...this.snapshot,
          notice: "",
          error: failure.message,
          lastInvalidatedArtifactIds: [],
        });
        return { ok: false, code: failure.code };
      } finally {
        this.inFlight.delete(key);
        this.publish({
          ...this.snapshot,
          activeActions: this.snapshot.activeActions.filter(
            (active) => active !== key,
          ),
        });
      }
    })();
    this.inFlight.set(key, pending);
    return pending;
  }

  reset(): Promise<ManualCommandOutcome> {
    return this.execute("reset-lab", "LAB", (operationId) => {
      const view = this.runtime.readObservedView();
      return this.runtime.service.resetLab(
        { operationId, expectedRevision: view.revision },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  configure(
    slot: ScenarioSlot,
    draft: ScenarioDraft,
  ): Promise<ManualCommandOutcome> {
    const errors = validateScenarioDraft(draft);
    if (Object.keys(errors).length > 0) {
      this.publish({
        ...this.snapshot,
        notice: "",
        error: `Scenario ${slot} contains invalid values.`,
        lastInvalidatedArtifactIds: [],
      });
      return Promise.resolve({ ok: false, code: "INVALID_COMMAND" });
    }
    return this.execute(`configure-${slot.toLowerCase()}`, `SCENARIO:${slot}`, (operationId) => {
      const view = this.runtime.readObservedView();
      const scenario = view.scenarios[slot];
      if (!scenario) {
        throw new StressLabApplicationError(
          "PREREQUISITE_NOT_MET",
          slot,
          `Scenario ${slot} must be initialized before configuration.`,
        );
      }
      return this.runtime.service.configureScenarioConfiguration(
        {
          operationId,
          expectedRevision: view.revision,
          slot,
          mode: "REPLACE",
          configuration: replacementConfiguration(
            this.runtime.repository.getState(),
            slot,
            draft,
          ),
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  inject(slot: ScenarioSlot): Promise<ManualCommandOutcome> {
    return this.execute(`inject-${slot.toLowerCase()}`, `SCENARIO:${slot}`, (operationId) => {
      const view = this.runtime.readObservedView();
      const scenario = view.scenarios[slot];
      if (!scenario) {
        throw new StressLabApplicationError(
          "PREREQUISITE_NOT_MET",
          slot,
          `Scenario ${slot} must be configured before disruption.`,
        );
      }
      return this.runtime.service.injectPublicDisruption(
        {
          operationId,
          expectedRevision: view.revision,
          scenarioRevisionId: scenario.id,
          disruption: {
            type: "VEHICLE_FAILURE",
            target: {
              kind: "DETERMINISTIC_RULE",
              rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID",
            },
            atSecond: 720,
          },
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  run(slot: ScenarioSlot): Promise<ManualCommandOutcome> {
    return this.execute(`run-${slot.toLowerCase()}`, `RUN:${slot}`, (operationId) => {
      const view = this.runtime.readObservedView();
      const scenario = view.scenarios[slot];
      if (!scenario) {
        throw new StressLabApplicationError(
          "PREREQUISITE_NOT_MET",
          slot,
          `Scenario ${slot} must be configured before a run.`,
        );
      }
      return this.runtime.service.runScenario(
        {
          operationId,
          expectedRevision: view.revision,
          scenarioRevisionId: scenario.id,
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  cancel(slot: ScenarioSlot): Promise<ManualCommandOutcome> {
    return this.execute(`cancel-${slot.toLowerCase()}`, `RUN:${slot}`, (operationId) => {
      const view = this.runtime.readObservedView();
      const active = view.activeOperations.find(
        (operation) => operation.target === `RUN:${slot}`,
      );
      if (!active) {
        throw new StressLabApplicationError(
          "INVALID_STATE_TRANSITION",
          slot,
          `Scenario ${slot} has no active run.`,
        );
      }
      return this.runtime.service.cancelRun(
        {
          operationId,
          expectedRevision: view.revision,
          slot,
          targetOperationId: active.operationId,
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  compare(): Promise<ManualCommandOutcome> {
    return this.execute("compare-scenarios", "COMPARISON", (operationId) => {
      const view = this.runtime.readObservedView();
      const left = view.currentRuns.A;
      const right = view.currentRuns.B;
      if (!left?.isCurrent || !right?.isCurrent) {
        throw new StressLabApplicationError(
          "PREREQUISITE_NOT_MET",
          "COMPARISON",
          "Current Scenario A and B runs are required.",
        );
      }
      return this.runtime.service.compareScenarios(
        {
          operationId,
          expectedRevision: view.revision,
          leftRunId: left.id,
          rightRunId: right.id,
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  stageFinding(): Promise<ManualCommandOutcome> {
    return this.execute("stage-finding", "FINDING", (operationId) => {
      const view = this.runtime.readObservedView();
      const comparison = view.currentComparison;
      if (!comparison?.isCurrent) {
        throw new StressLabApplicationError(
          "PREREQUISITE_NOT_MET",
          "FINDING",
          "A current trusted comparison is required.",
        );
      }
      return this.runtime.service.stageFinding(
        {
          operationId,
          expectedRevision: view.revision,
          comparisonId: comparison.id,
          selectedOutcome: "TRADE_OFF",
          emphasis: "BALANCED",
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  acceptFinding(): Promise<ManualCommandOutcome> {
    return this.execute("accept-finding", "FINDING", (operationId) => {
      const view = this.runtime.readObservedView();
      const finding = view.currentFinding;
      if (!finding?.isCurrent || finding.review !== "PENDING_REVIEW") {
        throw new StressLabApplicationError(
          "PREREQUISITE_NOT_MET",
          "FINDING",
          "A current pending finding is required.",
        );
      }
      return this.runtime.service.acceptFinding(
        {
          operationId,
          expectedRevision: view.revision,
          findingId: finding.id,
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }

  challengeFinding(feedback: string): Promise<ManualCommandOutcome> {
    return this.execute("challenge-finding", "FINDING", (operationId) => {
      const view = this.runtime.readObservedView();
      const finding = view.currentFinding;
      if (!finding?.isCurrent || finding.review !== "PENDING_REVIEW") {
        throw new StressLabApplicationError(
          "PREREQUISITE_NOT_MET",
          "FINDING",
          "A current pending finding is required.",
        );
      }
      return this.runtime.service.challengeFinding(
        {
          operationId,
          expectedRevision: view.revision,
          findingId: finding.id,
          feedback,
        },
        HUMAN_UI_INVOCATION_CONTEXT,
      );
    });
  }
}

const CONTROLLERS = new WeakMap<StressLabRuntime, ManualStressLabController>();

export function getManualStressLabController(
  runtime: StressLabRuntime,
): ManualStressLabController {
  const existing = CONTROLLERS.get(runtime);
  if (existing) return existing;
  const controller = new ManualStressLabController(runtime);
  CONTROLLERS.set(runtime, controller);
  return controller;
}

export function useStressLabRuntimeState(
  runtime: StressLabRuntime,
): StressLabRuntimeStoreState {
  return useSyncExternalStore(
    runtime.store.subscribe,
    runtime.store.getState,
    runtime.store.getInitialState,
  );
}

export function useManualControllerState(
  controller: ManualStressLabController,
): ManualControllerSnapshot {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    () => EMPTY_MANUAL_SNAPSHOT,
  );
}
