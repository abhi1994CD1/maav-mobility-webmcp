import { generateDemandTrace } from "@/domain/stress-lab/demand";
import { fingerprintCanonical } from "@/domain/stress-lab/fingerprint";
import {
  computeNetworkFixtureFingerprint,
  prepareGoldenExperimentManifest,
  prepareStressLabRunInput,
} from "@/domain/stress-lab/run-input";
import {
  basisPoints,
  count,
  disruptionId,
  edgeId,
  fingerprint,
  latitudeMicrodegrees,
  longitudeMicrodegrees,
  metres,
  seed,
  simulatedSecond,
  STRESS_LAB_CANONICALIZATION_VERSION,
  STRESS_LAB_DEMAND_GENERATOR_VERSION,
  STRESS_LAB_DISRUPTION_POLICY_VERSION,
  STRESS_LAB_ENGINE_VERSION,
  STRESS_LAB_FINGERPRINT_VERSION,
  STRESS_LAB_INPUT_SCHEMA_VERSION,
  STRESS_LAB_METRIC_DEFINITION_VERSION,
  STRESS_LAB_NETWORK_VERSION,
  STRESS_LAB_PRESET_VERSION,
  StressLabInputValidationError,
  wattHours,
  wattHoursPerKilometre,
  zoneId,
  type DisplayCoordinate,
  type GoldenExperimentPreset,
  type NetworkEdge,
  type NetworkFixture,
  type PreparedGoldenExperimentInputs,
  type ScenarioConfiguration,
  type ScenarioSlot,
  type StressLabRunInput,
  type ValidationIssue,
  type ValidationResult,
  type ZoneId,
} from "@/domain/stress-lab/types";

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function coordinate(latitude: number, longitude: number): DisplayCoordinate {
  return deepFreeze({
    latitudeMicrodegrees: latitudeMicrodegrees(latitude),
    longitudeMicrodegrees: longitudeMicrodegrees(longitude),
  });
}

const ZONES = deepFreeze({
  sandton: zoneId("sandton"),
  parkmore: zoneId("parkmore"),
  illovo: zoneId("illovo"),
  rosebank: zoneId("rosebank"),
  melroseArch: zoneId("melrose-arch"),
});

const ZONE_COORDINATES = deepFreeze({
  sandton: coordinate(-26_107_600, 28_056_700),
  parkmore: coordinate(-26_114_700, 28_042_100),
  illovo: coordinate(-26_127_900, 28_047_100),
  rosebank: coordinate(-26_145_800, 28_041_900),
  melroseArch: coordinate(-26_133_000, 28_068_100),
});

function edge(
  idValue: string,
  fromZoneId: ZoneId,
  toZoneId: ZoneId,
  distance: number,
  travelTime: number,
  displayPath: readonly DisplayCoordinate[],
): NetworkEdge {
  return deepFreeze({
    id: edgeId(idValue),
    fromZoneId,
    toZoneId,
    distanceMetres: metres(distance),
    travelSeconds: simulatedSecond(travelTime),
    pathZoneIds: [fromZoneId, toZoneId],
    displayPath,
  });
}

