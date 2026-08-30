# MAAV Stress Lab WebMCP Contracts

## Status and target

This document owns the future Stress Lab public WebMCP contract. Gate 1 changes
documentation only; the current runtime tools remain superseded baseline
behavior until Gate 2 and later implementation gates replace them.

Target Google Chrome 150:

- use the imperative `document.modelContext` API, never
  `navigator.modelContext`;
- use official `webmcp-types` TypeScript declarations;
- define `name`, `title`, concise `description`, JSON `inputSchema`,
  `annotations`, and `execute(input, { signal })`;
- validate unknown input again with strict Zod schemas;
- propagate the invocation `AbortSignal`;
- do not invent `outputSchema`.

## Exact static catalog

Register exactly these six tools once after the canonical lab store is ready:

1. `read_lab_state`
2. `configure_scenario`
3. `run_scenario`
4. `inject_disruption`
5. `compare_scenarios`
6. `stage_finding`

All six remain discoverable throughout the application lifecycle. The UI may
show each as Ready or Blocked, but the catalog does not change with state.
Application-level prerequisites, revisions, compatibility, and stale-evidence
checks remain authoritative even when an agent invokes a tool prematurely.

There is no public tool for human review, deterministic Reset, evidence
deletion, real-world execution, dispatch, arbitrary state mutation, or asking a
question.

## Adapter contract

Every adapter remains thin:

```text
strictly validate unknown input
  -> attach trusted WEBMCP actor/source context
  -> call the shared application service
  -> return a compact serializable envelope
  -> expose best-effort visible activity
```

An adapter must not calculate KPIs, modify Zustand directly, call Google to
determine results, select or Accept a finding, invent evidence, reflect raw
prompts, or perform a real-world action.

## Shared conventions

### Revisions

Every mutating tool requires `expectedRevision`. A successful mutation
increments the workspace revision exactly once. A stale request returns
`REVISION_CONFLICT`, the current revision, and `read_lab_state` as its safe
next action without mutation.

### Operation IDs and idempotency

Every mutating tool requires a bounded opaque `operationId`.

- same ID + same tool + same canonical arguments returns the original terminal
  result with `status: "REUSED"`;
- same ID with a different tool or arguments returns
  `IDEMPOTENCY_CONFLICT`;
- no retry may create duplicate scenario revisions, runs, disruptions,
  comparisons, or findings;
- a corrected or cancelled operation is retried with a new operation ID.

### Common success envelope

```json
{
  "ok": true,
  "operationId": "op-run-a-001",
  "stateRevision": 18,
  "status": "COMPLETED",
  "artifactId": "run-A-014",
  "summary": {},
  "nextActions": ["compare_scenarios"]
}
```

`operationId` and `artifactId` are omitted when they do not apply to the
read-only query. `summary` is bounded and never contains the full event
ledger. The UI provides detailed evidence inspection by artifact ID.

### Common business-error envelope

```json
{
  "ok": false,
  "operationId": "op-run-a-001",
  "stateRevision": 18,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The experiment changed after it was inspected.",
    "retryable": true,
    "field": "expectedRevision",
    "currentRevision": 18,
    "nextAction": "read_lab_state"
  }
}
```

Optional `field`, `currentRevision`, `missingFields`, and
`decisionPoints` appear only when useful. Errors never contain stack traces,
keys, browser storage, raw prompts, arbitrary reflected identifiers, or partial
success disguised as failure.

Stable H0 error codes include:

```text
INVALID_ARGUMENTS
NEEDS_CLARIFICATION
INVALID_CONFIGURATION
PREREQUISITE_NOT_MET
REVISION_CONFLICT
IDEMPOTENCY_CONFLICT
SCENARIO_REVISION_NOT_FOUND
RUN_NOT_FOUND
RUN_NOT_COMPLETED
STALE_RUN
INCOMPARABLE_RUNS
OUTSIDE_HORIZON
DISRUPTION_TARGET_NOT_FOUND
OPERATION_CANCELLED
ENGINE_INVARIANT_FAILED
INTERNAL_ERROR
```

