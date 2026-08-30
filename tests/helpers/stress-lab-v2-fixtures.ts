import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import {
  computeNetworkFixtureFingerprint,
  prepareStressLabRunInput,
} from "@/domain/stress-lab/run-input";
import {
  basisPoints,
  count,
  disruptionId,
  edgeId,
  latitudeMicrodegrees,
  longitudeMicrodegrees,
  metres,
  networkVersion,
  passengerId,
  seed,
  simulatedSecond,
  STRESS_LAB_CANONICALIZATION_VERSION,
  STRESS_LAB_DEMAND_GENERATOR_VERSION,
  STRESS_LAB_DISRUPTION_POLICY_VERSION,
  STRESS_LAB_ENGINE_VERSION,
  STRESS_LAB_FINGERPRINT_VERSION,
  STRESS_LAB_INPUT_SCHEMA_VERSION,
  STRESS_LAB_METRIC_DEFINITION_VERSION,
  STRESS_LAB_NETWORK_SCHEMA_VERSION,
  STRESS_LAB_PRESET_VERSION,
  wattHours,
  wattHoursPerKilometre,
  zoneId,
  type DemandDefinition,
  type DemandTrace,
  type NetworkFixture,
  type PreparedRunInput,
  type StressLabRunInput,
} from "@/domain/stress-lab/types";

const coordinate = Object.freeze({
  latitudeMicrodegrees: latitudeMicrodegrees(0),
  longitudeMicrodegrees: longitudeMicrodegrees(0),
});

const alpha = zoneId("alpha-hub");
const beta = zoneId("beta-exchange");
const gamma = zoneId("gamma-terminal");

export const TINY_TRIANGLE_V1_NETWORK: NetworkFixture = Object.freeze({
  inputSchemaVersion: STRESS_LAB_NETWORK_SCHEMA_VERSION,
  networkVersion: networkVersion("tiny-triangle-v1"),
  zones: Object.freeze(
    [alpha, beta, gamma].map((id) =>
      Object.freeze({ id, name: id, displayCoordinate: coordinate }),
    ),
  ),
  edges: Object.freeze([
    Object.freeze({
      id: edgeId("alpha-beta"),
      fromZoneId: alpha,
      toZoneId: beta,
      distanceMetres: metres(700),
      travelSeconds: simulatedSecond(60),
      pathZoneIds: Object.freeze([alpha, beta]),
      displayPath: Object.freeze([coordinate, coordinate]),
    }),
    Object.freeze({
      id: edgeId("beta-gamma"),
      fromZoneId: beta,
      toZoneId: gamma,
      distanceMetres: metres(1_100),
      travelSeconds: simulatedSecond(90),
      pathZoneIds: Object.freeze([beta, gamma]),
      displayPath: Object.freeze([coordinate, coordinate]),
    }),
    Object.freeze({
      id: edgeId("gamma-alpha"),
      fromZoneId: gamma,
      toZoneId: alpha,
      distanceMetres: metres(1_600),
      travelSeconds: simulatedSecond(120),
      pathZoneIds: Object.freeze([gamma, alpha]),
      displayPath: Object.freeze([coordinate, coordinate]),
    }),
    Object.freeze({
      id: edgeId("beta-alpha"),
      fromZoneId: beta,
      toZoneId: alpha,
      distanceMetres: metres(800),
      travelSeconds: simulatedSecond(60),
      pathZoneIds: Object.freeze([beta, alpha]),
      displayPath: Object.freeze([coordinate, coordinate]),
    }),
    Object.freeze({
      id: edgeId("gamma-beta"),
      fromZoneId: gamma,
      toZoneId: beta,
      distanceMetres: metres(1_200),
      travelSeconds: simulatedSecond(90),
      pathZoneIds: Object.freeze([gamma, beta]),
      displayPath: Object.freeze([coordinate, coordinate]),
    }),
    Object.freeze({
      id: edgeId("alpha-gamma"),
      fromZoneId: alpha,
      toZoneId: gamma,
      distanceMetres: metres(1_500),
      travelSeconds: simulatedSecond(120),
      pathZoneIds: Object.freeze([alpha, gamma]),
      displayPath: Object.freeze([coordinate, coordinate]),
    }),
  ]),
});

