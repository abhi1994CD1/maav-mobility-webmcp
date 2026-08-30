# Deterministic Recovery Engine

## Status and purpose

This document is the implementation contract for the command center's decision core. It replaces the current authored plan-outcome table with a bounded deterministic counterfactual model that is credible, explainable, testable, and small enough to finish before the challenge deadline.

This is not a general transit simulator, optimizer, machine-learning model, or real-world prediction system. It is a transparent projection for one authored disruption scenario. Every displayed result remains labelled simulated and projected.

The engine must preserve without modification:

- the seven durable workflow phases;
- the revision `0 -> 6` golden trace;
- the exact six public WebMCP tools;
- human-only incident activation, reset, and approval;
- approval `{ planId, validForRevision, consumed }` semantics;
- atomic application mutations and append-only audit;
- operational-only rollback;
- deterministic Google-independent canonical results.

## Core invariant

Candidate definitions author operational actions and assumptions, never their final results.

Allowed authored values include vehicle assignments, activation delay, headway, served stops, corridor distance, travel time, energy rate, demand forecast, accessibility capacity, and simulation thresholds.

Forbidden authored candidate values include final on-time percentage, maximum or mean wait, unserved passengers, accessibility violations, energy delta, and recovery time. The engine calculates all of them from the same incident snapshot.

## Decision pipeline

```text
current incident OperationalState
+ immutable authored scenario model
+ RecoveryObjectives
+ action-only candidate catalog
                  |
                  v
         resource/feasibility compiler
                  |
                  v
     one-minute counterfactual projection
                  |
                  v
          derived operational metrics
                  |
                  v
       hard-constraint safety kernel
                  |
                  v
       normalized deterministic ranking
                  |
                  v
 compact evaluated-plan summaries + exact projections
```

Every candidate begins from an independent deep clone of the same operational snapshot. The engine does not call Google, read the network, use `Date.now()`, or call `Math.random()`.

## Domain inputs

### Recovery model configuration

```ts
interface RecoveryModelConfig {
  engineVersion: "corridor-flow-v1";
  horizonMinutes: number;
  tickMinutes: 1;
  onTimeToleranceMinutes: number;
  recoveryStabilityMinutes: number;
  healthyQueueThreshold: number;
  healthyOldestWaitMinutes: number;
  baselineNetworkEnergyKwh: number;
  scoreWaitCapMinutes: number;
  scoreEnergyCapPercent: number;
}
```

The canonical horizon is bounded to 30–45 simulated minutes. Configuration is immutable scenario data and is included in calculation provenance.

### Demand model

```ts
interface DemandForecast {
  stopId: string;
  arrivalsPerMinute: number;
  wheelchairArrivalsPerMinute: number;
  promisedTravelMinutes: number;
}

interface DemandCohort {
  id: string;
  stopId: string;
  readyMinute: number;
  passengerCount: number;
  wheelchairCount: number;
  promisedArrivalMinute: number;
}
```

Initial cohorts are derived from the current `DemandPoint` queue and average wait. Future arrivals are derived from the authored forecast. Fractional rates use cumulative flooring:

```text
arrivals at minute t = floor(rate * (t + 1)) - floor(rate * t)
```

This preserves determinism without seeded noise. If later scenarios require randomness, they must use a documented seeded PRNG and remain reproducible.

### Vehicle resource model

```ts
interface VehicleProfile {
  vehicleId: string;
  capacity: number;
  wheelchairCapacity: number;
  accessible: boolean;
  energyKwhPerKm: number;
  initialPassengers: number;
  availability: "IN_SERVICE" | "DELAYED" | "RESERVE";
}
```

Explicit reserve profiles are the resource truth. `availableSpareVehicles` remains a derived UI summary rather than permission to invent anonymous capacity.

### Action-only candidate catalog

