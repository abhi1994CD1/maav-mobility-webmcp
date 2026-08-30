import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import {
  createEventLedgerDocument,
  createFingerprintDocument,
  runResultIdentityValue,
  type RunResultIdentityInput,
} from "@/domain/stress-lab/fingerprint";
import { deriveRunEvidence } from "@/domain/stress-lab/metrics";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import { count, fingerprint, simulatedSecond } from "@/domain/stress-lab/types";
import type {
  SimulationEvent,
  StressLabRunInput,
} from "@/domain/stress-lab/types";

function cloneInput(input: StressLabRunInput): StressLabRunInput {
  return JSON.parse(JSON.stringify(input)) as StressLabRunInput;
}

function createUntrustedRunResultDocument(result: RunResultIdentityInput) {
  return createFingerprintDocument(
    "RUN_RESULT_EVIDENCE",
    runResultIdentityValue(result),
  );
}

function assertFiniteIntegers(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertFiniteIntegers(entry);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) assertFiniteIntegers(entry);
  }
}

describe("Gate 4 canonical KPI and constraint evidence", () => {
  it("folds every KPI and constraint deterministically from the ledger", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const result = runDeterministicSimulation(prepared);
    const derived = deriveRunEvidence(prepared.input, result.events);

    expect(derived.metrics).toEqual(result.metrics);
    expect(derived.constraints).toEqual(result.constraints);
    expect(result.constraints.map((entry) => entry.code)).toEqual([
      "MAXIMUM_WAIT",
      "MAXIMUM_UNSERVED",
      "MINIMUM_RESERVE",
      "MAXIMUM_RECOVERY",
      "NO_STANDING",
    ]);
    const evidenceIds = new Set(result.events.map((event) => event.evidenceId));
    for (const constraint of result.constraints) {
      for (const id of constraint.evidenceIds) expect(evidenceIds.has(id)).toBe(true);
    }
    assertFiniteIntegers(result.metrics);
    assertFiniteIntegers(result.constraints);
  });

  it("retains the exact canonical bytes covered by the result fingerprint", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const document = createUntrustedRunResultDocument({
      resultSchemaVersion: result.resultSchemaVersion,
      eventSchemaVersion: result.eventSchemaVersion,
      inputFingerprint: result.inputFingerprint,
      engineVersion: result.engineVersion,
      tickSemanticsVersion: result.tickSemanticsVersion,
      controllerId: result.controllerId,
      controllerVersion: result.controllerVersion,
      metricDefinitionVersion: result.metricDefinitionVersion,
      eventLedgerFingerprint: result.eventLedgerFingerprint,
      snapshots: result.snapshots,
      terminalState: result.terminalState,
      metrics: result.metrics,
      constraints: result.constraints,
    });
    expect(document.canonicalJson).toBe(result.canonicalResultJson);
    expect(document.fingerprint).toBe(result.resultFingerprint);
    expect(result.resultFingerprint).toBe(
      `sha256-v1:${createHash("sha256")
        .update(result.canonicalResultJson, "utf8")
        .digest("hex")}`,
    );
  });

  it("locks the verified golden A/B result fingerprints", () => {
    const inputs = createGoldenExperimentInputs();
    const results = {
      A: runDeterministicSimulation(inputs.runs.A),
      B: runDeterministicSimulation(inputs.runs.B),
    };
    expect({
      ledgerA: results.A.eventLedgerFingerprint,
      resultA: results.A.resultFingerprint,
      ledgerB: results.B.eventLedgerFingerprint,
      resultB: results.B.resultFingerprint,
    }).toEqual({
      ledgerA: "sha256-v1:ca01cda9ae8edcf84ee8319304b7bd4853df5ecc5d0d0262d36a03acdfcc875b",
      resultA: "sha256-v1:d9138005105a050eea5974fe1a6ef0b2680204f15662463ca7fa6d08965d40ad",
      ledgerB: "sha256-v1:4df5d2078a36d16240e4f9e12bbb2403a8a4db92f9034e6c27bcc1a8c5bc2eb3",
      resultB: "sha256-v1:89dbf5e7080850c849d221b6c6646148bdd017db5ac2988285caf49034744511",
    });
  });

  it("changes the fingerprint when audited evidence changes", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const events = JSON.parse(JSON.stringify(result.events)) as SimulationEvent[];
    const arrivalIndex = events.findIndex(
      (event) => event.type === "PASSENGER_ARRIVED",
    );
    events[arrivalIndex] = {
      ...events[arrivalIndex],
      facts: { ...events[arrivalIndex].facts, requestSecond: 30 },
    };
    const changedLedger = createEventLedgerDocument({
      eventSchemaVersion: result.eventSchemaVersion,
      inputFingerprint: result.inputFingerprint,
      engineVersion: result.engineVersion,
      tickSemanticsVersion: result.tickSemanticsVersion,
      controllerId: result.controllerId,
      controllerVersion: result.controllerVersion,
      events,
    });
    const changed = createUntrustedRunResultDocument({
      resultSchemaVersion: result.resultSchemaVersion,
      eventSchemaVersion: result.eventSchemaVersion,
      inputFingerprint: result.inputFingerprint,
      engineVersion: result.engineVersion,
      tickSemanticsVersion: result.tickSemanticsVersion,
      controllerId: result.controllerId,
      controllerVersion: result.controllerVersion,
      metricDefinitionVersion: result.metricDefinitionVersion,
      eventLedgerFingerprint: changedLedger.fingerprint,
      snapshots: result.snapshots,
      terminalState: result.terminalState,
      metrics: result.metrics,
      constraints: result.constraints,
    });
    expect(changed.fingerprint).not.toBe(result.resultFingerprint);
    expect(changedLedger.fingerprint).not.toBe(
      result.eventLedgerFingerprint,
    );
  });

  it("separates event-ledger identity from metric-only evidence changes", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const repeatedLedger = createEventLedgerDocument(result);
    expect(repeatedLedger.fingerprint).toBe(result.eventLedgerFingerprint);

    const metricOnly = createUntrustedRunResultDocument({
      ...result,
      metrics: {
        ...result.metrics,
        maximumWaitSeconds: simulatedSecond(
          result.metrics.maximumWaitSeconds + 30,
        ),
      },
    });
    expect(repeatedLedger.fingerprint).toBe(result.eventLedgerFingerprint);
    expect(metricOnly.fingerprint).not.toBe(result.resultFingerprint);
  });

  it("commits every ordered snapshot to result identity but not ledger identity", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const snapshots = JSON.parse(
      JSON.stringify(result.snapshots),
    ) as typeof result.snapshots;
    const changed = snapshots.map((snapshot, index) =>
      index === 1
        ? {
            ...snapshot,
            zoneQueueCounts: {
              ...snapshot.zoneQueueCounts,
              sandton: count((snapshot.zoneQueueCounts.sandton ?? 0) + 1),
            },
          }
        : snapshot,
    );
    const changedDocument = createUntrustedRunResultDocument({
      ...result,
      snapshots: changed,
    });
    expect(changedDocument.fingerprint).not.toBe(result.resultFingerprint);
    expect(createEventLedgerDocument(result).fingerprint).toBe(
      result.eventLedgerFingerprint,
    );
    expect(Object.isFrozen(result.snapshots)).toBe(true);
    expect(result.snapshots.every((snapshot) => Object.isFrozen(snapshot))).toBe(
      true,
    );
    expect(
      result.snapshots.every(
        (snapshot) =>
          Object.isFrozen(snapshot.vehicles) &&
          Object.isFrozen(snapshot.passengerCounts) &&
          Object.isFrozen(snapshot.zoneQueueCounts),
      ),
    ).toBe(true);

    expect(
      createUntrustedRunResultDocument({
        ...result,
        snapshots: snapshots.slice(1),
      }).fingerprint,
    ).not.toBe(result.resultFingerprint);
    expect(
      createUntrustedRunResultDocument({
        ...result,
        snapshots: [
          ...snapshots.slice(0, 2),
          snapshots[1],
          ...snapshots.slice(2),
        ],
      }).fingerprint,
    ).not.toBe(result.resultFingerprint);
    const reordered = [...snapshots];
    [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
    expect(
      createUntrustedRunResultDocument({ ...result, snapshots: reordered })
        .fingerprint,
    ).not.toBe(result.resultFingerprint);
  });

  it("makes ordered-event position part of ledger and result identity", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const reordered = [...result.events];
    [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
    const reorderedLedger = createEventLedgerDocument({
      ...result,
      events: reordered,
    });
    const reorderedResult = createUntrustedRunResultDocument({
      ...result,
      eventLedgerFingerprint: reorderedLedger.fingerprint,
    });
    expect(reorderedLedger.fingerprint).not.toBe(
      result.eventLedgerFingerprint,
    );
    expect(reorderedResult.fingerprint).not.toBe(result.resultFingerprint);
  });

  it("binds semantics-bearing versions to the appropriate identity", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const changedExecutionLedger = createEventLedgerDocument({
      ...result,
      engineVersion: `${result.engineVersion}-changed`,
    });
    expect(changedExecutionLedger.fingerprint).not.toBe(
      result.eventLedgerFingerprint,
    );

    const changedMetricResult = createUntrustedRunResultDocument({
      ...result,
      metricDefinitionVersion: `${result.metricDefinitionVersion}-changed`,
    });
    expect(changedMetricResult.fingerprint).not.toBe(
      result.resultFingerprint,
    );
    expect(result.eventLedgerFingerprint).toBe(
      createEventLedgerDocument(result).fingerprint,
    );
  });

  it("excludes presentation-only fields from ledger and result identity", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const presentationOnly = {
      ...result,
      mapCamera: { latitude: -26.1, longitude: 28.05, zoom: 12 },
      playbackProgress: 0.75,
    };
    expect(createEventLedgerDocument(presentationOnly).fingerprint).toBe(
      result.eventLedgerFingerprint,
    );
    expect(createUntrustedRunResultDocument(presentationOnly).fingerprint).toBe(
      result.resultFingerprint,
    );
  });

  it("terminates safely for zero demand and zero fleet with defined evidence", () => {
    const source = createGoldenExperimentInputs().runs.A.input;

    const zeroDemand = cloneInput(source);
    (zeroDemand.demandDefinition as { requestCount: number }).requestCount = 0;
    (zeroDemand.demandTrace as unknown as { requests: unknown[] }).requests = [];
    (zeroDemand.demandTrace as { fingerprint: string }).fingerprint =
      computeDemandTraceFingerprint(
        zeroDemand.demandDefinition,
        zeroDemand.horizon,
        zeroDemand.demandTrace,
      );
    const emptyResult = runDeterministicSimulation(
      prepareStressLabRunInput(zeroDemand),
    );
    expect(emptyResult.metrics).toMatchObject({
      requestedPassengers: 0,
      servedPassengers: 0,
      inServiceAtHorizonPassengers: 0,
      unservedPassengers: 0,
      averageWaitSeconds: null,
      p95WaitSeconds: null,
      onTimeBasisPoints: null,
      energyWhPerPassengerKilometre: null,
    });

    const zeroFleet = cloneInput(source);
    (zeroFleet.scenario.fleet as { vehicleCount: number }).vehicleCount = 0;
    const noVehicleResult = runDeterministicSimulation(
      prepareStressLabRunInput(zeroFleet),
    );
    expect(
      noVehicleResult.events.filter(
        (event) => event.type === "DISRUPTION_TARGET_NOT_FOUND",
      ),
    ).toHaveLength(1);
    expect(noVehicleResult.metrics.servedPassengers).toBe(0);
    expect(noVehicleResult.metrics.unservedPassengers).toBe(120);
    expect(noVehicleResult.metrics.minimumBatteryBasisPoints).toBeNull();
    expect(
      noVehicleResult.constraints.find(
        (entry) => entry.code === "MAXIMUM_RECOVERY",
      )?.passed,
    ).toBe(false);
  });

  it("keeps reserve-infeasible passengers visible without inventing movement", () => {
    const input = cloneInput(createGoldenExperimentInputs().runs.A.input);
    (input.scenario.fleet as {
      startingBatteryBasisPoints: number;
      minimumReserveBasisPoints: number;
    }).startingBatteryBasisPoints = 2_000;
    (input.scenario.fleet as {
      minimumReserveBasisPoints: number;
    }).minimumReserveBasisPoints = 2_000;
    const result = runDeterministicSimulation(prepareStressLabRunInput(input));
    expect(
      result.events.some(
        (event) =>
          event.type === "ACTION_REJECTED" &&
          event.facts.reasonCode === "RESERVE_INFEASIBLE",
      ),
    ).toBe(true);
    expect(
      result.events.some((event) => event.type === "BATTERY_CHANGED"),
    ).toBe(false);
    expect(result.metrics.totalEnergyWh).toBe(0);
    expect(result.metrics.unservedPassengers).toBe(120);
  });

  it("requires complete versioned evidence before fingerprinting", () => {
    expect(() =>
      createUntrustedRunResultDocument({
        resultSchemaVersion: "simulation-result-schema-v2",
        eventSchemaVersion: "event-schema-v2",
        inputFingerprint: fingerprint(
          "sha256-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
        engineVersion: "maav-sim-v2",
        tickSemanticsVersion: "maav-30-second-tick-v2",
        controllerId: "invalid controller id" as never,
        controllerVersion: "invalid controller version" as never,
        metricDefinitionVersion: "stress-lab-metrics-v2",
        eventLedgerFingerprint: fingerprint(
          "sha256-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        ),
        snapshots: undefined as never,
        terminalState: undefined as never,
        metrics: undefined as never,
        constraints: [],
      }),
    ).toThrow();
  });
});
