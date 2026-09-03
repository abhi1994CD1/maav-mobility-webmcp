# MAAV Stress Lab Deterministic Simulation Contract

## Status and purpose

This document owns H0 simulation rules, event evidence, metric definitions,
hard constraints, fingerprints, cancellation, invariants, and model
limitations.

The H0 runtime implements the headless `v2` run contract described here. This
document contains no preferred-scenario constant or claim that the H0 outcome
has been calibrated. Application orchestration, UI, WebMCP, comparison, and
finding layers consume this contract without changing its evidence.

The engine is a bounded deterministic experiment model, not a general transport
simulator, optimizer, machine-learning system, or real-world predictor.

## Canonical experiment inputs

| Input | H0 contract |
|---|---|
| Network | `sandton-rosebank-v1`, versioned synthetic fixture |
| Run input | `run-input-schema-v2` / `morning-peak-resilience-v2` |
| Engine | `maav-sim-v2` |
| Tick semantics | `maav-30-second-tick-v2` |
| Event/result schemas | `event-schema-v2` / `simulation-result-schema-v2` |
| Metric definitions | `stress-lab-metrics-v2` |
| Intake window | 08:30:00–09:00:00, seconds `0 <= t < 1800` |
| Terminal evaluation | second `1980` |
| Tick | 30 simulated seconds |
| Passenger demand | exactly 120 individual synthetic requests |
| Seed | integer 7, displayed as `07` |
| Scenario A | 12 vehicles × 8 seats |
| Scenario B | 10 vehicles × 10 seats |
| Maximum wait | 180 seconds |
| Minimum reserve | 20% |
| Standing | prohibited |
| Disruption | equivalent vehicle failure at 08:42 in each scenario |

Starting battery, capacity in watt-hours, energy per kilometre, dwell time,
initial zone weights, OD weights, recovery transfer delay, additional hard
constraints, and rounding rules must be explicit fixture values and visible in
the assumptions UI. They may not be silently tuned after evidence capture.

## Deterministic truth boundary

The engine owns:

- passenger request generation and arrival;
- vehicle initialization, assignment, movement, occupancy, and service;
- battery state and energy consumption;
- disruption target resolution, failure, requeue, and recovery;
- event ledger and replay snapshots;
- final metrics and hard-constraint evaluation;
- comparison evidence inputs;
- supported finding claim values.

The following never change engine output:

- browser-agent prose or LLM calculation;
- Google Maps, Routes, traffic, Places, or map availability;
- map camera, selection, layers, marker interpolation, or renderer;
- animation frame timing or playback speed;
- wall-clock timestamps, run IDs, operation IDs, or activity durations.

Prewritten KPI tables, scenario-specific winner branches, and map-derived
distance or travel time are forbidden.

## Fixed authored network

`sandton-rosebank-v1` is a small connected directed network of named zones.
Every supported directed edge records:

- stable edge, origin, and destination IDs;
- positive integer distance in metres;
- positive integer travel time in seconds divisible by 30;
- stable path-zone IDs;
- authored display coordinates/polyline used only for presentation.

Build-time fixture validation must prove:

- IDs are unique;
- values are finite and in authored bounds;
- every passenger OD pair is reachable;
- reverse connections exist where bidirectionality is promised;
- coordinates are within the fixed corridor bounds;
- every travel time aligns with the engine tick;
- the fixture fingerprint is stable.

Route selection is deterministic. Prefer the shortest authored travel time, then
distance, then lexical path signature. Google route responses are never queried
during a run and never replace these values.

The domain type accepts any runtime-validated stable ASCII network-version ID;
it has no Sandton allowlist. The run input's declared network version must equal
the embedded fixture version. The network fixture schema remains
`stress-lab-input-schema-v1`, so widening the version boundary does not alter
the canonical bytes or fingerprint of `sandton-rosebank-v1`. The permanent
`tiny-triangle-v1` conformance fixture proves that the same engine runs different
zone IDs, topology, distances, travel times, fleet, battery, and disruption data.

## Shared seed-07 passenger trace

Generate the demand trace once per clean experiment and share the exact object
and fingerprint between A and B.

Each request contains:

```ts
{
  id: "P-001";
  arrivalSecond: number; // tick-aligned within the horizon
  originZoneId: string;
  destinationZoneId: string;
}
```

