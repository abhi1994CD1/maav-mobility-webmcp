import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import {
  runDeterministicSimulation,
  runDeterministicSimulationAsync,
} from "@/domain/stress-lab/engine";

describe("Gate 4 cancellable deterministic wrapper", () => {
  it("fails before validation or execution when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runDeterministicSimulationAsync(createGoldenExperimentInputs().runs.A, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
  });

  it("cancels at a bounded mid-run yield without a completed result", async () => {
    const controller = new AbortController();
    let yields = 0;
    const operation = runDeterministicSimulationAsync(
      createGoldenExperimentInputs().runs.A,
      {
        signal: controller.signal,
        yieldEveryTicks: 4,
        yieldControl: async () => {
          yields += 1;
          if (yields === 2) controller.abort();
        },
      },
    );
    await expect(operation).rejects.toMatchObject({
      code: "OPERATION_CANCELLED",
    });
    expect(yields).toBe(2);
  });

  it(
    "produces byte-identical evidence under different yield schedules",
    async () => {
      const prepared = createGoldenExperimentInputs().runs.B;
      const synchronous = runDeterministicSimulation(prepared);
      for (const yieldEveryTicks of [1, 4, 8, 61]) {
        const result = await runDeterministicSimulationAsync(prepared, {
          yieldEveryTicks,
          yieldControl: () => Promise.resolve(),
        });
        expect(result.canonicalResultJson).toBe(
          synchronous.canonicalResultJson,
        );
        expect(result.resultFingerprint).toBe(synchronous.resultFingerprint);
        expect(result).toEqual(synchronous);
      }
    },
    15_000,
  );

  it("rejects an invalid yield interval without starting a run", async () => {
    await expect(
      runDeterministicSimulationAsync(createGoldenExperimentInputs().runs.A, {
        yieldEveryTicks: 0,
      }),
    ).rejects.toMatchObject({ code: "INVALID_YIELD_INTERVAL" });
  });
});
