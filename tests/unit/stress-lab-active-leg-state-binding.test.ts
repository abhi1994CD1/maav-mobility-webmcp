import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import {
  createEventLedgerDocument,
  createFingerprintDocument,
  runResultIdentityValue,
} from "@/domain/stress-lab/fingerprint";
import {
  replayVerifiedEventLedger,
} from "@/domain/stress-lab/replay";
import { verifyTrustedSimulationResult } from "@/domain/stress-lab/result-verification";
import {
  computeNetworkFixtureFingerprint,
  prepareStressLabRunInput,
} from "@/domain/stress-lab/run-input";
import { energyWhForDistance } from "@/domain/stress-lab/simulation-math";
import type {
  ActiveLegEvidence,
  DeterministicSimulationResult,
  EventLedgerEnvelope,
  Fingerprint,
  NetworkEdge,
  RunResultArtifact,
  SimulationEvent,
  StressLabRunInput,
} from "@/domain/stress-lab/types";
import { createTinyTriangleRun } from "../helpers/stress-lab-v2-fixtures";

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

function rehashedEnvelope(
  result: DeterministicSimulationResult,
  events: readonly SimulationEvent[],
): EventLedgerEnvelope {
  const identity = { ...ledgerEnvelope(result), events };
  return { ...identity, fingerprint: createEventLedgerDocument(identity).fingerprint };
}

function mutableEvents(result: DeterministicSimulationResult): SimulationEvent[] {
  return JSON.parse(JSON.stringify(result.events)) as SimulationEvent[];
}

function activeLeg(event: SimulationEvent): ActiveLegEvidence {
  const value = event.facts.activeLeg;
  if (value === null || typeof value !== "object" || !("edgeIds" in value)) {
    throw new Error("Movement event requires active-leg evidence.");
  }
  return value as ActiveLegEvidence;
}

function connectedPath(
  input: StressLabRunInput,
  fromZoneId: string,
  toZoneId: string,
): readonly string[] {
  const queue: Array<{ zoneId: string; edgeIds: string[] }> = [
    { zoneId: fromZoneId, edgeIds: [] },
  ];
  const seen = new Set([fromZoneId]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.zoneId === toZoneId) return current.edgeIds;
    for (const edge of input.network.edges) {
      if (edge.fromZoneId !== current.zoneId || seen.has(edge.toZoneId)) continue;
      seen.add(edge.toZoneId);
      queue.push({ zoneId: edge.toZoneId, edgeIds: [...current.edgeIds, edge.id] });
    }
  }
  throw new Error(`No authored path from ${fromZoneId} to ${toZoneId}.`);
}

function replaceMovementRoute(
  event: SimulationEvent,
  input: StressLabRunInput,
  routeEdgeIds: readonly string[],
): ActiveLegEvidence {
  if (routeEdgeIds.length === 0) throw new Error("Test route must move.");
  const source = activeLeg(event);
  let offset = 0;
  const edges = routeEdgeIds.map((id) => {
    const authored = input.network.edges.find((edge) => edge.id === id);
    if (!authored) throw new Error(`Unknown test edge ${id}.`);
    const startOffsetSeconds = offset;
    offset += authored.travelSeconds;
    return {
      edgeId: authored.id,
      fromZoneId: authored.fromZoneId,
      toZoneId: authored.toZoneId,
      distanceMetres: authored.distanceMetres,
      travelSeconds: authored.travelSeconds,
      energyWh: energyWhForDistance(
        authored.distanceMetres,
        input.scenario.fleet.energyWhPerKilometre,
      ),
      startOffsetSeconds,
      endOffsetSeconds: offset,
    };
  });
  const replacement = {
    ...source,
    fromZoneId: edges[0].fromZoneId,
    toZoneId: edges.at(-1)!.toZoneId,
    edgeIds: edges.map((edge) => edge.edgeId),
    pathZoneIds: [edges[0].fromZoneId, ...edges.map((edge) => edge.toZoneId)],
    edges,
    distanceMetres: edges.reduce((sum, edge) => sum + edge.distanceMetres, 0),
    travelSeconds: edges.reduce((sum, edge) => sum + edge.travelSeconds, 0),
    energyWh: edges.reduce((sum, edge) => sum + edge.energyWh, 0),
    endsAtSecond:
      source.startedAtSecond +
      edges.reduce((sum, edge) => sum + edge.travelSeconds, 0),
    accountedDistanceMetres: 0,
    accountedEnergyWh: 0,
  } as unknown as ActiveLegEvidence;
  (event as { facts: Record<string, unknown> }).facts = {
    ...event.facts,
    fromZoneId: replacement.fromZoneId,
    toZoneId: replacement.toZoneId,
    distanceMetres: replacement.distanceMetres,
    travelSeconds: replacement.travelSeconds,
    projectedEnergyWh: replacement.energyWh,
    activeLeg: replacement,
  };
  return replacement;
}