export function createTinyTriangleRun(options?: {
  readonly disruption?: boolean;
  readonly passengerCount?: number;
  readonly vehicleCount?: number;
}): PreparedRunInput {
  const horizon = Object.freeze({
    displayStart: "08:30:00" as const,
    displayEnd: "09:00:00" as const,
    durationSeconds: simulatedSecond(300),
    tickSeconds: simulatedSecond(30),
  });
  const requestCount = options?.passengerCount ?? 3;
  const definition: DemandDefinition = Object.freeze({
    generatorVersion: STRESS_LAB_DEMAND_GENERATOR_VERSION,
    requestCount: count(requestCount),
    temporalWeights: Object.freeze([
      Object.freeze({
        startSecond: simulatedSecond(0),
        endSecondExclusive: simulatedSecond(300),
        weight: count(1),
      }),
    ]),
    originDestinationWeights: Object.freeze([
      Object.freeze({
        originZoneId: alpha,
        destinationZoneId: gamma,
        weight: count(1),
      }),
    ]),
  });
  const requests = Object.freeze(
    Array.from({ length: requestCount }, (_, index) =>
      Object.freeze({
        id: passengerId(`T-${String(index + 1).padStart(3, "0")}`),
        arrivalSecond: simulatedSecond(index * 30),
        originZoneId: alpha,
        destinationZoneId: gamma,
      }),
    ),
  );
  const traceWithoutFingerprint = {
    seed: seed(99),
    generatorVersion: STRESS_LAB_DEMAND_GENERATOR_VERSION,
    requests,
  };
  const demandTrace: DemandTrace = Object.freeze({
    ...traceWithoutFingerprint,
    fingerprint: computeDemandTraceFingerprint(
      definition,
      horizon,
      traceWithoutFingerprint,
    ),
  });
  const input: StressLabRunInput = {
    inputSchemaVersion: STRESS_LAB_INPUT_SCHEMA_VERSION,
    canonicalizationVersion: STRESS_LAB_CANONICALIZATION_VERSION,
    fingerprintVersion: STRESS_LAB_FINGERPRINT_VERSION,
    engineVersion: STRESS_LAB_ENGINE_VERSION,
    metricDefinitionVersion: STRESS_LAB_METRIC_DEFINITION_VERSION,
    presetVersion: STRESS_LAB_PRESET_VERSION,
    scenarioSlot: "A",
    horizon,
    terminalEvaluationSecond: simulatedSecond(360),
    seed: seed(99),
    networkVersion: TINY_TRIANGLE_V1_NETWORK.networkVersion,
    network: TINY_TRIANGLE_V1_NETWORK,
    networkFingerprint: computeNetworkFixtureFingerprint(TINY_TRIANGLE_V1_NETWORK),
    demandDefinition: definition,
    demandTrace,
    scenario: {
      slot: "A",
      label: "Tiny triangle proof",
      fleet: {
        vehicleCount: count(options?.vehicleCount ?? 2),
        seatsPerVehicle: count(3),
        batteryCapacityWh: wattHours(12_000),
        startingBatteryBasisPoints: basisPoints(9_000),
        minimumReserveBasisPoints: basisPoints(1_000),
        energyWhPerKilometre: wattHoursPerKilometre(150),
        dwellSeconds: simulatedSecond(30),
        initialZoneWeights: Object.freeze([
          Object.freeze({ zoneId: alpha, weight: count(1) }),
        ]),
      },
      constraints: {
        maximumWaitSeconds: simulatedSecond(60),
        maximumUnservedPassengers: count(3),
        minimumBatteryReserveBasisPoints: basisPoints(1_000),
        maximumRecoverySeconds: simulatedSecond(180),
        standingAllowed: false,
      },
      objectives: Object.freeze(["LOWER_WAIT"]),
    },
    disruptions:
      options?.disruption === false
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              id: disruptionId("tiny-failure-0090"),
              type: "VEHICLE_FAILURE",
              atSecond: simulatedSecond(90),
              target: Object.freeze({
                kind: "DETERMINISTIC_RULE",
                policyVersion: STRESS_LAB_DISRUPTION_POLICY_VERSION,
                ranking: [
                  "HIGHEST_ONBOARD_OCCUPANCY",
                  "HIGHEST_RESERVED_PASSENGER_COUNT",
                  "ACTIVE_SERVICE_FIRST",
                  "ASCENDING_VEHICLE_ID",
                ] as const,
              }),
              recoveryTransferSeconds: simulatedSecond(30),
            }),
          ]),
  };
  return prepareStressLabRunInput(input);
}
