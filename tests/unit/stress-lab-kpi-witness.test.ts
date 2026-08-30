import { describe, expect, it } from "vitest";
import { deriveRunEvidence } from "@/domain/stress-lab/metrics";
import {
  count,
  evidenceId,
  simulatedSecond,
  type SimulationEvent,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

function event(
  sequence: number,
  type: SimulationEvent["type"],
  atSecond: number,
  facts: SimulationEvent["facts"],
): SimulationEvent {
  return Object.freeze({
    evidenceId: evidenceId(`ev-A-${String(sequence).padStart(6, "0")}`),
    sequence: count(sequence),
    type,
    atSecond: simulatedSecond(atSecond),
    facts: Object.freeze(facts),
  });
}

const COMPLETE_WITNESS_LEDGER: readonly SimulationEvent[] = Object.freeze([
  event(1, "RUN_STARTED", 0, {
    requestCount: 4,
    minimumBatteryBasisPoints: 9_000,
    totalOnboardAfter: 0,
    activeSeatCountAfter: 2,
  }),
  event(2, "PASSENGER_ARRIVED", 0, {
    passengerId: "T-001",
    requestSecond: 0,
    originZoneId: "alpha-hub",
    destinationZoneId: "gamma-terminal",
    totalOnboardAfter: 0,
    activeSeatCountAfter: 2,
  }),
  event(3, "PASSENGER_ARRIVED", 30, {
    passengerId: "T-002",
    requestSecond: 30,
    originZoneId: "alpha-hub",
    destinationZoneId: "gamma-terminal",
    totalOnboardAfter: 0,
    activeSeatCountAfter: 2,
  }),
  event(4, "PASSENGERS_BOARDED", 30, {
    passengerIds: ["T-001"],
    boardedAtSecond: 30,
    occupancyAfter: 1,
    seatCapacity: 2,
    totalOnboardAfter: 1,
    activeSeatCountAfter: 2,
  }),
  event(5, "BATTERY_CHANGED", 60, {
    movementKind: "EMPTY",
    distanceMetres: 700,
    energyWh: 105,
    seatCapacity: 2,
    onboardCountDuringLeg: 0,
    batteryAfterBasisPoints: 8_000,
    belowReserve: false,
    totalOnboardAfter: 1,
    activeSeatCountAfter: 2,
  }),
  event(6, "PASSENGER_ARRIVED", 60, {
    passengerId: "T-003",
    requestSecond: 60,
    originZoneId: "alpha-hub",
    destinationZoneId: "gamma-terminal",
    totalOnboardAfter: 1,
    activeSeatCountAfter: 2,
  }),
  event(7, "VEHICLE_FAILED", 90, {
    disruptionId: "tiny-failure-0090",
    totalOnboardAfter: 1,
    activeSeatCountAfter: 1,
  }),
  event(8, "PASSENGER_ARRIVED", 90, {
    passengerId: "T-004",
    requestSecond: 90,
    originZoneId: "alpha-hub",
    destinationZoneId: "gamma-terminal",
    totalOnboardAfter: 1,
    activeSeatCountAfter: 1,
  }),
  event(9, "ACTION_REJECTED", 100, {
    controllerId: "witness",
    controllerVersion: "witness-v1",
    intentKind: "DISPATCH",
    reasonCode: "RESERVE_INFEASIBLE",
    vehicleId: "A-02",
    passengerIds: ["T-004"],
    totalOnboardAfter: 1,
    activeSeatCountAfter: 1,
  }),
  event(10, "ACTION_REJECTED", 110, {
    controllerId: "witness",
    controllerVersion: "witness-v1",
    intentKind: "DISPATCH",
    reasonCode: "CAPACITY_EXCEEDED",
    vehicleId: "A-02",
    passengerIds: ["T-002", "T-003"],
    totalOnboardAfter: 1,
    activeSeatCountAfter: 1,
  }),
  event(11, "PASSENGERS_BOARDED", 120, {
    passengerIds: ["T-003"],
    boardedAtSecond: 120,
    occupancyAfter: 2,
    seatCapacity: 2,
    totalOnboardAfter: 2,
    activeSeatCountAfter: 2,
  }),
  event(12, "RECOVERY_COMPLETED", 150, {
    disruptionId: "tiny-failure-0090",
    recoveryTimeSeconds: 60,
    reasonCode: "ALL_AFFECTED_PASSENGERS_RECOVERED",
    totalOnboardAfter: 2,
    activeSeatCountAfter: 2,
  }),
  event(13, "PASSENGERS_SERVED", 150, {
    passengerIds: ["T-001"],
    passengerMetres: 1_500,
    totalOnboardAfter: 1,
    activeSeatCountAfter: 2,
  }),
  event(14, "PASSENGERS_BOARDED", 270, {
    passengerIds: ["T-002"],
    boardedAtSecond: 270,
    occupancyAfter: 1,
    seatCapacity: 2,
    totalOnboardAfter: 1,
    activeSeatCountAfter: 2,
  }),
  event(15, "BATTERY_CHANGED", 300, {
    movementKind: "SERVICE",
    distanceMetres: 1_500,
    energyWh: 225,
    seatCapacity: 2,
    onboardCountDuringLeg: 2,
    batteryAfterBasisPoints: 7_000,
    belowReserve: false,
    totalOnboardAfter: 1,
    activeSeatCountAfter: 2,
  }),
  event(16, "PASSENGERS_SERVED", 330, {
    passengerIds: ["T-002"],
    passengerMetres: 1_500,
    totalOnboardAfter: 0,
    activeSeatCountAfter: 2,
  }),
  event(17, "RUN_COMPLETED", 360, {
    requestedPassengers: 4,
    servedPassengers: 2,
    inServiceAtHorizonPassengers: 1,
    unservedPassengers: 1,
    servedPassengerIds: ["T-001", "T-002"],
    inServiceAtHorizonPassengerIds: ["T-003"],
    unservedPassengerIds: ["T-004"],
    strandedPassengerIds: ["T-004"],
    totalOnboardAfter: 1,
    activeSeatCountAfter: 2,
  }),
]);

describe("Gate 4 independent hand-calculated KPI witness", () => {
  it("matches literal H0 KPI and constraint expectations", () => {
    const input = createTinyTriangleRun({ disruption: true, passengerCount: 4 })
      .input;
    const actual = deriveRunEvidence(input, COMPLETE_WITNESS_LEDGER);
    expect(actual.metrics).toStrictEqual({
      requestedPassengers: 4,
      servedPassengers: 2,
      inServiceAtHorizonPassengers: 1,
      unservedPassengers: 1,
      averageWaitSeconds: 150,
      p95WaitSeconds: 270,
      maximumWaitSeconds: 270,
      onTimeBasisPoints: 5_000,
      peakOccupancyBasisPoints: 10_000,
      passengerMetres: 3_000,
      vehicleMetres: 2_200,
      emptyVehicleMetres: 700,
      utilizationBasisPoints: 6_818,
      totalEnergyWh: 330,
      energyWhPerPassengerKilometre: 110,
      minimumBatteryBasisPoints: 7_000,
      reserveViolations: 0,
      reserveBlockedAssignments: 1,
      recoveryTimeSeconds: 60,
    });
    expect(actual.constraints.map(({ code, passed, observed, threshold }) => ({
      code,
      passed,
      observed,
      threshold,
    }))).toStrictEqual([
      { code: "MAXIMUM_WAIT", passed: false, observed: 270, threshold: 60 },
      { code: "MAXIMUM_UNSERVED", passed: true, observed: 1, threshold: 3 },
      { code: "MINIMUM_RESERVE", passed: true, observed: 7_000, threshold: 1_000 },
      { code: "MAXIMUM_RECOVERY", passed: true, observed: 60, threshold: 180 },
      { code: "NO_STANDING", passed: true, observed: 0, threshold: 0 },
    ]);
  });

  it("defines all zero denominators and incomplete recovery literally", () => {
    const zeroInput = createTinyTriangleRun({
      disruption: false,
      passengerCount: 0,
    }).input;
    const zeroLedger = [
      event(1, "RUN_STARTED", 0, { requestCount: 0 }),
      event(2, "RUN_COMPLETED", 360, {
        requestedPassengers: 0,
        servedPassengers: 0,
        inServiceAtHorizonPassengers: 0,
        unservedPassengers: 0,
        servedPassengerIds: [],
        inServiceAtHorizonPassengerIds: [],
        unservedPassengerIds: [],
        strandedPassengerIds: [],
      }),
    ];
    expect(deriveRunEvidence(zeroInput, zeroLedger).metrics).toStrictEqual({
      requestedPassengers: 0,
      servedPassengers: 0,
      inServiceAtHorizonPassengers: 0,
      unservedPassengers: 0,
      averageWaitSeconds: null,
      p95WaitSeconds: null,
      maximumWaitSeconds: 0,
      onTimeBasisPoints: null,
      peakOccupancyBasisPoints: null,
      passengerMetres: 0,
      vehicleMetres: 0,
      emptyVehicleMetres: 0,
      utilizationBasisPoints: null,
      totalEnergyWh: 0,
      energyWhPerPassengerKilometre: null,
      minimumBatteryBasisPoints: null,
      reserveViolations: 0,
      reserveBlockedAssignments: 0,
      recoveryTimeSeconds: null,
    });

    const incompleteInput = createTinyTriangleRun({
      disruption: true,
      passengerCount: 0,
    }).input;
    const incompleteLedger = [
      event(1, "RUN_STARTED", 0, { requestCount: 0 }),
      event(2, "VEHICLE_FAILED", 90, {
        disruptionId: "tiny-failure-0090",
      }),
      event(3, "RUN_COMPLETED", 360, {
        requestedPassengers: 0,
        servedPassengers: 0,
        inServiceAtHorizonPassengers: 0,
        unservedPassengers: 0,
        servedPassengerIds: [],
        inServiceAtHorizonPassengerIds: [],
        unservedPassengerIds: [],
        strandedPassengerIds: [],
      }),
    ];
    expect(
      deriveRunEvidence(incompleteInput, incompleteLedger).constraints.find(
        (constraint) => constraint.code === "MAXIMUM_RECOVERY",
      ),
    ).toMatchObject({ passed: false, observed: null });
  });
});
