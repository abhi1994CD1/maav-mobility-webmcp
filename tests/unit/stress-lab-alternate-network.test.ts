import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import { validateStressLabRunInput } from "@/domain/stress-lab/run-input";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

describe("Gate 4 generic engine boundary", () => {
  it("runs the unchanged engine against tiny-triangle-v1", () => {
    const prepared = createTinyTriangleRun();
    expect(validateStressLabRunInput(prepared.input)).toEqual({
      valid: true,
      issues: [],
    });
    const result = runDeterministicSimulation(prepared);
    expect(prepared.input).toMatchObject({
      networkVersion: "tiny-triangle-v1",
      scenario: {
        fleet: {
          vehicleCount: 2,
          seatsPerVehicle: 3,
          batteryCapacityWh: 12_000,
        },
      },
      disruptions: [{ atSecond: 90 }],
    });
    expect(result.status).toBe("COMPLETED");
    expect(result.snapshots).toHaveLength(13);
    expect(result.terminalState.atSecond).toBe(360);
    expect(result.events.some((event) => event.type === "VEHICLE_FAILED")).toBe(
      true,
    );
  });

  it("contains no golden fixture or scenario constants in engine modules", () => {
    const files = [
      "src/domain/stress-lab/engine.ts",
      "src/domain/stress-lab/metrics.ts",
      "src/domain/stress-lab/reference-controller.ts",
      "src/domain/stress-lab/replay.ts",
      "src/domain/stress-lab/route.ts",
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(
      /Sandton|Rosebank|sandton-rosebank-v1|morning-peak-resilience-v1|Scenario A|Scenario B/u,
    );
  });
});