Rules:

1. Use one explicitly implemented and versioned seeded PRNG.
2. Never call `Math.random()`.
3. Generate exactly 120 requests from disclosed temporal and OD weights.
4. Reject identical or unreachable origin/destination pairs.
5. Quantize arrivals to 30-second ticks.
6. Stable-sort by `arrivalSecond`, then passenger ID.
7. Preserve the trace fingerprint with every run.

Same fixture and seed produce a deep-equal trace. A supported different seed
must change at least one request and the fingerprint.

## Stable entity ordering

- Scenario vehicle IDs are derived from slot and ordinal, for example
  `A-01` through `A-12`.
- Passenger IDs are `P-001` through `P-120`.
- Vehicle loops use ascending vehicle ID.
- Passenger boarding uses request time then passenger ID.
- Disruptions use stable disruption ID.
- Events use simulated second then explicit sequence.
- Sorting is lexical/code-point based and never locale-sensitive.

Object insertion order must not affect a ledger or fingerprint.

## 30-second step model

Passenger intake and terminal evaluation are separate. Intake covers seconds
`0` through `1770`; no request is released at or after second `1800`. The latest
contractual request therefore has an inclusive boarding deadline of second
`1950`. The engine observes ticks `0, 30, ..., 1980`, producing exactly
`(1980 / 30) + 1 = 67` replay snapshots. It never shortens this boundary using
the actual maximum arrival in one generated trace.

A pure step receives immutable state and returns a new state plus events:

```ts
stepSimulation(
  state: SimulationState,
  atSecond: number,
  context: SimulationContext
): StepResult
```

The versioned `maav-30-second-tick-v2` order is:

1. record the tick observation;
2. apply scheduled disruptions in disruption-ID order;
3. account each active leg through the tick using completed-edge totals plus
   current-edge progress, then settle complete travel legs and record arrivals;
4. complete dwell actions: board reserved passengers, then depart when allowed;
5. alight passengers from service arrivals and mark them served;
6. release disruption-affected passengers whose transfer delay elapsed;
7. release passenger requests arriving at the tick while intake is open;
8. build a causal controller observation, resolve intents in stable lexical
   order, validate each intent, then apply or reject it atomically;
9. at the terminal tick, settle only operations whose `startSecond < 1980` and
   `completionSecond <= 1980`; do not invoke the controller or start any new
   reservation, assignment, boarding/dwell, recovery, route, or departure;
10. check invariants and record the compact replay snapshot.

A pre-started boarding/dwell operation owns an immutable passenger manifest.
Its completion may board that manifest at second `1980`, but a reservation by
itself is not a boarding operation and cannot board at the terminal boundary.
A pre-started recovery or travel may also complete at `1980`; work due at
`2010` remains incomplete. A disruption wins over a travel or dwell completion
on the same tick. Wait
evidence is folded after the ledger is complete. Boarding at exactly
`arrivalSecond + 180` is on time because the check is inclusive; the boarding
phase therefore establishes the evidence before any maximum-wait result is
published. Changing this order changes the tick-semantics and engine versions.

## Passenger lifecycle

At each simulated instant, every request is in exactly one state:

```text
NOT_ARRIVED
  -> WAITING
  -> RESERVED
  -> ONBOARD
  -> SERVED
```

A failure may move `RESERVED` or `ONBOARD` passengers into a bounded
`RECOVERY_WAIT` state before they return to `WAITING`. The original request
time, boarding time, deadline, and identity remain unchanged.

At second `1980`, every passenger has exactly one terminal outcome independent
of maximum-wait compliance:

- `SERVED`: alighted at the destination;
- `IN_SERVICE_AT_HORIZON`: currently onboard, dwelling onboard, travelling in
  service, waiting inside a started recovery transfer, or assigned within an
  active recovery pickup/boarding operation;
- `UNSERVED`: neither completed nor under active service/recovery, including a
  previously boarded passenger who is stranded or requeued without active
  recovery.

The conservation identity is
`requested = served + inServiceAtHorizon + unserved`. A late passenger may be
served or in service and still fail the wait SLA. A passenger boarded at second
`1950` but travelling at `1980` is in service, never unserved.

No passenger may board before arrival, occupy two states, exceed one seat, or be
served twice.