export const SANDTON_ROSEBANK_V1_NETWORK: NetworkFixture = deepFreeze({
  inputSchemaVersion: STRESS_LAB_INPUT_SCHEMA_VERSION,
  networkVersion: STRESS_LAB_NETWORK_VERSION,
  zones: [
    {
      id: ZONES.sandton,
      name: "Sandton",
      displayCoordinate: ZONE_COORDINATES.sandton,
    },
    {
      id: ZONES.parkmore,
      name: "Parkmore",
      displayCoordinate: ZONE_COORDINATES.parkmore,
    },
    {
      id: ZONES.illovo,
      name: "Illovo",
      displayCoordinate: ZONE_COORDINATES.illovo,
    },
    {
      id: ZONES.rosebank,
      name: "Rosebank",
      displayCoordinate: ZONE_COORDINATES.rosebank,
    },
    {
      id: ZONES.melroseArch,
      name: "Melrose Arch",
      displayCoordinate: ZONE_COORDINATES.melroseArch,
    },
  ],
  edges: [
    edge(
      "sandton-to-parkmore",
      ZONES.sandton,
      ZONES.parkmore,
      1_800,
      180,
      [
        ZONE_COORDINATES.sandton,
        coordinate(-26_109_200, 28_051_500),
        ZONE_COORDINATES.parkmore,
      ],
    ),
    edge(
      "parkmore-to-sandton",
      ZONES.parkmore,
      ZONES.sandton,
      1_800,
      180,
      [
        ZONE_COORDINATES.parkmore,
        coordinate(-26_109_200, 28_051_500),
        ZONE_COORDINATES.sandton,
      ],
    ),
    edge(
      "parkmore-to-illovo",
      ZONES.parkmore,
      ZONES.illovo,
      1_900,
      180,
      [
        ZONE_COORDINATES.parkmore,
        coordinate(-26_120_600, 28_043_800),
        ZONE_COORDINATES.illovo,
      ],
    ),
    edge(
      "illovo-to-parkmore",
      ZONES.illovo,
      ZONES.parkmore,
      1_900,
      180,
      [
        ZONE_COORDINATES.illovo,
        coordinate(-26_120_600, 28_043_800),
        ZONE_COORDINATES.parkmore,
      ],
    ),
    edge(
      "illovo-to-rosebank",
      ZONES.illovo,
      ZONES.rosebank,
      2_100,
      240,
      [
        ZONE_COORDINATES.illovo,
        coordinate(-26_136_300, 28_044_500),
        ZONE_COORDINATES.rosebank,
      ],
    ),
    edge(
      "rosebank-to-illovo",
      ZONES.rosebank,
      ZONES.illovo,
      2_100,
      240,
      [
        ZONE_COORDINATES.rosebank,
        coordinate(-26_136_300, 28_044_500),
        ZONE_COORDINATES.illovo,
      ],
    ),
    edge(
      "illovo-to-melrose-arch",
      ZONES.illovo,
      ZONES.melroseArch,
      2_400,
      240,
      [
        ZONE_COORDINATES.illovo,
        coordinate(-26_129_500, 28_057_200),
        ZONE_COORDINATES.melroseArch,
      ],
    ),
    edge(
      "melrose-arch-to-illovo",
      ZONES.melroseArch,
      ZONES.illovo,
      2_400,
      240,
      [
        ZONE_COORDINATES.melroseArch,
        coordinate(-26_129_500, 28_057_200),
        ZONE_COORDINATES.illovo,
      ],
    ),
    edge(
      "sandton-to-melrose-arch",
      ZONES.sandton,
      ZONES.melroseArch,
      3_400,
      300,
      [
        ZONE_COORDINATES.sandton,
        coordinate(-26_119_100, 28_062_900),
        ZONE_COORDINATES.melroseArch,
      ],
    ),
    edge(
      "melrose-arch-to-sandton",
      ZONES.melroseArch,
      ZONES.sandton,
      3_400,
      300,
      [
        ZONE_COORDINATES.melroseArch,
        coordinate(-26_119_100, 28_062_900),
        ZONE_COORDINATES.sandton,
      ],
    ),
  ],
});

const GOLDEN_HORIZON = deepFreeze({
  displayStart: "08:30:00" as const,
  displayEnd: "09:00:00" as const,
  durationSeconds: simulatedSecond(1_800),
  tickSeconds: simulatedSecond(30),
});

const INITIAL_ZONE_WEIGHTS = deepFreeze([
  { zoneId: ZONES.sandton, weight: count(30) },
  { zoneId: ZONES.parkmore, weight: count(15) },
  { zoneId: ZONES.illovo, weight: count(20) },
  { zoneId: ZONES.rosebank, weight: count(25) },
  { zoneId: ZONES.melroseArch, weight: count(10) },
]);

