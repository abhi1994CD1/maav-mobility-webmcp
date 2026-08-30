import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import {
  initializeSimulation,
  runDeterministicSimulation,
  runDeterministicSimulationWithController,
  stepSimulation,
} from "@/domain/stress-lab/engine";
import { activeLegProgressAt } from "@/domain/stress-lab/simulation-math";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import {
  controllerId,
  controllerVersion,
  disruptionId,
  simulatedSecond,
  type ControllerObservationV1,
  type DispatchControllerV1,
  type StressLabRunInput,
} from "@/domain/stress-lab/types";

function cloneInput(input: StressLabRunInput): StressLabRunInput {
  return JSON.parse(JSON.stringify(input)) as StressLabRunInput;
}

function latestArrivalInput(options?: {
  readonly dwellSeconds?: number;
  readonly remoteVehicle?: boolean;
  readonly keepDisruption?: boolean;
}) {
  const input = cloneInput(createGoldenExperimentInputs().runs.A.input);
  const origin = input.network.zones[0].id;
  const destination = input.network.zones[1].id;
  (input.scenario.fleet as {
    vehicleCount: number;
    dwellSeconds: number;
    initialZoneWeights: unknown;
  }).vehicleCount = 1;
  (input.scenario.fleet as { dwellSeconds: number }).dwellSeconds =
    options?.dwellSeconds ?? 0;
  (input.scenario.fleet as { initialZoneWeights: unknown }).initialZoneWeights = [
    { zoneId: options?.remoteVehicle ? destination : origin, weight: 1 },
  ];
  if (!options?.keepDisruption) {
    (input as { disruptions: StressLabRunInput["disruptions"] }).disruptions = [];
  }
  (input.demandDefinition as { requestCount: number }).requestCount = 1;
  (input.demandTrace as unknown as { requests: unknown[] }).requests = [
    {
      id: "P-LATEST",
      arrivalSecond: 1_770,
      originZoneId: origin,
      destinationZoneId: destination,
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

const boundaryController: DispatchControllerV1 = Object.freeze({
  controllerId: controllerId("deadline-boundary-proof"),
  controllerVersion: controllerVersion("deadline-boundary-proof-v1"),
  decide(observation: ControllerObservationV1) {
    if (observation.atSecond !== 1_950) return Object.freeze([]);
    const passenger = observation.eligiblePassengers[0];
    const vehicle = observation.vehicles.find((entry) => entry.state === "IDLE");
    if (!passenger || !vehicle) return Object.freeze([]);
    return Object.freeze([
      Object.freeze({
        intentVersion: "dispatch-intent-v1",
        kind: "DISPATCH",
        vehicleId: vehicle.id,
        passengerIds: Object.freeze([passenger.id]),
        originZoneId: passenger.currentZoneId,
        destinationZoneId: passenger.destinationZoneId,
      }),
    ]);
  },
});

function dispatchAt(second: number, calls?: number[]): DispatchControllerV1 {
  return Object.freeze({
    controllerId: controllerId(`dispatch-at-${second}`),
    controllerVersion: controllerVersion(`dispatch-at-${second}-v1`),
    decide(observation: ControllerObservationV1) {
      calls?.push(observation.atSecond);
      if (observation.atSecond !== second) return Object.freeze([]);
      const passenger = observation.eligiblePassengers[0];
      const vehicle = observation.vehicles.find((entry) => entry.state === "IDLE");
      if (!passenger || !vehicle) return Object.freeze([]);
      return Object.freeze([Object.freeze({
        intentVersion: "dispatch-intent-v1" as const,
        kind: "DISPATCH" as const,
        vehicleId: vehicle.id,
        passengerIds: Object.freeze([passenger.id]),
        originZoneId: passenger.currentZoneId,
        destinationZoneId: passenger.destinationZoneId,
      })]);
    },
  });
}

describe("Gate 4 intake and terminal-evaluation contract", () => {
  it("uses the contractual 0–1770 intake and exactly 67 observations through 1980", () => {
    const prepared = createGoldenExperimentInputs();
    const maximumGeneratedArrival = Math.max(
      ...prepared.sharedDemandTrace.requests.map((request) => request.arrivalSecond),
    );
    expect(maximumGeneratedArrival).toBe(1_740);
    expect(prepared.runs.A.input.horizon.durationSeconds).toBe(1_800);
    expect(prepared.runs.A.input.terminalEvaluationSecond).toBe(1_980);
    const result = runDeterministicSimulation(prepared.runs.A);
    expect(result.snapshots.map((snapshot) => snapshot.atSecond)).toEqual(
      Array.from({ length: 67 }, (_, index) => index * 30),
    );
    expect(result.events.filter((event) => event.type === "TICK_OBSERVED")).toHaveLength(
      67,
    );
    expect(
      result.events.some(
        (event) =>
          event.atSecond >= 1_800 && event.type === "PASSENGER_ARRIVED",
      ),
    ).toBe(false);
  });

  it("allows boarding at the inclusive 1770 + 180 deadline", () => {
    const result = runDeterministicSimulationWithController(
      latestArrivalInput(),
      boundaryController,
    );
    const boarded = result.events.find(
      (event) => event.type === "PASSENGERS_BOARDED",
    );
    expect(boarded?.atSecond).toBe(1_950);
    expect(result.metrics.maximumWaitSeconds).toBe(180);
    expect(result.metrics.onTimeBasisPoints).toBe(10_000);
    expect(result.metrics).toMatchObject({
      servedPassengers: 0,
      inServiceAtHorizonPassengers: 1,
      unservedPassengers: 0,
    });
    expect(
      result.constraints.find((constraint) => constraint.code === "MAXIMUM_WAIT"),
    ).toMatchObject({ passed: true, observed: 180 });
  });

  it("starts no assignments or departures at terminal evaluation", () => {
    const result = runDeterministicSimulation(createGoldenExperimentInputs().runs.A);
    expect(
      result.events.filter(
        (event) =>
          event.atSecond === 1_980 &&
          [
            "VEHICLE_DISPATCHED_EMPTY",
            "VEHICLE_ARRIVED_PICKUP",
            "VEHICLE_DEPARTED_SERVICE",
            "RECOVERY_ASSIGNED",
          ].includes(event.type),
      ),
    ).toEqual([]);
  });

  it("settles only pre-started terminal work and never invokes the controller at 1980", () => {
    const calls: number[] = [];
    const result = runDeterministicSimulationWithController(
      latestArrivalInput({ dwellSeconds: 30 }),
      dispatchAt(1_950, calls),
    );
    const terminalBoarding = result.events.filter(
      (event) => event.type === "PASSENGERS_BOARDED" && event.atSecond === 1_980,
    );
    expect(terminalBoarding).toHaveLength(1);
    expect(terminalBoarding[0].facts.terminalHold).toBe(true);
    expect(
      result.events.some(
        (event) => event.type === "VEHICLE_DEPARTED_SERVICE" && event.atSecond === 1_980,
      ),
    ).toBe(false);
    expect(calls).not.toContain(1_980);

    const reservedOnly = runDeterministicSimulationWithController(
      latestArrivalInput({ dwellSeconds: 30, remoteVehicle: true }),
      dispatchAt(1_950),
    );
    expect(
      reservedOnly.events.some(
        (event) => event.type === "PASSENGERS_BOARDED" && event.atSecond === 1_980,
      ),
    ).toBe(false);
    expect(reservedOnly.metrics).toMatchObject({
      inServiceAtHorizonPassengers: 0,
      unservedPassengers: 1,
    });

    const terminalPickup = runDeterministicSimulationWithController(
      latestArrivalInput({ dwellSeconds: 30, remoteVehicle: true }),
      dispatchAt(1_800),
    );
    const pickupArrival = terminalPickup.events.find(
      (event) => event.type === "VEHICLE_ARRIVED_PICKUP" && event.atSecond === 1_980,
    );
    expect(pickupArrival?.facts).toMatchObject({
      boardingOperationStarted: false,
      boardingOperation: null,
      dwellEndsAtSecond: null,
    });
    expect(terminalPickup.terminalState.vehicles[0]).toMatchObject({
      state: "IDLE",
    });
    expect(terminalPickup.terminalState.vehicles[0].activeBoardingOperation).toBeUndefined();
  });

  it("settles travel and alighting due at 1980 but leaves work due at 2010 active", () => {
    const due = runDeterministicSimulationWithController(
      latestArrivalInput({ dwellSeconds: 30 }),
      dispatchAt(1_770),
    );
    expect(
      due.events.some(
        (event) => event.type === "VEHICLE_ARRIVED_DROPOFF" && event.atSecond === 1_980,
      ),
    ).toBe(true);
    expect(due.metrics.servedPassengers).toBe(1);

    const later = runDeterministicSimulationWithController(
      latestArrivalInput({ dwellSeconds: 30 }),
      dispatchAt(1_800),
    );
    expect(later.terminalState.vehicles[0].activeLeg?.endsAtSecond).toBe(2_010);
    expect(later.metrics.inServiceAtHorizonPassengers).toBe(1);
    expect(later.metrics.servedPassengers).toBe(0);
  });

  it("completes a pre-started recovery at 1980 but starts no newly possible recovery", () => {
    const prepared = latestArrivalInput({
      dwellSeconds: 30,
      keepDisruption: true,
    });
    const initialized = initializeSimulation(prepared);
    const disruption = prepared.input.disruptions[0];
    const passenger = initialized.state.passengers[0];
    const vehicle = initialized.state.vehicles[0];
    const activeRecoveryState = {
      ...initialized.state,
      atSecond: simulatedSecond(1_950),
      passengers: [{
        ...passenger,
        state: "RESERVED" as const,
        currentZoneId: passenger.request.originZoneId,
        assignedVehicleId: vehicle.id,
        firstBoardedAtSecond: simulatedSecond(1_800),
        affectedByDisruptionId: disruption.id,
      }],
      vehicles: [{
        ...vehicle,
        state: "DWELLING" as const,
        currentZoneId: passenger.request.originZoneId,
        reservedPassengerIds: [passenger.request.id],
        assignedOriginZoneId: passenger.request.originZoneId,
        assignedDestinationZoneId: passenger.request.destinationZoneId,
        activeBoardingOperation: {
          startedAtSecond: simulatedSecond(1_950),
          completesAtSecond: simulatedSecond(1_980),
          passengerIds: [passenger.request.id],
          originZoneId: passenger.request.originZoneId,
          destinationZoneId: passenger.request.destinationZoneId,
        },
        dwellEndsAtSecond: simulatedSecond(1_980),
      }],
      appliedDisruptionIds: [disruption.id],
    };
    const settled = stepSimulation(
      activeRecoveryState,
      1_980,
      initialized.context,
      dispatchAt(1_980),
    );
    expect(
      settled.events.filter((event) => event.type === "RECOVERY_COMPLETED"),
    ).toHaveLength(1);
    expect(
      settled.events.some((event) => event.type === "VEHICLE_DEPARTED_SERVICE"),
    ).toBe(false);

    const releaseOnlyState = {
      ...activeRecoveryState,
      passengers: [{
        ...passenger,
        state: "RECOVERY_WAIT" as const,
        currentZoneId: passenger.request.originZoneId,
        firstBoardedAtSecond: simulatedSecond(1_800),
        affectedByDisruptionId: disruptionId(disruption.id),
        recoveryReleaseSecond: simulatedSecond(1_980),
      }],
      vehicles: [{ ...vehicle, state: "FAILED" as const, failedByDisruptionId: disruption.id }],
    };
    const released = stepSimulation(
      releaseOnlyState,
      1_980,
      initialized.context,
      dispatchAt(1_980),
    );
    expect(released.state.passengers[0].state).toBe("WAITING");
    expect(
      released.events.some(
        (event) => event.type === "RECOVERY_ASSIGNED" || event.type === "RECOVERY_COMPLETED",
      ),
    ).toBe(false);
  });

  it("accounts for elapsed active-leg distance and energy at the terminal boundary", () => {
    const result = runDeterministicSimulation(createGoldenExperimentInputs().runs.A);
    const active = result.terminalState.vehicles.filter(
      (vehicle) => vehicle.activeLeg !== undefined,
    );
    expect(active.length).toBeGreaterThan(0);
    for (const vehicle of active) {
      const leg = vehicle.activeLeg!;
      const evidence = result.events.find(
        (event) =>
          event.type === "BATTERY_CHANGED" &&
          event.atSecond === 1_980 &&
          event.facts.vehicleId === vehicle.id,
      );
      expect(evidence).toBeDefined();
      const progress = activeLegProgressAt(leg, 1_980);
      expect(evidence?.facts.cumulativeDistanceMetres).toBe(
        progress.distanceMetres,
      );
      expect(evidence?.facts.cumulativeEnergyWh).toBe(progress.energyWh);
      expect(leg.accountedDistanceMetres).toBe(progress.distanceMetres);
      expect(leg.accountedEnergyWh).toBe(progress.energyWh);
    }
  });
});
