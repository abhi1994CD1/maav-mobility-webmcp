# MAAV Stress Lab Deterministic Simulation Contract

## Status and purpose

This document owns H0 simulation rules, event evidence, metric definitions,
hard constraints, fingerprints, cancellation, invariants, and model
limitations.

Gate 1 defines the contract only. The Stress Lab engine does not yet exist, so
this document contains no final golden KPI values, preferred scenario, or claim
that the H0 outcome has been calibrated.

The engine is a bounded deterministic experiment model, not a general transport
simulator, optimizer, machine-learning system, or real-world predictor.

## Canonical experiment inputs

| Input | H0 contract |
|---|---|
| Network | `sandton-rosebank-v1`, versioned synthetic fixture |
| Engine | `maav-sim-v1` |
| Metric definitions | versioned with the engine release |
| Window | 08:30:00–09:00:00 |
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

The simulation covers tick zero through the horizon, giving 61 snapshots for a
30-minute run unless the finalized fixture records an additional bounded
significant-event snapshot.

A pure step receives immutable state and returns a new state plus events:

```ts
stepSimulation(
  state: SimulationState,
  atSecond: number,
  context: SimulationContext
): StepResult
```

At every tick execute this order:

1. apply scheduled disruptions in disruption-ID order;
2. complete vehicle travel legs ending at the tick;
3. complete dwell actions ending at the tick;
4. unload and mark arriving passengers served;
5. release disruption-affected passengers whose transfer delay elapsed;
6. add passenger requests arriving at the tick;
7. assign recovery for failed-vehicle passengers;
8. dispatch eligible idle vehicles in ascending vehicle ID;
9. check conservation, vehicle, battery, numeric, and event invariants;
10. record the compact replay snapshot.

A disruption wins over a travel or dwell completion on the same tick. Changing
this order changes the model and requires a new engine version.

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
time and identity remain unchanged. At the horizon, all non-served arrived
passengers are reported as unserved for final metrics.

No passenger may board before arrival, occupy two states, exceed one seat, or be
served twice.

## Transparent dispatch policy

H0 uses one policy, `OLDEST_WAIT_NEAREST_IDLE_V1`:

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
The rejection emits `DISPATCH_BLOCKED_RESERVE` and changes neither passenger
nor vehicle state.

Battery never rises in H0 because charging is excluded. Every accepted movement
records its integer distance and energy delta.

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
- calculate and retain the integer fraction of distance and energy already
  travelled;
- snap recovery to the nearer authored endpoint, with destination winning an
  exact 50% tie;
- immediately release reserved passengers;
- move onboard passengers to `RECOVERY_WAIT` at that endpoint while retaining
  original request times;
- release those passengers to the queue after the fixture's visible 60-second
  transfer approximation;
- never restore the vehicle during the run;
- emit failure, requeue, recovery assignment, and recovery completion evidence.

Recovery completes when every affected passenger has boarded another vehicle.
If any remains unboarded at the horizon, recovery is `Not recovered`; the
engine never invents a duration.

This is a documented approximation, not a physical incident or safety model.

## Immutable event ledger

Every completed run owns an ordered ledger with stable evidence IDs. Required
H0 event families are:

```text
RUN_STARTED
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
DISPATCH_BLOCKED_RESERVE
RUN_COMPLETED
```

Each event contains integer simulated second, stable sequence, typed affected
IDs, and the before/after facts needed for metrics and audit. It contains no
presentation prose, Google content, wall-clock time, or browser object.

A cancelled or failed run may retain bounded diagnostic evidence but never
masquerades as a completed comparison-ready run.

## Replay snapshots

Capture a compact snapshot after each tick. A snapshot contains only the
vehicle, passenger-state counts, zone queues, disruption state, and partial
metric facts required to reproduce the timeline/map/list frame.

Replay reads the stored ledger/snapshots; it never reruns the engine. Selecting
0.5×, 1×, 2×, or 4× playback, scrubbing, changing layers, or rendering with
Google versus SVG must produce identical final metrics and fingerprints.

## Metric derivation

Fold final metrics from the immutable event ledger plus the initial/final
snapshots. UI components and tool handlers never calculate alternative values.

| Metric | H0 definition |
|---|---|
| Requested | Count of requests in the shared demand trace |
| Served | Requests with a service-completion event by horizon |
| Unserved | Requested minus served |
| Experienced wait | Board minus request time; horizon minus request time for unserved |
| Average wait | Mean experienced wait over all requested; `N/A` for zero demand |
| P95 wait | Nearest-rank 95th percentile of experienced wait |
| Maximum wait | Maximum experienced wait; zero for zero demand |
| On-time service | Requests boarded within configured max wait divided by requested |
| Peak occupancy | Maximum simultaneous onboard count relative to active seats |
| Passenger-km | Sum of served passenger authored trip distances |
| Vehicle-km | Completed plus partial authored leg distances |
| Empty vehicle-km | Vehicle-km travelled with zero onboard passengers |
| Capacity utilization | Passenger-km divided by seat-km; `N/A` for zero seat-km |
| Total energy | Sum of recorded battery energy consumption |
| Energy/passenger-km | Total energy divided by passenger-km; `N/A` for zero passenger-km |
| Minimum battery reserve | Minimum state of charge observed |
| Reserve violations | Actual below-reserve states; expected zero under fail-closed dispatch |
| Reserve-blocked assignments | Count of refused reserve-infeasible missions |
| Recovery time | Failure to final affected-passenger reboarding, otherwise `Not recovered` |

Final reconciliation must expose generated, waiting, reserved, onboard, served,
and unserved counts with one documented definition. No denominator may produce
`NaN`, infinity, or a misleading zero.

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

Result fingerprint covers:

```text
input fingerprint
+ normalized event ledger
+ normalized final metrics
+ hard-constraint evaluations
```

Exclude run ID, operation ID, wall-clock timestamps, measured duration, browser
version, Google status, UI state, map state, and playback state. The selected
hash algorithm is locked and tested during the implementation gate; its purpose
is reproducibility and evidence integrity, not identity authorization.

## Comparison compatibility

Before authoritative deltas, require:

- explicit completed current run A and run B;
- matching engine, network, metric, demand, seed, horizon, and tick versions;
- equivalent vehicle-failure type, time, and target-selection policy;
- disclosed fleet configuration differences.

Incompatible artifacts may be inspected but produce no authoritative deltas,
winner, evidence hash, or finding.

## Finding evidence

The deterministic finding builder selects at most three high-information claims
from a current compatible comparison:

1. hard-constraint difference;
2. material service or recovery difference relevant to bounded emphasis;
3. material energy or utilization trade-off.

Each claim stores a code, metric keys, exact A/B/delta values, evidence IDs, and
template version. The agent may choose bounded emphasis and outcome framing,
but it may not submit numeric claims. Agent prose is never authoritative
evidence.

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
