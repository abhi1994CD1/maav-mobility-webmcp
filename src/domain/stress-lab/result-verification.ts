import { canonicalJson } from "./canonical-json";
import {
  createFingerprintDocument,
  runResultIdentityValue,
  type FingerprintDocument,
  type RunResultIdentityInput,
} from "./fingerprint";
import {
  replayVerifiedEventLedger,
  replayVerifiedEventLedgerPrefix,
} from "./replay";
import { prepareStressLabRunInput } from "./run-input";
import {
  count,
  fingerprint,
  STRESS_LAB_ENGINE_VERSION,
  STRESS_LAB_EVENT_SCHEMA_VERSION,
  STRESS_LAB_METRIC_DEFINITION_VERSION,
  STRESS_LAB_RESULT_SCHEMA_VERSION,
  STRESS_LAB_TICK_SEMANTICS_VERSION,
  StressLabArtifactVerificationError,
  type EventLedgerEnvelope,
  type PassengerLifecycleState,
  type PreparedRunInput,
  type RunResultArtifact,
  type SimulationSnapshot,
  type SimulationState,
  type SimulationTerminalState,
  type VerifiedRunResultArtifact,
} from "./types";

const RESULT_ARTIFACT_KEYS = Object.freeze([
  "resultSchemaVersion",
  "eventSchemaVersion",
  "inputFingerprint",
  "engineVersion",
  "tickSemanticsVersion",
  "controllerId",
  "controllerVersion",
  "metricDefinitionVersion",
  "eventLedgerFingerprint",
  "snapshots",
  "terminalState",
  "metrics",
  "constraints",
  "canonicalResultJson",
  "resultFingerprint",
] as const);

const verifiedRunResultArtifacts = new WeakSet<object>();

function fail(path: string, message: string): never {
  throw new StressLabArtifactVerificationError(path, message);
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "Expected a plain object.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, "Expected a plain object.");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = plainRecord(value, path);
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) fail(`${path}.${key}`, "Unexpected property.");
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      fail(`${path}.${key}`, "Missing required property.");
    }
  }
  return record;
}

function assertDenseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(path, "Expected an array.");
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail(`${path}[${index}]`, "Sparse array entries are not allowed.");
    }
  }
  for (const key of Object.keys(value)) {
    if (!/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      fail(`${path}.${key}`, "Unexpected array property.");
    }
  }
  return value;
}

function clonePlain<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map((entry) => clonePlain(entry)) as Value;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = clonePlain((value as Record<string, unknown>)[key]);
    }
    return clone as Value;
  }
  return value;
}

function cloneWithoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneWithoutUndefined(entry));
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) clone[key] = cloneWithoutUndefined(entry);
    }
    return clone;
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

function firstMismatchPath(
  expected: unknown,
  actual: unknown,
  path: string,
): string | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return path;
    if (expected.length !== actual.length) return `${path}.length`;
    for (let index = 0; index < expected.length; index += 1) {
      const mismatch = firstMismatchPath(
        expected[index],
        actual[index],
        `${path}[${index}]`,
      );
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return path;
  }
  const expectedRecord = expected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  const expectedKeys = Object.keys(expectedRecord).sort();
  const actualKeys = Object.keys(actualRecord).sort();
  const allKeys = [...new Set([...expectedKeys, ...actualKeys])].sort();
  for (const key of allKeys) {
    if (!Object.prototype.hasOwnProperty.call(expectedRecord, key)) {
      return `${path}.${key}`;
    }
    if (!Object.prototype.hasOwnProperty.call(actualRecord, key)) {
      return `${path}.${key}`;
    }
    const mismatch = firstMismatchPath(
      expectedRecord[key],
      actualRecord[key],
      `${path}.${key}`,
    );
    if (mismatch) return mismatch;
  }
  return undefined;
}

function assertCanonicalEqual(
  expected: unknown,
  actual: unknown,
  path: string,
  message: string,
): void {
  let equal = false;
  try {
    equal = canonicalJson(expected) === canonicalJson(actual);
  } catch {
    fail(path, `${message} The supplied value is not canonicalizable.`);
  }
  if (!equal) {
    fail(firstMismatchPath(expected, actual, path) ?? path, message);
  }
}

function passengerCounts(state: SimulationState): Record<PassengerLifecycleState, number> {
  const values: Record<PassengerLifecycleState, number> = {
    NOT_ARRIVED: 0,
    WAITING: 0,
    RESERVED: 0,
    ONBOARD: 0,
    RECOVERY_WAIT: 0,
    SERVED: 0,
  };
  for (const passenger of state.passengers) values[passenger.state] += 1;
  return values;
}

