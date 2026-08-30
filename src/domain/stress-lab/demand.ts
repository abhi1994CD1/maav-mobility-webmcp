import { fingerprintCanonical } from "./fingerprint";
import { createSeededPrng, STRESS_LAB_PRNG_VERSION } from "./prng";
import {
  passengerId,
  simulatedSecond,
  StressLabInputValidationError,
  type DemandDefinition,
  type DemandTrace,
  type Fingerprint,
  type NetworkFixture,
  type OriginDestinationWeight,
  type PassengerRequest,
  type Seed,
  type SimulationHorizon,
  type TemporalWeightWindow,
  type ZoneId,
} from "./types";

export interface GenerateDemandTraceInput {
  readonly definition: DemandDefinition;
  readonly horizon: SimulationHorizon;
  readonly network: NetworkFixture;
  readonly seed: Seed;
}

function assertPositiveWeight(weight: number, path: string): void {
  if (!Number.isSafeInteger(weight) || weight <= 0) {
    throw new StressLabInputValidationError(
      "INVALID_DEMAND_WEIGHT",
      `${path} must be a positive safe integer.`,
    );
  }
}

function totalWeight<Weighted extends { readonly weight: number }>(
  values: readonly Weighted[],
  path: string,
): number {
  if (values.length === 0) {
    throw new StressLabInputValidationError(
      "EMPTY_DEMAND_WEIGHTS",
      `${path} must contain at least one weighted option.`,
    );
  }

  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    assertPositiveWeight(values[index].weight, `${path}[${index}].weight`);
    total += values[index].weight;
    if (!Number.isSafeInteger(total) || total > 0xffff_ffff) {
      throw new StressLabInputValidationError(
        "DEMAND_WEIGHT_TOTAL_TOO_LARGE",
        `${path} total weight exceeds the supported integer range.`,
      );
    }
  }
  return total;
}

function chooseWeighted<Weighted extends { readonly weight: number }>(
  values: readonly Weighted[],
  total: number,
  nextInteger: (exclusiveMaximum: number) => number,
): Weighted {
  const selected = nextInteger(total);
  let cumulative = 0;
  for (const value of values) {
    cumulative += value.weight;
    if (selected < cumulative) return value;
  }
  throw new StressLabInputValidationError(
    "DEMAND_WEIGHT_SELECTION_FAILED",
    "Demand weight selection did not resolve a value.",
  );
}

function buildAdjacency(network: NetworkFixture): ReadonlyMap<ZoneId, readonly ZoneId[]> {
  const zoneIds = new Set(network.zones.map((zone) => zone.id));
  const mutable = new Map<ZoneId, ZoneId[]>();
  for (const zone of network.zones) mutable.set(zone.id, []);

  for (const edge of network.edges) {
    if (!zoneIds.has(edge.fromZoneId) || !zoneIds.has(edge.toZoneId)) {
      throw new StressLabInputValidationError(
        "DEMAND_NETWORK_EDGE_UNKNOWN_ZONE",
        `Network edge ${edge.id} references an unknown zone.`,
      );
    }
    mutable.get(edge.fromZoneId)?.push(edge.toZoneId);
  }
  return mutable;
}

function isReachable(
  adjacency: ReadonlyMap<ZoneId, readonly ZoneId[]>,
  origin: ZoneId,
  destination: ZoneId,
): boolean {
  const visited = new Set<ZoneId>([origin]);
  const queue: ZoneId[] = [origin];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === destination) return true;
    if (current === undefined) break;
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

function validateTemporalWindows(
  windows: readonly TemporalWeightWindow[],
  horizon: SimulationHorizon,
): void {
  for (let index = 0; index < windows.length; index += 1) {
    const bucket = windows[index];
    if (
      bucket.startSecond < 0 ||
      bucket.endSecondExclusive <= bucket.startSecond ||
      bucket.endSecondExclusive > horizon.durationSeconds
    ) {
      throw new StressLabInputValidationError(
        "INVALID_TEMPORAL_WINDOW",
        `Temporal weight window ${index} must be inside the simulation horizon.`,
      );
    }
    if (
      bucket.startSecond % horizon.tickSeconds !== 0 ||
      bucket.endSecondExclusive % horizon.tickSeconds !== 0
    ) {
      throw new StressLabInputValidationError(
        "TEMPORAL_WINDOW_NOT_TICK_ALIGNED",
        `Temporal weight window ${index} must align with the simulation tick.`,
      );
    }
  }
}

