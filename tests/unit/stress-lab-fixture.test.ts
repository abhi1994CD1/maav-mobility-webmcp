import { describe, expect, it } from "vitest";
import {
  MORNING_PEAK_RESILIENCE_V1,
  MORNING_PEAK_RESILIENCE_V1_FINGERPRINT,
  SANDTON_ROSEBANK_V1_NETWORK,
  SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
  assertSandtonRosebankV1Valid,
  validateSandtonRosebankV1,
} from "@/data/scenarios/sandton-rosebank-v1";
import {
  basisPoints,
  count,
  simulatedSecond,
  zoneId,
} from "@/domain/stress-lab/types";

describe("Gate 3 sandton-rosebank-v1 fixture", () => {
  it("passes its complete authored fixture validator", () => {
    expect(validateSandtonRosebankV1()).toEqual({ valid: true, issues: [] });
    expect(assertSandtonRosebankV1Valid).not.toThrow();
  });

  it("uses stable unique IDs, integer operational units, and reverse edges", () => {
    const network = SANDTON_ROSEBANK_V1_NETWORK;
    expect(network.zones).toHaveLength(5);
    expect(new Set(network.zones.map((zone) => zone.id)).size).toBe(5);
    expect(new Set(network.edges.map((edge) => edge.id)).size).toBe(
      network.edges.length,
    );

    for (const edge of network.edges) {
      expect(Number.isSafeInteger(edge.distanceMetres)).toBe(true);
      expect(Number.isSafeInteger(edge.travelSeconds)).toBe(true);
      expect(edge.distanceMetres).toBeGreaterThan(0);
      expect(edge.travelSeconds % 30).toBe(0);
      expect(
        network.edges.some(
          (candidate) =>
            candidate.fromZoneId === edge.toZoneId &&
            candidate.toZoneId === edge.fromZoneId,
        ),
      ).toBe(true);
    }
  });

  it("locks the exact H0 golden experiment without final KPI constants", () => {
    const preset = MORNING_PEAK_RESILIENCE_V1;
    expect(preset).toMatchObject({
      presetVersion: "morning-peak-resilience-v1",
      networkVersion: "sandton-rosebank-v1",
      engineVersion: "maav-sim-v1",
      metricDefinitionVersion: "stress-lab-metrics-v1",
      seed: 7,
      horizon: {
        displayStart: "08:30:00",
        displayEnd: "09:00:00",
        durationSeconds: 1_800,
        tickSeconds: 30,
      },
      demand: { generatorVersion: "demand-v1", requestCount: 120 },
      scenarios: {
        A: {
          fleet: {
            vehicleCount: 12,
            seatsPerVehicle: 8,
            batteryCapacityWh: 70_000,
            startingBatteryBasisPoints: 8_200,
            energyWhPerKilometre: 210,
            dwellSeconds: 30,
          },
          constraints: {
            maximumWaitSeconds: 180,
            minimumBatteryReserveBasisPoints: 2_000,
          },
        },
        B: {
          fleet: { vehicleCount: 10, seatsPerVehicle: 10 },
          constraints: {
            maximumWaitSeconds: 180,
            minimumBatteryReserveBasisPoints: 2_000,
          },
        },
      },
      disruptions: {
        A: [{ atSecond: 720, recoveryTransferSeconds: 60 }],
        B: [{ atSecond: 720, recoveryTransferSeconds: 60 }],
      },
    });
    expect(JSON.stringify(preset)).not.toMatch(
      /averageWait|maximumWaitResult|winner|recommendedScenario|totalEnergyResult/u,
    );
  });

  it("validates branded IDs and integer operational units at construction", () => {
    expect(() => zoneId("contains a space")).toThrow(/stable identifier/u);
    expect(() => count(1.5)).toThrow(/safe integer/u);
    expect(() => count(-1)).toThrow(/safe integer/u);
    expect(() => basisPoints(10_001)).toThrow(/safe integer/u);
    expect(() => simulatedSecond(86_401)).toThrow(/safe integer/u);
  });

  it("locks the authored network and experiment-preset fingerprints", () => {
    expect({
      network: SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
      preset: MORNING_PEAK_RESILIENCE_V1_FINGERPRINT,
    }).toEqual({
      network:
        "sha256-v1:ff982fc42bc6ae8bb6d1f110a44925e392f2f44e2ebbdf9f0f8054080d4df5d0",
      preset:
        "sha256-v1:6e36281c791eb11af7aaae46fa32a67e5fd637c950cff28f6955c673c36d763e",
    });
  });

  it("is deeply immutable", () => {
    expect(Object.isFrozen(SANDTON_ROSEBANK_V1_NETWORK)).toBe(true);
    expect(Object.isFrozen(SANDTON_ROSEBANK_V1_NETWORK.zones)).toBe(true);
    expect(Object.isFrozen(SANDTON_ROSEBANK_V1_NETWORK.edges[0].displayPath)).toBe(
      true,
    );
    expect(Object.isFrozen(MORNING_PEAK_RESILIENCE_V1.scenarios.A.fleet)).toBe(
      true,
    );
  });
});