function goldenAServiceAttack(
  routeEdgeIds: readonly string[],
): {
  prepared: ReturnType<typeof createGoldenExperimentInputs>["runs"]["A"];
  result: DeterministicSimulationResult;
  events: SimulationEvent[];
} {
  const prepared = createGoldenExperimentInputs().runs.A;
  const result = runDeterministicSimulation(prepared);
  const events = mutableEvents(result);
  const movement = events.find(
    (event) =>
      event.type === "VEHICLE_DEPARTED_SERVICE" &&
      event.facts.vehicleId === "A-03" &&
      event.facts.fromZoneId === "melrose-arch" &&
      event.facts.toZoneId === "sandton",
  );
  if (!movement) throw new Error("Scenario A requires the reproduced A-03 leg.");
  replaceMovementRoute(movement, prepared.input, routeEdgeIds);
  return { prepared, result, events };
}

function preparedTinyPassengerRun(options: {
  originZoneId: string;
  destinationZoneId: string;
  initialZoneId: string;
  mutateNetwork?: (edges: NetworkEdge[]) => NetworkEdge[];
}) {
  const input = JSON.parse(
    JSON.stringify(
      createTinyTriangleRun({
        disruption: false,
        passengerCount: 1,
        vehicleCount: 1,
      }).input,
    ),
  ) as StressLabRunInput;
  (input.demandDefinition as unknown as { originDestinationWeights: unknown })
    .originDestinationWeights = [
    {
      originZoneId: options.originZoneId,
      destinationZoneId: options.destinationZoneId,
      weight: 1,
    },
  ];
  (input.demandTrace as unknown as { requests: unknown[] }).requests = [
    {
      id: "T-001",
      arrivalSecond: 0,
      originZoneId: options.originZoneId,
      destinationZoneId: options.destinationZoneId,
    },
  ];
  (input.scenario.fleet as unknown as { initialZoneWeights: unknown })
    .initialZoneWeights = [{ zoneId: options.initialZoneId, weight: 1 }];
  if (options.mutateNetwork) {
    (input.network as unknown as { edges: NetworkEdge[] }).edges =
      options.mutateNetwork([...input.network.edges]);
    (input as unknown as { networkFingerprint: string }).networkFingerprint =
      computeNetworkFixtureFingerprint(input.network);
  }
  (input.demandTrace as unknown as { fingerprint: string }).fingerprint =
    computeDemandTraceFingerprint(
      input.demandDefinition,
      input.horizon,
      input.demandTrace,
    );
  return prepareStressLabRunInput(input);
}