function scenario(
  slot: ScenarioSlot,
  label: string,
  vehicleCount: number,
  seatsPerVehicle: number,
): ScenarioConfiguration {
  return deepFreeze({
    slot,
    label,
    fleet: {
      vehicleCount: count(vehicleCount),
      seatsPerVehicle: count(seatsPerVehicle),
      batteryCapacityWh: wattHours(70_000),
      startingBatteryBasisPoints: basisPoints(8_200),
      minimumReserveBasisPoints: basisPoints(2_000),
      energyWhPerKilometre: wattHoursPerKilometre(210),
      dwellSeconds: simulatedSecond(30),
      initialZoneWeights: INITIAL_ZONE_WEIGHTS,
    },
    constraints: {
      maximumWaitSeconds: simulatedSecond(180),
      maximumUnservedPassengers: count(12),
      minimumBatteryReserveBasisPoints: basisPoints(2_000),
      maximumRecoverySeconds: simulatedSecond(600),
      standingAllowed: false as const,
    },
    objectives: [
      "LOWER_WAIT",
      "LOWER_ENERGY_PER_PASSENGER_KM",
      "HIGHER_UTILIZATION",
      "FASTER_RECOVERY",
      "LOWER_EMPTY_KM",
    ],
  });
}

function disruption(slot: ScenarioSlot) {
  return deepFreeze({
    id: disruptionId(`failure-${slot}-0842`),
    type: "VEHICLE_FAILURE" as const,
    atSecond: simulatedSecond(720),
    target: {
      kind: "DETERMINISTIC_RULE" as const,
      policyVersion: STRESS_LAB_DISRUPTION_POLICY_VERSION,
      ranking: [
        "HIGHEST_ONBOARD_OCCUPANCY",
        "HIGHEST_RESERVED_PASSENGER_COUNT",
        "ACTIVE_SERVICE_FIRST",
        "ASCENDING_VEHICLE_ID",
      ] as const,
    },
    recoveryTransferSeconds: simulatedSecond(60),
  });
}

export const MORNING_PEAK_RESILIENCE_V1: GoldenExperimentPreset = deepFreeze({
  inputSchemaVersion: STRESS_LAB_INPUT_SCHEMA_VERSION,
  presetVersion: STRESS_LAB_PRESET_VERSION,
  engineVersion: STRESS_LAB_ENGINE_VERSION,
  metricDefinitionVersion: STRESS_LAB_METRIC_DEFINITION_VERSION,
  canonicalizationVersion: STRESS_LAB_CANONICALIZATION_VERSION,
  fingerprintVersion: STRESS_LAB_FINGERPRINT_VERSION,
  networkVersion: STRESS_LAB_NETWORK_VERSION,
  horizon: GOLDEN_HORIZON,
  seed: seed(7),
  demand: {
    generatorVersion: STRESS_LAB_DEMAND_GENERATOR_VERSION,
    requestCount: count(120),
    temporalWeights: [
      {
        startSecond: simulatedSecond(0),
        endSecondExclusive: simulatedSecond(300),
        weight: count(10),
      },
      {
        startSecond: simulatedSecond(300),
        endSecondExclusive: simulatedSecond(720),
        weight: count(25),
      },
      {
        startSecond: simulatedSecond(720),
        endSecondExclusive: simulatedSecond(1_200),
        weight: count(40),
      },
      {
        startSecond: simulatedSecond(1_200),
        endSecondExclusive: simulatedSecond(1_800),
        weight: count(25),
      },
    ],
    originDestinationWeights: [
      {
        originZoneId: ZONES.sandton,
        destinationZoneId: ZONES.rosebank,
        weight: count(24),
      },
      {
        originZoneId: ZONES.rosebank,
        destinationZoneId: ZONES.sandton,
        weight: count(22),
      },
      {
        originZoneId: ZONES.parkmore,
        destinationZoneId: ZONES.sandton,
        weight: count(10),
      },
      {
        originZoneId: ZONES.illovo,
        destinationZoneId: ZONES.sandton,
        weight: count(8),
      },
      {
        originZoneId: ZONES.sandton,
        destinationZoneId: ZONES.illovo,
        weight: count(8),
      },
      {
        originZoneId: ZONES.rosebank,
        destinationZoneId: ZONES.illovo,
        weight: count(7),
      },
      {
        originZoneId: ZONES.melroseArch,
        destinationZoneId: ZONES.sandton,
        weight: count(7),
      },
      {
        originZoneId: ZONES.sandton,
        destinationZoneId: ZONES.melroseArch,
        weight: count(6),
      },
      {
        originZoneId: ZONES.parkmore,
        destinationZoneId: ZONES.rosebank,
        weight: count(4),
      },
      {
        originZoneId: ZONES.melroseArch,
        destinationZoneId: ZONES.rosebank,
        weight: count(4),
      },
    ],
  },
  scenarios: {
    A: scenario("A", "Twelve compact pods", 12, 8),
    B: scenario("B", "Ten higher-capacity pods", 10, 10),
  },
  disruptions: {
    A: [disruption("A")],
    B: [disruption("B")],
  },
});

