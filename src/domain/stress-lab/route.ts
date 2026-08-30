import {
  metres,
  simulatedSecond,
  StressLabInputValidationError,
  type EdgeId,
  type Metres,
  type NetworkEdge,
  type NetworkFixture,
  type SimulatedSecond,
  type ZoneId,
} from "./types";

export interface AuthoredRoute {
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  readonly edgeIds: readonly EdgeId[];
  readonly pathZoneIds: readonly ZoneId[];
  readonly distanceMetres: Metres;
  readonly travelSeconds: SimulatedSecond;
  readonly pathSignature: string;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRoutes(left: AuthoredRoute, right: AuthoredRoute): number {
  if (left.travelSeconds !== right.travelSeconds) {
    return left.travelSeconds - right.travelSeconds;
  }
  if (left.distanceMetres !== right.distanceMetres) {
    return left.distanceMetres - right.distanceMetres;
  }
  return compareCodeUnits(left.pathSignature, right.pathSignature);
}

function freezeRoute(route: AuthoredRoute): AuthoredRoute {
  return Object.freeze({
    ...route,
    edgeIds: Object.freeze([...route.edgeIds]),
    pathZoneIds: Object.freeze([...route.pathZoneIds]),
  });
}

function outgoingEdges(
  fixture: NetworkFixture,
  fromZoneId: ZoneId,
): readonly NetworkEdge[] {
  return [...fixture.edges]
    .filter((edge) => edge.fromZoneId === fromZoneId)
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

/**
 * Resolve one route using only the authored fixture. All simple paths are
 * considered because the H0 network is deliberately bounded to a handful of
 * zones. Selection uses travel time, then distance, then the lexical edge-path
 * signature. Object insertion order cannot affect the answer.
 */
export function findAuthoredRoute(
  fixture: NetworkFixture,
  fromZoneId: ZoneId,
  toZoneId: ZoneId,
): AuthoredRoute {
  const knownZoneIds = new Set(fixture.zones.map((zone) => zone.id));
  if (!knownZoneIds.has(fromZoneId) || !knownZoneIds.has(toZoneId)) {
    throw new StressLabInputValidationError(
      "ROUTE_UNKNOWN_ZONE",
      "Authored route endpoints must reference known network zones.",
    );
  }
  if (fromZoneId === toZoneId) {
    return freezeRoute({
      fromZoneId,
      toZoneId,
      edgeIds: [],
      pathZoneIds: [fromZoneId],
      distanceMetres: metres(0),
      travelSeconds: simulatedSecond(0),
      pathSignature: `${fromZoneId}:stationary`,
    });
  }

  const candidates: AuthoredRoute[] = [];
  const visit = (
    currentZoneId: ZoneId,
    visited: ReadonlySet<ZoneId>,
    edges: readonly NetworkEdge[],
    pathZoneIds: readonly ZoneId[],
    distanceMetresValue: number,
    travelSecondsValue: number,
  ): void => {
    if (currentZoneId === toZoneId) {
      const edgeIds = edges.map((edge) => edge.id);
      candidates.push(
        freezeRoute({
          fromZoneId,
          toZoneId,
          edgeIds,
          pathZoneIds,
          distanceMetres: metres(distanceMetresValue),
          travelSeconds: simulatedSecond(travelSecondsValue),
          pathSignature: edgeIds.join(">"),
        }),
      );
      return;
    }

    for (const edge of outgoingEdges(fixture, currentZoneId)) {
      if (visited.has(edge.toZoneId)) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(edge.toZoneId);
      visit(
        edge.toZoneId,
        nextVisited,
        [...edges, edge],
        [...pathZoneIds, edge.toZoneId],
        distanceMetresValue + edge.distanceMetres,
        travelSecondsValue + edge.travelSeconds,
      );
    }
  };

  visit(fromZoneId, new Set([fromZoneId]), [], [fromZoneId], 0, 0);
  const selected = [...candidates].sort(compareRoutes)[0];
  if (!selected) {
    throw new StressLabInputValidationError(
      "ROUTE_NOT_FOUND",
      "No authored route connects the requested network zones.",
    );
  }
  return selected;
}