```ts
type RecoveryPrimitive =
  | {
      type: "BRIDGE_SERVICE";
      vehicleIds: string[];
      stopIds: string[];
      activationMinute: number;
      headwayMinutes: number;
      tripDistanceKm: number;
      tripTravelMinutes: number;
      deadheadDistanceKm: number;
    }
  | {
      type: "SHORT_TURN";
      vehicleIds: string[];
      stopIds: string[];
      activationMinute: number;
      headwayMinutes: number;
      tripDistanceKm: number;
      tripTravelMinutes: number;
    }
  | {
      type: "SYNCHRONIZE_TRANSFER";
      feederStopId: string;
      bridgeStopId: string;
      maximumTransferMinutes: number;
    };

interface RecoveryCandidateDefinition {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  actions: RecoveryPrimitive[];
}
```

The candidate catalog must not contain a `metrics` property or any equivalent precomputed result.

The canonical candidates retain their product meanings:

- `express_bridge_a`: accessible bridge capacity, but insufficient frequency or coverage to satisfy every reliability/wait objective;
- `short_turn_b`: strong local frequency and lower energy, but no compliant accessible through-service across the obstruction;
- `combined_recovery_c`: accessible bridge service synchronized with short turns, satisfying every canonical hard constraint.

These expected behaviors are acceptance constraints on the authored actions and scenario calibration, not permission to insert final KPI values.

## Feasibility compiler

The compiler turns candidate primitives into ordered `ServiceOpportunity` values before simulation.

```ts
interface ServiceOpportunity {
  minute: number;
  vehicleId: string;
  servedStopIds: string[];
  capacity: number;
  accessibleCapacity: number;
  projectedArrivalMinute: number;
  energyKwh: number;
}
```

It rejects a candidate before scoring when it detects:

- the same vehicle assigned to overlapping services;
- a vehicle not available in the snapshot;
- more reserve vehicles than exist;
- traversal of the blocked segment without an allowed bridge pattern;
- invalid stops, negative timings, zero/negative headways, or non-finite values.

An infeasible candidate returns bounded explanation codes and cannot be recommended or staged.
Insufficient accessible service is not hidden as a compiler failure: the model
still projects the candidate, reports the accessible-service deficit, and the
hard-constraint evaluator rejects it. This keeps unsafe options visible and
explainable to the operator.

## Counterfactual projection

For each minute in the bounded horizon:

1. Age all waiting cohorts by one minute.
2. Add deterministic forecast arrivals.
3. Apply service opportunities scheduled for the minute.
4. Board eligible cohorts first-in, first-out.
5. Allow wheelchair passengers to board only against accessible capacity.
6. Record boarded passenger count, wait, projected arrival, energy, vehicle assignment, and remaining capacity.
7. Retain unserved cohorts for the next minute.
8. Detect whether queue and oldest-wait thresholds have remained healthy for the configured stability window.

The simulator returns an internal projection, not a public WebMCP object:

```ts
interface CounterfactualProjection {
  engineVersion: string;
  baseRevision: number;
  horizonMinutes: number;
  operational: OperationalState;
  metrics: OperationalMetrics;
  assignments: ServiceOpportunity[];
  explanationCodes: string[];
}
```

For a candidate that reaches stable recovery, `operational` is the exact
candidate-specific state at that recovery checkpoint. Otherwise it is the
horizon-end state and the plan is not commit-eligible. The projection retains
the minute-by-minute trace internally for metric calculation, but the trace is
not copied into revisioned application state or public results.

All arithmetic uses full precision. Round only values mapped into public DTOs, normally to one decimal place.

## Metric definitions

Every metric has one versioned definition.

### Affected and unserved passengers

```text
affectedPassengers = initial incident queue + arrivals entering affected flows during horizon
unservedPassengers = passengers remaining in affected queues at horizon end
```

Conservation must always hold:

```text
boardedPassengers + unservedPassengers = affectedPassengers
```

Transfers must be represented as movements of the same cohort, never new passengers.

### Waiting time

For boarded passengers, observed wait is `boardMinute - readyMinute`. For passengers remaining at the horizon, observed wait is `horizonMinute - readyMinute`.

```text
meanWaitMinutes = sum(observedWait * passengerCount) / affectedPassengers
maximumWaitMinutes = maximum observed cohort wait
```

