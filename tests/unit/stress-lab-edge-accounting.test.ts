import { describe, expect, it } from "vitest";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import { activeLegProgressAt } from "@/domain/stress-lab/simulation-math";
import {
  computeNetworkFixtureFingerprint,
  prepareStressLabRunInput,
} from "@/domain/stress-lab/run-input";
import {
  count,
  edgeId,
  metres,
  networkVersion,
  passengerId,
  simulatedSecond,
  wattHours,
  zoneId,
  type ActiveLegEvidence,
  type NetworkFixture,
  type NetworkVersion,
  type StressLabRunInput,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

const alpha = zoneId("alpha-hub");
const beta = zoneId("beta-exchange");
const gamma = zoneId("gamma-terminal");

function twoEdgeLeg(): ActiveLegEvidence {
  return Object.freeze({
    kind: "SERVICE",
    purpose: "PASSENGER_SERVICE",
    fromZoneId: alpha,
    toZoneId: gamma,
    edgeIds: Object.freeze([edgeId("alpha-beta"), edgeId("beta-gamma")]),
    pathZoneIds: Object.freeze([alpha, beta, gamma]),
    passengerIds: Object.freeze([passengerId("T-001")]),
    reservationIds: Object.freeze([]),
    edges: Object.freeze([
      Object.freeze({
        edgeId: edgeId("alpha-beta"), fromZoneId: alpha, toZoneId: beta,
        distanceMetres: metres(700), travelSeconds: simulatedSecond(180),
        energyWh: wattHours(105), startOffsetSeconds: simulatedSecond(0),
        endOffsetSeconds: simulatedSecond(180),
      }),
      Object.freeze({
        edgeId: edgeId("beta-gamma"), fromZoneId: beta, toZoneId: gamma,
        distanceMetres: metres(1_100), travelSeconds: simulatedSecond(180),
        energyWh: wattHours(165), startOffsetSeconds: simulatedSecond(180),
        endOffsetSeconds: simulatedSecond(360),
      }),
    ]),
    distanceMetres: metres(1_800), travelSeconds: simulatedSecond(360),
    energyWh: wattHours(270), startedAtSecond: simulatedSecond(30),
    endsAtSecond: simulatedSecond(390), onboardCountAtDeparture: count(1),
    accountedDistanceMetres: metres(0), accountedEnergyWh: wattHours(0),
  });
}

function failingTwoEdgeRun(failureSecond = 180) {
  const source = createTinyTriangleRun({
    disruption: true,
    passengerCount: 1,
    vehicleCount: 1,
  }).input;
  const input = JSON.parse(JSON.stringify(source)) as StressLabRunInput;
  const version = networkVersion("tiny-two-edge-v1");
  (input as unknown as { networkVersion: NetworkVersion }).networkVersion = version;
  const network = input.network as unknown as {
    networkVersion: NetworkVersion;
    edges: NetworkFixture["edges"];
  };
  network.networkVersion = version;
  network.edges = Object.freeze(
    input.network.edges
      .filter((edge) => edge.id !== "alpha-gamma")
      .map((edge) =>
        edge.id === "alpha-beta" || edge.id === "beta-gamma"
          ? Object.freeze({ ...edge, travelSeconds: simulatedSecond(180) })
          : edge,
      ),
  );
  (input as unknown as { networkFingerprint: string }).networkFingerprint =
    computeNetworkFixtureFingerprint(input.network);
  (input.disruptions[0] as { atSecond: number }).atSecond = failureSecond;
  return prepareStressLabRunInput(input);
}

describe("Gate 4 edge-aware movement accounting", () => {
  it("rounds only the current edge and reconciles exact edge/route totals", () => {
    const leg = twoEdgeLeg();
    expect(activeLegProgressAt(leg, 30)).toMatchObject({
      distanceMetres: 0, energyWh: 0, snappedZoneId: alpha,
    });
    expect(activeLegProgressAt(leg, 120).snappedZoneId).toBe(beta);
    expect(activeLegProgressAt(leg, 180)).toMatchObject({
      distanceMetres: 583, energyWh: 88, snappedZoneId: beta,
      currentEdgeId: "alpha-beta",
    });
    expect(activeLegProgressAt(leg, 210)).toMatchObject({
      distanceMetres: 700, energyWh: 105, snappedZoneId: beta,
    });
    expect(activeLegProgressAt(leg, 300)).toMatchObject({
      distanceMetres: 1_250, energyWh: 188, snappedZoneId: gamma,
      currentEdgeId: "beta-gamma",
    });
    expect(activeLegProgressAt(leg, 390)).toMatchObject({
      distanceMetres: 1_800, energyWh: 270, snappedZoneId: gamma,
      currentEdgeId: null, complete: true,
    });
    const samples = Array.from({ length: 13 }, (_, index) =>
      activeLegProgressAt(leg, 30 + index * 30),
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].distanceMetres).toBeGreaterThanOrEqual(
        samples[index - 1].distanceMetres,
      );
      expect(samples[index].energyWh).toBeGreaterThanOrEqual(
        samples[index - 1].energyWh,
      );
    }

    const singleTick = {
      ...leg,
      toZoneId: beta,
      edgeIds: [edgeId("alpha-beta")],
      pathZoneIds: [alpha, beta],
      edges: [{
        ...leg.edges[0],
        distanceMetres: metres(101),
        travelSeconds: simulatedSecond(30),
        energyWh: wattHours(17),
        endOffsetSeconds: simulatedSecond(30),
      }],
      distanceMetres: metres(101),
      travelSeconds: simulatedSecond(30),
      energyWh: wattHours(17),
      endsAtSecond: simulatedSecond(60),
    } satisfies ActiveLegEvidence;
    expect(activeLegProgressAt(singleTick, 45)).toMatchObject({
      distanceMetres: 51,
      energyWh: 9,
    });
    expect(activeLegProgressAt(singleTick, 60)).toMatchObject({
      distanceMetres: 101,
      energyWh: 17,
      complete: true,
    });
  });

  it("records the audited 150-second first-edge failure without future-edge debit", () => {
    const result = runDeterministicSimulation(failingTwoEdgeRun());
    const failed = result.events.find((event) => event.type === "VEHICLE_FAILED");
    expect(failed?.atSecond).toBe(180);
    expect(failed?.facts).toMatchObject({
      partialDistanceMetres: 583,
      partialEnergyWh: 88,
      snappedZoneId: "beta-exchange",
    });
    const movement = result.events.filter(
      (event) => event.type === "BATTERY_CHANGED" && event.atSecond <= 180,
    );
    expect(
      movement.reduce((sum, event) => sum + Number(event.facts.distanceMetres), 0),
    ).toBe(583);
    expect(
      movement.reduce((sum, event) => sum + Number(event.facts.energyWh), 0),
    ).toBe(88);
  });

  it("accounts completed first edges in full before a later-edge failure", () => {
    const result = runDeterministicSimulation(failingTwoEdgeRun(270));
    const failed = result.events.find((event) => event.type === "VEHICLE_FAILED");
    expect(failed?.facts).toMatchObject({
      partialDistanceMetres: 1_067,
      partialEnergyWh: 160,
      snappedZoneId: "beta-exchange",
    });
    const movement = result.events.filter(
      (event) => event.type === "BATTERY_CHANGED" && event.atSecond <= 270,
    );
    expect(
      movement.reduce((sum, event) => sum + Number(event.facts.distanceMetres), 0),
    ).toBe(1_067);
    expect(
      movement.reduce((sum, event) => sum + Number(event.facts.energyWh), 0),
    ).toBe(160);
  });
});
