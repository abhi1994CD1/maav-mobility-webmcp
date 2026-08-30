import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import {
  createFingerprintDocument,
  runResultIdentityValue,
} from "@/domain/stress-lab/fingerprint";
import { verifyTrustedSimulationResult } from "@/domain/stress-lab/result-verification";
import type {
  DeterministicSimulationResult,
  EventLedgerEnvelope,
  RunResultArtifact,
  SimulationSnapshot,
} from "@/domain/stress-lab/types";

function ledgerEnvelope(
  result: DeterministicSimulationResult,
): EventLedgerEnvelope {
  return {
    eventSchemaVersion: result.eventSchemaVersion,
    inputFingerprint: result.inputFingerprint,
    engineVersion: result.engineVersion,
    tickSemanticsVersion: result.tickSemanticsVersion,
    controllerId: result.controllerId,
    controllerVersion: result.controllerVersion,
    events: result.events,
    fingerprint: result.eventLedgerFingerprint,
  };
}

function artifactFromResult(
  result: DeterministicSimulationResult,
): RunResultArtifact {
  return {
    resultSchemaVersion: result.resultSchemaVersion,
    eventSchemaVersion: result.eventSchemaVersion,
    inputFingerprint: result.inputFingerprint,
    engineVersion: result.engineVersion,
    tickSemanticsVersion: result.tickSemanticsVersion,
    controllerId: result.controllerId,
    controllerVersion: result.controllerVersion,
    metricDefinitionVersion: result.metricDefinitionVersion,
    eventLedgerFingerprint: result.eventLedgerFingerprint,
    snapshots: result.snapshots,
    terminalState: result.terminalState,
    metrics: result.metrics,
    constraints: result.constraints,
    canonicalResultJson: result.canonicalResultJson,
    resultFingerprint: result.resultFingerprint,
  };
}

function rehashedArtifact(
  artifact: Omit<RunResultArtifact, "canonicalResultJson" | "resultFingerprint">,
): RunResultArtifact {
  const document = createFingerprintDocument(
    "RUN_RESULT_EVIDENCE",
    runResultIdentityValue(artifact),
  );
  return {
    ...artifact,
    canonicalResultJson: document.canonicalJson,
    resultFingerprint: document.fingerprint,
  };
}

function mutableArtifact(result: DeterministicSimulationResult) {
  const artifact = JSON.parse(
    JSON.stringify(artifactFromResult(result)),
  ) as RunResultArtifact;
  const identity = { ...artifact } as Record<string, unknown>;
  delete identity.canonicalResultJson;
  delete identity.resultFingerprint;
  return identity as unknown as Omit<
    RunResultArtifact,
    "canonicalResultJson" | "resultFingerprint"
  >;
}

