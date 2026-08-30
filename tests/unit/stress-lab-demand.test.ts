import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MORNING_PEAK_RESILIENCE_V2,
  SANDTON_ROSEBANK_V1_NETWORK,
  createGoldenExperimentInputs,
} from "@/data/scenarios/sandton-rosebank-v1";
import { generateDemandTrace } from "@/domain/stress-lab/demand";
import { createSeededPrng } from "@/domain/stress-lab/prng";
import { seed } from "@/domain/stress-lab/types";

function generate(seedValue = 7) {
  return generateDemandTrace({
    definition: MORNING_PEAK_RESILIENCE_V2.demand,
    horizon: MORNING_PEAK_RESILIENCE_V2.horizon,
    network: SANDTON_ROSEBANK_V1_NETWORK,
    seed: seed(seedValue),
  });
}

describe("Gate 3 seeded demand", () => {
  it("generates the same deeply equal 120-request trace for Seed 07", () => {
    const first = generate();
    const second = generate();
    expect(first).toEqual(second);
    expect(first.requests).toHaveLength(120);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.requests)).toBe(true);
    expect(first.requests.every((request) => Object.isFrozen(request))).toBe(true);
  });

  it("changes the trace and fingerprint for a different supported seed", () => {
    const seedSeven = generate(7);
    const seedEight = generate(8);
    expect(seedEight.requests).not.toEqual(seedSeven.requests);
    expect(seedEight.fingerprint).not.toBe(seedSeven.fingerprint);
  });

  it("keeps every request valid, reachable, tick-aligned, and stably ordered", () => {
    const trace = generate();
    const zoneIds = new Set(SANDTON_ROSEBANK_V1_NETWORK.zones.map((zone) => zone.id));
    const passengerIds = new Set<string>();

    for (let index = 0; index < trace.requests.length; index += 1) {
      const request = trace.requests[index];
      expect(zoneIds.has(request.originZoneId)).toBe(true);
      expect(zoneIds.has(request.destinationZoneId)).toBe(true);
      expect(request.originZoneId).not.toBe(request.destinationZoneId);
      expect(request.arrivalSecond).toBeGreaterThanOrEqual(0);
      expect(request.arrivalSecond).toBeLessThan(1_800);
      expect(request.arrivalSecond % 30).toBe(0);
      expect(passengerIds.has(request.id)).toBe(false);
      passengerIds.add(request.id);

      const prior = trace.requests[index - 1];
      if (prior) {
        expect(
          prior.arrivalSecond < request.arrivalSecond ||
            (prior.arrivalSecond === request.arrivalSecond && prior.id < request.id),
        ).toBe(true);
      }
    }
  });

  it("does not mutate its network, definition, or horizon inputs", () => {
    const before = JSON.stringify({
      network: SANDTON_ROSEBANK_V1_NETWORK,
      definition: MORNING_PEAK_RESILIENCE_V2.demand,
      horizon: MORNING_PEAK_RESILIENCE_V2.horizon,
    });
    generate();
    expect(
      JSON.stringify({
        network: SANDTON_ROSEBANK_V1_NETWORK,
        definition: MORNING_PEAK_RESILIENCE_V2.demand,
        horizon: MORNING_PEAK_RESILIENCE_V2.horizon,
      }),
    ).toBe(before);
  });

  it("shares one immutable trace object and fingerprint between A and B", () => {
    const prepared = createGoldenExperimentInputs();
    expect(prepared.runs.A.input.demandTrace).toBe(prepared.sharedDemandTrace);
    expect(prepared.runs.B.input.demandTrace).toBe(prepared.sharedDemandTrace);
    expect(prepared.runs.A.input.demandTrace).toBe(
      prepared.runs.B.input.demandTrace,
    );
    expect(prepared.runs.A.input.demandTrace.fingerprint).toBe(
      prepared.runs.B.input.demandTrace.fingerprint,
    );
  });

  it("locks the generator version, deterministic PRNG sequence, and Seed 07 fingerprint", () => {
    const prng = createSeededPrng(seed(7));
    expect(prng.version).toBe("mulberry32-v1");
    expect([prng.nextUint32(), prng.nextUint32(), prng.nextUint32()]).toEqual([
      50_271_532,
      266_108_690,
      4_195_786_334,
    ]);
    expect(generate().fingerprint).toBe(
      "sha256-v1:f7fd7e72e6ba7befe1b3eb578e20387b89a9b7a274c67b65ddebdfd62ee22302",
    );
  });

  it("contains no ambient random-number source", () => {
    const source = [
      readFileSync("src/domain/stress-lab/prng.ts", "utf8"),
      readFileSync("src/domain/stress-lab/demand.ts", "utf8"),
    ].join("\n");
    expect(source).not.toContain("Math.random");
    expect(source).not.toMatch(/crypto\.getRandomValues|randomUUID/u);
  });
});