## Transparent dispatch policy and authority

H0 uses one policy, `oldest-wait-nearest-idle-v1`, behind the narrow synchronous
`DispatchControllerV1` domain port. The engine supplies a deeply immutable and
independently cloned
`ControllerObservationV1` containing only the current second, visible vehicles,
currently eligible passengers, static authored topology, applicable
constraints/fleet parameters, and already-active disruption IDs. It contains no
not-yet-arrived demand, future disruption schedule, complete run input, future
event, KPI, final state, or Scenario A/B result. Every nested edge/path,
passenger, reservation, active-leg, per-edge, and boarding-manifest container
is copied before deep-freezing; no observation reference aliases run input or
engine state.

The controller proposes typed `DispatchIntentV1` values; it never mutates state.
The engine sorts intents by a stable lexical key and remains the sole authority
for topology, eligibility, capacity, and reserve checks. An intent either
commits all passenger and vehicle changes or commits none. Rejection emits one
typed `ACTION_REJECTED` event with a stable reason such as
`CAPACITY_EXCEEDED` or `RESERVE_INFEASIBLE`.

The reference policy is:

1. An idle vehicle first considers waiting passengers at its current zone.
2. Choose the destination group whose oldest request has waited longest.
3. Break group ties with destination ID.
4. Freeze a capacity-bounded batch in request-time then passenger-ID order.
5. If no passenger waits locally, find the globally oldest waiting request.
6. Rank feasible idle vehicles by predicted pickup time, empty distance,
   remaining battery, then vehicle ID.
7. Dispatch the first vehicle whose complete mission is reserve-feasible.
8. When one group is energy-infeasible, continue deterministically to other
   eligible groups rather than inventing service.

No standing, mixed-destination ride pooling, charging, repositioning optimizer,
traffic prediction, learning, or hidden balancing policy exists in H0.

This policy is intentionally simple and inspectable. The project makes no claim
that it is optimal for a real network.

## Reserve-aware mission feasibility

Represent battery energy internally in integer watt-hours:

```text
startingWh =
  round(batteryCapacityKWh * 1000 * startingBatteryPercent / 100)

legEnergyWh =
  round(authoredDistanceKm * authoredEnergyKWhPerKm * 1000)

endingWh = startingWh - legEnergyWh
reserveWh =
  round(batteryCapacityKWh * 1000 * minimumReservePercent / 100)
```

Before assignment, calculate the energy for the complete known mission. A leg
ending exactly at reserve is feasible. One watt-hour below reserve is rejected.
The rejection emits `ACTION_REJECTED` with `RESERVE_INFEASIBLE` and changes
neither passenger nor vehicle state.

Battery never rises in H0 because charging is excluded. Every accepted movement
records its integer distance and energy delta. Partial movement is edge-aware:
completed edges contribute their full authored metres/Wh, only the current
edge is ratio-rounded, and future edges contribute zero. Each debit is the new
cumulative target minus the previously accounted total, preventing drift,
omission, and double debit. Full-leg reserve feasibility is still validated
before departure.

## Equivalent vehicle failure at 08:42

The disruption occurs at `atSecond: 720` in each scenario.

Resolve the target independently:

1. active vehicles only;
2. highest onboard occupancy;
3. highest reserved-passenger count;
4. active-service state before other active states;
5. ascending vehicle ID.

Record the selected vehicle ID and ranked selection facts. The chosen vehicle
is not random and the user does not select it to manufacture a result.

Failure processing occurs before other same-tick transitions:

- permanently mark the vehicle `FAILED`;
- cancel its current leg at the deterministic tick position;
- calculate and retain complete-edge totals plus the rounded current-edge
  distance and energy already travelled; future edges remain zero;
- snap recovery to the nearer authored endpoint, with destination winning an
  exact 50% tie;
- immediately release reserved passengers;
- move onboard passengers to `RECOVERY_WAIT` at that endpoint while retaining
  original request times;
- release those passengers to the queue after the fixture's visible 60-second
  transfer approximation;
- never restore the vehicle during the run;
- emit failure, requeue, recovery assignment, and recovery completion evidence.

The fixture-owned `recoveryTransferSeconds: 60` is part of the canonical run
input and therefore changes the input fingerprint if changed. The engine reads
that field when it creates the onboard-passenger release second; no engine
module owns a literal 60-second recovery delay.