## Strict shared configuration shape

The public scenario boundary normalizes a complete replacement or bounded patch
into this H0 configuration:

```ts
type ScenarioConfiguration = {
  label: string; // 1–48 plain-text characters
  fleet: {
    vehicleCount: number;           // integer 0–30
    seatsPerVehicle: number;        // integer 1–20
    batteryCapacityKWh: number;     // bounded positive fixture-supported value
    startingBatteryPercent: number; // 0–100
    minimumReservePercent: number;  // 0–100 and <= starting battery
    energyKWhPerKm: number;         // bounded positive authored assumption
    dwellSeconds: number;           // non-negative multiple of 30
    initialZoneWeights: Record<string, number>;
  };
  constraints: {
    maximumWaitSeconds: number;
    maximumUnservedPassengers: number;
    minimumBatteryReservePercent: number;
    maximumRecoverySeconds: number;
    standingAllowed: false;
  };
  objectives: Array<
    | "LOWER_WAIT"
    | "LOWER_ENERGY_PER_PASSENGER_KM"
    | "HIGHER_UTILIZATION"
    | "FASTER_RECOVERY"
    | "LOWER_EMPTY_KM"
  >;
};
```

The schema rejects unknown fields, non-finite values, arbitrary URLs, HTML,
JavaScript, expressions, raw prompts, and caller-supplied KPI claims.

## 1. `read_lab_state`

Purpose: inspect the current experiment revision, scenario/run summaries,
constraints, disruptions, stale/current status, readiness, and valid or blocked
next actions.

Input:

```ts
{
  scope?: "SUMMARY" | "SCENARIO" | "RUN" | "COMPARISON" | "FINDING";
  objectId?: string;
}
```

Prerequisites: the canonical lab store is loaded. It succeeds regardless of
which later artifacts exist.

Authoritative output:

- current workspace revision;
- engine, network, metric, demand, horizon, and seed identity;
- active A/B scenario revision IDs;
- compact current/historical run, comparison, and finding status;
- active disruption specifications;
- hard constraints;
- map and WebMCP readiness;
- blocked and valid next actions;
- explicit synthetic-data disclosure.

It does not return the full ledger, internal state, keys, raw Google context, or
raw activity prompts.

Visible effect: highlight/focus the requested artifact through ephemeral UI
state. No workspace revision change.

Annotations:

```json
{ "readOnlyHint": true, "untrustedContentHint": true }
```

`untrustedContentHint` is true because compact state may contain bounded
human-authored scenario labels.

## 2. `configure_scenario`

Purpose: create an immutable Scenario A or B revision from a complete
configuration or documented bounded patch.

Input:

```ts
{
  operationId: string;
  expectedRevision: number;
  slot: "A" | "B";
  mode: "REPLACE" | "PATCH";
  configuration: ScenarioConfiguration | BoundedScenarioPatch;
}
```

Prerequisites:

- expected workspace revision is current;
- target slot has no conflicting active mutation;
- patch fields are documented and the normalized complete configuration is
  valid.

Authoritative output:

- immutable scenario revision ID and input fingerprint;
- normalized assumptions and constraints;
- validation warnings;
- difference summary against the prior revision;
- invalidated dependent artifact IDs;
- current valid next actions.

Visible effect: populate the selected scenario, render validation/differences,
and refresh authored map projections. No simulation result is implied.

Annotations:

```json
{ "readOnlyHint": false, "untrustedContentHint": true }
```

The normalized result may contain the bounded human-authored scenario label.

## 3. `run_scenario`

Purpose: execute one immutable scenario revision through the deterministic
30-second engine and commit one terminal run artifact.

Input:

```ts
{
  operationId: string;
  expectedRevision: number;
  scenarioRevisionId: string;
}
```

Prerequisites:

