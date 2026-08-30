import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { sha256Hex } from "@/domain/stress-lab/fingerprint";
import {
  prepareStressLabRunInput,
  validateStressLabRunInput,
} from "@/domain/stress-lab/run-input";
import type { StressLabRunInput } from "@/domain/stress-lab/types";

function cloneRunInput(input: StressLabRunInput): StressLabRunInput {
  return JSON.parse(JSON.stringify(input)) as StressLabRunInput;
}

describe("Gate 3 complete experiment inputs", () => {
  it("constructs two valid complete run inputs without a simulator", () => {
    const prepared = createGoldenExperimentInputs();
    expect(validateStressLabRunInput(prepared.runs.A.input)).toEqual({
      valid: true,
      issues: [],
    });
    expect(validateStressLabRunInput(prepared.runs.B.input)).toEqual({
      valid: true,
      issues: [],
    });
    expect(prepared.runs.A.input).toMatchObject({
      inputSchemaVersion: "run-input-schema-v2",
      canonicalizationVersion: "canonical-json-v1",
      fingerprintVersion: "sha256-v1",
      engineVersion: "maav-sim-v2",
      metricDefinitionVersion: "stress-lab-metrics-v2",
      presetVersion: "morning-peak-resilience-v2",
      scenarioSlot: "A",
      seed: 7,
      terminalEvaluationSecond: 1_980,
      networkVersion: "sandton-rosebank-v1",
      network: { networkVersion: "sandton-rosebank-v1" },
      demandDefinition: { generatorVersion: "demand-v1", requestCount: 120 },
      demandTrace: { generatorVersion: "demand-v1", seed: 7 },
      scenario: { slot: "A" },
      disruptions: [{ type: "VEHICLE_FAILURE", atSecond: 720 }],
    });
  });

  it("reconstructs byte-identical canonical inputs and fingerprints", () => {
    const first = createGoldenExperimentInputs();
    const second = createGoldenExperimentInputs();
    expect(first).toEqual(second);
    expect(first.runs.A.canonicalJson).toBe(second.runs.A.canonicalJson);
    expect(first.runs.B.canonicalJson).toBe(second.runs.B.canonicalJson);
    expect(first.manifestCanonicalJson).toBe(second.manifestCanonicalJson);
    expect(first.manifestFingerprint).toBe(second.manifestFingerprint);
  });

  it("proves every digest against the exact retained UTF-8 canonical bytes", () => {
    const prepared = createGoldenExperimentInputs();
    for (const document of [
      prepared.runs.A,
      prepared.runs.B,
      {
        canonicalJson: prepared.manifestCanonicalJson,
        fingerprint: prepared.manifestFingerprint,
      },
    ]) {
      const expected = createHash("sha256")
        .update(document.canonicalJson, "utf8")
        .digest("hex");
      expect(document.fingerprint).toBe(`sha256-v1:${expected}`);
      expect(sha256Hex(document.canonicalJson)).toBe(expected);
    }
  });

  it("fails closed when immutable content no longer matches its demand fingerprint", () => {
    const prepared = createGoldenExperimentInputs();
    const tampered = cloneRunInput(prepared.runs.A.input);
    const firstRequest = tampered.demandTrace.requests[0] as {
      originZoneId: string;
      destinationZoneId: string;
    };
    const replacement = tampered.network.zones.find(
      (zone) =>
        zone.id !== firstRequest.originZoneId &&
        zone.id !== firstRequest.destinationZoneId,
    );
    if (!replacement) throw new Error("Test fixture needs a replacement zone.");
    firstRequest.destinationZoneId = replacement.id;

    const validation = validateStressLabRunInput(tampered);
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((entry) => entry.code)).toContain(
      "DEMAND_FINGERPRINT_MISMATCH",
    );
    expect(() => prepareStressLabRunInput(tampered)).toThrow(
      /DEMAND_FINGERPRINT_MISMATCH/u,
    );
  });

  it("changes a run-input digest for a semantic scenario change", () => {
    const prepared = createGoldenExperimentInputs();
    const changed = cloneRunInput(prepared.runs.A.input);
    const fleet = changed.scenario.fleet as { vehicleCount: number };
    fleet.vehicleCount = 13;
    const changedPrepared = prepareStressLabRunInput(changed);
    expect(changedPrepared.fingerprint).not.toBe(prepared.runs.A.fingerprint);
  });

  it("locks the byte-level golden experiment manifest", () => {
    const prepared = createGoldenExperimentInputs();
    expect({
      demand: prepared.sharedDemandTrace.fingerprint,
      runA: prepared.runs.A.fingerprint,
      runB: prepared.runs.B.fingerprint,
      manifest: prepared.manifestFingerprint,
    }).toEqual({
      demand:
        "sha256-v1:f7fd7e72e6ba7befe1b3eb578e20387b89a9b7a274c67b65ddebdfd62ee22302",
      runA:
        "sha256-v1:5156b1558d9767d60d1d050df868adb54b8075a0681ccea50dad07071b64afae",
      runB:
        "sha256-v1:e1e6b94a79218c817ac346922309f87f35755bbd3721142d68db58b67111d80c",
      manifest:
        "sha256-v1:a526424f1146f9326ee13909de9ce5e0c37d878a659aa9d9536fa8ae41c31548",
    });
  });

  it("returns deeply frozen operational inputs", () => {
    const prepared = createGoldenExperimentInputs();
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.runs.A.input)).toBe(true);
    expect(Object.isFrozen(prepared.runs.A.input.network.edges)).toBe(true);
    expect(Object.isFrozen(prepared.runs.A.input.demandTrace.requests)).toBe(true);
    expect(
      Reflect.set(prepared.runs.A.input.scenario.fleet, "vehicleCount", 99),
    ).toBe(false);
  });

  it("has no UI, WebMCP, Google, network, wall-clock, or platform-crypto dependency", () => {
    const files = [
      "src/domain/stress-lab/types.ts",
      "src/domain/stress-lab/canonical-json.ts",
      "src/domain/stress-lab/fingerprint.ts",
      "src/domain/stress-lab/prng.ts",
      "src/domain/stress-lab/demand.ts",
      "src/domain/stress-lab/run-input.ts",
      "src/data/scenarios/sandton-rosebank-v1.ts",
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(
      /from ["'](?:react|next|zustand|@vis\.gl|node:crypto)|modelContext|Date\.now|Math\.random|window\.|document\.|navigator\.|fetch\(/u,
    );
  });
});