function preparedRecoveryRun() {
  const input = JSON.parse(
    JSON.stringify(
      createTinyTriangleRun({ passengerCount: 1, vehicleCount: 2 }).input,
    ),
  ) as StressLabRunInput;
  (input.network as unknown as { edges: NetworkEdge[] }).edges =
    input.network.edges.filter((edge) => edge.id !== "alpha-gamma");
  (input as unknown as { networkFingerprint: string }).networkFingerprint =
    computeNetworkFixtureFingerprint(input.network);
  (input.disruptions[0] as unknown as { atSecond: number }).atSecond = 90;
  return prepareStressLabRunInput(input);
}

function artifactFromResult(
  result: DeterministicSimulationResult,
  eventLedgerFingerprint: Fingerprint,
): RunResultArtifact {
  const identity = {
    resultSchemaVersion: result.resultSchemaVersion,
    eventSchemaVersion: result.eventSchemaVersion,
    inputFingerprint: result.inputFingerprint,
    engineVersion: result.engineVersion,
    tickSemanticsVersion: result.tickSemanticsVersion,
    controllerId: result.controllerId,
    controllerVersion: result.controllerVersion,
    metricDefinitionVersion: result.metricDefinitionVersion,
    eventLedgerFingerprint,
    snapshots: result.snapshots,
    terminalState: result.terminalState,
    metrics: result.metrics,
    constraints: result.constraints,
  } as const;
  const document = createFingerprintDocument(
    "RUN_RESULT_EVIDENCE",
    runResultIdentityValue(identity),
  );
  return {
    ...identity,
    eventLedgerFingerprint: eventLedgerFingerprint as RunResultArtifact["eventLedgerFingerprint"],
    canonicalResultJson: document.canonicalJson,
    resultFingerprint: document.fingerprint,
  };
}

