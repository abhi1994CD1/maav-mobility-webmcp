import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import {
  createControllerObservation,
  initializeSimulation,
  runDeterministicSimulation,
} from "@/domain/stress-lab/engine";
import { REFERENCE_DISPATCH_CONTROLLER } from "@/domain/stress-lab/reference-controller";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import type {
  ControllerObservationV1,
  SimulationState,
  StressLabRunInput,
} from "@/domain/stress-lab/types";

function cloneInput(input: StressLabRunInput): StressLabRunInput {
  return JSON.parse(JSON.stringify(input)) as StressLabRunInput;
}

function futureDemandVariant(): ReturnType<typeof prepareStressLabRunInput> {
  const input = cloneInput(createGoldenExperimentInputs().runs.A.input);
  const request = input.demandTrace.requests.find(
    (candidate) => candidate.arrivalSecond >= 900,
  ) as { originZoneId: string; destinationZoneId: string } | undefined;
  if (!request) throw new Error("Golden trace needs future demand.");
  const destination = input.network.zones.find(
    (zone) =>
      zone.id !== request.originZoneId && zone.id !== request.destinationZoneId,
  );
  if (!destination) throw new Error("Network needs an alternate destination.");
  request.destinationZoneId = destination.id;
  (input.demandTrace as { fingerprint: string }).fingerprint =
    computeDemandTraceFingerprint(
      input.demandDefinition,
      input.horizon,
      input.demandTrace,
    );
  return prepareStressLabRunInput(input);
}

function futureDisruptionVariant(): ReturnType<typeof prepareStressLabRunInput> {
  const input = cloneInput(createGoldenExperimentInputs().runs.A.input);
  (input.disruptions[0] as { atSecond: number }).atSecond = 1_200;
  return prepareStressLabRunInput(input);
}

function waitingState(prepared: ReturnType<typeof prepareStressLabRunInput>) {
  const initialized = initializeSimulation(prepared);
  const state = JSON.parse(JSON.stringify(initialized.initialState)) as {
    atSecond: number;
    passengers: Array<{
      request: { arrivalSecond: number; originZoneId: string };
      state: string;
      currentZoneId?: string;
    }>;
  };
  const passenger = state.passengers[0];
  state.atSecond = passenger.request.arrivalSecond;
  passenger.state = "WAITING";
  passenger.currentZoneId = passenger.request.originZoneId;
  return state as unknown as SimulationState;
}

function operationalPrefix(prepared: ReturnType<typeof prepareStressLabRunInput>) {
  return runDeterministicSimulation(prepared).events.filter(
    (event) => event.type !== "RUN_STARTED" && event.atSecond < 720,
  );
}

function assertRestricted(observation: ControllerObservationV1): void {
  const json = JSON.stringify(observation);
  expect(json).not.toMatch(
    /NOT_ARRIVED|demandTrace|disruptions|terminalState|metrics|scenarioSlot|inputFingerprint/u,
  );
  expect(Object.isFrozen(observation)).toBe(true);
  expect(Object.isFrozen(observation.vehicles)).toBe(true);
  expect(Object.isFrozen(observation.topology.edges)).toBe(true);
}