Failure state semantics are explicit:

- idle at a zone: fail in place; with no reservations or onboard passengers,
  recovery completes immediately with zero duration;
- dwelling: fail at the current zone and release reservations immediately to
  their original pickup queue;
- travelling empty: account for elapsed distance/energy, snap to the nearer
  authored endpoint, and release pickup reservations immediately;
- travelling with passengers: account for elapsed distance/energy, snap to the
  nearer endpoint, move onboard passengers to `RECOVERY_WAIT`, and release them
  to that endpoint queue after the configured transfer delay;
- all released reservations retain their original arrival and wait deadline.

Recovery starts at the failure second and completes when every affected
passenger has boarded another vehicle. If no passenger is affected it completes
immediately with reason `NO_AFFECTED_PASSENGERS`, zero duration, and explicit
constraint evidence that no passenger recovery was required. Otherwise a
completion uses `ALL_AFFECTED_PASSENGERS_RECOVERED`. If any affected passenger
remains unboarded at terminal evaluation, recovery is `Not recovered`; the
engine never invents a duration.

This is a documented approximation, not a physical incident or safety model.

## Immutable event ledger

Every completed run owns an `event-schema-v2` ordered ledger with stable
evidence IDs. Required H0 event families are:

```text
RUN_STARTED
TICK_OBSERVED
PASSENGER_ARRIVED
VEHICLE_DISPATCHED_EMPTY
VEHICLE_ARRIVED_PICKUP
PASSENGERS_BOARDED
VEHICLE_DEPARTED_SERVICE
VEHICLE_ARRIVED_DROPOFF
PASSENGERS_SERVED
BATTERY_CHANGED
VEHICLE_FAILED
PASSENGERS_REQUEUED
RECOVERY_ASSIGNED
RECOVERY_COMPLETED
ACTION_REJECTED
DISRUPTION_TARGET_NOT_FOUND
RUN_COMPLETED
```

Each event contains integer simulated second, stable sequence, typed affected
IDs, and the before/after facts needed for metrics and replay. Movement starts
embed one shared immutable active-leg evidence value: origin, destination,
edge/path IDs, purpose, passenger/reservation IDs, departure, planned arrival,
distance, travel seconds, integer energy, ordered per-edge facts and cumulative
accounted totals. Pickup-arrival events also bind the started boarding operation
and frozen manifest. Replay never reruns routing or infers an omitted path.
Events contain no presentation prose, Google content,
wall-clock time, or browser object.

`event-schema-v2` is recursively closed-world at the trusted replay boundary.
Every event variant, fact object, active leg, boarding operation, ordered array,
and per-edge fact accepts only its declared properties; unknown properties are
rejected with an indexed property path and are never stripped. Every referenced
zone and edge is also bound to the verified run input. Edge order, endpoints,
distance, travel time, derived integer energy, offsets, and connected path must
agree with the authored network. Recomputing a ledger hash cannot make an
unknown edge or contract-extra property valid.

Topology validity alone does not authorize a movement. At every movement-start
transition, replay derives the allowed origin from the vehicle's current state,
the pickup from the exact assigned passengers' current locations, and the
service destination from their immutable requests. Reservation and onboard
cohorts must match authoritative replay ownership exactly. A recovered
passenger is picked up at the replayed failure/requeue location while retaining
the original request destination; the obsolete request origin is not reused.
Later battery, failure, and arrival evidence remains bound to that accepted
leg, and an arrival cannot replace its destination. Any connected authored path
between the derived endpoints is admissible; trusted replay does not rerun or
enforce the reference controller's route selection.

A cancelled or failed run may retain bounded diagnostic evidence but never
masquerades as a completed comparison-ready run.

## Replay snapshots

Capture a compact snapshot after each tick. A snapshot contains only the
vehicle, passenger-state counts, zone queues, disruption state, and partial
metric facts required to reproduce the timeline/map/list frame.

