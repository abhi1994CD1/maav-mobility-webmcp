import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import {
  runDeterministicSimulation,
  runDeterministicSimulationWithController,
} from "@/domain/stress-lab/engine";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import {
  controllerId,
  controllerVersion,
  type ControllerObservationV1,
  type DispatchControllerV1,
  type StressLabRunInput,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

const noDispatchController: DispatchControllerV1 = Object.freeze({
  controllerId: controllerId("no-dispatch-proof"),
  controllerVersion: controllerVersion("no-dispatch-proof-v1"),
  decide: () => Object.freeze([]),
});

const delayedController: DispatchControllerV1 = Object.freeze({
  controllerId: controllerId("delayed-dispatch-proof"),
  controllerVersion: controllerVersion("delayed-dispatch-proof-v1"),
  decide(observation: ControllerObservationV1) {
    if (observation.atSecond !== 90) return Object.freeze([]);
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

function clonedTiny(): StressLabRunInput {
  return JSON.parse(
    JSON.stringify(createTinyTriangleRun({ disruption: false, passengerCount: 1 }).input),
  ) as StressLabRunInput;
}

describe("Gate 4 constraint and outcome discrimination", () => {
  it("produces a completely feasible passing result", () => {
    const result = runDeterministicSimulation(
      createTinyTriangleRun({ disruption: false, passengerCount: 1 }),
    );
    expect(result.constraints.every((constraint) => constraint.passed)).toBe(true);
    expect(result.metrics).toMatchObject({
      requestedPassengers: 1,
      servedPassengers: 1,
      unservedPassengers: 0,
      reserveViolations: 0,
    });
  });

  it("distinguishes a maximum-wait failure", () => {
    const input = clonedTiny();
    (input.scenario.fleet as { dwellSeconds: number }).dwellSeconds = 0;
    const result = runDeterministicSimulationWithController(
      prepareStressLabRunInput(input),
      delayedController,
    );
    expect(
      result.constraints.find((constraint) => constraint.code === "MAXIMUM_WAIT"),
    ).toMatchObject({ passed: false, observed: 90, threshold: 60 });
  });

  it("distinguishes an unserved failure", () => {
    const input = clonedTiny();
    (input.scenario.constraints as { maximumUnservedPassengers: number })
      .maximumUnservedPassengers = 0;
    const result = runDeterministicSimulationWithController(
      prepareStressLabRunInput(input),
      noDispatchController,
    );
    expect(result.metrics.unservedPassengers).toBe(1);
    expect(
      result.constraints.find(
        (constraint) => constraint.code === "MAXIMUM_UNSERVED",
      ),
    ).toMatchObject({ passed: false, observed: 1, threshold: 0 });
  });

  it("rejects infeasible battery movement without debiting energy", () => {
    const input = clonedTiny();
    (input.scenario.fleet as { startingBatteryBasisPoints: number })
      .startingBatteryBasisPoints = 1_000;
    const result = runDeterministicSimulation(prepareStressLabRunInput(input));
    expect(
      result.events.some(
        (event) =>
          event.type === "ACTION_REJECTED" &&
          event.facts.reasonCode === "RESERVE_INFEASIBLE",
      ),
    ).toBe(true);
    expect(result.metrics.totalEnergyWh).toBe(0);
  });

  it("distinguishes successful and failed passenger recovery", () => {
    const successful = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const failed = runDeterministicSimulation(
      createTinyTriangleRun({ vehicleCount: 1 }),
    );
    expect(
      successful.constraints.find(
        (constraint) => constraint.code === "MAXIMUM_RECOVERY",
      )?.passed,
    ).toBe(true);
    expect(
      failed.constraints.find(
        (constraint) => constraint.code === "MAXIMUM_RECOVERY",
      )?.passed,
    ).toBe(false);
  });
});
