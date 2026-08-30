import { computeDemandTraceFingerprint } from "./demand";
import {
  createFingerprintDocument,
  fingerprintCanonical,
} from "./fingerprint";
import {
  STRESS_LAB_CANONICALIZATION_VERSION,
  STRESS_LAB_DEMAND_GENERATOR_VERSION,
  STRESS_LAB_ENGINE_VERSION,
  STRESS_LAB_FINGERPRINT_VERSION,
  STRESS_LAB_INPUT_SCHEMA_VERSION,
  STRESS_LAB_METRIC_DEFINITION_VERSION,
  STRESS_LAB_NETWORK_VERSION,
  STRESS_LAB_PRESET_VERSION,
  StressLabInputValidationError,
  type Fingerprint,
  type GoldenExperimentInputManifest,
  type PreparedRunInput,
  type ScenarioSlot,
  type StressLabRunInput,
  type ValidationIssue,
  type ValidationResult,
} from "./types";

function clonePlain<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry)) as Value;
  }
  if (value !== null && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new StressLabInputValidationError(
        "RUN_INPUT_NON_PLAIN_OBJECT",
        "Run input contains a non-plain object.",
      );
    }
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = clonePlain((value as Record<string, unknown>)[key]);
    }
    return clone as Value;
  }
  return value;
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function isDeepFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.keys(value).every((key) =>
    isDeepFrozen((value as Record<string, unknown>)[key], seen),
  );
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return Object.freeze({ code, path, message });
}

function stableUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function networkReachable(
  input: StressLabRunInput,
  origin: string,
  destination: string,
): boolean {
  const queue = [origin];
  const visited = new Set<string>(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === destination) return true;
    if (current === undefined) break;
    for (const edge of input.network.edges) {
      if (edge.fromZoneId === current && !visited.has(edge.toZoneId)) {
        visited.add(edge.toZoneId);
        queue.push(edge.toZoneId);
      }
    }
  }
  return false;
}

export function computeNetworkFixtureFingerprint(
  network: StressLabRunInput["network"],
): Fingerprint {
  return fingerprintCanonical("NETWORK_FIXTURE", network);
}