describe("Gate 4 causal controller capability", () => {
  it(
    "keeps observations, decisions, and ledger prefixes independent of future demand",
    () => {
      const baseline = createGoldenExperimentInputs().runs.A;
      const changed = futureDemandVariant();
      const baselineObservation = createControllerObservation(
        waitingState(baseline),
        baseline.input,
      );
      const changedObservation = createControllerObservation(
        waitingState(changed),
        changed.input,
      );
      expect(changedObservation).toEqual(baselineObservation);
      expect(REFERENCE_DISPATCH_CONTROLLER.decide(changedObservation)).toEqual(
        REFERENCE_DISPATCH_CONTROLLER.decide(baselineObservation),
      );
      expect(operationalPrefix(changed)).toEqual(operationalPrefix(baseline));
      assertRestricted(baselineObservation);
    },
    15_000,
  );

  it(
    "keeps observations, decisions, and ledger prefixes independent of future disruptions",
    () => {
      const baseline = createGoldenExperimentInputs().runs.A;
      const changed = futureDisruptionVariant();
      const baselineObservation = createControllerObservation(
        waitingState(baseline),
        baseline.input,
      );
      const changedObservation = createControllerObservation(
        waitingState(changed),
        changed.input,
      );
      expect(changedObservation).toEqual(baselineObservation);
      expect(REFERENCE_DISPATCH_CONTROLLER.decide(changedObservation)).toEqual(
        REFERENCE_DISPATCH_CONTROLLER.decide(baselineObservation),
      );
      expect(operationalPrefix(changed)).toEqual(operationalPrefix(baseline));
    },
    15_000,
  );

  it("does not retain input references and cannot be mutated", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const state = waitingState(prepared);
    const observation = createControllerObservation(state, prepared.input);
    expect(observation.topology.edges[0]).not.toBe(prepared.input.network.edges[0]);
    expect(observation.topology.zoneIds).not.toBe(prepared.input.network.zones);
    expect(observation.topology.edges[0].pathZoneIds).not.toBe(
      prepared.input.network.edges[0].pathZoneIds,
    );
    expect(observation.vehicles[0]).not.toBe(state.vehicles[0]);
    expect(
      Reflect.set(observation.vehicles[0], "batteryWh", 0),
    ).toBe(false);
    expect(
      Reflect.set(observation.topology.edges[0], "travelSeconds", 1),
    ).toBe(false);
    expect(
      Reflect.set(observation.topology.edges[0].pathZoneIds, "0", "forged"),
    ).toBe(false);

    const result = runDeterministicSimulation(prepared);
    const activeSnapshot = result.snapshots.find((snapshot) =>
      snapshot.vehicles.some((vehicle) => vehicle.activeLeg),
    );
    if (!activeSnapshot) throw new Error("Golden run needs an active-leg snapshot.");
    const activeState = {
      ...state,
      atSecond: activeSnapshot.atSecond,
      vehicles: activeSnapshot.vehicles,
    } as unknown as SimulationState;
    const activeObservation = createControllerObservation(
      activeState,
      prepared.input,
    );
    const sourceVehicle = activeState.vehicles.find((vehicle) => vehicle.activeLeg)!;
    const observedVehicle = activeObservation.vehicles.find(
      (vehicle) => vehicle.id === sourceVehicle.id,
    )!;
    expect(observedVehicle.activeLeg).not.toBe(sourceVehicle.activeLeg);
    expect(observedVehicle.activeLeg?.edgeIds).not.toBe(
      sourceVehicle.activeLeg?.edgeIds,
    );
    expect(observedVehicle.activeLeg?.pathZoneIds).not.toBe(
      sourceVehicle.activeLeg?.pathZoneIds,
    );
    expect(observedVehicle.activeLeg?.passengerIds).not.toBe(
      sourceVehicle.activeLeg?.passengerIds,
    );
    expect(observedVehicle.activeLeg?.reservationIds).not.toBe(
      sourceVehicle.activeLeg?.reservationIds,
    );
    expect(observedVehicle.activeLeg?.edges).not.toBe(
      sourceVehicle.activeLeg?.edges,
    );
    expect(observedVehicle.activeLeg?.edges[0]).not.toBe(
      sourceVehicle.activeLeg?.edges[0],
    );
    expect(Object.isFrozen(observedVehicle.activeLeg?.edges)).toBe(true);
    expect(
      Reflect.set(observedVehicle.activeLeg!.edges[0], "distanceMetres", 1),
    ).toBe(false);
    expect(sourceVehicle.activeLeg!.edges[0].distanceMetres).not.toBe(1);
  });
});