If no passenger is affected, both wait metrics are `0` and on-time percentage
is `100`; the engine never divides by zero.

### Accessibility violations

Accessibility is an explicit obligation, not a score penalty. `accessibilityViolations` is the number of wheelchair passengers that cannot complete the required affected flow using accessible opportunities within the modelled service window. Wheelchair passengers never board inaccessible capacity.

### Energy delta

```text
opportunityEnergyKwh = tripDistanceKm * vehicle.energyKwhPerKm
extraRecoveryKwh = sum(opportunityEnergyKwh + modelled deadhead energy)
energyDeltaPercent = 100 * extraRecoveryKwh / baselineNetworkEnergyKwh
```

Idle energy is excluded unless an authored, documented rate is supplied for all candidates.

### Projected recovery time

`projectedRecoveryMinutes` is the first minute at which both total queue and oldest wait are at or below their authored healthy thresholds for `recoveryStabilityMinutes` consecutive minutes. If recovery does not occur inside the horizon, return `horizonMinutes + 1` and the bounded `NOT_RECOVERED_IN_HORIZON` explanation code. Such a plan is not commit-eligible.

### On-time percentage

Each cohort has a promised arrival derived from the authored baseline service. A passenger is on time when the projected arrival is no later than:

```text
promisedArrivalMinute + onTimeToleranceMinutes
```

Unserved passengers are late.

```text
onTimePercent = 100 * onTimePassengerCount / affectedPassengers
```

Do not relabel a synthetic weighted score as on-time performance.

### Spare vehicles

`spareVehiclesRequired` is the number of distinct reserve vehicle IDs assigned by the candidate, not a handwritten candidate property.

## Safety kernel and ranking

Hard constraints run after metric calculation and before scoring:

1. candidate compilation is feasible;
2. stable recovery occurs inside the bounded horizon;
3. no accessibility violations when preservation is requested;
4. on-time percentage meets the operator minimum;
5. maximum wait is within the operator maximum;
6. energy delta is within the operator maximum.

A soft score cannot compensate for a hard failure. Only compliant plans participate in recommendation ranking.

The bounded 0–100 score uses normalized components:

```text
reliability       35%
waiting time      25%
passengers served 20%
energy            10%
recovery speed    10%
```

The normalization is fixed by the versioned model configuration:

```text
clamp01(x) = min(1, max(0, x))

reliability       = clamp01(onTimePercent / 100)
waiting time      = 1 - clamp01(maximumWaitMinutes / scoreWaitCapMinutes)
passengers served = affectedPassengers == 0
                    ? 1
                    : clamp01((affectedPassengers - unservedPassengers) / affectedPassengers)
energy            = 1 - clamp01(max(0, energyDeltaPercent) / scoreEnergyCapPercent)
recovery speed    = 1 - clamp01(projectedRecoveryMinutes / horizonMinutes)

totalScore = roundToOneDecimal(100 * (
  0.35 * reliability
  + 0.25 * waiting time
  + 0.20 * passengers served
  + 0.10 * energy
  + 0.10 * recovery speed
))
```

All caps must be finite and greater than zero. Each normalized component and the total are returned with stable explanation codes. Equal scores use lexical `planId` order as the deterministic tie-break. Objectives change eligibility, while score weights and caps remain fixed for an engine version. The canonical objectives must continue to select `combined_recovery_c` as the only fully compliant plan.

If no candidate is compliant, return all evaluated failures with no `recommendedPlanId`. Never manufacture a recommendation.

## Evaluation, staging, and commit

Evaluation receives the current incident `OperationalState`, current revision, immutable scenario model, objectives, and action catalog. It stores, for every evaluated plan:

- a compact public summary;
- the exact candidate-specific `CounterfactualProjection` or typed operational patch;
- engine version and base revision;
- hard-constraint and explanation codes.

The public DTO mapper is explicit. Never spread an internal projection into a WebMCP result.

Staging continues to select a compliant evaluated plan without changing operational state. Approval continues to bind the staged plan and resulting approved revision.