export function validateStressLabRunInput(input: StressLabRunInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  const expectedVersions = [
    ["inputSchemaVersion", input.inputSchemaVersion, STRESS_LAB_INPUT_SCHEMA_VERSION],
    [
      "canonicalizationVersion",
      input.canonicalizationVersion,
      STRESS_LAB_CANONICALIZATION_VERSION,
    ],
    ["fingerprintVersion", input.fingerprintVersion, STRESS_LAB_FINGERPRINT_VERSION],
    ["engineVersion", input.engineVersion, STRESS_LAB_ENGINE_VERSION],
    [
      "metricDefinitionVersion",
      input.metricDefinitionVersion,
      STRESS_LAB_METRIC_DEFINITION_VERSION,
    ],
    ["presetVersion", input.presetVersion, STRESS_LAB_PRESET_VERSION],
  ] as const;
  for (const [path, actual, expected] of expectedVersions) {
    if (actual !== expected) {
      issues.push(issue("VERSION_MISMATCH", path, `${path} must be ${expected}.`));
    }
  }

  if (input.network.networkVersion !== STRESS_LAB_NETWORK_VERSION) {
    issues.push(
      issue(
        "NETWORK_VERSION_MISMATCH",
        "network.networkVersion",
        `Network version must be ${STRESS_LAB_NETWORK_VERSION}.`,
      ),
    );
  }
  if (input.network.inputSchemaVersion !== STRESS_LAB_INPUT_SCHEMA_VERSION) {
    issues.push(
      issue(
        "NETWORK_SCHEMA_MISMATCH",
        "network.inputSchemaVersion",
        `Network schema must be ${STRESS_LAB_INPUT_SCHEMA_VERSION}.`,
      ),
    );
  }
  if (computeNetworkFixtureFingerprint(input.network) !== input.networkFingerprint) {
    issues.push(
      issue(
        "NETWORK_FINGERPRINT_MISMATCH",
        "networkFingerprint",
        "Network fingerprint does not match the immutable network content.",
      ),
    );
  }
  const networkZoneIds = input.network.zones.map((zone) => zone.id);
  const networkZoneIdSet = new Set(networkZoneIds);
  if (!stableUnique(networkZoneIds)) {
    issues.push(
      issue(
        "DUPLICATE_NETWORK_ZONE_ID",
        "network.zones",
        "Network zone IDs must be unique.",
      ),
    );
  }
  if (!stableUnique(input.network.edges.map((edge) => edge.id))) {
    issues.push(
      issue(
        "DUPLICATE_NETWORK_EDGE_ID",
        "network.edges",
        "Network edge IDs must be unique.",
      ),
    );
  }
  for (let index = 0; index < input.network.edges.length; index += 1) {
    const edge = input.network.edges[index];
    if (
      !networkZoneIdSet.has(edge.fromZoneId) ||
      !networkZoneIdSet.has(edge.toZoneId)
    ) {
      issues.push(
        issue(
          "NETWORK_EDGE_UNKNOWN_ZONE",
          `network.edges[${index}]`,
          "Network edge endpoints must reference known zones.",
        ),
      );
    }
    if (
      !Number.isSafeInteger(edge.distanceMetres) ||
      !Number.isSafeInteger(edge.travelSeconds) ||
      edge.distanceMetres <= 0 ||
      edge.travelSeconds <= 0 ||
      edge.travelSeconds % input.horizon.tickSeconds !== 0
    ) {
      issues.push(
        issue(
          "INVALID_NETWORK_EDGE_UNITS",
          `network.edges[${index}]`,
          "Network edge distance and tick-aligned travel time must be positive integers.",
        ),
      );
    }
  }

  const { horizon } = input;
  if (
    !Number.isSafeInteger(horizon.durationSeconds) ||
    !Number.isSafeInteger(horizon.tickSeconds) ||
    horizon.durationSeconds <= 0 ||
    horizon.tickSeconds <= 0 ||
    horizon.durationSeconds % horizon.tickSeconds !== 0
  ) {
    issues.push(
      issue(
        "INVALID_HORIZON",
        "horizon",
        "Horizon duration and tick must be positive aligned integers.",
      ),
    );
  }

  if (input.demandTrace.generatorVersion !== STRESS_LAB_DEMAND_GENERATOR_VERSION) {
    issues.push(
      issue(
        "DEMAND_VERSION_MISMATCH",
        "demandTrace.generatorVersion",
        `Demand generator must be ${STRESS_LAB_DEMAND_GENERATOR_VERSION}.`,
      ),
    );
  }
  if (
    input.demandDefinition.generatorVersion !==
    STRESS_LAB_DEMAND_GENERATOR_VERSION
  ) {
    issues.push(
      issue(
        "DEMAND_DEFINITION_VERSION_MISMATCH",
        "demandDefinition.generatorVersion",
        `Demand definition must use ${STRESS_LAB_DEMAND_GENERATOR_VERSION}.`,
      ),
    );
  }
  if (
    input.demandDefinition.temporalWeights.length === 0 ||
    input.demandDefinition.originDestinationWeights.length === 0
  ) {
    issues.push(
      issue(
        "EMPTY_DEMAND_DEFINITION",
        "demandDefinition",
        "Demand definition must include temporal and origin-destination weights.",
      ),
    );
  }
  for (
    let index = 0;
    index < input.demandDefinition.temporalWeights.length;
    index += 1
  ) {
    const bucket = input.demandDefinition.temporalWeights[index];
    if (
      !Number.isSafeInteger(bucket.weight) ||
      bucket.weight <= 0 ||
      bucket.startSecond < 0 ||
      bucket.endSecondExclusive <= bucket.startSecond ||
      bucket.endSecondExclusive > horizon.durationSeconds ||
      bucket.startSecond % horizon.tickSeconds !== 0 ||
      bucket.endSecondExclusive % horizon.tickSeconds !== 0
    ) {
      issues.push(
        issue(
          "INVALID_DEMAND_TEMPORAL_WEIGHT",
          `demandDefinition.temporalWeights[${index}]`,
          "Temporal demand weights must be positive, in-horizon, and tick-aligned.",
        ),
      );
    }
  }
  const demandPairs = new Set<string>();
  for (
    let index = 0;
    index < input.demandDefinition.originDestinationWeights.length;
    index += 1
  ) {
    const od = input.demandDefinition.originDestinationWeights[index];
    const pair = `${od.originZoneId}->${od.destinationZoneId}`;
    if (
      !Number.isSafeInteger(od.weight) ||
      od.weight <= 0 ||
      od.originZoneId === od.destinationZoneId ||
      !networkZoneIdSet.has(od.originZoneId) ||
      !networkZoneIdSet.has(od.destinationZoneId) ||
      !networkReachable(input, od.originZoneId, od.destinationZoneId) ||
      demandPairs.has(pair)
    ) {
      issues.push(
        issue(
          "INVALID_DEMAND_OD_WEIGHT",
          `demandDefinition.originDestinationWeights[${index}]`,
          "OD demand weights must be unique, positive, distinct, known, and reachable.",
        ),
      );
    }
    demandPairs.add(pair);
  }
  if (input.demandTrace.seed !== input.seed) {
    issues.push(
      issue(
        "DEMAND_SEED_MISMATCH",
        "demandTrace.seed",
        "Demand trace seed must match the run-input seed.",
      ),
    );
  }
  if (!stableUnique(input.demandTrace.requests.map((request) => request.id))) {
    issues.push(
      issue(
        "DUPLICATE_PASSENGER_ID",
        "demandTrace.requests",
        "Demand trace passenger IDs must be unique.",
      ),
    );
  }
  for (let index = 0; index < input.demandTrace.requests.length; index += 1) {
    const request = input.demandTrace.requests[index];
    if (
      !Number.isSafeInteger(request.arrivalSecond) ||
      request.arrivalSecond < 0 ||
      request.arrivalSecond >= horizon.durationSeconds ||
      request.arrivalSecond % horizon.tickSeconds !== 0
    ) {
      issues.push(
        issue(
          "INVALID_PASSENGER_ARRIVAL",
          `demandTrace.requests[${index}].arrivalSecond`,
          "Passenger arrival must be an in-horizon, tick-aligned integer.",
        ),
      );
    }
    if (request.originZoneId === request.destinationZoneId) {
      issues.push(
        issue(
          "IDENTICAL_PASSENGER_OD",
          `demandTrace.requests[${index}]`,
          "Passenger origin and destination must differ.",
        ),
      );
    }
    if (
      !networkZoneIdSet.has(request.originZoneId) ||
      !networkZoneIdSet.has(request.destinationZoneId)
    ) {
      issues.push(
        issue(
          "PASSENGER_OD_UNKNOWN_ZONE",
          `demandTrace.requests[${index}]`,
          "Passenger origin and destination must reference known zones.",
        ),
      );
    } else if (
      !networkReachable(input, request.originZoneId, request.destinationZoneId)
    ) {
      issues.push(
        issue(
          "PASSENGER_OD_UNREACHABLE",
          `demandTrace.requests[${index}]`,
          "Passenger origin and destination must be reachable in the authored network.",
        ),
      );
    }
    const prior = input.demandTrace.requests[index - 1];
    if (
      prior &&
      (prior.arrivalSecond > request.arrivalSecond ||
        (prior.arrivalSecond === request.arrivalSecond && prior.id >= request.id))
    ) {
      issues.push(
        issue(
          "DEMAND_TRACE_NOT_STABLY_ORDERED",
          `demandTrace.requests[${index}]`,
          "Demand requests must be ordered by arrival second then passenger ID.",
        ),
      );
    }
  }
  const demandFingerprint = computeDemandTraceFingerprint(
    input.demandDefinition,
    horizon,
    input.demandTrace,
  );
  if (demandFingerprint !== input.demandTrace.fingerprint) {
    issues.push(
      issue(
        "DEMAND_FINGERPRINT_MISMATCH",
        "demandTrace.fingerprint",
        "Demand fingerprint does not match its definition and immutable requests.",
      ),
    );
  }
  if (input.demandDefinition.requestCount !== input.demandTrace.requests.length) {
    issues.push(
      issue(
        "DEMAND_COUNT_MISMATCH",
        "demandDefinition.requestCount",
        "Demand definition count must match the generated request trace.",
      ),
    );
  }

  if (input.scenario.slot !== input.scenarioSlot) {
    issues.push(
      issue(
        "SCENARIO_SLOT_MISMATCH",
        "scenario.slot",
        "Scenario configuration slot must match the run-input slot.",
      ),
    );
  }
  if (
    input.scenario.label.trim().length < 1 ||
    input.scenario.label.trim().length > 48 ||
    /[<>\u0000-\u001F\u007F]/u.test(input.scenario.label)
  ) {
    issues.push(
      issue(
        "INVALID_SCENARIO_LABEL",
        "scenario.label",
        "Scenario label must be 1–48 plain-text characters.",
      ),
    );
  }
  const { fleet } = input.scenario;
  if (
    !Number.isSafeInteger(fleet.vehicleCount) ||
    fleet.vehicleCount < 0 ||
    fleet.vehicleCount > 30 ||
    !Number.isSafeInteger(fleet.seatsPerVehicle) ||
    fleet.seatsPerVehicle < 1 ||
    fleet.seatsPerVehicle > 20 ||
    !Number.isSafeInteger(fleet.batteryCapacityWh) ||
    fleet.batteryCapacityWh <= 0 ||
    !Number.isSafeInteger(fleet.energyWhPerKilometre) ||
    fleet.energyWhPerKilometre <= 0
  ) {
    issues.push(
      issue(
        "INVALID_FLEET_CONFIGURATION",
        "scenario.fleet",
        "Fleet counts, capacity, battery, and energy assumptions must use supported integer units.",
      ),
    );
  }
  if (!stableUnique(fleet.initialZoneWeights.map((entry) => entry.zoneId))) {
    issues.push(
      issue(
        "DUPLICATE_INITIAL_ZONE_WEIGHT",
        "scenario.fleet.initialZoneWeights",
        "Initial fleet zone weights must use unique zones.",
      ),
    );
  }
  if (fleet.initialZoneWeights.length === 0) {
    issues.push(
      issue(
        "EMPTY_INITIAL_ZONE_WEIGHTS",
        "scenario.fleet.initialZoneWeights",
        "Initial fleet distribution must include at least one zone weight.",
      ),
    );
  }
  for (let index = 0; index < fleet.initialZoneWeights.length; index += 1) {
    const entry = fleet.initialZoneWeights[index];
    if (!networkZoneIdSet.has(entry.zoneId) || entry.weight <= 0) {
      issues.push(
        issue(
          "INVALID_INITIAL_ZONE_WEIGHT",
          `scenario.fleet.initialZoneWeights[${index}]`,
          "Each initial fleet weight must reference a known zone and be positive.",
        ),
      );
    }
  }
  if (!stableUnique(input.scenario.objectives)) {
    issues.push(
      issue(
        "DUPLICATE_SCENARIO_OBJECTIVE",
        "scenario.objectives",
        "Scenario objectives must not be duplicated.",
      ),
    );
  }
  if (
    input.scenario.fleet.minimumReserveBasisPoints >
    input.scenario.fleet.startingBatteryBasisPoints
  ) {
    issues.push(
      issue(
        "RESERVE_ABOVE_STARTING_BATTERY",
        "scenario.fleet.minimumReserveBasisPoints",
        "Minimum reserve cannot exceed starting battery.",
      ),
    );
  }
  if (
    input.scenario.constraints.minimumBatteryReserveBasisPoints !==
    input.scenario.fleet.minimumReserveBasisPoints
  ) {
    issues.push(
      issue(
        "RESERVE_CONSTRAINT_MISMATCH",
        "scenario.constraints.minimumBatteryReserveBasisPoints",
        "Fleet and hard-constraint reserve values must match.",
      ),
    );
  }
  if (
    input.scenario.fleet.dwellSeconds % horizon.tickSeconds !== 0 ||
    input.scenario.fleet.dwellSeconds < 0
  ) {
    issues.push(
      issue(
        "DWELL_NOT_TICK_ALIGNED",
        "scenario.fleet.dwellSeconds",
        "Dwell time must be a non-negative multiple of the simulation tick.",
      ),
    );
  }

  if (!stableUnique(input.disruptions.map((disruption) => disruption.id))) {
    issues.push(
      issue(
        "DUPLICATE_DISRUPTION_ID",
        "disruptions",
        "Disruption IDs must be unique within a run input.",
      ),
    );
  }
  for (let index = 0; index < input.disruptions.length; index += 1) {
    const disruption = input.disruptions[index];
    if (
      disruption.atSecond < 0 ||
      disruption.atSecond >= horizon.durationSeconds ||
      disruption.atSecond % horizon.tickSeconds !== 0
    ) {
      issues.push(
        issue(
          "DISRUPTION_OUTSIDE_HORIZON",
          `disruptions[${index}].atSecond`,
          "Disruption time must be in-horizon and tick-aligned.",
        ),
      );
    }
    if (
      disruption.type !== "VEHICLE_FAILURE" ||
      disruption.target.kind !== "DETERMINISTIC_RULE" ||
      disruption.target.policyVersion !== "equivalent-vehicle-failure-v1" ||
      disruption.target.ranking.join("|") !==
        [
          "HIGHEST_ONBOARD_OCCUPANCY",
          "HIGHEST_RESERVED_PASSENGER_COUNT",
          "ACTIVE_SERVICE_FIRST",
          "ASCENDING_VEHICLE_ID",
        ].join("|")
    ) {
      issues.push(
        issue(
          "INVALID_DISRUPTION_POLICY",
          `disruptions[${index}].target`,
          "Vehicle failure must use the approved equivalent deterministic ranking.",
        ),
      );
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

export function prepareStressLabRunInput(input: StressLabRunInput): PreparedRunInput {
  const snapshot = isDeepFrozen(input) ? input : deepFreeze(clonePlain(input));
  const validation = validateStressLabRunInput(snapshot);
  if (!validation.valid) {
    const first = validation.issues[0];
    throw new StressLabInputValidationError(
      first.code,
      `${first.code}: invalid complete run input at ${first.path}: ${first.message}`,
    );
  }
  const fingerprintDocument = createFingerprintDocument("RUN_INPUT", snapshot);
  return deepFreeze({
    input: snapshot,
    canonicalJson: fingerprintDocument.canonicalJson,
    fingerprint: fingerprintDocument.fingerprint,
  });
}

export interface PrepareGoldenManifestInput {
  readonly networkFingerprint: Fingerprint;
  readonly presetFingerprint: Fingerprint;
  readonly demandFingerprint: Fingerprint;
  readonly seed: StressLabRunInput["seed"];
  readonly runInputFingerprints: Readonly<Record<ScenarioSlot, Fingerprint>>;
}

export function prepareGoldenExperimentManifest(
  input: PrepareGoldenManifestInput,
): {
  readonly manifest: GoldenExperimentInputManifest;
  readonly canonicalJson: string;
  readonly fingerprint: Fingerprint;
} {
  const manifest = deepFreeze({
    inputSchemaVersion: STRESS_LAB_INPUT_SCHEMA_VERSION,
    canonicalizationVersion: STRESS_LAB_CANONICALIZATION_VERSION,
    fingerprintVersion: STRESS_LAB_FINGERPRINT_VERSION,
    presetVersion: STRESS_LAB_PRESET_VERSION,
    presetFingerprint: input.presetFingerprint,
    networkVersion: STRESS_LAB_NETWORK_VERSION,
    networkFingerprint: input.networkFingerprint,
    demandGeneratorVersion: STRESS_LAB_DEMAND_GENERATOR_VERSION,
    demandFingerprint: input.demandFingerprint,
    seed: input.seed,
    runInputFingerprints: {
      A: input.runInputFingerprints.A,
      B: input.runInputFingerprints.B,
    },
  } satisfies GoldenExperimentInputManifest);
  const fingerprintDocument = createFingerprintDocument(
    "GOLDEN_EXPERIMENT_INPUT_MANIFEST",
    manifest,
  );
  return deepFreeze({
    manifest,
    canonicalJson: fingerprintDocument.canonicalJson,
    fingerprint: fingerprintDocument.fingerprint,
  });
}
