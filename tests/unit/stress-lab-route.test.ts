import { describe, expect, it } from "vitest";
import { SANDTON_ROSEBANK_V1_NETWORK } from "@/data/scenarios/sandton-rosebank-v1";
import {
  batteryWhAtBasisPoints,
  energyWhForDistance,
  isMissionReserveFeasible,
} from "@/domain/stress-lab/reference-controller";
import { findAuthoredRoute } from "@/domain/stress-lab/route";
import {
  edgeId,
  latitudeMicrodegrees,
  longitudeMicrodegrees,
  metres,
  simulatedSecond,
  STRESS_LAB_NETWORK_SCHEMA_VERSION,
  STRESS_LAB_NETWORK_VERSION,
  zoneId,
  type NetworkFixture,
} from "@/domain/stress-lab/types";

const coordinate = {
  latitudeMicrodegrees: latitudeMicrodegrees(0),
  longitudeMicrodegrees: longitudeMicrodegrees(0),
};

function tieFixture(reversed: boolean): NetworkFixture {
  const a = zoneId("a");
  const b = zoneId("b");
  const c = zoneId("c");
  const d = zoneId("d");
  const edges = [
    {
      id: edgeId("a-to-b"),
      fromZoneId: a,
      toZoneId: b,
      distanceMetres: metres(1_000),
      travelSeconds: simulatedSecond(60),
      pathZoneIds: [a, b],
      displayPath: [coordinate, coordinate],
    },
    {
      id: edgeId("b-to-d"),
      fromZoneId: b,
      toZoneId: d,
      distanceMetres: metres(1_000),
      travelSeconds: simulatedSecond(60),
      pathZoneIds: [b, d],
      displayPath: [coordinate, coordinate],
    },
    {
      id: edgeId("a-to-c"),
      fromZoneId: a,
      toZoneId: c,
      distanceMetres: metres(1_000),
      travelSeconds: simulatedSecond(60),
      pathZoneIds: [a, c],
      displayPath: [coordinate, coordinate],
    },
    {
      id: edgeId("c-to-d"),
      fromZoneId: c,
      toZoneId: d,
      distanceMetres: metres(1_000),
      travelSeconds: simulatedSecond(60),
      pathZoneIds: [c, d],
      displayPath: [coordinate, coordinate],
    },
  ];
  return {
    inputSchemaVersion: STRESS_LAB_NETWORK_SCHEMA_VERSION,
    networkVersion: STRESS_LAB_NETWORK_VERSION,
    zones: [a, b, c, d].map((id) => ({ id, name: id, displayCoordinate: coordinate })),
    edges: reversed ? edges.reverse() : edges,
  };
}

describe("Gate 4 authored route referee", () => {
  it("uses authored travel time, distance, and lexical signature only", () => {
    const route = findAuthoredRoute(
      SANDTON_ROSEBANK_V1_NETWORK,
      zoneId("sandton"),
      zoneId("rosebank"),
    );
    expect(route).toMatchObject({
      edgeIds: [
        "sandton-to-parkmore",
        "parkmore-to-illovo",
        "illovo-to-rosebank",
      ],
      distanceMetres: 5_800,
      travelSeconds: 600,
    });
  });

  it("resolves equal routes identically regardless of edge insertion order", () => {
    const expected = ["a-to-b", "b-to-d"];
    expect(
      findAuthoredRoute(tieFixture(false), zoneId("a"), zoneId("d")).edgeIds,
    ).toEqual(expected);
    expect(
      findAuthoredRoute(tieFixture(true), zoneId("a"), zoneId("d")).edgeIds,
    ).toEqual(expected);
  });

  it("returns a zero-cost stationary route and rejects unknown zones", () => {
    expect(
      findAuthoredRoute(
        SANDTON_ROSEBANK_V1_NETWORK,
        zoneId("sandton"),
        zoneId("sandton"),
      ),
    ).toMatchObject({ distanceMetres: 0, travelSeconds: 0, edgeIds: [] });
    expect(() =>
      findAuthoredRoute(
        SANDTON_ROSEBANK_V1_NETWORK,
        zoneId("unknown"),
        zoneId("sandton"),
      ),
    ).toThrow(/known network zones/u);
  });
});

describe("Gate 4 integer energy boundary", () => {
  it("uses integer watt-hours and accepts exact reserve but rejects one Wh below", () => {
    expect(energyWhForDistance(5_800, 210)).toBe(1_218);
    expect(batteryWhAtBasisPoints(70_000, 2_000)).toBe(14_000);
    expect(isMissionReserveFeasible(15_000, 1_000, 14_000)).toBe(true);
    expect(isMissionReserveFeasible(14_999, 1_000, 14_000)).toBe(false);
  });
});
