import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import {
  runDeterministicSimulationWithController,
} from "@/domain/stress-lab/engine";
import { replayVerifiedEventLedger } from "@/domain/stress-lab/replay";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import {
  controllerId,
  controllerVersion,
  type ActionRejectedEvent,
  type ControllerObservationV1,
  type DispatchControllerV1,
  type StressLabRunInput,
} from "@/domain/stress-lab/types";

function overCapacityInput() {
  const input = JSON.parse(
    JSON.stringify(createGoldenExperimentInputs().runs.A.input),
  ) as StressLabRunInput;
  const origin = input.network.zones[0].id;
  const destination = input.network.zones[1].id;
  (input.scenario.fleet as {
    vehicleCount: number;
    seatsPerVehicle: number;
    initialZoneWeights: unknown;
  }).vehicleCount = 1;
  (input.scenario.fleet as { seatsPerVehicle: number }).seatsPerVehicle = 1;
  (input.scenario.fleet as { initialZoneWeights: unknown }).initialZoneWeights = [
    { zoneId: origin, weight: 1 },
  ];
  (input as { disruptions: StressLabRunInput["disruptions"] }).disruptions = [];
  (input.demandDefinition as { requestCount: number }).requestCount = 2;
  (input.demandTrace as unknown as { requests: unknown[] }).requests = [
    {
      id: "P-CAP-1",
      arrivalSecond: 0,
      originZoneId: origin,
      destinationZoneId: destination,
    },
    {
      id: "P-CAP-2",
      arrivalSecond: 0,
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

const overCapacityController: DispatchControllerV1 = Object.freeze({
  controllerId: controllerId("scripted-over-capacity-proof"),
  controllerVersion: controllerVersion("scripted-over-capacity-proof-v1"),
  decide(observation: ControllerObservationV1) {
    if (observation.atSecond !== 0) return Object.freeze([]);
    const vehicle = observation.vehicles[0];
    if (!vehicle || observation.eligiblePassengers.length < 2) {
      return Object.freeze([]);
    }
    const [first, second] = observation.eligiblePassengers;
    return Object.freeze([
      Object.freeze({
        intentVersion: "dispatch-intent-v1",
        kind: "DISPATCH",
        vehicleId: vehicle.id,
        passengerIds: Object.freeze([first.id, second.id]),
        originZoneId: first.currentZoneId,
        destinationZoneId: first.destinationZoneId,
      }),
    ]);
  },
});

describe("Gate 4 atomic controller-action rejection", () => {
  it("rejects one over-capacity intent without any partial mutation", () => {
    const prepared = overCapacityInput();
    const result = runDeterministicSimulationWithController(
      prepared,
      overCapacityController,
    );
    const rejected = result.events.filter(
      (event): event is ActionRejectedEvent => event.type === "ACTION_REJECTED",
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0].facts).toMatchObject({
      controllerId: "scripted-over-capacity-proof",
      controllerVersion: "scripted-over-capacity-proof-v1",
      reasonCode: "CAPACITY_EXCEEDED",
      passengerIds: ["P-CAP-1", "P-CAP-2"],
    });
    expect(
      result.events.some((event) => event.type === "PASSENGERS_BOARDED"),
    ).toBe(false);
    expect(result.terminalState.passengers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "WAITING" }),
        expect.objectContaining({ state: "WAITING" }),
      ]),
    );
    expect(result.terminalState.vehicles[0]).toMatchObject({
      state: "IDLE",
      onboardPassengerIds: [],
      reservedPassengerIds: [],
      seats: 1,
    });
    expect(
      result.terminalState.vehicles.every(
        (vehicle) => vehicle.onboardPassengerIds.length <= vehicle.seats,
      ),
    ).toBe(true);

    const replayed = replayVerifiedEventLedger(prepared, {
      eventSchemaVersion: result.eventSchemaVersion,
      inputFingerprint: result.inputFingerprint,
      engineVersion: result.engineVersion,
      tickSemanticsVersion: result.tickSemanticsVersion,
      controllerId: result.controllerId,
      controllerVersion: result.controllerVersion,
      events: result.events,
      fingerprint: result.eventLedgerFingerprint,
    });
    expect(JSON.parse(JSON.stringify(replayed.vehicles))).toEqual(
      result.terminalState.vehicles,
    );
    expect(JSON.parse(JSON.stringify(replayed.passengers))).toEqual(
      result.terminalState.passengers,
    );
  });
});
