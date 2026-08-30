# Architecture

## Architectural style

The application is a modular monolith with hexagonal boundaries. UI, WebMCP, and Google integrations are adapters around one application API and a pure domain core.

```text
┌──────────────────────────┐  ┌──────────────────────────┐
│ Human UI adapter         │  │ WebMCP adapter           │
│ React / map / controls   │  │ schemas / registry       │
└─────────────┬────────────┘  └─────────────┬────────────┘
              │ same commands and queries  │
              └─────────────┬──────────────┘
                            ▼
┌─────────────────────────────────────────────────────────┐
│ Application use cases                                   │
│ revision checks • transition checks • atomic repository │
│ domain invocation • event and audit append              │
└───────────────────┬─────────────────────┬───────────────┘
                    │                     │ ports
                    ▼                     ▼
┌────────────────────────────┐  ┌─────────────────────────┐
│ Domain core                │  │ Infrastructure adapters │
│ simulation • constraints   │  │ Google • session state  │
│ scoring • governance       │  │ authored fallback       │
└────────────────────────────┘  └─────────────────────────┘
```

Layer direction is:

```text
UI / WebMCP / Google adapters -> application use cases -> domain model
```

The domain and application layers must not import React, Next.js, browser APIs, Google Maps, WebMCP, or Zustand. A React control and a WebMCP handler for the same capability call the same application use case; neither adapter contains domain rules.

## Runtime responsibilities

### Command-center UI

- Render the Google base map and synthetic operational overlays.
- Render KPIs, incident details, plan comparisons, approval, audit, and reset controls.
- Collect the operator's explicit approval and canonical incident/reset commands.
- Render transient tool status, loading, and recovery animation without changing domain revision.

### Application services

- Validate `expectedRevision` and legal phase transitions.
- Invoke deterministic domain calculations.
- Update the revisioned repository atomically.
- Append domain events and audit records as part of the same mutation.
- Return compact typed DTOs and structured failures.

### Domain core

Pure TypeScript modules own network, fleet, demand, incident, deterministic simulation, recovery constraints and scoring, governance, metrics, and audit event definitions.

Use small pure functions, explicit domain types, discriminated command results, and immutable updates at domain boundaries. Avoid `any`; narrow `unknown`. Keep files focused, use comments for rationale, generate audit timestamps as UTC ISO strings from a simulated service clock, and keep scenario IDs stable and externally opaque.

### WebMCP adapter

- Detect the Chrome 150 `document.modelContext` surface.
- Register precisely state-gated tools through one central registry.
- Runtime-validate every input with Zod.
- Invoke application use cases and serialize the common result envelope.
- Track in-flight executions and defer tool removal until they drain.
- Propagate invocation cancellation to cancellable work.
- Publish invocation status to the ephemeral activity rail.

### Google adapters

- Use the pinned `@vis.gl/react-google-maps` React presentation adapter and its `APIProvider`; do not maintain a second manual Maps JavaScript loader.
- Run Maps JavaScript API only in the browser with the referrer-restricted `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; `NEXT_PUBLIC_GOOGLE_MAP_ID` selects the map style and is not a Routes credential.
- Treat `GOOGLE_ROUTES_API_KEY` as optional and call Routes API only through a narrow server route handler with that API-restricted server key; never send it to the browser.
- Request only traffic-aware duration, static duration, distance, and encoded route geometry for the fixed Rosebank-Sandton segment. Normalize them into a bounded internal route-presentation DTO and retain it only in browser memory for the demo session.
- Supply a clearly labelled authored fallback when Routes API is unavailable.
- Keep map loading, failure, camera, selection, and overlay animation state ephemeral so Google availability never changes domain revision or recovery results.

## Code boundaries

The implementation follows these boundaries. Add deeper modules only when an implemented slice requires them; do not create empty directories or `.gitkeep` placeholders.

```text
src/
  app/                    # Next.js routes and narrow server handlers
  application/            # use cases, commands, queries, and ports
  domain/                 # pure models, governance, simulation, scoring
  infrastructure/
    google/               # Maps and Routes adapters
    webmcp/               # browser adapter and drain-aware registry
    persistence/          # in-memory/session repository adapters only
  features/command-center # React feature composition
  state/                  # Zustand-backed adapters and ephemeral UI state
  ui/                     # reusable presentational components
  data/scenarios/         # authored synthetic scenario seeds