The trusted replay entry receives a validated canonical run input plus the
complete ledger envelope. It recomputes input identity, derives initial state,
validates the ledger fingerprint, requires exactly one first `RUN_STARTED` and
one last `RUN_COMPLETED`, binds the start event to the input fingerprint, then
invokes an internal pure reducer. Every event family is runtime-validated,
including evidence-only events. Unknown types, incomplete edge facts, wrong
input, events after completion, non-contiguous sequence, malformed facts,
unknown entities, and illegal transitions fail closed. Replay reconstructs the
terminal state without calling engine, controller, router, metrics, or snapshot
logic.

An event-ledger hash proves the canonical bytes that were hashed; it does not
prove that those bytes satisfy the event contract. Trusted replay therefore
performs closed-world runtime validation and input-network binding after
recomputing identity and before applying any event.

External result artifacts use `verifyTrustedSimulationResult`, which accepts
the validated input, supplied ledger, and supplied result artifact together.
For each expected observation second it selects the ledger prefix after every
same-second tick event, except that terminal `RUN_COMPLETED` occurs after the
second-1980 snapshot. It independently replays that prefix, constructs the
expected compact snapshot, and compares canonical bytes. The H0 sequence is
exactly `0, 30, ..., 1980` (67 snapshots). Only after every prefix, terminal
state, canonical result document, and result fingerprint agree is the artifact
returned as verified. The engine's internal fingerprint construction is not an
external trust API; the generic hash helper makes no semantic-validation claim.

Replay reads the stored ledger/snapshots; it never reruns the engine. Selecting
0.5×, 1×, 2×, or 4× playback, scrubbing, changing layers, or rendering with
Google versus SVG must produce identical final metrics and fingerprints.

## Metric derivation

Fold final metrics from the immutable event ledger. Snapshots are projections,
not metric authority. UI components and tool handlers never calculate
alternative values.

| Metric | H0 definition |
|---|---|
| Requested | Count of requests in the shared demand trace |
| Served | Requests with a service-completion event by second 1980 |
| In service at horizon | Not served and currently onboard/in-service or in a started active recovery lifecycle at second 1980 |
| Unserved | Neither served nor under active service/recovery at second 1980; prior boarding alone does not qualify |
| Experienced wait | First board minus request time; terminal evaluation minus request time for never-boarded requests |
| Average wait | Mean experienced wait over all requested; `N/A` for zero demand |
| P95 wait | Nearest-rank 95th percentile of experienced wait |
| Maximum wait | Maximum experienced wait; zero for zero demand |
| On-time service | Requests boarded within configured max wait divided by requested |
| Peak occupancy | Maximum simultaneous onboard count relative to active seats |
| Passenger-km | Sum of served passenger authored trip distances |
| Vehicle-km | Completed plus terminal/failure partial authored leg distances |
| Empty vehicle-km | Vehicle-km travelled with zero onboard passengers |
| Capacity utilization | Passenger-km divided by seat-km; `N/A` for zero seat-km |
| Total energy | Sum of recorded battery energy consumption |
| Energy/passenger-km | Total energy divided by passenger-km; `N/A` for zero passenger-km |
| Minimum battery reserve | Minimum state of charge observed |
| Reserve violations | Actual below-reserve states; expected zero under fail-closed dispatch |
| Reserve-blocked assignments | Count of refused reserve-infeasible missions |
| Recovery time | Failure to final affected-passenger reboarding, otherwise `Not recovered` |

Final reconciliation exposes lifecycle counts plus the three mutually exclusive
terminal outcomes. Completed edges reconcile to full authored totals; only the
current partial edge uses deterministic positive-integer ratio rounding. No
denominator may produce `NaN`, infinity, or a misleading zero.

Store time in seconds, distance in metres, energy in watt-hours, and counts as
integers. Round only at the presentation boundary: percentages to one decimal,
energy display to two decimal kWh, and undefined percentage deltas to `N/A`
when the baseline is zero.

## Hard constraints

Evaluate hard constraints before interpreting soft objectives:

| Constraint | Pass condition |
|---|---|
| Maximum wait | maximum experienced wait <= configured seconds |
| Maximum unserved | unserved passengers <= configured maximum |
| Minimum reserve | observed battery >= configured reserve with no below-reserve event |
| Maximum recovery | no disruption, or recovered within configured seconds |
| Standing prohibited | no occupancy event exceeds vehicle seats |

The golden maximum-wait threshold is 180 seconds and minimum reserve is 20%.
A run may complete successfully while failing one or more constraints; that is
an experiment result, not a tool failure.