export const SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT =
  computeNetworkFixtureFingerprint(SANDTON_ROSEBANK_V1_NETWORK);

export const MORNING_PEAK_RESILIENCE_V1_FINGERPRINT = fingerprintCanonical(
  "EXPERIMENT_PRESET",
  MORNING_PEAK_RESILIENCE_V1,
);

export const LOCKED_GATE_3_FINGERPRINTS = deepFreeze({
  network: fingerprint(
    "sha256-v1:ff982fc42bc6ae8bb6d1f110a44925e392f2f44e2ebbdf9f0f8054080d4df5d0",
  ),
  preset: fingerprint(
    "sha256-v1:6e36281c791eb11af7aaae46fa32a67e5fd637c950cff28f6955c673c36d763e",
  ),
  demand: fingerprint(
    "sha256-v1:f7fd7e72e6ba7befe1b3eb578e20387b89a9b7a274c67b65ddebdfd62ee22302",
  ),
  runA: fingerprint(
    "sha256-v1:7a8b2f3ba0032d630d6fcac32a295a0fd94a832cea1a41a27b464b70a886af57",
  ),
  runB: fingerprint(
    "sha256-v1:fac59cb8142eb2a01912876b166e46adc3b9f9dd77473cff2342e0e7e06ce24b",
  ),
  manifest: fingerprint(
    "sha256-v1:b23227b7bcec16c2e2849bb68a4c3749738c07749fef041db559749b5e281b06",
  ),
});

function issue(code: string, path: string, message: string): ValidationIssue {
  return Object.freeze({ code, path, message });
}

function reachable(
  origin: ZoneId,
  destination: ZoneId,
  edges: readonly NetworkEdge[],
): boolean {
  const queue: ZoneId[] = [origin];
  const visited = new Set<ZoneId>([origin]);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === destination) return true;
    if (current === undefined) break;
    for (const edgeValue of edges) {
      if (edgeValue.fromZoneId === current && !visited.has(edgeValue.toZoneId)) {
        visited.add(edgeValue.toZoneId);
        queue.push(edgeValue.toZoneId);
      }
    }
  }
  return false;
}