After existing atomic approval checks, commit applies the exact stored projection for the approved plan. It must not recalculate against changed inputs and must not apply a shared hardcoded fleet/demand mutation. Committed metrics therefore equal the metrics the human reviewed.

Immediately before commit, capture the existing narrow `OperationalSnapshot`. Rollback behavior is unchanged.

## Public calculation provenance

`evaluate_recovery_options` returns compact provenance alongside plan summaries:

```json
{
  "engineVersion": "corridor-flow-v1",
  "baseRevision": 1,
  "horizonMinutes": 30,
  "modelSource": "AUTHORED_SIMULATION",
  "plans": []
}
```

Each plan summary includes derived metrics, metric deltas from the incident baseline, constraint results, normalized score components, and bounded explanation codes. It does not expose cohorts, raw route responses, internal assignments, or unrestricted operational state.

The UI displays `PROJECTED • MODEL corridor-flow-v1`. It must not label projections as observed, live, certified, or guaranteed.

## Google and integration boundaries

Google Maps and Routes provide geography and bounded route context only. `GOOGLE` and `AUTHORED_FALLBACK` runs over the same canonical operational snapshot must produce byte-identical plan metrics and ranking.

The authored scenario provider is the current operational-input adapter. A future fleet platform may implement a narrow snapshot adapter, but no production connector, command write-back, or customer integration is part of this build. Do not create unused ports or empty adapter folders merely to illustrate that future.

## Required tests

### Determinism and purity

- Identical snapshot, model, catalog, and objectives produce deep-equal evaluations.
- Evaluation does not mutate its inputs.
- Candidate order does not change results or recommendation.
- Google/fallback source and live delay changes do not change canonical results.

### Conservation and monotonicity

- Boarded plus unserved equals affected demand.
- Increasing demand cannot reduce maximum wait or unserved passengers.
- Adding eligible capacity cannot increase wait or unserved passengers.
- Adding service distance cannot reduce energy.
- Wheelchair cohorts never board inaccessible capacity.

### Feasibility and sensitivity

- Reserve shortages and overlapping assignments create infeasible plans without phantom capacity.
- Each canonical candidate creates a distinct fleet/demand projection.
- Relaxing accessibility or energy objectives changes the eligible set predictably.
- Zero-compliant-plan evaluation returns no recommendation.

### Governance integration

- Exactly three canonical plans are evaluated and only coordinated recovery is canonical-compliant.
- Committed operational metrics equal the approved staged projection.
- A different approved candidate, when compliant under alternate objectives, applies its own projection.
- Revision, approval, audit, abort, and rollback contracts remain unchanged.
- The WebMCP tool names, schemas, phase matrix, and common envelopes remain unchanged except for documented additive response fields.

## Implementation boundaries

Create files only as their slice is implemented. The intended domain split is:

```text
src/domain/recovery/
  model.ts         # types and versioned configuration
  catalog.ts       # action-only canonical candidates
  compile.ts       # feasibility and service opportunities
  simulate.ts      # pure minute-step projection
  metrics.ts       # metric derivation
  constraints.ts   # hard safety checks
  rank.ts          # normalized scoring and stable tie-break
```

Scenario fixtures belong with real scenario data. Application integration remains in `CommandCenterService`; WebMCP and React receive only compact DTOs from application mappers. Add no runtime dependency for this engine.

## Deadline-safe implementation sequence

1. Add types, immutable model configuration, demand forecasts, explicit vehicle resources, and action-only candidates.
2. Implement compiler, simulator, metrics, constraints, ranking, and pure tests.
3. Integrate evaluation with the current operational snapshot and explicit DTO mapping.
4. Apply the approved plan's stored projection at commit; preserve snapshot/rollback semantics.
5. Show compact calculation provenance and explanation codes in the existing plan comparison.
6. Run the full golden flow, adversarial contract tests, Google/fallback equality, and Chrome 150 smoke test.

If this engine is not fully green by the feature cut line in `docs/CHALLENGE_PLAN.md`, preserve the last stable release rather than submitting a partially migrated decision core.