function snapshotFromReplay(
  prepared: PreparedRunInput,
  state: SimulationState,
  atSecond: number,
  throughEventSequence: number,
): SimulationSnapshot {
  const zoneQueueCounts: Record<string, number> = {};
  for (const zone of prepared.input.network.zones) zoneQueueCounts[zone.id] = 0;
  for (const passenger of state.passengers) {
    if (
      (passenger.state === "WAITING" || passenger.state === "RECOVERY_WAIT") &&
      passenger.currentZoneId
    ) {
      zoneQueueCounts[passenger.currentZoneId] += 1;
    }
  }
  return {
    atSecond: atSecond as SimulationSnapshot["atSecond"],
    throughEventSequence: count(throughEventSequence),
    vehicles: cloneWithoutUndefined(state.vehicles) as SimulationSnapshot["vehicles"],
    passengerCounts: passengerCounts(state) as SimulationSnapshot["passengerCounts"],
    zoneQueueCounts: zoneQueueCounts as SimulationSnapshot["zoneQueueCounts"],
    appliedDisruptionIds: [...state.appliedDisruptionIds],
    recoveryCompletedDisruptionIds: [...state.recoveryCompletedDisruptionIds],
  };
}

function terminalStateFromReplay(state: SimulationState): SimulationTerminalState {
  return cloneWithoutUndefined({
    atSecond: state.atSecond,
    passengers: state.passengers,
    vehicles: state.vehicles,
    appliedDisruptionIds: state.appliedDisruptionIds,
    recoveryCompletedDisruptionIds: state.recoveryCompletedDisruptionIds,
  }) as SimulationTerminalState;
}

function validateResultIdentity(
  prepared: PreparedRunInput,
  ledger: EventLedgerEnvelope,
  artifact: RunResultArtifact,
): void {
  assertExactKeys(artifact, RESULT_ARTIFACT_KEYS, "result");
  fingerprint(String(artifact.inputFingerprint));
  fingerprint(String(artifact.eventLedgerFingerprint));
  fingerprint(String(artifact.resultFingerprint));
  if (
    artifact.resultSchemaVersion !== STRESS_LAB_RESULT_SCHEMA_VERSION ||
    artifact.eventSchemaVersion !== STRESS_LAB_EVENT_SCHEMA_VERSION ||
    artifact.engineVersion !== STRESS_LAB_ENGINE_VERSION ||
    artifact.tickSemanticsVersion !== STRESS_LAB_TICK_SEMANTICS_VERSION ||
    artifact.metricDefinitionVersion !== STRESS_LAB_METRIC_DEFINITION_VERSION
  ) {
    fail("result", "Result schema or semantic version is unsupported.");
  }
  if (
    artifact.inputFingerprint !== prepared.fingerprint ||
    artifact.inputFingerprint !== ledger.inputFingerprint ||
    artifact.eventLedgerFingerprint !== ledger.fingerprint ||
    artifact.controllerId !== ledger.controllerId ||
    artifact.controllerVersion !== ledger.controllerVersion ||
    artifact.engineVersion !== ledger.engineVersion ||
    artifact.tickSemanticsVersion !== ledger.tickSemanticsVersion ||
    artifact.eventSchemaVersion !== ledger.eventSchemaVersion
  ) {
    fail("result", "Result provenance does not match the verified input and ledger.");
  }
  if (typeof artifact.canonicalResultJson !== "string") {
    fail("result.canonicalResultJson", "Expected canonical result JSON.");
  }
}

function expectedThroughEventSequence(
  ledger: EventLedgerEnvelope,
  atSecond: number,
): number {
  const events = ledger.events.filter(
    (event) => event.atSecond <= atSecond && event.type !== "RUN_COMPLETED",
  );
  const last = events.at(-1);
  if (!last) fail("eventLedger.events", `No replay prefix exists for second ${atSecond}.`);
  const tickEvents = ledger.events.filter(
    (event) => event.type === "TICK_OBSERVED" && event.atSecond === atSecond,
  );
  if (tickEvents.length !== 1) {
    fail(
      "eventLedger.events",
      `Second ${atSecond} must contain exactly one tick observation.`,
    );
  }
  return last.sequence;
}

