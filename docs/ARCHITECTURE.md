# MAAV Stress Lab Architecture

## Status and ownership

This document owns target system boundaries, dependency direction, artifact
flow, state ownership, adapter responsibilities, and atomic command behavior.
Gates 3–5 implement deterministic inputs, verified simulations, trusted
comparisons, and deterministic finding candidates. Gate 6 implements the
headless application authority described below; the current browser runtime
remains separate until later gated slices integrate it through that boundary.

## Architectural style

MAAV Stress Lab is a modular monolith with hexagonal boundaries:

```text
React manual UI ───────────────┐
Six static WebMCP adapters ────┼──> StressLab application service
                              │             │
Google/SVG/list projections ──┘             ├──> pure deterministic domain
Zustand repository adapter <────────────────┘
```

Dependency direction is:

```text
UI / WebMCP / Google / Zustand adapters
                  ↓
          application services
                  ↓
               domain
```

The domain and application layers must not import React, Next.js, Zustand,
Google Maps, browser APIs, WebMCP APIs, network clients, or presentation state.
They must not read `Date.now()`, `Math.random()`, animation frames, browser
locale ordering, or live Google responses when producing evidence.

## Artifact lifecycle

The lab does not use one linear global workflow phase. Scenario A and Scenario B
may independently have current or historical runs. The authoritative lifecycle
is a graph of immutable artifacts:

```text
Scenario Revision
  -> Run Artifact
  -> Comparison Artifact
  -> Finding Artifact
  -> Human Review
```

- A configuration or disruption change creates a new scenario revision.
- A run captures one immutable scenario revision, shared demand fingerprint,
  engine version, network version, seed, and disruption set.
- A comparison references two explicit compatible completed run IDs.
- A finding references one comparison and an evidence hash.
- Accept or Challenge references the exact current finding/evidence version.

Artifacts are never rewritten. A currentness selector may mark historical runs,
comparisons, and findings stale when their inputs are no longer current.
Historical evidence remains inspectable.

## H0 context and controlled treatment

The canonical experiment shares:

- versioned network `sandton-rosebank-v1`;
- 120-request seed-07 demand trace;
- 08:30–09:00 horizon with 30-second ticks;
- metric-definition and engine versions;
- maximum wait of 180 seconds;
- minimum battery reserve of 20%.

Scenario A has 12×8 seats and Scenario B has 10×10 seats. Each receives an
equivalent failure at 08:42. The target is resolved independently by highest
onboard occupancy, then reserved-passenger count, active-service state, and
ascending vehicle ID. Equal rule, time, demand, engine, and network define the
controlled treatment; equal vehicle IDs are not required.

## Layer responsibilities

### Domain

Pure TypeScript domain modules own:

- versioned generic-network and scenario types;
- seeded passenger trace generation;
- the causally restricted synchronous controller-observation/intent port;
- authoritative intent validation plus deterministic dispatch, movement,
  boarding, service, battery, energy, failure, and recovery;
- replay-complete immutable events, verified-input-bound pure event replay, and
  authoritative replay snapshots committed by the result fingerprint;
- metric and hard-constraint derivation;
- artifact compatibility and deltas;
- evidence-bound finding candidates;
- canonical serialization plus separate event-ledger and final-result
  fingerprints; the latter commits every ordered snapshot as well as terminal
  state, KPIs, and constraints;
- invariants and safe failures.

The domain never authors final KPI tables, preferred-scenario constants, or
agent prose. `docs/SIMULATION_ENGINE.md` owns exact simulation rules.

Trusted artifact ingestion is stricter than hashing. Event validation is
recursively closed-world and binds every zone, edge, ordered edge fact, and path
to the verified canonical network. A movement leg is trusted only when one
state-aware replay validator also derives its origin, destination, reservation
ownership, and passenger cohort from the already-replayed vehicle state and
immutable requests. This binding permits any connected authored path between
those endpoints; replay neither imports the router nor requires its preferred
path. The public
`verifyTrustedSimulationResult` boundary accepts input, ledger, and result
together, replays every supplied snapshot's documented post-tick ledger prefix,
checks the terminal state, then verifies canonical result bytes and identity.
The engine may use an internal result-fingerprint construction helper for its
own already-derived artifact; that helper is not exported as a semantic trust
decision. A hash proves byte identity, not domain truth.

### Application

One framework-independent `StressLabService` boundary owns:

