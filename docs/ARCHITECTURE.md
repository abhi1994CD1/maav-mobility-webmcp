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

- Run Maps JavaScript API only in the browser with a referrer-restricted key.
- Call Routes API only through a narrow server route handler with an API-restricted server key.
- Normalize allowed responses into an internal route-context DTO and retain it only in memory for the demo session.
- Supply a clearly labelled authored fallback when Routes API is unavailable.

## Planned code boundaries

Implementation should grow into these boundaries as slices require them; do not create empty directories or `.gitkeep` placeholders.

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

## Recovery calculation and Google boundary

1. Generate a small finite set of operationally distinct candidates.
2. Simulate each candidate from the same authored operational snapshot.
3. Calculate metrics in domain code.
4. Reject hard-constraint violations.
5. Rank valid candidates with an explicit weighted score.
6. Return metrics and explanation codes, not only a score.

Primary metrics are on-time arrival percentage, maximum and mean wait, affected and unserved passengers, accessibility violations, spare vehicles, energy delta, and projected recovery time.

For the canonical judging scenario, authored operational inputs determine hard constraints, metrics, and plan ranking. Live Google route or traffic context may enrich map geometry, route context, and informational display, but it is not the sole source of any hard constraint and cannot change the canonical winning plan. The same scenario seed therefore produces the same recovery outcome with live Routes data, different traffic, or the labelled authored fallback. No Google call occurs inside the deterministic simulation loop.

Randomness inside simulation must come only from the scenario's seeded PRNG. Deterministic tests do not read the current wall clock.

## Chrome 150 WebMCP contract

Use the imperative Chrome 150 surface at `document.modelContext`; never read or fall back to `navigator.modelContext`. Add the official `webmcp-types` package as the TypeScript declaration source when implementation begins.

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

One central registry owns every registered tool's registration `AbortController`, desired/registered status, and in-flight execution count.

1. Registration creates one controller and passes its signal to `document.modelContext.registerTool`.
2. The `execute` wrapper increments the tool's in-flight count before validation/use-case dispatch and decrements it in `finally`.
3. A phase change recomputes the desired tool set.
4. If a tool should be removed while its count is nonzero, mark removal pending; do not abort its registration or replace the same name.
5. After the last callback settles, defer removal through a short post-settlement task/grace before aborting that tool's registration controller. Chrome 150 can otherwise reject the caller after the domain mutation has already committed because result delivery is still finishing.
6. If the tool becomes desired again before draining, cancel the pending removal rather than churn the registration.

Do not assume a later Chrome `unregisterTool` API or Chrome-153-or-later lifecycle behavior. Delayed registry removal can briefly leave a stale tool discoverable, so every mutation use case must enforce phase, revision, and approval preconditions at execution time.

The registration controller owns discoverability; it is not the invocation cancellation signal. Invocation cancellation is handled by `execute(input, { signal })` and must not partially commit a mutation. The adapter forwards a supplied invocation signal and provides a non-aborted fallback when Chrome 150's deterministic `executeTool` test path omits the callback options object.

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

Required automated coverage includes deterministic replay, hard-constraint filtering, plan ranking, invalid transitions, stale revisions, approval binding/invalidation/consumption, operational-only rollback, WebMCP validation, the drain-aware state-registration matrix, Routes fallback, and the complete golden flow.

## Deployment

- Vercel application and public GitHub repository.
- No database; in-memory/session state only.
- Environment variables only for keys and map ID.
- Deterministic scenario bundled with the application.
- Build, unit/contract tests, and Linux E2E in CI.