tests/
  unit/
  contract/
  e2e/
```

## Workflow state machine

The authoritative durable phases and forward transitions are:

```text
READY
  -> INCIDENT_ACTIVE
  -> OPTIONS_EVALUATED
  -> PLAN_STAGED
  -> APPROVED
  -> RECOVERED
  -> ROLLED_BACK
```

| From | To | Trigger owner | Use case |
|---|---|---|---|
| `READY` | `INCIDENT_ACTIVE` | Human/demo UI | Activate the canonical incident |
| `INCIDENT_ACTIVE` | `OPTIONS_EVALUATED` | Human UI or WebMCP | Evaluate recovery options |
| `OPTIONS_EVALUATED` | `PLAN_STAGED` | Human UI or WebMCP | Stage one evaluated plan |
| `PLAN_STAGED` | `APPROVED` | Human UI only | Approve the currently staged plan |
| `APPROVED` | `RECOVERED` | Human UI or WebMCP | Commit the approved recovery |
| `RECOVERED` | `ROLLED_BACK` | Human UI or WebMCP | Roll back the committed recovery |

`PLAN_STAGED` means the selected recovery is staged and waiting for explicit human approval. There is no separate `AWAITING_OPERATOR_APPROVAL` phase. `running`, `executing`, `animating`, and similar labels belong to ephemeral UI/tool activity state; there is no durable `APPLYING` phase.

The human-only Reset scenario use case is an exceptional demo control rather than a browser-agent workflow transition. On an existing session it restores canonical operational values, clears evaluated/staged/approval/rollback governance, enters `READY`, appends a reset audit event, and increments revision exactly once. Fresh initialization may start at revision 0. Human incident activation and reset are revision-checked application use cases and are not public WebMCP tools.

An invalid transition or stale command returns a structured failure and changes neither revisioned state nor audit history. The ephemeral activity rail may still display the failed attempt.

## Revisioned state and ephemeral UI state

Revisioned application/domain state contains operational truth and governance:

```ts
type OperationalPhase =
  | "READY"
  | "INCIDENT_ACTIVE"
  | "OPTIONS_EVALUATED"
  | "PLAN_STAGED"
  | "APPROVED"
  | "RECOVERED"
  | "ROLLED_BACK";

interface OperatorApproval {
  planId: string;
  validForRevision: number;
  consumed: boolean;
}

interface OperationalState {
  network: NetworkState;
  fleet: FleetState;
  demand: DemandState;
  simulatedTime: string;
  activeIncident?: Incident;
  metrics: OperationalMetrics;
}