function verifySnapshots(
  prepared: PreparedRunInput,
  ledger: EventLedgerEnvelope,
  snapshotsValue: readonly SimulationSnapshot[],
): void {
  const snapshots = assertDenseArray(snapshotsValue, "result.snapshots") as
    readonly SimulationSnapshot[];
  const { tickSeconds } = prepared.input.horizon;
  const terminalSecond = prepared.input.terminalEvaluationSecond;
  const expectedSeconds = Array.from(
    { length: terminalSecond / tickSeconds + 1 },
    (_, index) => index * tickSeconds,
  );
  if (snapshots.length !== expectedSeconds.length) {
    fail(
      "result.snapshots.length",
      `Expected ${expectedSeconds.length} complete tick snapshots.`,
    );
  }
  for (let index = 0; index < expectedSeconds.length; index += 1) {
    const supplied = snapshots[index];
    const atSecond = expectedSeconds[index];
    if (!supplied || supplied.atSecond !== atSecond) {
      fail(
        `result.snapshots[${index}].atSecond`,
        `Expected snapshot second ${atSecond}.`,
      );
    }
    const expectedSequence = expectedThroughEventSequence(ledger, atSecond);
    if (supplied.throughEventSequence !== expectedSequence) {
      fail(
        `result.snapshots[${index}].throughEventSequence`,
        `Snapshot second ${atSecond} uses the wrong same-second ledger prefix.`,
      );
    }
    const replayed = replayVerifiedEventLedgerPrefix(
      prepared,
      ledger,
      expectedSequence,
    );
    if (replayed.atSecond !== atSecond) {
      fail(
        `result.snapshots[${index}].atSecond`,
        `Verified replay did not reach snapshot second ${atSecond}.`,
      );
    }
    const expected = snapshotFromReplay(
      prepared,
      replayed,
      atSecond,
      expectedSequence,
    );
    assertCanonicalEqual(
      expected,
      supplied,
      `result.snapshots[${index}]`,
      `Snapshot second ${atSecond} disagrees with its verified ledger prefix.`,
    );
  }
}

function createVerifiedDocument(
  prepared: PreparedRunInput,
  ledger: EventLedgerEnvelope,
  artifact: RunResultArtifact,
): FingerprintDocument {
  const validatedPrepared = prepareStressLabRunInput(prepared.input);
  if (
    validatedPrepared.fingerprint !== prepared.fingerprint ||
    validatedPrepared.canonicalJson !== prepared.canonicalJson
  ) {
    fail("input", "Prepared run-input identity is invalid.");
  }
  validateResultIdentity(validatedPrepared, ledger, artifact);
  const replayedTerminal = replayVerifiedEventLedger(validatedPrepared, ledger);
  verifySnapshots(validatedPrepared, ledger, artifact.snapshots);
  const terminalSecond = validatedPrepared.input.terminalEvaluationSecond;
  const terminalSequence = expectedThroughEventSequence(ledger, terminalSecond);
  assertCanonicalEqual(
    snapshotFromReplay(
      validatedPrepared,
      replayedTerminal,
      terminalSecond,
      terminalSequence,
    ),
    artifact.snapshots.at(-1),
    `result.snapshots[${artifact.snapshots.length - 1}]`,
    "Terminal snapshot disagrees with the fully replayed terminal state.",
  );
  assertCanonicalEqual(
    terminalStateFromReplay(replayedTerminal),
    artifact.terminalState,
    "result.terminalState",
    "Terminal state disagrees with the fully verified ledger.",
  );
  return createFingerprintDocument(
    "RUN_RESULT_EVIDENCE",
    runResultIdentityValue(artifact satisfies RunResultIdentityInput),
  );
}

/**
 * Public trust boundary for an externally supplied result artifact. A valid
 * hash is necessary but insufficient: input, ledger, every snapshot prefix,
 * terminal state, canonical bytes, and final identity must all agree.
 */
export function verifyTrustedSimulationResult(
  prepared: PreparedRunInput,
  ledger: EventLedgerEnvelope,
  artifact: RunResultArtifact,
): VerifiedRunResultArtifact {
  const document = createVerifiedDocument(prepared, ledger, artifact);
  if (artifact.canonicalResultJson !== document.canonicalJson) {
    fail(
      "result.canonicalResultJson",
      "Canonical result bytes do not match the verified result document.",
    );
  }
  if (artifact.resultFingerprint !== document.fingerprint) {
    fail(
      "result.resultFingerprint",
      "Result fingerprint does not match the verified result document.",
    );
  }
  const verified = deepFreeze(
    clonePlain(artifact),
  ) as VerifiedRunResultArtifact;
  verifiedRunResultArtifacts.add(verified);
  return verified;
}

/**
 * Runtime companion to the compile-time VerifiedRunResultArtifact brand.
 * Serialized or copied artifacts must pass verifyTrustedSimulationResult again;
 * a cast or a matching hash alone does not create trusted comparison evidence.
 */
export function isVerifiedRunResultArtifact(
  value: unknown,
): value is VerifiedRunResultArtifact {
  return (
    value !== null &&
    typeof value === "object" &&
    verifiedRunResultArtifacts.has(value)
  );
}
