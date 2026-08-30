import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import type {
  SimulationEvent,
  StressLabRunInput,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

function cloneInput(input: StressLabRunInput): StressLabRunInput {
  return JSON.parse(JSON.stringify(input)) as StressLabRunInput;
}

function stringFact(event: SimulationEvent, key: string): string {
  const value = event.facts[key];
  if (typeof value !== "string") throw new Error(`Missing ${key}.`);
  return value;
}

function numberFact(event: SimulationEvent, key: string): number {
  const value = event.facts[key];
  if (typeof value !== "number") throw new Error(`Missing ${key}.`);
  return value;
}

function stringListFact(event: SimulationEvent, key: string): readonly string[] {
  const value = event.facts[key];
  if (!Array.isArray(value)) throw new Error(`Missing ${key}.`);
  return value as readonly string[];
}

describe("Gate 4 equivalent vehicle failure", () => {
  it("applies the full deterministic ranking independently to A and B", () => {
    const inputs = createGoldenExperimentInputs();
    for (const slot of ["A", "B"] as const) {
      const result = runDeterministicSimulation(inputs.runs[slot]);
      const failures = result.events.filter(
        (event) => event.type === "VEHICLE_FAILED",
      );
      expect(failures).toHaveLength(1);
      const failure = failures[0];
      const selectedVehicleId = stringFact(failure, "vehicleId");
      const ranking = stringListFact(failure, "rankedCandidates");
      expect(failure.atSecond).toBe(720);
      expect(selectedVehicleId.startsWith(`${slot}-`)).toBe(true);
      expect(ranking[0]?.startsWith(`${selectedVehicleId}|`)).toBe(true);
      expect(result.terminalState.vehicles).toContainEqual(
        expect.objectContaining({
          id: selectedVehicleId,
          state: "FAILED",
          failedByDisruptionId: `failure-${slot}-0842`,
        }),
      );

      const operationalEventsAfterFailure = result.events.filter(
        (event) =>
          event.atSecond > failure.atSecond &&
          event.facts.vehicleId === selectedVehicleId &&
          [
            "VEHICLE_DISPATCHED_EMPTY",
            "VEHICLE_ARRIVED_PICKUP",
            "PASSENGERS_BOARDED",
            "VEHICLE_DEPARTED_SERVICE",
            "VEHICLE_ARRIVED_DROPOFF",
            "PASSENGERS_SERVED",
            "BATTERY_CHANGED",
          ].includes(event.type),
      );
      expect(operationalEventsAfterFailure).toEqual([]);
    }
  });

  it("retains request identity and applies the authored 60-second transfer", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const result = runDeterministicSimulation(prepared);
    const failure = result.events.find(
      (event) => event.type === "VEHICLE_FAILED",
    );
    if (!failure) throw new Error("Golden failure evidence is required.");
    const onboard = stringListFact(failure, "onboardPassengerIds");
    const reserved = stringListFact(failure, "reservedPassengerIds");
    expect(onboard.length + reserved.length).toBeGreaterThan(0);

    if (onboard.length > 0) {
      const transferRelease = result.events.find(
        (event) =>
          event.type === "PASSENGERS_REQUEUED" &&
          event.facts.reasonCode === "FAILED_VEHICLE_TRANSFER_COMPLETE",
      );
      expect(transferRelease?.atSecond).toBe(780);
      expect(stringListFact(transferRelease!, "passengerIds")).toEqual(
        [...onboard].sort(),
      );
    }
    for (const passengerId of [...onboard, ...reserved]) {
      const before = prepared.input.demandTrace.requests.find(
        (request) => request.id === passengerId,
      );
      const after = result.terminalState.passengers.find(
        (passenger) => passenger.request.id === passengerId,
      );
      expect(after?.request).toEqual(before);
      expect(after?.affectedByDisruptionId).toBe("failure-A-0842");
    }
  });

  it("lets disruption processing win a same-tick service completion tie", () => {
    const source = createGoldenExperimentInputs().runs.A.input;
    const baselineInput = cloneInput(source);
    (baselineInput.scenario.fleet as { vehicleCount: number }).vehicleCount = 1;
    (baselineInput as unknown as { disruptions: unknown[] }).disruptions = [];
    const baseline = runDeterministicSimulation(
      prepareStressLabRunInput(baselineInput),
    );
    const serviceCompletion = baseline.events.find(
      (event) => event.type === "VEHICLE_ARRIVED_DROPOFF",
    );
    if (!serviceCompletion) {
      throw new Error("One-vehicle baseline must complete a service leg.");
    }

    const stressedInput = cloneInput(baselineInput);
    (stressedInput as { disruptions: StressLabRunInput["disruptions"] })
      .disruptions = [
      {
        ...source.disruptions[0],
        atSecond: serviceCompletion.atSecond,
      },
    ];
    const stressed = runDeterministicSimulation(
      prepareStressLabRunInput(stressedInput),
    );
    const failure = stressed.events.find(
      (event) => event.type === "VEHICLE_FAILED",
    );
    expect(failure).toBeDefined();
    expect(failure?.atSecond).toBe(serviceCompletion.atSecond);
    expect(numberFact(failure!, "partialDistanceMetres")).toBeGreaterThan(0);
    expect(
      stressed.events.some(
        (event) =>
          event.type === "VEHICLE_ARRIVED_DROPOFF" &&
          event.atSecond === serviceCompletion.atSecond &&
          event.facts.vehicleId === failure?.facts.vehicleId,
      ),
    ).toBe(false);
  });

  it("does not hide a previously boarded stranded passenger as in service", () => {
    const result = runDeterministicSimulation(
      createTinyTriangleRun({ vehicleCount: 1 }),
    );
    const stranded = result.terminalState.passengers.filter(
      (passenger) =>
        passenger.firstBoardedAtSecond !== undefined &&
        (passenger.state === "WAITING" || passenger.state === "RESERVED"),
    );
    expect(stranded.length).toBeGreaterThan(0);
    const completed = result.events.at(-1)!;
    expect(completed.type).toBe("RUN_COMPLETED");
    const unservedIds = stringListFact(completed, "unservedPassengerIds");
    for (const passenger of stranded) {
      expect(unservedIds).toContain(passenger.request.id);
    }
    expect(result.metrics.unservedPassengers).toBeGreaterThanOrEqual(
      stranded.length,
    );
    expect(
      result.constraints.find(
        (constraint) => constraint.code === "MAXIMUM_RECOVERY",
      )?.passed,
    ).toBe(false);
  });
});