interface CommandCenterState {
  revision: number;
  scenarioId: string;
  phase: OperationalPhase;
  operational: OperationalState;
  evaluatedPlans: RecoveryPlan[];
  stagedPlanId?: string;
  approval?: OperatorApproval;
  lastCommittedOperationalSnapshot?: OperationalSnapshot;
  audit: AuditEvent[];
}
```

Ephemeral UI state is not part of `CommandCenterState`:

```ts
interface CommandCenterUiState {
  mapCamera: MapCamera;
  selectedFeatureId?: string;
  openPanels: PanelId[];
  animationProgress?: number;
  agentActivity: AgentActivityItem[];
  pendingOperations: PendingOperation[];
}
```

Map focus, selection, panel visibility, tool activity rendering, loading/execution indicators, and animation progress never increment domain revision. A read-only tool may visibly focus the map or open a panel through this UI state while leaving revisioned state unchanged.

Zustand may back `CommandCenterUiState` and may implement an infrastructure repository adapter for `CommandCenterState`. Application and domain code depend only on repository ports and never import Zustand.

## Mutation and revision semantics

Every successful domain mutation is one atomic transaction:

1. Compare `expectedRevision` with the current revision.
2. Validate the command and current phase.
3. Calculate the complete next state.
4. Apply operational/governance changes and append required events/audit entries.
5. Increment revision exactly once and publish the result.

The audit append within that transaction does not cause a second revision increment. Failed validation, stale revision, illegal transition, or cancellation before commit produces no domain mutation and no revision increment. Queries and ephemeral UI updates never increment revision.

The canonical revision sequence for a fresh session is:

```text
READY revision 0
human activates incident at expectedRevision 0 -> INCIDENT_ACTIVE revision 1
evaluate at expectedRevision 1              -> OPTIONS_EVALUATED revision 2
stage at expectedRevision 2                 -> PLAN_STAGED revision 3
human approves at expectedRevision 3        -> APPROVED revision 4
commit at expectedRevision 4                -> RECOVERED revision 5
rollback at expectedRevision 5              -> ROLLED_BACK revision 6
```

## Approval protocol

1. `stage_recovery_plan(planId, expectedRevision=2)` verifies revision 2 and an evaluated plan, then returns `PLAN_STAGED` at revision 3.
2. The UI displays that exact staged plan and its calculated impact.
3. The human clicks Approve with `expectedRevision=3`.
4. Approval is one mutation. It returns `APPROVED` at revision 4 and stores:

```json
{
  "planId": "combined_recovery_c",
  "validForRevision": 4,
  "consumed": false
}
```

5. Only after that mutation may the registry expose `commit_approved_recovery`.
6. Commit must atomically require all of the following:
   - current revision equals the command's `expectedRevision`;
   - `approval.validForRevision` equals the current revision;
   - approval `planId` equals the command `planId` and staged plan;
   - `approval.consumed` is `false`;
   - current phase is `APPROVED`.
7. A valid commit captures the operational snapshot, applies the recovery, sets `consumed: true`, appends events/audit, increments revision once, and enters `RECOVERED`.

Any intervening domain mutation invalidates an approval because the current revision no longer equals `validForRevision`; non-commit mutations also clear an unconsumed approval. Registry timing is never an authorization boundary: the commit use case always rechecks every precondition.

## Safe rollback

Rollback never snapshots or restores the entire `CommandCenterState`. Immediately before a valid commit applies operational changes, capture only the values needed to reverse that recovery:

```ts
interface OperationalSnapshot {
  network: NetworkState;
  fleet: FleetState;
  demand: DemandState;
  simulatedTime: string;
  activeIncident?: Incident;
  metrics: OperationalMetrics;
}
```

An `OperationalSnapshot` must not contain or restore:

- `phase`;
- `revision`;
- approval records;
- evaluated or staged-plan governance;
- audit history;
- agent activity or any other UI state.

`rollback_last_recovery` is legal only in `RECOVERED` with a matching `expectedRevision` and an available snapshot. It restores the operational fields, clears evaluated plans, staged-plan state, approval, and the consumed rollback snapshot, appends rollback domain/audit events, increments revision exactly once, and enters `ROLLED_BACK`. Audit history stays append-only. The activity rail remains an independent UI history and is not rewound.

## Deterministic counterfactual decision core

The decision core is a bounded passenger-flow projection, not a lookup table, general route optimizer, LLM, or real transport simulator. `docs/RECOVERY_ENGINE.md` owns the implementable data model, formulas, and acceptance tests.

Its authoritative pipeline is:

```text
current incident snapshot
+ immutable scenario model
+ operator objectives
+ action-only recovery candidates
        |
        v
feasibility compiler
        |
        v
minute-step counterfactual projection
        |
        v
derived metrics
        |
        v
hard-constraint safety kernel
        |
        v
