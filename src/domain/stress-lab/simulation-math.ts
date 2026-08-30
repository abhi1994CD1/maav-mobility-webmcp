import {
  metres,
  wattHours,
  type ActiveLegEvidence,
  type EdgeId,
  type Metres,
  type WattHours,
  type ZoneId,
} from "./types";

export interface ActiveLegProgress {
  readonly distanceMetres: Metres;
  readonly energyWh: WattHours;
  readonly currentEdgeId: EdgeId | null;
  readonly snappedZoneId: ZoneId;
  readonly complete: boolean;
}

export function roundPositiveRatio(
  numerator: number,
  denominator: number,
): number {
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator <= 0
  ) {
    throw new RangeError(
      "A deterministic ratio requires safe positive integers.",
    );
  }
  return Math.floor(
    (numerator + Math.floor(denominator / 2)) / denominator,
  );
}

export function energyWhForDistance(
  distanceMetres: number,
  energyWhPerKilometre: number,
): WattHours {
  return wattHours(
    roundPositiveRatio(distanceMetres * energyWhPerKilometre, 1_000),
  );
}

export function batteryWhAtBasisPoints(
  capacityWh: number,
  basisPointsValue: number,
): WattHours {
  return wattHours(
    roundPositiveRatio(capacityWh * basisPointsValue, 10_000),
  );
}

export function isMissionReserveFeasible(
  currentBatteryWh: number,
  requiredEnergyWh: number,
  reserveWh: number,
): boolean {
  return currentBatteryWh - requiredEnergyWh >= reserveWh;
}

/**
 * Accounts complete authored edges in full and rounds only the current edge.
 * An exact midpoint snaps forward to the current edge destination.
 */
export function activeLegProgressAt(
  leg: ActiveLegEvidence,
  atSecond: number,
): ActiveLegProgress {
  const elapsed = Math.max(
    0,
    Math.min(leg.travelSeconds, atSecond - leg.startedAtSecond),
  );
  let distance = 0;
  let energy = 0;
  let snappedZoneId = leg.fromZoneId;
  let currentEdgeId: EdgeId | null = null;

  for (const edge of leg.edges) {
    if (elapsed >= edge.endOffsetSeconds) {
      distance += edge.distanceMetres;
      energy += edge.energyWh;
      snappedZoneId = edge.toZoneId;
      continue;
    }
    if (elapsed <= edge.startOffsetSeconds) {
      currentEdgeId = edge.edgeId;
      snappedZoneId = edge.fromZoneId;
      break;
    }
    const edgeElapsed = elapsed - edge.startOffsetSeconds;
    distance += roundPositiveRatio(
      edge.distanceMetres * edgeElapsed,
      edge.travelSeconds,
    );
    energy += roundPositiveRatio(
      edge.energyWh * edgeElapsed,
      edge.travelSeconds,
    );
    currentEdgeId = edge.edgeId;
    snappedZoneId =
      edgeElapsed * 2 >= edge.travelSeconds
        ? edge.toZoneId
        : edge.fromZoneId;
    break;
  }

  const complete = elapsed === leg.travelSeconds;
  if (complete) {
    distance = leg.distanceMetres;
    energy = leg.energyWh;
    currentEdgeId = null;
    snappedZoneId = leg.toZoneId;
  }
  return Object.freeze({
    distanceMetres: metres(distance),
    energyWh: wattHours(energy),
    currentEdgeId,
    snappedZoneId,
    complete,
  });
}