export function validateSandtonRosebankV1(): ValidationResult {
  const issues: ValidationIssue[] = [];
  const network = SANDTON_ROSEBANK_V1_NETWORK;
  const preset = MORNING_PEAK_RESILIENCE_V1;
  const zoneIds = network.zones.map((zone) => zone.id);
  const edgeIds = network.edges.map((edgeValue) => edgeValue.id);
  const zoneIdSet = new Set(zoneIds);

  if (
    SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT !==
    LOCKED_GATE_3_FINGERPRINTS.network
  ) {
    issues.push(
      issue(
        "NETWORK_FINGERPRINT_DRIFT",
        "network",
        "Network content changed without an explicit version and fingerprint update.",
      ),
    );
  }
  if (
    MORNING_PEAK_RESILIENCE_V1_FINGERPRINT !==
    LOCKED_GATE_3_FINGERPRINTS.preset
  ) {
    issues.push(
      issue(
        "PRESET_FINGERPRINT_DRIFT",
        "preset",
        "Experiment preset changed without an explicit version and fingerprint update.",
      ),
    );
  }

  if (network.zones.length < 4 || network.zones.length > 6) {
    issues.push(issue("ZONE_COUNT", "network.zones", "Network must contain 4–6 zones."));
  }
  if (new Set(zoneIds).size !== zoneIds.length) {
    issues.push(issue("DUPLICATE_ZONE_ID", "network.zones", "Zone IDs must be unique."));
  }
  if (new Set(edgeIds).size !== edgeIds.length) {
    issues.push(issue("DUPLICATE_EDGE_ID", "network.edges", "Edge IDs must be unique."));
  }

  for (let index = 0; index < network.zones.length; index += 1) {
    const zone = network.zones[index];
    if (zone.name.trim().length === 0) {
      issues.push(
        issue(
          "EMPTY_ZONE_NAME",
          `network.zones[${index}].name`,
          "Zone name is required.",
        ),
      );
    }
    const { latitudeMicrodegrees: latitude, longitudeMicrodegrees: longitude } =
      zone.displayCoordinate;
    if (
      latitude < -26_160_000 ||
      latitude > -26_090_000 ||
      longitude < 28_030_000 ||
      longitude > 28_080_000
    ) {
      issues.push(
        issue(
          "ZONE_OUTSIDE_CORRIDOR_BOUNDS",
          `network.zones[${index}].displayCoordinate`,
          "Zone display coordinate is outside the fixed corridor bounds.",
        ),
      );
    }
  }

  for (let index = 0; index < network.edges.length; index += 1) {
    const edgeValue = network.edges[index];
    if (
      !zoneIdSet.has(edgeValue.fromZoneId) ||
      !zoneIdSet.has(edgeValue.toZoneId)
    ) {
      issues.push(
        issue(
          "EDGE_UNKNOWN_ZONE",
          `network.edges[${index}]`,
          "Edge references an unknown zone.",
        ),
      );
    }
    if (edgeValue.distanceMetres <= 0 || edgeValue.travelSeconds <= 0) {
      issues.push(
        issue(
          "EDGE_NON_POSITIVE",
          `network.edges[${index}]`,
          "Edge distance and time must be positive.",
        ),
      );
    }
    if (edgeValue.travelSeconds % preset.horizon.tickSeconds !== 0) {
      issues.push(
        issue(
          "EDGE_NOT_TICK_ALIGNED",
          `network.edges[${index}].travelSeconds`,
          "Edge time must align with the engine tick.",
        ),
      );
    }
    if (
      edgeValue.pathZoneIds[0] !== edgeValue.fromZoneId ||
      edgeValue.pathZoneIds.at(-1) !== edgeValue.toZoneId
    ) {
      issues.push(
        issue(
          "EDGE_PATH_ENDPOINT_MISMATCH",
          `network.edges[${index}].pathZoneIds`,
          "Edge path endpoints must match the directed edge.",
        ),
      );
    }
    if (edgeValue.displayPath.length < 2) {
      issues.push(
        issue(
          "EDGE_DISPLAY_PATH_TOO_SHORT",
          `network.edges[${index}].displayPath`,
          "Edge display path needs at least two coordinates.",
        ),
      );
    }
    for (
      let coordinateIndex = 0;
      coordinateIndex < edgeValue.displayPath.length;
      coordinateIndex += 1
    ) {
      const displayCoordinate = edgeValue.displayPath[coordinateIndex];
      if (
        displayCoordinate.latitudeMicrodegrees < -26_160_000 ||
        displayCoordinate.latitudeMicrodegrees > -26_090_000 ||
        displayCoordinate.longitudeMicrodegrees < 28_030_000 ||
        displayCoordinate.longitudeMicrodegrees > 28_080_000
      ) {
        issues.push(
          issue(
            "EDGE_DISPLAY_PATH_OUTSIDE_BOUNDS",
            `network.edges[${index}].displayPath[${coordinateIndex}]`,
            "Edge display coordinate is outside the fixed corridor bounds.",
          ),
        );
      }
    }
    const reverseExists = network.edges.some(
      (candidate) =>
        candidate.fromZoneId === edgeValue.toZoneId &&
        candidate.toZoneId === edgeValue.fromZoneId,
    );
    if (!reverseExists) {
      issues.push(
        issue(
          "MISSING_REVERSE_EDGE",
          `network.edges[${index}]`,
          "Every H0 edge requires an authored reverse edge.",
        ),
      );
    }
  }

  for (const od of preset.demand.originDestinationWeights) {
    if (!reachable(od.originZoneId, od.destinationZoneId, network.edges)) {
      issues.push(
        issue(
          "UNREACHABLE_DEMAND_OD",
          "preset.demand.originDestinationWeights",
          `Demand pair ${od.originZoneId}->${od.destinationZoneId} is unreachable.`,
        ),
      );
    }
  }

  const temporalWeightTotal = preset.demand.temporalWeights.reduce(
    (total, entry) => total + entry.weight,
    0,
  );
  const originDestinationWeightTotal =
    preset.demand.originDestinationWeights.reduce(
      (total, entry) => total + entry.weight,
      0,
    );
  const temporalCoverageIsContiguous = preset.demand.temporalWeights.every(
    (entry, index, values) =>
      index === 0 || values[index - 1].endSecondExclusive === entry.startSecond,
  );
  if (
    temporalWeightTotal !== 100 ||
    originDestinationWeightTotal !== 100 ||
    preset.demand.temporalWeights[0]?.startSecond !== 0 ||
    preset.demand.temporalWeights.at(-1)?.endSecondExclusive !==
      preset.horizon.durationSeconds ||
    !temporalCoverageIsContiguous
  ) {
    issues.push(
      issue(
        "GOLDEN_DEMAND_PROFILE_MISMATCH",
        "preset.demand",
        "Golden demand weights must total 100 and cover the horizon contiguously.",
      ),
    );
  }

  for (const slot of ["A", "B"] as const) {
    const initialWeightTotal = preset.scenarios[
      slot
    ].fleet.initialZoneWeights.reduce((total, entry) => total + entry.weight, 0);
    if (initialWeightTotal !== 100) {
      issues.push(
        issue(
          "INITIAL_FLEET_WEIGHT_MISMATCH",
          `preset.scenarios.${slot}.fleet.initialZoneWeights`,
          "Initial fleet zone weights must total 100.",
        ),
      );
    }
  }

  if (
    preset.seed !== 7 ||
    preset.demand.requestCount !== 120 ||
    preset.horizon.durationSeconds !== 1_800 ||
    preset.horizon.tickSeconds !== 30 ||
    preset.scenarios.A.fleet.vehicleCount !== 12 ||
    preset.scenarios.A.fleet.seatsPerVehicle !== 8 ||
    preset.scenarios.B.fleet.vehicleCount !== 10 ||
    preset.scenarios.B.fleet.seatsPerVehicle !== 10 ||
    preset.scenarios.A.constraints.maximumWaitSeconds !== 180 ||
    preset.scenarios.B.constraints.maximumWaitSeconds !== 180 ||
    preset.scenarios.A.constraints.minimumBatteryReserveBasisPoints !== 2_000 ||
    preset.scenarios.B.constraints.minimumBatteryReserveBasisPoints !== 2_000 ||
    preset.disruptions.A[0]?.atSecond !== 720 ||
    preset.disruptions.B[0]?.atSecond !== 720
  ) {
    issues.push(
      issue(
        "GOLDEN_PRESET_MISMATCH",
        "preset",
        "Golden H0 values do not match the approved contract.",
      ),
    );
  }

  return deepFreeze({ valid: issues.length === 0, issues });
}