normalized deterministic ranking
```

Candidate definitions may author vehicle assignments, service patterns, headways, activation delays, travel assumptions, and energy rates. They must not contain their final KPI outcomes. Every candidate begins from an independent clone of the same incident snapshot. Evaluation receives operational state; it may not calculate from objectives alone.

The feasibility compiler rejects structurally invalid resource assignments, blocked-segment traversal, and missing reserve capacity before simulation. Insufficient accessible service remains a visible calculated outcome: the simulator reports the accessibility deficit and the hard-constraint kernel rejects the plan. The simulator also derives on-time percentage, maximum and mean wait, affected and unserved passengers, spare vehicles used, energy delta, and recovery time. Hard constraints run before soft scoring; a score can never compensate for an accessibility failure.

An evaluated plan stores the exact candidate-specific operational projection reviewed by the human. Commit applies that stored projection only after the existing approval and revision checks. It does not recalculate against changed inputs and does not apply a shared hardcoded recovery mutation. Rollback continues to restore the narrow pre-commit `OperationalSnapshot`.

Application mappers expose compact plan summaries, metric deltas, bounded explanation codes, score components, and calculation provenance. They never spread internal cohorts, assignments, or projections into WebMCP or UI results.

### Integration seam, not integration claim

The authored scenario provider is the current operational-input adapter. The domain core accepts internal operational types rather than vendor payloads. A future fleet-management adapter could normalize an incumbent snapshot into those types, but this repository does not implement or claim a live fleet connector, dispatch write-back, safety certification, or customer deployment.

### Google boundary

Live Google route or traffic context may enrich map geometry, bounded route context, and informational display. It is not an input to canonical hard constraints or scoring. Runs with `GOOGLE`, different live delay, or `AUTHORED_FALLBACK` must therefore produce byte-identical canonical plan metrics and ranking. No Google call occurs inside the deterministic decision core.

The full North Spine remains the authored simulated operational corridor in `OperationalState`. Google Routes supplies a road-shaped presentation overlay only for the fixed Rosebank-Sandton affected segment. On a Google Maps surface, the authored spine remains visible as a subdued operational backbone while the Google segment is prominent and receives the simulated `HEALTHY`, `DISRUPTED`, or `RECOVERED` status colour. When Routes is unavailable or invalid, the authored operational path becomes the prominent route. The authored SVG never attempts to reproduce Google geometry.

The infrastructure-owned route-presentation DTO adds `staticDurationSeconds` and an optional bounded `encodedPolyline` to the existing informational route metrics. It exists only in ephemeral UI state. Encoded geometry is never placed in `CommandCenterState`, `OperationalSnapshot`, audit, approval, recovery plans, application commands, or WebMCP results, and is never persisted. `delaySeconds` is `max(0, traffic-aware duration - static duration)`; it is a traffic-aware session snapshot, not a continuous feed, fleet truth, passenger truth, or recovery-scoring input.

The four presentation outcomes are authoritative:

| Maps JavaScript | Routes context | Label | Route rendering |
|---|---|---|---|
| Ready | Google | `GOOGLE MAPS + ROUTES CONTEXT` | Subdued authored spine plus prominent encoded Google segment |
| Ready | Authored fallback | `GOOGLE MAPS • AUTHORED ROUTE FALLBACK` | Prominent authored operational path |
| Unavailable | Google | `AUTHORED MAP • GOOGLE ROUTE CONTEXT` | Authored SVG only; normalized Google metrics remain informational |
| Unavailable | Authored fallback | `AUTHORED MAP + ROUTE FALLBACK` | Fully authored deterministic presentation |

The model uses no wall-clock time or unseeded randomness. Any future stochastic behavior must use the scenario's explicit seeded PRNG and preserve reproducible tests.

## Human-authorized WebMCP capability choreography

WebMCP is a phase-shaped capability surface, not a static RPC menu. Domain phase determines which consequential capability is discoverable, while application preconditions remain the authorization boundary.

```text
INCIDENT_ACTIVE     -> evaluate capability
OPTIONS_EVALUATED  -> stage capability
PLAN_STAGED        -> no agent commit capability
human approval     -> revision-bound commit capability appears
RECOVERED          -> rollback capability replaces commit
```

This creates four independent protections:

1. discovery communicates the legal next action;
2. runtime schemas reject malformed requests;
3. phase, revision, plan, and approval checks reject stale or replayed calls;
4. the visible UI retains the human-only decision.

The snapshot query returns compact recovery context after agent context loss: next actor/action, recommended/staged/approved plan IDs when present, and rollback availability. It returns no approval secret or unrestricted state.

Tool results are domain-authoritative. Ephemeral activity, announcements, panel focus, and animation are best-effort effects after the application result exists. A rendering failure must not convert a committed mutation into an `INTERNAL_ERROR` response.

Trusted tool results do not reflect arbitrary caller text. In particular, invalid plan identifiers produce stable generic errors. User-supplied rollback reasons appear only through the audit output that declares `untrustedContentHint: true`.

## Chrome 150 WebMCP contract

Use the imperative Chrome 150 surface at `document.modelContext`; never read or fall back to `navigator.modelContext`. Use the official `webmcp-types` package as the TypeScript declaration source.

Each registered definition includes:

```ts
{
  name,
  title,
  description,
  inputSchema,
  annotations,
  execute: async (input, { signal }) => { /* adapter -> use case */ }
}
```

`inputSchema` is serializable JSON Schema and Zod validates the input again at runtime. The invocation `signal` is propagated to cancellable route requests and other asynchronous work. Do not add an `outputSchema` field unless the target WebMCP API is deliberately upgraded and the contract is reviewed.

### Drain-aware registration lifecycle

One central coordinator owns the latest desired phase and serializes/coalesces reconciliation. One central registry owns every registered tool's registration `AbortController`, desired/registered status, and in-flight execution count. Overlapping phase notifications must converge on the newest desired tool set even when `registerTool()` promises resolve out of order.

1. A phase notification replaces the coordinator's desired definitions; it does not start an independent reconciliation race.
2. Registration creates one controller and passes its signal to `document.modelContext.registerTool`.
3. The `execute` wrapper increments the tool's in-flight count before validation/use-case dispatch and decrements it in `finally`.
4. If a tool should be removed while its count is nonzero, mark removal pending; do not abort its registration or replace the same name.
5. After the last callback settles, defer removal through a short post-settlement task/grace before aborting that tool's registration controller. Chrome 150 can otherwise reject the caller after the domain mutation has already committed because result delivery is still finishing.
6. If the tool becomes desired again before draining, cancel the pending removal rather than churn the registration.
7. Reconciliation repeats until the registered set equals the newest desired set.
8. Bridge teardown remains authoritative until registrations and in-flight executions have drained; a remount must not create a second registry for the same document during teardown.

Do not assume a later Chrome `unregisterTool` API or Chrome-153-or-later lifecycle behavior. Delayed registry removal can briefly leave a stale tool discoverable, so every mutation use case must enforce phase, revision, and approval preconditions at execution time.

The registration controller owns discoverability; it is not the invocation cancellation signal. Invocation cancellation is handled by `execute(input, { signal })` and must not partially commit a mutation. The adapter forwards a supplied invocation signal into actual cancellable work and provides a non-aborted fallback when Chrome 150's deterministic `executeTool` test path omits the callback options object. Pure synchronous mutations check a pre-aborted signal before their atomic mutation; do not add artificial delays solely to demonstrate cancellation.

## WebMCP browser security

- WebMCP requires a secure, origin-isolated/origin-keyed document and is gated by the `tools` Permissions Policy.
- Do not enable or assign `document.domain`, because it defeats origin-keyed isolation.
- This project needs only top-level same-origin tools; do not configure cross-origin iframe exposure.
- Handle unavailable API, `SecurityError`, and `NotAllowedError` as setup failures without breaking the manual UI.
- Read-only tools use `readOnlyHint: true`.
- Use `untrustedContentHint: true` only for a tool whose actual result includes untrusted external or user-supplied content.
- Prefer normalized codes, numbers, and authored labels over raw third-party free-form text.
- Never return keys, approval internals beyond safe status, stack traces, or unrestricted mutation capabilities.

## Failure strategy

- Google error: use the labelled authored fallback and continue the full workflow.
- Unsupported or disallowed WebMCP: keep the manual UI usable and show setup guidance.
- Invalid input: return the common structured failure with a corrective action.
- Stale command: return current metadata and ask the agent to re-inspect.
- Illegal transition or invalid approval: no mutation; report the legal next action.
- Aborted cancellable work: return an aborted failure if no mutation committed.
- Domain calculation failure: preserve the previous immutable state.

## Verification environment

The local development target is:

- macOS 12.7.6;
- Intel x86_64;
- Google Chrome 150;
- WebMCP testing flag enabled.

Local hard gates are lint, typecheck, Vitest unit/contract tests, production build, and a manual Chrome 150 real-WebMCP smoke test. The latest locally downloaded Playwright browser is not a development prerequisite. Full Playwright E2E, including the golden flow, may run in Linux CI.

Required automated coverage includes deterministic replay, candidate feasibility, passenger conservation, monotonic demand/capacity/energy properties, objective sensitivity, hard-constraint filtering, plan ranking, invalid transitions, stale revisions, approval binding/invalidation/consumption, candidate-specific commit, operational-only rollback, WebMCP validation, serialized drain-aware registration, stale/replayed/simultaneous calls, trusted/untrusted output handling, Routes fallback equality, and the complete bridge-driven golden flow.

## Deployment

- Vercel application and public GitHub repository.
- No database; in-memory/session state only.
- Environment variables only for keys and map ID.
- Deterministic scenario bundled with the application.
- Build, unit/contract tests, and Linux bridge-driven E2E in CI.
- The submitted release SHA must have green public CI, a discoverable HTTPS URL, and a dated native Chrome 150 evidence report.
