import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import {
  assertSimulationInvariants,
  initializeSimulation,
  runDeterministicSimulation,
} from "@/domain/stress-lab/engine";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import type {
  DeterministicSimulationResult,
  SimulationState,
  StressLabRunInput,
} from "@/domain/stress-lab/types";

function cloneInput(input: StressLabRunInput): StressLabRunInput {
  return JSON.parse(JSON.stringify(input)) as StressLabRunInput;
}

function baselineInput(slot: "A" | "B") {
  const prepared = createGoldenExperimentInputs().runs[slot];
  const input = cloneInput(prepared.input);
  (input as unknown as { disruptions: unknown[] }).disruptions = [];
  return prepareStressLabRunInput(input);
}

function singlePassengerInput() {
  const input = cloneInput(createGoldenExperimentInputs().runs.A.input);
  (input.scenario.fleet as { vehicleCount: number }).vehicleCount = 1;
  (input as unknown as { disruptions: unknown[] }).disruptions = [];
  (input.demandDefinition as { requestCount: number }).requestCount = 1;
  (input.demandTrace as unknown as { requests: unknown[] }).requests = [
    {
      id: "P-001",
      arrivalSecond: 0,
      originZoneId: "rosebank",
      destinationZoneId: "illovo",
    },
  ];
  (input.demandTrace as { fingerprint: string }).fingerprint =
    computeDemandTraceFingerprint(
      input.demandDefinition,
      input.horizon,
      input.demandTrace,
    );
  return prepareStressLabRunInput(input);
}

function assertTerminalConservation(result: DeterministicSimulationResult): void {
  const counts = result.terminalState.passengers.reduce<Record<string, number>>(
    (values, passenger) => {
      values[passenger.state] = (values[passenger.state] ?? 0) + 1;
      return values;
    },
    {},
  );
  expect(Object.values(counts).reduce((total, value) => total + value, 0)).toBe(
    result.metrics.requestedPassengers,
  );
  expect(counts.SERVED ?? 0).toBe(result.metrics.servedPassengers);
  expect(
    result.metrics.servedPassengers +
      result.metrics.inServiceAtHorizonPassengers +
      result.metrics.unservedPassengers,
  ).toBe(result.metrics.requestedPassengers);
}