- queries and commands shared by manual UI and WebMCP;
- complete validation and normalization before mutation;
- expected-revision and idempotency checks;
- prerequisite, compatibility, and stale-evidence enforcement;
- cancellation propagation;
- local computation against immutable inputs;
- compare-and-swap repository commit;
- durable audit append and safe result mapping;
- human-only Accept, Challenge, and Reset commands.

No adapter may bypass this service to mutate revisioned state.

Gate 6 exposes the headless commands `configureScenario`,
`injectDisruption`, `runScenario`, `cancelRun`, `compareScenarios`, and
`stageFinding`, plus the human-only `acceptFinding`, `challengeFinding`, and
`resetLab` commands. `readLabState` returns a deeply frozen projection rather
than internal repository objects. This is an application API, not the Gate 7
WebMCP schema or tool export.

The headless staging command is closed-world:

```ts
{
  operationId: string;
  expectedRevision: number;
  comparisonId: string;
  selectedOutcome: "A" | "B" | "TRADE_OFF" | "INCONCLUSIVE";
  emphasis: "BALANCED" | "SERVICE" | "ENERGY" | "RESILIENCE";
}
```

Unknown fields fail before mutation. In particular, there is no caller-supplied
claim ID or numeric-evidence field.

### Gate 6 authority model

Application currentness uses two independent authorities:

```text
ScenarioRevisionRef
  = slot + monotonically increasing revision + prepared-input fingerprint

OperationToken
  = caller operation ID + target + target generation
    + captured ScenarioRevisionRefs + reserved artifact ID
```

A fingerprint proves content identity. A scenario revision proves that the
content is still authoritative. Replacing a scenario with byte-identical input
therefore creates a new revision and prevents edit/revert ABA publication.

Starting, restarting, cancelling, resetting, or invalidating work advances the
target generation. Run A, Run B, and comparison have separate targets. Every
progress report and terminal transition carries the originating token; a token
whose operation ID or generation no longer owns the target is ignored or fails
as stale. Progress is an ephemeral projection and does not increment the
application revision, enter audit evidence, or affect a trusted fingerprint.

Every mutating command requires an expected application revision and a
caller-supplied operation ID. A tab-scoped operation cache installs a pending
record before command execution so same-ID/same-command retries—including
subscriber re-entry—share one terminal promise. Reusing the ID with a different
canonical command fails as `IDEMPOTENCY_CONFLICT`. Application command
identities, revisions, generations, operation IDs, cancellation state, and
review feedback are excluded from Gate 3–5 evidence.

Invocation authority is a separate, trusted application argument rather than a
tool-command field. Adapters must pass exactly one frozen application context:
`HUMAN_UI` or `WEBMCP`. The source is included in the application-only command
identity and operation token, then atomically appended to every durable audit
entry with the operation, revisions, status, and artifact references. The same
operation ID and source remains idempotent; reusing an operation ID from a
different source fails closed. Source never enters a scenario, run,
comparison, finding candidate, or trusted fingerprint. Audit records contain no
raw prompt, passenger record, unsafe label, wall-clock timestamp, or duration.
`Accept`, `Challenge`, and deterministic Reset reject a `WEBMCP` context even
though all other application commands share the same service boundary.

Run publication follows one guarded path:

1. capture the current scenario revision and immutable prepared input;
2. reserve a new target generation and publish the active token;
3. compute outside the repository transition;
4. verify input, ledger, every snapshot, terminal state, and result through
   `verifyTrustedSimulationResult`;
5. re-enter one compare-and-swap transition;
6. recheck token ownership, generation, cancellation, scenario revision, and
   prepared-input fingerprint;
7. publish one complete run record and current pointer.

Cancellation may avoid computation, but token/generation and revision checks
are the correctness boundary. A cancelled, failed, superseded, or stale run
publishes no partial result and cannot erase the last completed current run for
the same unchanged scenario. This is exactly-once accepted publication inside
one process and repository instance; the project makes no distributed
exactly-once, durable-delivery, or outbox claim.

The service stores the exact same-process `VerifiedRunResultArtifact` returned
by Gate 4 and passes that exact object to `createTrustedRunComparison`. It never
clones, casts, serializes, hydrates, or reconstructs attestation from a hash.
Persistence or transport must rerun the complete Gate 4 verifier and is outside
Gate 6.

A comparison publishes only while both captured scenario revisions and both
exact current run objects still match. Gate 5 owns compatibility and arithmetic;
`StressLabService` propagates `StressLabComparisonError` unchanged and commits
no partial comparison. A new current run, either scenario edit, or reset makes
dependent comparison and finding pointers stale transitively while immutable
historical records remain inspectable.