No opaque composite winner score is permitted. Comparison reports hard
constraints first, then explicit service, capacity, energy, battery, and
recovery trade-offs.

## Canonical fingerprints

Canonical serialization must:

- recursively sort object keys;
- preserve array order;
- reject non-finite numbers and unsupported values;
- normalize strings and integer units;
- exclude functions, dates, maps, sets, browser objects, and `undefined`;
- record its algorithm/version.

Input fingerprint covers:

```text
engine version
+ network fixture fingerprint
+ metric-definition version
+ demand-trace fingerprint
+ complete normalized scenario configuration
+ disruptions
```

The explicit event-ledger fingerprint covers a domain-separated canonical
document containing:

```text
event-schema version
+ input fingerprint
+ engine and tick-semantics versions
+ controller identity and version
+ ordered events
```

Result fingerprint covers:

```text
result-schema version
+ input fingerprint and all semantic versions
+ event-ledger fingerprint
+ all 67 ordered authoritative replay snapshots
+ canonical terminal operational state
+ normalized final metrics
+ hard-constraint evaluations
```

Exclude run ID, operation ID, wall-clock timestamps, measured duration, browser
version, Google status, UI state, map state, and playback state. A metric-only
change therefore changes the result identity but not the ledger identity; an
event or execution-semantics change changes both. The selected
hash algorithm is locked and tested during the implementation gate; its purpose
is reproducibility and evidence integrity, not identity authorization. A valid
hash establishes byte identity only. It does not make malformed events,
network-unknown evidence, or false replay snapshots semantically trustworthy.

## Comparison compatibility

The headless comparison boundary accepts only validated prepared inputs and
runtime-attested `VerifiedRunResultArtifact` values. A raw engine result, copied
artifact, TypeScript cast, or correctly formatted hash is not trusted. Persisted
or transported evidence must be reverified by the Gate 4 trust boundary.

Before any delta, require identical network content and fingerprint, demand
definition/trace and fingerprint, seed, intake/evaluation horizon, canonical
and input versions, engine/tick/controller/metric/event/result contracts, hard
constraints, non-size fleet and energy assumptions, objectives, and semantic
vehicle-failure schedule. Scenario slot and label, vehicle count, seats per
vehicle, and the scenario-local disruption ID are the fixed H0 permitted
dimensions. Every actual permitted difference is recorded. Any undeclared
difference fails closed as `INCOMPARABLE_RUNS` with an exact mismatch path and
left/right values.

Each of the 19 published H0 KPIs records left value, right value, unit, and the
signed convention:

```text
rightMinusLeft = right value - left value
```

Relative differences are integer basis points rounded deterministically. They
are `N/A` when either value is unavailable or the left denominator is zero;
`NaN` and infinity are never representable evidence. Constraint transitions
are explicit: `BOTH_PASS`, `BOTH_FAIL`, `LEFT_PASS_RIGHT_FAIL`, and
`LEFT_FAIL_RIGHT_PASS`. No direction is converted into a winner score or
hidden preference.

The complete `comparison-schema-v1` evidence document includes operand input,
ledger, and result fingerprints, shared provenance, permitted differences,
metric deltas, constraint evidence, and bounded claims. It is canonically
serialized under the `RUN_COMPARISON_EVIDENCE` domain and SHA-256 fingerprinted.
Swapping operands creates a different valid document with reversed signed
absolute deltas. Map state, animation, browser state, operation IDs, wall-clock
time, and agent prose cannot enter the identity.

## Bounded comparison claims

Gate 5 emits at most three neutral structured claims from a verified comparison:

1. the first constraint transition, preferring a differing status and then a
   shared failure;
2. the unserved-passenger delta;
3. the total-energy delta.

Each claim stores a bounded code, subject identifier, exact left/right/delta
values, unit, relation, constraint transition when applicable, evidence IDs,
and the relevant input/ledger/result fingerprints. The fixed template version
is part of the comparison identity. Claims contain no free-form prose and make
no optimality or winner assertion. A later renderer or browser agent may explain
them, but that explanation cannot modify trusted evidence. Finding staging and
human review remain later application gates.

### Pending-finding selection policy