export function assertSandtonRosebankV1Valid(): void {
  const result = validateSandtonRosebankV1();
  if (!result.valid) {
    const first = result.issues[0];
    throw new StressLabInputValidationError(
      first.code,
      `Invalid ${STRESS_LAB_NETWORK_VERSION} fixture at ${first.path}: ${first.message}`,
    );
  }
}

function runInput(
  slot: ScenarioSlot,
  sharedDemandTrace: ReturnType<typeof generateDemandTrace>,
): StressLabRunInput {
  return deepFreeze({
    inputSchemaVersion: STRESS_LAB_INPUT_SCHEMA_VERSION,
    canonicalizationVersion: STRESS_LAB_CANONICALIZATION_VERSION,
    fingerprintVersion: STRESS_LAB_FINGERPRINT_VERSION,
    engineVersion: STRESS_LAB_ENGINE_VERSION,
    metricDefinitionVersion: STRESS_LAB_METRIC_DEFINITION_VERSION,
    presetVersion: STRESS_LAB_PRESET_VERSION,
    scenarioSlot: slot,
    horizon: MORNING_PEAK_RESILIENCE_V1.horizon,
    seed: MORNING_PEAK_RESILIENCE_V1.seed,
    network: SANDTON_ROSEBANK_V1_NETWORK,
    networkFingerprint: SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
    demandDefinition: MORNING_PEAK_RESILIENCE_V1.demand,
    demandTrace: sharedDemandTrace,
    scenario: MORNING_PEAK_RESILIENCE_V1.scenarios[slot],
    disruptions: MORNING_PEAK_RESILIENCE_V1.disruptions[slot],
  });
}