Finding staging accepts exactly a current comparison ID, a proposed outcome
(`A`, `B`, `TRADE_OFF`, or `INCONCLUSIVE`), and an operational emphasis
(`BALANCED`, `SERVICE`, `ENERGY`, or `RESILIENCE`), plus application revision
and operation metadata. The caller cannot select claim IDs or supply KPI,
delta, constraint, score, ranking, caveat, evidence fingerprint, or conclusion
content. The domain builder deterministically selects at most three exact rows
from the trusted comparison and adds bounded versioned caveats. Accept and
Challenge update a separate application review record only while that finding
is current; they cannot alter run, comparison, claim, caveat, or evidence
identities and do not dispatch or execute anything.

### Repository adapter

The application depends on a repository port, not Zustand. The H0
infrastructure adapter keeps tab-scoped in-memory/session state and supports an
atomic compare-and-swap commit.

Gate 6 defines this port and uses a controlled in-memory test adapter. The
Zustand implementation remains Gate 8 work; neither the domain nor the Gate 6
service imports Zustand.

Repository responsibilities:

- return immutable state snapshots;
- atomically commit only when the expected workspace revision still matches;
- notify subscribers after commit;
- retain immutable artifacts and current pointers;
- keep operation/idempotency records within the tab session.

It does not calculate simulation results, infer tool prerequisites, or contain
React behavior.

### WebMCP adapter

The browser adapter:

- detects Chrome 150 `document.modelContext`;
- statically registers the exact six tools once after the store is ready;
- validates strict input again at runtime;
- injects trusted actor/source context;
- forwards the invocation `AbortSignal`;
- calls the shared application service;
- serializes compact common envelopes;
- renders best-effort visible activity after obtaining the authoritative result.

All tools remain discoverable. Application-level preconditions return structured
errors for premature calls. Registration timing is not authorization.

### Human UI

The React UI:

- edits and validates A/B scenario drafts through application commands;
- invokes the same run, disruption, comparison, and staging services as tools;
- projects immutable replay evidence into forms, metrics, timeline, map, and
  fallback surfaces;
- displays stale/current/compatible status and tool activity;
- exposes human-only Accept, Challenge, and deterministic Reset;
- never calculates an alternate KPI or directly mutates Zustand domain state.

### Google and fallback adapters

Google Maps renders geographic context from an infrastructure-owned
presentation model. It may provide:

- enterprise basemap and attribution;
- Advanced Markers;
- authored route/network overlays;
- supported GeoJSON, polygon, and line layers;
- selection and interaction.

Both Google and the authored SVG/list fallback consume the same replay-derived
presentation frame. Neither executes the simulator or changes evidence.

## State ownership

### Revisioned application/domain state

Revisioned state includes:

- workspace revision and experiment identity;
- fixed engine, network, metric, demand, horizon, and seed references;
- immutable scenario revisions;
- immutable run artifacts and their ledgers/snapshots;
- immutable comparison artifacts;
- finding artifacts and human-review records;
- current artifact pointers and stale/current derivation inputs;
- idempotency records where retained with the session;
- append-only sanitized audit entries.

Every successful domain mutation increments workspace revision exactly once.
Queries do not.

### Ephemeral UI and operation state

Ephemeral state includes:

- map readiness, camera, bounds, layers, and selected object;
- active panel, dialog, focus restoration, and disclosure state;
- playback time, speed, animation interpolation, and reduced-motion projection;
- transient form editing before application submission;
- tool/manual activity rendering and wall-clock duration;
- genuine run progress and cancellable operation handles;
- notices, loading, error presentation, and map retry state.

Ephemeral changes never increment workspace revision, create evidence, alter an
artifact fingerprint, or invalidate a finding.

## Command transaction

Every mutation follows one atomic path:

1. receive trusted source plus strictly validated command;
2. compare `expectedRevision`;
3. resolve idempotency by operation ID and canonical arguments;
4. validate lifecycle prerequisites and artifact currentness;
5. capture immutable engine/network/demand/scenario/disruption inputs;
6. check cancellation;
7. calculate complete next state or artifact locally;
8. validate domain invariants and supported evidence;
9. check cancellation immediately before commit;
10. compare-and-swap the state and append audit once;
11. wait until subscribers can observe the resulting revision;
12. return the authoritative envelope;
13. render best-effort ephemeral activity.

Validation, prerequisite, compatibility, cancellation, calculation, or
revision failure produces no partial mutation. If another command wins the
race, return `REVISION_CONFLICT`; do not silently rebase consequential work.

## Revision and idempotency