The finding builder reads the complete trusted comparison rather than treating
the comparison's compact claims as a ranking. `finding-policy-v1` selects zero
to three pending-review rows in this order: a genuine pass/fail constraint
difference, the largest emphasis-relevant service/resilience difference, and
the largest material energy/utilization difference. Shared `BOTH_FAIL` and
`BOTH_PASS` constraints are caveats, not side differences.

Numeric salience is `abs(B - A) / max(abs(A), abs(B))`, compared exactly by
integer cross multiplication. Equal and both-zero values are excluded; one
zero yields magnitude one; null/N/A is excluded except for typed recovery
state. Recovered versus not recovered outranks numeric resilience rows, both
recovered compares duration, and both not recovered remains an explicit
caveat. Energy thresholds are 100 Wh plus 5%, energy/passenger-km one native
unit plus 5%, and utilization 100 basis points. These thresholds decide which
facts merit limited presentation space; they are not model significance tests.

Direction metadata can describe whether selected operational and efficiency
evidence genuinely opposes or aligns. Proposed outcome never changes factual
selection, and neither a proposed trade-off nor an emphasis creates a winner,
score, weighting, recommendation, or operational authority.

## Cancellation and atomic commit

Keep the step function pure. An async application wrapper:

1. checks the supplied `AbortSignal` before validation and execution;
2. checks at every tick;
3. yields to the browser every bounded number of ticks;
4. checks before metric and fingerprint assembly;
5. checks immediately before repository commit.

Yield schedules affect responsiveness only. A non-cancelled run is
byte-equivalent under different yield schedules.

The application captures immutable inputs, computes locally, validates
invariants, and commits the complete artifact through expected-revision
compare-and-swap. Cancellation or stale revision before commit produces no
completed artifact. A late result never overwrites newer current state.

## Invariants

Check after each tick in development/tests and at completion:

- requested passenger conservation and one-state exclusivity;
- no passenger boards before arrival or is served twice;
- vehicle operational-state exclusivity;
- occupancy remains between zero and seats;
- energy is finite, non-negative, and no greater than capacity;
- accepted missions do not end below reserve;
- distances, waits, energy, and counts are non-negative;
- event time and sequence are monotonic;
- failed vehicles remain failed;
- no `NaN`, infinity, invalid percentage, or unsupported precision appears.

An invariant breach returns `ENGINE_INVARIANT_FAILED`, retains only safe
diagnostic identity, and publishes no complete metrics, comparison, or finding.

## Required acceptance properties

- same normalized inputs produce deep-equal traces, ledgers, metrics, and
  fingerprints across repeated runs;
- Node and Chrome 150 independently construct and run A/B and produce identical
  canonical UTF-8 bytes for input, ledger, and snapshot-bearing result
  documents under UTC and Africa/Johannesburg;
- verified canonical input plus its bound ordered ledger reconstructs the
  terminal state byte-for-byte, including runs that end mid-leg;
- all 67 snapshot prefixes replay to their authoritative projections, and the
  complete ordered snapshots are committed by the result fingerprint;
- an independent hand-calculated test witness covers every published H0 KPI and
  constraint without importing production metric helpers;
- A and B use the exact same passenger trace;
- demand, capacity, distance, and energy changes affect results coherently;
- passenger and vehicle inputs are not mutated;
- vehicle failure wins same-tick completion ties and permanently removes one
  vehicle;
- zero demand, zero fleet, overload, reserve infeasibility, and all-vehicle
  failure terminate safely with defined evidence;
- map on/off and playback speeds produce identical results;
- no scenario-specific result constant or final KPI literal exists.

The golden experiment must run repeatedly before any KPI value is published in
README, demo, screenshots, or submission claims.

## Model limitations

H0 intentionally excludes:

- scientific calibration or prediction guarantees;
- real passenger/fleet/traffic inputs;
- street-level traffic dynamics and arbitrary routing;
- charging and charging outages;
- demand surge;
- multi-destination pooling and standing;
- stochastic robustness sweeps;
- external optimizers;
- real dispatch, V2X, safety control, or regulatory use;
- SUMO, reinforcement learning, or production fleet adapters.

The authored network, dispatch policy, energy assumptions, 60-second passenger
recovery delay, and 30-second discretization are simplified model choices.
Every evidence surface must identify them as such.