export function createGoldenExperimentInputs(): PreparedGoldenExperimentInputs {
  assertSandtonRosebankV1Valid();
  const sharedDemandTrace = generateDemandTrace({
    definition: MORNING_PEAK_RESILIENCE_V1.demand,
    horizon: MORNING_PEAK_RESILIENCE_V1.horizon,
    network: SANDTON_ROSEBANK_V1_NETWORK,
    seed: MORNING_PEAK_RESILIENCE_V1.seed,
  });
  const runs = deepFreeze({
    A: prepareStressLabRunInput(runInput("A", sharedDemandTrace)),
    B: prepareStressLabRunInput(runInput("B", sharedDemandTrace)),
  });
  const preparedManifest = prepareGoldenExperimentManifest({
    networkFingerprint: SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
    presetFingerprint: MORNING_PEAK_RESILIENCE_V1_FINGERPRINT,
    demandFingerprint: sharedDemandTrace.fingerprint,
    seed: MORNING_PEAK_RESILIENCE_V1.seed,
    runInputFingerprints: {
      A: runs.A.fingerprint,
      B: runs.B.fingerprint,
    },
  });

  const currentFingerprints = {
    demand: sharedDemandTrace.fingerprint,
    runA: runs.A.fingerprint,
    runB: runs.B.fingerprint,
    manifest: preparedManifest.fingerprint,
  };
  for (const key of ["demand", "runA", "runB", "manifest"] as const) {
    if (currentFingerprints[key] !== LOCKED_GATE_3_FINGERPRINTS[key]) {
      throw new StressLabInputValidationError(
        "GATE_3_FINGERPRINT_DRIFT",
        `${key} content changed without an explicit version and fingerprint update.`,
      );
    }
  }

  return deepFreeze({
    networkFingerprint: SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
    presetFingerprint: MORNING_PEAK_RESILIENCE_V1_FINGERPRINT,
    sharedDemandTrace,
    runs,
    manifest: preparedManifest.manifest,
    manifestCanonicalJson: preparedManifest.canonicalJson,
    manifestFingerprint: preparedManifest.fingerprint,
  });
}