describe("Gate 4 trusted result verification", () => {
  it(
    "verifies all 67 Scenario A/B prefixes without mutating supplied artifacts",
    () => {
      const inputs = createGoldenExperimentInputs();
      for (const slot of ["A", "B"] as const) {
        const result = runDeterministicSimulation(inputs.runs[slot]);
        const ledger = ledgerEnvelope(result);
        const artifact = artifactFromResult(result);
        const before = {
          input: inputs.runs[slot].canonicalJson,
          ledger: JSON.stringify(ledger),
          result: JSON.stringify(artifact),
        };
        const verified = verifyTrustedSimulationResult(
          inputs.runs[slot],
          ledger,
          artifact,
        );
        expect(verified.resultFingerprint).toBe(result.resultFingerprint);
        expect(verified.snapshots).toHaveLength(67);
        expect(verified.snapshots.map((snapshot) => snapshot.atSecond)).toEqual(
          Array.from({ length: 67 }, (_, index) => index * 30),
        );
        expect({
          input: inputs.runs[slot].canonicalJson,
          ledger: JSON.stringify(ledger),
          result: JSON.stringify(artifact),
        }).toEqual(before);
        expect(verified).not.toBe(artifact);
        expect(Object.isFrozen(verified)).toBe(true);
      }
    },
    60_000,
  );

  it(
    "rejects correctly rehashed aggregate and nested snapshot lies at second 990",
    () => {
      const prepared = createGoldenExperimentInputs().runs.A;
      const result = runDeterministicSimulation(prepared);
      const ledger = ledgerEnvelope(result);

      const aggregate = mutableArtifact(result);
      const aggregateSnapshots = aggregate.snapshots as SimulationSnapshot[];
      const aggregateSnapshot = aggregateSnapshots[33];
      expect(aggregateSnapshot.atSecond).toBe(990);
      const queueId = Object.keys(aggregateSnapshot.zoneQueueCounts)[0];
      (aggregateSnapshot.zoneQueueCounts as Record<string, number>)[queueId] += 1;
      const aggregateArtifact = rehashedArtifact(aggregate);
      expect(aggregateArtifact.resultFingerprint).not.toBe(
        result.resultFingerprint,
      );
      expect(() =>
        verifyTrustedSimulationResult(prepared, ledger, aggregateArtifact),
      ).toThrow(/snapshots\[33\].*zoneQueueCounts/u);

      const nested = mutableArtifact(result);
      const nestedSnapshots = nested.snapshots as SimulationSnapshot[];
      const vehicle = nestedSnapshots[33].vehicles[0] as unknown as {
        batteryWh: number;
      };
      vehicle.batteryWh += 1;
      const nestedArtifact = rehashedArtifact(nested);
      expect(nestedArtifact.resultFingerprint).not.toBe(result.resultFingerprint);
      expect(() =>
        verifyTrustedSimulationResult(prepared, ledger, nestedArtifact),
      ).toThrow(/snapshots\[33\].*vehicles\[0\].batteryWh/u);
    },
    60_000,
  );

  it(
    "rejects omitted, duplicated, reordered, and wrong-prefix snapshots",
    () => {
      const prepared = createGoldenExperimentInputs().runs.A;
      const result = runDeterministicSimulation(prepared);
      const ledger = ledgerEnvelope(result);

      const omitted = mutableArtifact(result);
      (omitted.snapshots as SimulationSnapshot[]).splice(12, 1);
      expect(() =>
        verifyTrustedSimulationResult(
          prepared,
          ledger,
          rehashedArtifact(omitted),
        ),
      ).toThrow(/snapshots\.length/u);

      const duplicated = mutableArtifact(result);
      (duplicated.snapshots as SimulationSnapshot[]).splice(
        12,
        0,
        duplicated.snapshots[11],
      );
      expect(() =>
        verifyTrustedSimulationResult(
          prepared,
          ledger,
          rehashedArtifact(duplicated),
        ),
      ).toThrow(/snapshots\.length/u);

      const reordered = mutableArtifact(result);
      const reorderedSnapshots = reordered.snapshots as SimulationSnapshot[];
      [reorderedSnapshots[11], reorderedSnapshots[12]] = [
        reorderedSnapshots[12],
        reorderedSnapshots[11],
      ];
      expect(() =>
        verifyTrustedSimulationResult(
          prepared,
          ledger,
          rehashedArtifact(reordered),
        ),
      ).toThrow(/snapshots\[11\]\.atSecond/u);

      const wrongPrefix = mutableArtifact(result);
      const wrongPrefixSnapshots =
        wrongPrefix.snapshots as SimulationSnapshot[];
      (wrongPrefixSnapshots[33] as unknown as { throughEventSequence: number })
        .throughEventSequence -= 1;
      expect(() =>
        verifyTrustedSimulationResult(
          prepared,
          ledger,
          rehashedArtifact(wrongPrefix),
        ),
      ).toThrow(/snapshots\[33\]\.throughEventSequence/u);
    },
    30_000,
  );

  it(
    "rejects a correctly rehashed terminal snapshot lie",
    () => {
      const prepared = createGoldenExperimentInputs().runs.B;
      const result = runDeterministicSimulation(prepared);
      const ledger = ledgerEnvelope(result);
      const changed = mutableArtifact(result);
      const snapshots = changed.snapshots as SimulationSnapshot[];
      const terminalVehicle = snapshots.at(-1)!.vehicles[0] as unknown as {
        batteryWh: number;
      };
      terminalVehicle.batteryWh += 1;
      const rehashed = rehashedArtifact(changed);
      expect(rehashed.resultFingerprint).not.toBe(result.resultFingerprint);
      expect(() =>
        verifyTrustedSimulationResult(prepared, ledger, rehashed),
      ).toThrow(/snapshots\[66\].*vehicles\[0\].batteryWh/u);
    },
    60_000,
  );
});
