import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import {
  computeNetworkFixtureFingerprint,
  prepareStressLabRunInput,
} from "@/domain/stress-lab/run-input";
import { createEventLedgerDocument } from "@/domain/stress-lab/fingerprint";
import {
  replayVerifiedEventLedger,
  replayVerifiedEventLedgerPrefix,
} from "@/domain/stress-lab/replay";
import {
  networkVersion,
  simulatedSecond,
  type NetworkFixture,
  type NetworkVersion,
  type StressLabRunInput,
} from "@/domain/stress-lab/types";
import type {
  PassengerLifecycleState,
  PreparedRunInput,
  SimulationEvent,
  SimulationState,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

function replayResult(prepared: PreparedRunInput) {
  const result = runDeterministicSimulation(prepared);
  const replayed = replayVerifiedEventLedger(prepared, ledgerEnvelope(result));
  return { result, replayed };
}

function ledgerEnvelope(result: ReturnType<typeof runDeterministicSimulation>) {
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

function rehashedEnvelope(
  result: ReturnType<typeof runDeterministicSimulation>,
  events: readonly SimulationEvent[],
) {
  const identity = { ...ledgerEnvelope(result), events };
  return {
    ...identity,
    fingerprint: createEventLedgerDocument(identity).fingerprint,
  };
}

function operationalProjection(state: SimulationState) {
  return JSON.parse(
    JSON.stringify({
      atSecond: state.atSecond,
      passengers: state.passengers,
      vehicles: state.vehicles,
      appliedDisruptionIds: state.appliedDisruptionIds,
      recoveryCompletedDisruptionIds: state.recoveryCompletedDisruptionIds,
    }),
  );
}

function snapshotPassengerCounts(state: SimulationState) {
  const counts: Record<PassengerLifecycleState, number> = {
    NOT_ARRIVED: 0,
    WAITING: 0,
    RESERVED: 0,
    ONBOARD: 0,
    RECOVERY_WAIT: 0,
    SERVED: 0,
  };
  for (const passenger of state.passengers) counts[passenger.state] += 1;
  return counts;
}

function createMultiEdgeMidLegRun(): PreparedRunInput {
  const source = createTinyTriangleRun({
    disruption: false,
    passengerCount: 1,
  }).input;
  const input = JSON.parse(JSON.stringify(source)) as StressLabRunInput;
  const version = networkVersion("tiny-multiedge-v1");
  const network = input.network as unknown as {
    networkVersion: NetworkVersion;
    edges: NetworkFixture["edges"];
  };
  const root = input as unknown as { networkVersion: NetworkVersion };
  network.networkVersion = version;
  root.networkVersion = version;
  network.edges = Object.freeze(
    input.network.edges
      .filter((edge) => edge.id !== "alpha-gamma")
      .map((edge) =>
        edge.id === "alpha-beta" || edge.id === "beta-gamma"
          ? Object.freeze({
              ...edge,
              travelSeconds: simulatedSecond(180),
            })
          : edge,
      ),
  );
  (input as unknown as { networkFingerprint: string }).networkFingerprint =
    computeNetworkFixtureFingerprint(input.network);
  return prepareStressLabRunInput(input);
}

describe("Gate 4 pure event replay", () => {
  it("reconstructs byte-identical Scenario A and B terminal operational states", () => {
    const inputs = createGoldenExperimentInputs();
    for (const slot of ["A", "B"] as const) {
      const result = runDeterministicSimulation(inputs.runs[slot]);
      const replayed = replayVerifiedEventLedger(
        inputs.runs[slot],
        ledgerEnvelope(result),
      );
      expect(operationalProjection(replayed)).toEqual(result.terminalState);
    }
  });

  it("replays an alternate multi-edge run ending mid-leg without routing", () => {
    const prepared = createMultiEdgeMidLegRun();
    const { result, replayed } = replayResult(prepared);
    expect(operationalProjection(replayed)).toEqual(result.terminalState);
    const activeLegs = result.terminalState.vehicles
      .map((vehicle) => vehicle.activeLeg)
      .filter((leg) => leg !== undefined);
    expect(activeLegs.length).toBeGreaterThan(0);
    expect(activeLegs.some((leg) => leg?.edgeIds.length === 2)).toBe(true);
    expect(
      result.events
        .filter((event) =>
          ["VEHICLE_DISPATCHED_EMPTY", "VEHICLE_DEPARTED_SERVICE"].includes(
            event.type,
          ),
        )
        .every((event) => {
          const leg = event.facts.activeLeg;
          return (
            typeof leg === "object" &&
            leg !== null &&
            "edgeIds" in leg &&
            "pathZoneIds" in leg &&
            "energyWh" in leg
          );
        }),
    ).toBe(true);
  });

  it("replays travelling failures and successful or incomplete recovery", () => {
    const successful = replayResult(createGoldenExperimentInputs().runs.A);
    expect(operationalProjection(successful.replayed)).toEqual(
      successful.result.terminalState,
    );
    expect(
      successful.result.events.some(
        (event) =>
          event.type === "VEHICLE_FAILED" &&
          String(event.facts.stateBefore).startsWith("TRAVELLING"),
      ),
    ).toBe(true);
    expect(
      successful.result.events.find(
        (event) => event.type === "RECOVERY_COMPLETED",
      )?.facts.reasonCode,
    ).toBe("ALL_AFFECTED_PASSENGERS_RECOVERED");

    const incomplete = replayResult(createTinyTriangleRun({ vehicleCount: 1 }));
    expect(operationalProjection(incomplete.replayed)).toEqual(
      incomplete.result.terminalState,
    );
    expect(
      incomplete.result.constraints.find(
        (constraint) => constraint.code === "MAXIMUM_RECOVERY",
      )?.passed,
    ).toBe(false);
  });

  it("replays all 67 event prefixes to their exact snapshot projections", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const result = runDeterministicSimulation(prepared);
    for (const snapshot of result.snapshots) {
      const replayed = replayVerifiedEventLedgerPrefix(
        prepared,
        ledgerEnvelope(result),
        snapshot.throughEventSequence,
      );
      expect(replayed.atSecond).toBe(snapshot.atSecond);
      expect(JSON.parse(JSON.stringify(replayed.vehicles))).toEqual(
        snapshot.vehicles,
      );
      expect(snapshotPassengerCounts(replayed)).toEqual(snapshot.passengerCounts);
      expect(replayed.appliedDisruptionIds).toEqual(
        snapshot.appliedDisruptionIds,
      );
      expect(replayed.recoveryCompletedDisruptionIds).toEqual(
        snapshot.recoveryCompletedDisruptionIds,
      );
    }
  }, 30_000);

  it("fails closed for dropped, duplicated, reordered, or unknown-entity events", () => {
    const prepared = createTinyTriangleRun();
    const result = runDeterministicSimulation(prepared);
    const events = result.events;
    const mutable = (): SimulationEvent[] =>
      JSON.parse(JSON.stringify(events)) as SimulationEvent[];

    const dropped = mutable();
    dropped.splice(5, 1);
    expect(() =>
      replayVerifiedEventLedger(prepared, rehashedEnvelope(result, dropped)),
    ).toThrow(/sequence|envelope/u);

    const duplicated = mutable();
    duplicated.splice(5, 0, duplicated[4]);
    expect(() =>
      replayVerifiedEventLedger(prepared, rehashedEnvelope(result, duplicated)),
    ).toThrow(/sequence|envelope/u);

    const reordered = mutable();
    [reordered[4], reordered[5]] = [reordered[5], reordered[4]];
    expect(() =>
      replayVerifiedEventLedger(prepared, rehashedEnvelope(result, reordered)),
    ).toThrow(/sequence|time|envelope/u);

    const unknown = mutable();
    const movement = unknown.find(
      (event) => event.type === "VEHICLE_DEPARTED_SERVICE",
    );
    if (!movement) throw new Error("Fixture requires a service departure.");
    (movement as { facts: SimulationEvent["facts"] }).facts = {
      ...movement.facts,
      vehicleId: "unknown-vehicle",
    };
    expect(() =>
      replayVerifiedEventLedger(prepared, rehashedEnvelope(result, unknown)),
    ).toThrow(/Unknown vehicle/u);
  });

  it("rejects recomputed ledgers with contract-extra event properties", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const result = runDeterministicSimulation(prepared);
    const clone = () =>
      JSON.parse(JSON.stringify(result.events)) as SimulationEvent[];

    const topLevel = clone();
    const topLevelIndex = 1;
    (topLevel[topLevelIndex] as unknown as Record<string, unknown>).unexpected =
      "attacker-controlled";
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, topLevel),
      ),
    ).toThrow(`eventLedger.events[${topLevelIndex}].unexpected`);

    const nested = clone();
    const movementIndex = nested.findIndex(
      (event) => event.type === "VEHICLE_DEPARTED_SERVICE",
    );
    if (movementIndex < 0) throw new Error("Golden run needs movement evidence.");
    const activeLeg = nested[movementIndex].facts.activeLeg as unknown as Record<
      string,
      unknown
    >;
    nested[movementIndex] = {
      ...nested[movementIndex],
      facts: {
        ...nested[movementIndex].facts,
        activeLeg: { ...activeLeg, unexpectedNestedFact: true },
      } as unknown as SimulationEvent["facts"],
    };
    expect(() =>
      replayVerifiedEventLedger(prepared, rehashedEnvelope(result, nested)),
    ).toThrow(
      `eventLedger.events[${movementIndex}].facts.activeLeg.unexpectedNestedFact`,
    );

    const nestedEdge = clone();
    const nestedEdgeLeg = nestedEdge[movementIndex].facts
      .activeLeg as unknown as { edges: Array<Record<string, unknown>> };
    nestedEdgeLeg.edges[0].unexpectedEdgeFact = 1;
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, nestedEdge),
      ),
    ).toThrow(
      `eventLedger.events[${movementIndex}].facts.activeLeg.edges[0].unexpectedEdgeFact`,
    );
  });

  it("binds every active-leg edge and path to the verified authored network", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const result = runDeterministicSimulation(prepared);
    const clone = () =>
      JSON.parse(JSON.stringify(result.events)) as SimulationEvent[];
    const movementIndex = result.events.findIndex(
      (event) => event.type === "VEHICLE_DEPARTED_SERVICE",
    );
    if (movementIndex < 0) throw new Error("Golden run needs movement evidence.");

    const unknownEdge = clone();
    const unknownLeg = unknownEdge[movementIndex].facts.activeLeg as unknown as {
      edgeIds: string[];
      edges: Array<Record<string, unknown>>;
    };
    unknownLeg.edgeIds[0] = "attacker-edge";
    unknownLeg.edges[0].edgeId = "attacker-edge";
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, unknownEdge),
      ),
    ).toThrow(/Unknown authored-network edge attacker-edge/u);

    const changedAuthoredFact = clone();
    const changedEvent = changedAuthoredFact[movementIndex];
    const changedLeg = changedEvent.facts.activeLeg as unknown as {
      distanceMetres: number;
      edges: Array<{ distanceMetres: number }>;
    };
    changedLeg.edges[0].distanceMetres += 1;
    changedLeg.distanceMetres += 1;
    (changedEvent.facts as Record<string, unknown>).distanceMetres =
      changedLeg.distanceMetres;
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, changedAuthoredFact),
      ),
    ).toThrow(/verified authored network/u);

    const multiEdgePrepared = createMultiEdgeMidLegRun();
    const multiEdgeResult = runDeterministicSimulation(multiEdgePrepared);
    const disconnected = JSON.parse(
      JSON.stringify(multiEdgeResult.events),
    ) as SimulationEvent[];
    const multiEdgeIndex = disconnected.findIndex((event) => {
      const leg = event.facts.activeLeg;
      return (
        (event.type === "VEHICLE_DISPATCHED_EMPTY" ||
          event.type === "VEHICLE_DEPARTED_SERVICE") &&
        typeof leg === "object" &&
        leg !== null &&
        "edges" in leg &&
        Array.isArray(leg.edges) &&
        leg.edges.length === 2
      );
    });
    if (multiEdgeIndex < 0) throw new Error("Fixture needs a two-edge movement.");
    const disconnectedEvent = disconnected[multiEdgeIndex];
    const disconnectedLeg = disconnectedEvent.facts.activeLeg as unknown as {
      fromZoneId: string;
      toZoneId: string;
      edgeIds: string[];
      pathZoneIds: string[];
      edges: Array<{
        edgeId: string;
        fromZoneId: string;
        toZoneId: string;
      }>;
    };
    disconnectedLeg.edges.reverse();
    disconnectedLeg.edgeIds = disconnectedLeg.edges.map((edge) => edge.edgeId);
    disconnectedLeg.fromZoneId = disconnectedLeg.edges[0].fromZoneId;
    disconnectedLeg.toZoneId = disconnectedLeg.edges.at(-1)!.toZoneId;
    disconnectedLeg.pathZoneIds = [
      disconnectedLeg.edges[0].fromZoneId,
      ...disconnectedLeg.edges.map((edge) => edge.toZoneId),
    ];
    (disconnectedEvent.facts as Record<string, unknown>).fromZoneId =
      disconnectedLeg.fromZoneId;
    (disconnectedEvent.facts as Record<string, unknown>).toZoneId =
      disconnectedLeg.toZoneId;
    expect(() =>
      replayVerifiedEventLedger(
        multiEdgePrepared,
        rehashedEnvelope(multiEdgeResult, disconnected),
      ),
    ).toThrow(/path|inconsistent/u);
  });

  it("binds replay to verified input, sentinels, and runtime-valid events", () => {
    const inputs = createGoldenExperimentInputs();
    const result = runDeterministicSimulation(inputs.runs.A);
    const clone = () =>
      JSON.parse(JSON.stringify(result.events)) as SimulationEvent[];

    expect(() =>
      replayVerifiedEventLedger(inputs.runs.B, ledgerEnvelope(result)),
    ).toThrow(/provenance/u);

    const changedRecoveryInput = JSON.parse(
      JSON.stringify(inputs.runs.A.input),
    ) as StressLabRunInput;
    (changedRecoveryInput.disruptions[0] as {
      recoveryTransferSeconds: number;
    }).recoveryTransferSeconds += 30;
    const changedRecovery = prepareStressLabRunInput(changedRecoveryInput);
    expect(() =>
      replayVerifiedEventLedger(changedRecovery, ledgerEnvelope(result)),
    ).toThrow(/provenance/u);

    const forgedStart = clone();
    forgedStart[0] = {
      ...forgedStart[0],
      facts: {
        ...forgedStart[0].facts,
        inputFingerprint:
          "sha256-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    };
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, forgedStart),
      ),
    ).toThrow(/RUN_STARTED/u);

    const missingStart = clone().slice(1);
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, missingStart),
      ),
    ).toThrow(/RUN_STARTED/u);

    const duplicateStart = clone();
    duplicateStart.splice(1, 0, duplicateStart[0]);
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, duplicateStart),
      ),
    ).toThrow(/RUN_STARTED/u);

    const missingCompletion = clone().slice(0, -1);
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, missingCompletion),
      ),
    ).toThrow(/RUN_COMPLETED/u);

    const afterCompletion = clone();
    afterCompletion.push({
      ...afterCompletion.at(-1)!,
      evidenceId: "ev-A-999999" as SimulationEvent["evidenceId"],
      sequence: 999999 as SimulationEvent["sequence"],
    });
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, afterCompletion),
      ),
    ).toThrow(/RUN_COMPLETED/u);

    const malformedEvidence = clone();
    const rejectedIndex = malformedEvidence.findIndex(
      (event) => event.type === "TICK_OBSERVED",
    );
    if (rejectedIndex < 0) throw new Error("Golden run needs tick evidence.");
    malformedEvidence[rejectedIndex] = {
      ...malformedEvidence[rejectedIndex],
      facts: {
        ...malformedEvidence[rejectedIndex].facts,
        terminalEvaluation: "false",
      } as unknown as SimulationEvent["facts"],
    };
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, malformedEvidence),
      ),
    ).toThrow(/terminalEvaluation/u);

    const unknownType = clone();
    (unknownType[1] as { type: string }).type = "UNKNOWN_EVENT";
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, unknownType),
      ),
    ).toThrow(/Unknown event type/u);

    const malformedLeg = clone();
    const movementIndex = malformedLeg.findIndex(
      (event) => event.type === "VEHICLE_DEPARTED_SERVICE",
    );
    if (movementIndex < 0) throw new Error("Golden run needs movement evidence.");
    const activeLeg = malformedLeg[movementIndex].facts.activeLeg as object;
    malformedLeg[movementIndex] = {
      ...malformedLeg[movementIndex],
      facts: {
        ...malformedLeg[movementIndex].facts,
        activeLeg: { ...activeLeg, edges: [] },
      } as unknown as SimulationEvent["facts"],
    };
    expect(() =>
      replayVerifiedEventLedger(
        inputs.runs.A,
        rehashedEnvelope(result, malformedLeg),
      ),
    ).toThrow(/activeLeg/u);
  }, 30_000);
});