describe("Gate 4 state-bound active-leg replay", () => {
  it("rejects the correctly rehashed A-03 authored reverse service route", () => {
    const attack = goldenAServiceAttack(["sandton-to-melrose-arch"]);
    expect(() =>
      replayVerifiedEventLedger(
        attack.prepared,
        rehashedEnvelope(attack.result, attack.events),
      ),
    ).toThrow(/Service endpoints.*authoritative replay state/u);
  });

  it("rejects genuine authored paths with a wrong service origin or destination", () => {
    const wrongOrigin = goldenAServiceAttack(["parkmore-to-sandton"]);
    expect(() =>
      replayVerifiedEventLedger(
        wrongOrigin.prepared,
        rehashedEnvelope(wrongOrigin.result, wrongOrigin.events),
      ),
    ).toThrow(/Service endpoints/u);

    const wrongDestination = goldenAServiceAttack([
      "melrose-arch-to-illovo",
    ]);
    expect(() =>
      replayVerifiedEventLedger(
        wrongDestination.prepared,
        rehashedEnvelope(wrongDestination.result, wrongDestination.events),
      ),
    ).toThrow(/Service endpoints/u);
  });

  it("rejects wrong pickup endpoints and reservation ownership", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const result = runDeterministicSimulation(prepared);
    const sourceMovement = result.events.find(
      (event) => event.type === "VEHICLE_DISPATCHED_EMPTY",
    );
    if (!sourceMovement) throw new Error("Scenario A needs an empty dispatch.");
    const sourceLeg = activeLeg(sourceMovement);

    const wrongStart = mutableEvents(result);
    const wrongStartMovement = wrongStart.find(
      (event) => event.sequence === sourceMovement.sequence,
    )!;
    const alternateStart = prepared.input.network.zones.find(
      (zone) => zone.id !== sourceLeg.fromZoneId && zone.id !== sourceLeg.toZoneId,
    )!.id;
    replaceMovementRoute(
      wrongStartMovement,
      prepared.input,
      connectedPath(prepared.input, alternateStart, sourceLeg.toZoneId),
    );
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, wrongStart),
      ),
    ).toThrow(/Empty pickup endpoints/u);

    const wrongEnd = mutableEvents(result);
    const wrongEndMovement = wrongEnd.find(
      (event) => event.sequence === sourceMovement.sequence,
    )!;
    const alternateEnd = prepared.input.network.zones.find(
      (zone) => zone.id !== sourceLeg.toZoneId && zone.id !== sourceLeg.fromZoneId,
    )!.id;
    replaceMovementRoute(
      wrongEndMovement,
      prepared.input,
      connectedPath(prepared.input, sourceLeg.fromZoneId, alternateEnd),
    );
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, wrongEnd),
      ),
    ).toThrow(/Empty pickup endpoints/u);

    const wrongReservation = mutableEvents(result);
    const pickup = wrongReservation.find(
      (event) =>
        event.type === "VEHICLE_ARRIVED_PICKUP" &&
        event.facts.vehicleId === sourceMovement.facts.vehicleId &&
        event.atSecond > sourceMovement.atSecond,
    );
    if (!pickup) throw new Error("Empty dispatch needs a later pickup arrival.");
    const originalIds = pickup.facts.passengerIds as readonly string[];
    const foreignId = prepared.input.demandTrace.requests.find(
      (request) => !originalIds.includes(request.id),
    )!.id;
    const forgedIds = [foreignId, ...originalIds.slice(1)];
    const operation = pickup.facts.boardingOperation as ActiveLegEvidence & {
      passengerIds: readonly string[];
    };
    (pickup as { facts: Record<string, unknown> }).facts = {
      ...pickup.facts,
      passengerIds: forgedIds,
      boardingOperation:
        operation === null ? null : { ...operation, passengerIds: forgedIds },
    };
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, wrongReservation),
      ),
    ).toThrow(/Pickup arrival cohort/u);
  });

  it("rejects a genuine non-onboard passenger and a false dropoff endpoint", () => {
    const prepared = createGoldenExperimentInputs().runs.A;
    const result = runDeterministicSimulation(prepared);
    const nonOnboard = mutableEvents(result);
    const departure = nonOnboard.find(
      (event) => event.type === "VEHICLE_DEPARTED_SERVICE",
    );
    if (!departure) throw new Error("Scenario A needs a service departure.");
    const original = departure.facts.passengerIds as readonly string[];
    const foreignId = prepared.input.demandTrace.requests.find(
      (request) => !original.includes(request.id),
    )!.id;
    const forged = [foreignId, ...original.slice(1)];
    (departure as { facts: Record<string, unknown> }).facts = {
      ...departure.facts,
      passengerIds: forged,
      activeLeg: { ...activeLeg(departure), passengerIds: forged },
    };
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, nonOnboard),
      ),
    ).toThrow(/authoritative vehicle occupancy/u);

    const falseArrival = mutableEvents(result);
    const dropoff = falseArrival.find(
      (event) => event.type === "VEHICLE_ARRIVED_DROPOFF",
    );
    if (!dropoff) throw new Error("Scenario A needs a dropoff.");
    const wrongZone = prepared.input.network.zones.find(
      (zone) => zone.id !== dropoff.facts.zoneId,
    )!.id;
    (dropoff as { facts: Record<string, unknown> }).facts = {
      ...dropoff.facts,
      zoneId: wrongZone,
    };
    expect(() =>
      replayVerifiedEventLedger(
        prepared,
        rehashedEnvelope(result, falseArrival),
      ),
    ).toThrow(/Dropoff location.*accepted service-leg destination/u);
  });

  it("uses recovery pickup B and immutable destination C, never obsolete origin A", () => {
    const prepared = preparedRecoveryRun();
    const result = runDeterministicSimulation(prepared);
    expect(() =>
      replayVerifiedEventLedger(prepared, ledgerEnvelope(result)),
    ).not.toThrow();
    const failure = result.events.find((event) => event.type === "VEHICLE_FAILED");
    expect(failure?.facts.snappedZoneId).toBe("beta-exchange");
    const resumed = result.events.find(
      (event) =>
        event.type === "VEHICLE_DEPARTED_SERVICE" &&
        Array.isArray(event.facts.passengerIds) &&
        event.facts.passengerIds.includes("T-001") &&
        event.atSecond > 90,
    );
    expect(resumed?.facts.fromZoneId).toBe("beta-exchange");
    expect(resumed?.facts.toZoneId).toBe("gamma-terminal");

    const forged = mutableEvents(result);
    const forgedResumed = forged.find(
      (event) => event.sequence === resumed?.sequence,
    );
    if (!forgedResumed) throw new Error("Recovery needs resumed service.");
    replaceMovementRoute(forgedResumed, prepared.input, ["beta-alpha"]);
    expect(() =>
      replayVerifiedEventLedger(prepared, rehashedEnvelope(result, forged)),
    ).toThrow(/Service endpoints/u);
  });

  it("accepts genuine reverse demand and a non-reference multi-edge authored path", () => {
    const reverse = preparedTinyPassengerRun({
      originZoneId: "gamma-terminal",
      destinationZoneId: "alpha-hub",
      initialZoneId: "gamma-terminal",
    });
    const reverseResult = runDeterministicSimulation(reverse);
    expect(() =>
      replayVerifiedEventLedger(reverse, ledgerEnvelope(reverseResult)),
    ).not.toThrow();
    expect(
      reverseResult.events.find(
        (event) => event.type === "VEHICLE_DEPARTED_SERVICE",
      )?.facts,
    ).toMatchObject({ fromZoneId: "gamma-terminal", toZoneId: "alpha-hub" });

    const alternate = preparedTinyPassengerRun({
      originZoneId: "gamma-terminal",
      destinationZoneId: "alpha-hub",
      initialZoneId: "gamma-terminal",
      mutateNetwork: (edges) =>
        edges.map((edge) =>
          edge.id === "gamma-alpha"
            ? ({ ...edge, distanceMetres: 2_000, travelSeconds: 150 } as NetworkEdge)
            : edge,
        ),
    });
    const alternateResult = runDeterministicSimulation(alternate);
    const events = mutableEvents(alternateResult);
    const departure = events.find(
      (event) => event.type === "VEHICLE_DEPARTED_SERVICE",
    );
    if (!departure) throw new Error("Alternate-path run needs departure.");
    expect(activeLeg(departure).edgeIds).toEqual(["gamma-alpha"]);
    const replacement = replaceMovementRoute(departure, alternate.input, [
      "gamma-beta",
      "beta-alpha",
    ]);
    for (const event of events) {
      if (
        event.type !== "BATTERY_CHANGED" ||
        event.facts.vehicleId !== departure.facts.vehicleId ||
        event.atSecond <= replacement.startedAtSecond ||
        event.atSecond > replacement.endsAtSecond
      ) continue;
      const elapsed = event.atSecond - replacement.startedAtSecond;
      const currentEdgeId =
        elapsed === replacement.travelSeconds
          ? null
          : replacement.edges.find((edge) => elapsed < edge.endOffsetSeconds)
              ?.edgeId ?? null;
      (event as { facts: Record<string, unknown> }).facts = {
        ...event.facts,
        currentEdgeId,
      };
    }
    expect(replacement.edgeIds).toEqual(["gamma-beta", "beta-alpha"]);
    expect(() =>
      replayVerifiedEventLedger(
        alternate,
        rehashedEnvelope(alternateResult, events),
      ),
    ).not.toThrow();
  });

  it("makes trusted-result verification reject the correctly rehashed reverse ledger", () => {
    const attack = goldenAServiceAttack(["sandton-to-melrose-arch"]);
    const ledger = rehashedEnvelope(attack.result, attack.events);
    const artifact = artifactFromResult(attack.result, ledger.fingerprint);
    expect(() =>
      verifyTrustedSimulationResult(attack.prepared, ledger, artifact),
    ).toThrow(/Service endpoints.*authoritative replay state/u);
  });
});
