import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import {
  createControllerObservation,
  initializeSimulation,
} from "@/domain/stress-lab/engine";
import {
  REFERENCE_CONTROLLER,
  selectNextDispatch,
} from "@/domain/stress-lab/reference-controller";
import type { SimulationState } from "@/domain/stress-lab/types";

function cloneState(state: SimulationState): SimulationState {
  return JSON.parse(JSON.stringify(state)) as SimulationState;
}

describe("Gate 4 versioned reference controller", () => {
  it("is explicitly versioned and non-optimizing", () => {
    expect(REFERENCE_CONTROLLER).toEqual({
      controllerId: "oldest-wait-nearest-idle",
      controllerVersion: "oldest-wait-nearest-idle-v1",
      policy: "OLDEST_WAIT_NEAREST_IDLE_V1",
      optimizing: false,
    });
  });

  it("selects the oldest local destination group and freezes a capacity batch", () => {
    const initialized = initializeSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const state = cloneState(initialized.state) as unknown as {
      passengers: Array<{
        request: {
          id: string;
          arrivalSecond: number;
          originZoneId: string;
          destinationZoneId: string;
        };
        state: string;
        currentZoneId?: string;
      }>;
      vehicles: Array<{ seats: number; currentZoneId: string }>;
    };
    state.vehicles[0].seats = 1;
    const localZone = state.vehicles[0].currentZoneId;
    const destinations = initialized.context.input.network.zones
      .map((zone) => zone.id)
      .filter((id) => id !== localZone)
      .sort();
    const waiting = state.passengers.slice(0, 3);
    waiting[0].request.arrivalSecond = 30;
    waiting[0].request.originZoneId = localZone;
    waiting[0].request.destinationZoneId = destinations[1];
    waiting[1].request.arrivalSecond = 0;
    waiting[1].request.originZoneId = localZone;
    waiting[1].request.destinationZoneId = destinations[0];
    waiting[2].request.arrivalSecond = 0;
    waiting[2].request.originZoneId = localZone;
    waiting[2].request.destinationZoneId = destinations[0];
    for (const passenger of waiting) {
      passenger.state = "WAITING";
      passenger.currentZoneId = localZone;
    }

    const selection = selectNextDispatch(
      createControllerObservation(
        state as unknown as SimulationState,
        initialized.context.input,
      ),
    );
    expect(selection?.vehicleId).toBe("A-01");
    expect(selection?.destinationZoneId).toBe(destinations[0]);
    expect(selection?.passengerIds).toEqual([
      [waiting[1].request.id, waiting[2].request.id].sort()[0],
    ]);
  });

  it("ranks remote pickup by time, distance, higher battery, then vehicle ID", () => {
    const initialized = initializeSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const state = cloneState(initialized.state) as unknown as {
      passengers: Array<{
        request: {
          arrivalSecond: number;
          originZoneId: string;
          destinationZoneId: string;
        };
        state: string;
        currentZoneId?: string;
      }>;
      vehicles: Array<{
        id: string;
        state: string;
        currentZoneId: string;
        batteryWh: number;
      }>;
    };
    const first = state.vehicles[0];
    const second = state.vehicles[1];
    second.currentZoneId = first.currentZoneId;
    second.batteryWh = first.batteryWh + 1;
    for (const vehicle of state.vehicles.slice(2)) vehicle.state = "FAILED";
    const remoteOrigin = initialized.context.input.network.zones.find(
      (zone) => zone.id !== first.currentZoneId,
    )?.id;
    const destination = initialized.context.input.network.zones.find(
      (zone) => zone.id !== remoteOrigin && zone.id !== first.currentZoneId,
    )?.id;
    if (!remoteOrigin || !destination) throw new Error("Fixture needs remote zones.");
    const passenger = state.passengers[0];
    passenger.state = "WAITING";
    passenger.currentZoneId = remoteOrigin;
    passenger.request.arrivalSecond = 0;
    passenger.request.originZoneId = remoteOrigin;
    passenger.request.destinationZoneId = destination;

    const selection = selectNextDispatch(
      createControllerObservation(
        state as unknown as SimulationState,
        initialized.context.input,
      ),
    );
    expect(selection?.vehicleId).toBe(second.id);
  });
});