- Every mutator requires the current workspace revision.
- Two writes against one revision produce at most one success.
- Every mutating WebMCP call requires an operation ID.
- Same ID, same tool, and same canonical arguments return the original terminal
  result without another artifact or revision.
- Same ID with different tool or arguments returns
  `IDEMPOTENCY_CONFLICT`.
- A cancelled operation ID is terminal; a corrected retry uses a new ID.
- Late results may be retained as explicit historical evidence only when the
  contract allows it; they never replace newer current state.

## Cancellation

The invocation cancellation signal flows:

```text
WebMCP/UI operation
  -> application validation
  -> optional route-preparation presentation work
  -> deterministic tick loop
  -> metric/result assembly
  -> atomic commit guard
```

The pure engine itself remains deterministic; an async wrapper yields
periodically for responsiveness. Yield timing never enters events, metrics, or
fingerprints. Cancellation produces exactly one terminal state,
`COMPLETED` or `CANCELLED`, never both. A cancelled run publishes no
comparison-ready KPI set and cannot later ghost-commit.

## Deterministic evidence boundary

Evidence-changing inputs are limited to versioned authored and user-configured
experiment data:

| Input | Evidence authority |
|---|---|
| Network distance/travel time | Versioned authored fixture |
| Passenger arrivals | Shared seeded demand trace |
| Fleet and constraints | Immutable scenario revision |
| Failure | Immutable disruption specification and deterministic selector |
| Events and vehicle/passenger state | Simulation engine |
| Metrics and hard constraints | Event-ledger fold |
| Comparison deltas | Compatible explicit run artifacts |
| Finding claims | Deterministic evidence builder |

These are presentation-only and cannot change evidence:

- Google basemap, route enrichment, or availability;
- map camera, selection, and layers;
- SVG versus Google renderer;
- playback speed and animation;
- browser-agent wording;
- UI wall-clock timestamps and activity duration.

## Comparison and finding safety

`createTrustedRunComparison` is the domain trust boundary. Each operand contains
a recomputed, validated `PreparedRunInput` plus the exact
`VerifiedRunResultArtifact` returned by the Gate 4 verifier. The compile-time
brand has a same-process runtime attestation: copying, serializing, casting, or
rehashing a result does not preserve trust. A serialized result must pass the
full input/ledger/snapshot/result verifier again before comparison.

The domain compares only after proving equality of network and demand
identities, seed, horizon, terminal evaluation, input and execution versions,
controller contract, metric definition, hard constraints, non-size fleet and
energy assumptions, objectives, and the semantic disruption schedule. The
only H0 differences are scenario slot and label, vehicle count, seats per
vehicle, and the scenario-local disruption identifier. Actual differences are
recorded in the artifact. Any other mismatch throws `INCOMPARABLE_RUNS` with
the exact path and left/right values; no partial comparison is returned.

Application services additionally require the two completed artifacts to be
current for their scenario revisions. That currentness rule is not inferred by
the headless comparison domain from scenario names or UI selection.

The comparison artifact contains every published KPI with explicit unit and
signed `rightMinusLeft = right - left` delta. Relative differences use integer
basis points; a zero left denominator is explicitly `N/A`. Constraint rows use
`BOTH_PASS`, `BOTH_FAIL`, `LEFT_PASS_RIGHT_FAIL`, or
`LEFT_FAIL_RIGHT_PASS`. At most three deterministic structured claims cite
their exact values, units, evidence IDs when available, and input/ledger/result
fingerprints. They are evidence references, not prose, an optimizer, a score,
or a winner selection.

`comparison-schema-v1` is canonically serialized with domain separation and
SHA-256. Operand order is meaningful: swapping operands produces a new valid
identity and reverses all signed absolute deltas. UI state, operation IDs,
wall-clock time, Google context, and agent wording are absent from the identity.

`createFindingCandidate` accepts only the exact runtime-trusted comparison plus
the proposed outcome and emphasis. `finding-schema-v1` owns the candidate
shape, `finding-template-v1` owns bounded renderer wording, and
`finding-policy-v1` owns eligible metric families, exact selection arithmetic,
materiality thresholds, constraint precedence, and tie-breaking. All published
values, units, deltas, transitions, and input/ledger/result references are
copied from the comparison; transient selector arithmetic never becomes a KPI,
score, or returned magnitude.

The policy maintains one exhaustive registry over every published comparison
metric. It excludes controlled demand, redundant outcomes, and diagnostics from
selection; eligible rows are classified as service, resilience, energy, or
utilization with an explicit direction and unit. The candidate has up to three
ordered slots:

1. the canonically first genuine `LEFT_PASS_RIGHT_FAIL` or
   `LEFT_FAIL_RIGHT_PASS` hard-constraint transition;
2. the largest non-zero service/resilience difference allowed by the emphasis;
3. the largest material energy/utilization difference.

Metric magnitude is the exact ratio
`abs(B - A) / max(abs(A), abs(B))`. Ratios are compared through transient
integer cross multiplication, never floating-point ranking or cross-unit raw
deltas; exact ties use the metric key. `SERVICE` and `RESILIENCE` use their own
family before the documented fallback, while `BALANCED` and `ENERGY` rank the
combined operational pool. No emphasis supplies weights or a composite score.

Energy evidence is material only at 100 Wh and 5%, energy/passenger-km at one
native integer unit and 5%, and utilization at 100 basis points. These are H0
presentation thresholds, not statistical significance. Recovered versus not
recovered is a categorical resilience difference; both recovered ranks the
numeric duration, both not recovered becomes a caveat, and genuine no-
disruption N/A remains distinct. A constraint slot suppresses only its exact
duplicate metric row.

`selectedOutcome` never affects factual selection or ordering. After selection,
direction metadata classifies opposing service/resilience and efficiency facts
as `OPPOSING_TRADE_OFF`; aligned facts remain a material efficiency difference.
A proposed `TRADE_OFF` cannot manufacture opposition and receives a bounded
caveat when the selected evidence does not establish it. Every failed hard
constraint remains a deterministic caveat, including shared `BOTH_FAIL`
outcomes that are not scenario differences.

The finding fingerprint is the domain-separated canonical identity of the
finding, template, and policy versions, comparison fingerprint, proposed
outcome, emphasis, evidence relationship, generated claims, and caveats.
Operation IDs, application revisions,
wall-clock, UI, browser, and WebMCP state are excluded. This is proposed
decision evidence with `PENDING_REVIEW` application review—not acceptance,
certification, recommendation, or operating authority.

Accept and Challenge are visible human commands. They bind the exact finding
and evidence version. Acceptance is neither operational authorization nor
scientific certification.

## Google boundary and degradation

The simulator reads only the frozen authored network fixture. Google never
determines distance, travel time, dispatch, battery, energy, constraints,
comparison, preferred scenario, or finding.

Browser Maps and optional server Routes keys remain separate and restricted.
No Google response, route polyline, place content, or key enters revisioned
state, the event ledger, artifact fingerprints, audit evidence, or tool output.

On missing key, authentication error, quota, timeout, or network failure:

```text
Google presentation DEGRADED
  -> authored interactive SVG
  -> structured zones/routes/vehicles/disruptions list
  -> unchanged simulator, tools, evidence, and human review
```

The UI labels degradation honestly and preserves Google attribution whenever a
Google surface is present.

## Security and failure strategy

- Use a secure origin-isolated top-level document allowed by the `tools`
  Permissions Policy; never set `document.domain`.
- Validate all IDs, labels, enums, units, ranges, revisions, operation IDs,
  and artifact relationships.
- Bound and render user-authored labels/challenge feedback as text.
- Return structured safe errors; never return keys, raw prompts, storage,
  stack traces, unrestricted URLs, or unnecessary third-party prose.
- A hostile label cannot change tool order, authority, evidence, or rendering
  behavior.
- Internal invariant failure returns `ENGINE_INVARIANT_FAILED` and no
  complete metrics.
- Unsupported WebMCP keeps the entire manual workflow available and records no
  fake agent activity.

## Intended implementation map

Implementation is additive at `/lab` until every H0 gate is green. The
approved planning sources contain the sequenced repository map. Do not create
the folders below during Gate 1:

```text
domain/stress-lab
application stress-lab service and repository port
infrastructure WebMCP, persistence, Google and fallback adapters
features/stress-lab React composition
tests unit, contract and E2E
```

Only after the manual flow, real WebMCP flow, build, deployment smoke, and
fallback paths pass may the root route cut over and legacy runtime code be
removed. The tagged superseded product remains a release contingency, not part
of Stress Lab.

## Documentation ownership

- Product behavior and scope: `docs/PRODUCT.md`
- Simulation and metrics: `docs/SIMULATION_ENGINE.md`
- Exact WebMCP contracts: `docs/WEBMCP_TOOLS.md`
- Demonstration: `docs/DEMO.md`
- Deadline/release strategy: `docs/CHALLENGE_PLAN.md`
- Full approved planning source: `docs/plans/stress-lab/`