- current expected revision;
- referenced scenario revision exists and is valid;
- no conflicting active run for the target slot;
- immutable engine, network, shared demand, horizon, seed, and disruption inputs
  can be captured.

Authoritative output:

- run ID and terminal status;
- engine/network/input/result fingerprints;
- compact service, capacity, wait, distance, energy, battery, recovery, and
  hard-constraint summary;
- event/snapshot counts and evidence IDs;
- valid next actions.

The tool does not wait for visual playback. Playback projects stored evidence.

Visible effect: show genuine pending/running/cancelled/completed activity, then
commit metrics and timeline only after successful artifact commit.

Annotations:

```json
{ "readOnlyHint": false, "untrustedContentHint": false }
```

Cancellation: propagate `execute(input, { signal })` through the service and
tick loop. Cancellation produces no completed KPI set or later ghost commit.

## 4. `inject_disruption`

Purpose: create a new scenario revision with one synthetic H0 vehicle failure.

Input:

```ts
{
  operationId: string;
  expectedRevision: number;
  scenarioRevisionId: string;
  disruption: {
    type: "VEHICLE_FAILURE";
    target:
      | { kind: "VEHICLE_ID"; vehicleId: string }
      | {
          kind: "DETERMINISTIC_RULE";
          rule: "HIGHEST_OCCUPANCY_THEN_VEHICLE_ID";
        };
    atSecond: number;
  };
}
```

For the golden experiment, `atSecond: 720` means 08:42 and the deterministic
rule additionally applies the documented reserved-passenger and active-service
tie-breaks before ascending vehicle ID.

Prerequisites:

- current expected revision;
- referenced scenario revision exists;
- disruption time is inside the immutable horizon;
- target or rule is valid;
- the command does not rewrite an active or completed run.

Authoritative output:

- new immutable scenario revision and disruption IDs;
- disruption fingerprint and normalized meaning;
- invalidated/currentness effects;
- validation result and valid next actions.

Call once for Scenario A and once for Scenario B to apply the equivalent stress
treatment. The service records the vehicle resolved independently during each
run.

Visible effect: add the authored incident specification and mark dependent
current evidence stale. The timeline/map event becomes evidence only after a
run emits it.

Annotations:

```json
{ "readOnlyHint": false, "untrustedContentHint": false }
```

## 5. `compare_scenarios`

Purpose: compare exactly two explicit current completed run artifacts after a
strict compatibility check.

Input:

```ts
{
  operationId: string;
  expectedRevision: number;
  runAId: string;
  runBId: string;
}
```

Prerequisites:

- current expected revision;
- run A belongs to slot A and run B to slot B;
- both completed and are current;
- equal engine, network, demand fingerprint, seed, horizon, tick, metric
  version, and equivalent disruption policy.

Authoritative output:

- comparison ID, compatibility class, evidence hash, and configuration
  differences;
- hard-constraint matrix;
- service, capacity, wait, distance, energy, battery, and recovery A/B values
  plus defined deltas;
- caveats and valid next actions.

An incompatible pair returns `INCOMPARABLE_RUNS`. It may be inspected in the
UI, but the tool creates no authoritative deltas, winner, or finding-ready
artifact. No opaque composite score is produced.

Visible effect: open synchronized comparison mode across metrics, evidence,
timeline, and map/fallback context.

Annotations:

```json
{ "readOnlyHint": false, "untrustedContentHint": true }
```

The configuration-difference summary may include bounded human-authored labels.

## 6. `stage_finding`

Purpose: stage a bounded evidence-backed interpretation from one current
comparison for human review.

Input:

```ts
{
  operationId: string;
  expectedRevision: number;
  comparisonId: string;
  selectedOutcome: "A" | "B" | "TRADE_OFF" | "INCONCLUSIVE";
  emphasis: "BALANCED" | "SERVICE" | "ENERGY" | "RESILIENCE";
}
```

Prerequisites:

- current expected revision;
- comparison exists, is compatible, and is current;
- selected outcome and emphasis are supported;
- no caller-supplied metric number or unsupported claim is accepted.

Authoritative output:

- pending-review finding ID;
- comparison and evidence hashes;
- at most three engine-generated claims with metric keys, values, evidence IDs,
  hard-constraint context, and caveats;
- synthetic-simulation disclosure;
- human review as the next action.

Visible effect: open the finding review surface labelled
`AGENT DRAFT • PENDING HUMAN REVIEW`.

Annotations:

```json
{ "readOnlyHint": false, "untrustedContentHint": false }
```

The tool cannot change the finding to Accepted or Challenged and cannot execute
any operational action.

## Clarification without a seventh tool

When a semantically essential choice is missing, return
`NEEDS_CLARIFICATION` instead of guessing:

```json
{
  "ok": false,
  "operationId": "op-disrupt-001",
  "stateRevision": 12,
  "error": {
    "code": "NEEDS_CLARIFICATION",
    "message": "The disruption scope is ambiguous.",
    "retryable": true,
    "missingFields": ["scenarioRevisionId"],
    "decisionPoints": [
      {
        "field": "scenario",
        "question": "Apply the equivalent failure to Scenario A, Scenario B, or both?",
        "allowedValues": ["A", "B", "BOTH"],
        "recommended": "BOTH"
      }
    ],
    "nextAction": "ASK_HUMAN_THEN_RETRY"
  }
}
```

The browser agent asks the human and retries with corrected arguments and a new
operation ID. Decision points are bounded; the application never returns an
open-ended instruction-execution channel.

## Static registration lifecycle

One bridge and central registry own all six registrations and their registration
`AbortController` values. React Strict Mode, remount, and route changes must
not duplicate registrations.

- Register the catalog once after store initialization.
- State mutations never reconcile a different tool set.
- Unregister only during authoritative bridge teardown.
- Track in-flight callbacks and do not abort a registration while its invocation
  is running or its result is settling.
- Application prerequisites protect every consequential call regardless of
  registry timing.
- The registration controller is distinct from the invocation cancellation
  signal.

## Stale, incompatible, and late evidence

- Editing a scenario creates a new revision and marks dependent current
  artifacts stale; old artifacts remain immutable.
- A stale run cannot create a current comparison.
- An incompatible comparison cannot produce authoritative deltas or a finding.
- A finding whose comparison is stale cannot be accepted as current evidence.
- A late run result cannot overwrite newer current state. Final compare-and-swap
  determines whether it commits, is retained as explicit history, or is
  discarded safely.

## Human review boundary

The browser agent may inspect, configure, run, disrupt, compare, and stage. Only
visible UI controls may Accept, Challenge, or deterministically Reset.

This is an explicit prototype workflow boundary, not a cryptographic identity or
authorization claim. Tool annotations are hints, never authorization.

## Security and content handling

- Expose tools only from the secure origin-isolated top-level application
  document permitted by the `tools` Permissions Policy.
- Do not set `document.domain` or delegate cross-origin iframe access.
- Bound all strings and render them as text.
- Do not accept arbitrary URLs, HTML, JavaScript, expressions, prompts, or
  claimed evidence values.
- Log sanitized structured arguments and fingerprints, not the browser-agent
  conversation.
- Never return Google keys, raw Google prose, browser storage, stack traces, or
  full event ledgers.
- A hostile scenario label cannot alter authority, registration, tool order, or
  evidence.

## Agent evaluation contract

Release evidence must cover:

- exact six-tool discovery with no duplicates;
- golden configure/disrupt/run/compare/stage completion;
- valid arguments across direct prompts and paraphrases;
- structured recovery from invalid input;
- clarification for essential ambiguity;
- revision and idempotency conflicts;
- cancellation without ghost artifacts;
- stale and incompatible evidence rejection;
- 100% grounding of displayed numeric claims;
- zero agent-created finding acceptances;
- complete manual behavior when WebMCP is unavailable.