function validateOriginDestinationWeights(
  weights: readonly OriginDestinationWeight[],
  network: NetworkFixture,
): void {
  const zoneIds = new Set(network.zones.map((zone) => zone.id));
  const adjacency = buildAdjacency(network);
  const pairs = new Set<string>();

  for (let index = 0; index < weights.length; index += 1) {
    const pair = weights[index];
    if (
      !zoneIds.has(pair.originZoneId) ||
      !zoneIds.has(pair.destinationZoneId)
    ) {
      throw new StressLabInputValidationError(
        "DEMAND_OD_UNKNOWN_ZONE",
        `Demand OD weight ${index} references an unknown zone.`,
      );
    }
    if (pair.originZoneId === pair.destinationZoneId) {
      throw new StressLabInputValidationError(
        "DEMAND_OD_IDENTICAL_ZONES",
        `Demand OD weight ${index} must use different zones.`,
      );
    }
    const key = `${pair.originZoneId}->${pair.destinationZoneId}`;
    if (pairs.has(key)) {
      throw new StressLabInputValidationError(
        "DUPLICATE_DEMAND_OD_PAIR",
        `Demand OD pair ${key} is duplicated.`,
      );
    }
    pairs.add(key);
    if (!isReachable(adjacency, pair.originZoneId, pair.destinationZoneId)) {
      throw new StressLabInputValidationError(
        "DEMAND_OD_UNREACHABLE",
        `Demand OD pair ${key} is unreachable in the authored network.`,
      );
    }
  }
}

function demandFingerprintPayload(
  definition: DemandDefinition,
  horizon: SimulationHorizon,
  seedValue: Seed,
  requests: readonly PassengerRequest[],
): unknown {
  return {
    generatorVersion: definition.generatorVersion,
    prngVersion: STRESS_LAB_PRNG_VERSION,
    seed: seedValue,
    horizon,
    requestCount: definition.requestCount,
    temporalWeights: definition.temporalWeights,
    originDestinationWeights: definition.originDestinationWeights,
    requests,
  };
}

export function computeDemandTraceFingerprint(
  definition: DemandDefinition,
  horizon: SimulationHorizon,
  trace: Pick<DemandTrace, "seed" | "requests">,
): Fingerprint {
  return fingerprintCanonical(
    "DEMAND_TRACE",
    demandFingerprintPayload(definition, horizon, trace.seed, trace.requests),
  );
}

export function generateDemandTrace(input: GenerateDemandTraceInput): DemandTrace {
  const { definition, horizon, network, seed: seedValue } = input;
  if (!Number.isSafeInteger(definition.requestCount) || definition.requestCount < 0) {
    throw new StressLabInputValidationError(
      "INVALID_DEMAND_COUNT",
      "Demand request count must be a non-negative safe integer.",
    );
  }

  validateTemporalWindows(definition.temporalWeights, horizon);
  validateOriginDestinationWeights(definition.originDestinationWeights, network);
  const temporalTotal = totalWeight(definition.temporalWeights, "temporalWeights");
  const originDestinationTotal = totalWeight(
    definition.originDestinationWeights,
    "originDestinationWeights",
  );
  const prng = createSeededPrng(seedValue);
  const requests: PassengerRequest[] = [];

  for (let ordinal = 1; ordinal <= definition.requestCount; ordinal += 1) {
    const temporalWindow = chooseWeighted(
      definition.temporalWeights,
      temporalTotal,
      prng.nextInteger,
    );
    const tickCount =
      (temporalWindow.endSecondExclusive - temporalWindow.startSecond) /
      horizon.tickSeconds;
    const arrivalTick = prng.nextInteger(tickCount);
    const od = chooseWeighted(
      definition.originDestinationWeights,
      originDestinationTotal,
      prng.nextInteger,
    );
    requests.push(
      Object.freeze({
        id: passengerId(`P-${String(ordinal).padStart(3, "0")}`),
        arrivalSecond: simulatedSecond(
          temporalWindow.startSecond + arrivalTick * horizon.tickSeconds,
        ),
        originZoneId: od.originZoneId,
        destinationZoneId: od.destinationZoneId,
      }),
    );
  }

  requests.sort((left, right) => {
    const timeDifference = left.arrivalSecond - right.arrivalSecond;
    if (timeDifference !== 0) return timeDifference;
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });

  const frozenRequests = Object.freeze([...requests]);
  const traceWithoutFingerprint = {
    seed: seedValue,
    generatorVersion: definition.generatorVersion,
    requests: frozenRequests,
  };

  return Object.freeze({
    ...traceWithoutFingerprint,
    fingerprint: computeDemandTraceFingerprint(
      definition,
      horizon,
      traceWithoutFingerprint,
    ),
  });
}