describe("Gate 4 deterministic headless referee", () => {
  it("initializes stable isolated A/B fleets from the frozen Gate 3 inputs", () => {
    const inputs = createGoldenExperimentInputs();
    const a = initializeSimulation(inputs.runs.A);
    const b = initializeSimulation(inputs.runs.B);

    expect(a.state.vehicles).toHaveLength(12);
    expect(b.state.vehicles).toHaveLength(10);
    expect(a.state.vehicles.map((vehicle) => vehicle.id)).toEqual([
      "A-01",
      "A-02",
      "A-03",
      "A-04",
      "A-05",
      "A-06",
      "A-07",
      "A-08",
      "A-09",
      "A-10",
      "A-11",
      "A-12",
    ]);
    expect(new Set(a.state.vehicles.map((vehicle) => vehicle.seats))).toEqual(
      new Set([8]),
    );
    expect(new Set(b.state.vehicles.map((vehicle) => vehicle.seats))).toEqual(
      new Set([10]),
    );
    expect(a.state.vehicles[0]).not.toBe(b.state.vehicles[0]);
    expect(a.runStartedEvent).toMatchObject({
      type: "RUN_STARTED",
      atSecond: 0,
      sequence: 1,
      facts: {
        engineVersion: "maav-sim-v2",
        tickSemanticsVersion: "maav-30-second-tick-v2",
        controllerVersion: "oldest-wait-nearest-idle-v1",
      },
    });
  });

  it("completes A and B with genuine immutable ledgers and 67 replay snapshots", () => {
    const inputs = createGoldenExperimentInputs();
    const results = {
      A: runDeterministicSimulation(inputs.runs.A),
      B: runDeterministicSimulation(inputs.runs.B),
    };

    for (const [slot, result] of Object.entries(results)) {
      expect(result.status).toBe("COMPLETED");
      expect(result.snapshots).toHaveLength(67);
      expect(result.snapshots[0].atSecond).toBe(0);
      expect(result.snapshots.at(-1)?.atSecond).toBe(1_980);
      expect(result.events[0].type).toBe("RUN_STARTED");
      expect(result.events.at(-1)?.type).toBe("RUN_COMPLETED");
      expect(result.events.length).toBeGreaterThan(120);
      expect(
        result.events.every(
          (event, index, events) =>
            event.sequence === index + 1 &&
            (index === 0 || event.atSecond >= events[index - 1].atSecond),
        ),
      ).toBe(true);
      expect(
        result.events.filter((event) => event.type === "PASSENGER_ARRIVED"),
      ).toHaveLength(120);
      expect(
        result.events.filter((event) => event.type === "VEHICLE_FAILED"),
      ).toHaveLength(1);
      expect(result.terminalState.atSecond).toBe(1_980);
      expect(result.terminalState.vehicles).toHaveLength(slot === "A" ? 12 : 10);
      expect(result.snapshots.at(-1)?.vehicles).toEqual(
        result.terminalState.vehicles,
      );
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.events)).toBe(true);
      expect(Object.isFrozen(result.terminalState.passengers)).toBe(true);
      assertTerminalConservation(result);
    }
    expect(results.A.resultFingerprint).not.toBe(results.B.resultFingerprint);
    expect(results.A.inputFingerprint).toBe(inputs.runs.A.fingerprint);
    expect(results.B.inputFingerprint).toBe(inputs.runs.B.fingerprint);
  });

  it(
    "reproduces byte-identical normalized A and B results twenty times each",
    () => {
      const inputs = createGoldenExperimentInputs();
      for (const slot of ["A", "B"] as const) {
        const prepared = inputs.runs[slot];
        const first = runDeterministicSimulation(prepared);
        for (let iteration = 1; iteration < 20; iteration += 1) {
          const next = runDeterministicSimulation(prepared);
          expect(next.canonicalResultJson).toBe(first.canonicalResultJson);
          expect(next.eventLedgerFingerprint).toBe(
            first.eventLedgerFingerprint,
          );
          expect(next.resultFingerprint).toBe(first.resultFingerprint);
          expect(next.events).toEqual(first.events);
          expect(next.metrics).toEqual(first.metrics);
          expect(next.constraints).toEqual(first.constraints);
          expect(next.terminalState).toEqual(first.terminalState);
        }
      }
    },
    90_000,
  );

  it(
    "runs baseline A/B without manufacturing disruption evidence",
    () => {
      for (const slot of ["A", "B"] as const) {
        const result = runDeterministicSimulation(baselineInput(slot));
        expect(
          result.events.some((event) => event.type === "VEHICLE_FAILED"),
        ).toBe(false);
        expect(result.terminalState.appliedDisruptionIds).toEqual([]);
        expect(
          result.constraints.find((entry) => entry.code === "MAXIMUM_RECOVERY"),
        ).toMatchObject({ passed: true, observed: null });
        assertTerminalConservation(result);
      }
    },
    15_000,
  );

  it("executes one passenger through arrival, dwell, movement, and alighting", () => {
    const result = runDeterministicSimulation(singlePassengerInput());
    const events = result.events.filter((event) =>
      [
        "PASSENGER_ARRIVED",
        "VEHICLE_ARRIVED_PICKUP",
        "PASSENGERS_BOARDED",
        "VEHICLE_DEPARTED_SERVICE",
        "VEHICLE_ARRIVED_DROPOFF",
        "PASSENGERS_SERVED",
      ].includes(event.type),
    );
    expect(events.map((event) => [event.type, event.atSecond])).toEqual([
      ["PASSENGER_ARRIVED", 0],
      ["VEHICLE_ARRIVED_PICKUP", 0],
      ["PASSENGERS_BOARDED", 30],
      ["VEHICLE_DEPARTED_SERVICE", 30],
      ["VEHICLE_ARRIVED_DROPOFF", 270],
      ["PASSENGERS_SERVED", 270],
    ]);
    expect(result.metrics).toMatchObject({
      requestedPassengers: 1,
      servedPassengers: 1,
      unservedPassengers: 0,
      maximumWaitSeconds: 30,
      passengerMetres: 2_100,
    });
  });

  it(
    "does not let future demand change an already-computed event prefix",
    () => {
      const baseline = baselineInput("A");
      const changedInput = cloneInput(baseline.input);
      const futureIndex = changedInput.demandTrace.requests.findIndex(
        (request) => request.arrivalSecond >= 900,
      );
      if (futureIndex < 0) throw new Error("Fixture needs post-900 demand.");
      const futureRequest = changedInput.demandTrace.requests[futureIndex] as {
        originZoneId: string;
        destinationZoneId: string;
      };
      const replacement = changedInput.network.zones.find(
        (zone) =>
          zone.id !== futureRequest.originZoneId &&
          zone.id !== futureRequest.destinationZoneId,
      );
      if (!replacement) {
        throw new Error("Fixture needs a replacement destination.");
      }
      futureRequest.destinationZoneId = replacement.id;
      (changedInput.demandTrace as { fingerprint: string }).fingerprint =
        computeDemandTraceFingerprint(
          changedInput.demandDefinition,
          changedInput.horizon,
          changedInput.demandTrace,
        );
      const changed = prepareStressLabRunInput(changedInput);

      const prefix = (prepared: ReturnType<typeof prepareStressLabRunInput>) =>
        runDeterministicSimulation(prepared).events.filter(
          (event) => event.type !== "RUN_STARTED" && event.atSecond < 900,
        );
      expect(prefix(changed)).toEqual(prefix(baseline));
    },
    15_000,
  );

  it("does not mutate canonical inputs and fails closed on an invalid state", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const before = prepared.canonicalJson;
    runDeterministicSimulation(prepared);
    expect(prepared.canonicalJson).toBe(before);

    const initialized = initializeSimulation(prepared);
    const state = JSON.parse(JSON.stringify(initialized.state)) as {
      vehicles: { onboardPassengerIds: string[] }[];
    };
    const sourceVehicle = initialized.state.vehicles[0];
    state.vehicles[0].onboardPassengerIds = Array.from(
      { length: sourceVehicle.seats + 1 },
      (_, index) => `P-${String(index + 1).padStart(3, "0")}`,
    );
    expect(() =>
      assertSimulationInvariants(
        state as unknown as SimulationState,
        initialized.context,
      ),
    ).toThrow(/capacity or battery invariants/u);
  });
});
