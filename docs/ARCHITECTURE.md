# Architecture

## Architectural style
A modular monolith with hexagonal boundaries and an evented application state.

This gives the project enterprise-grade separation without the delivery risk of microservices.

```text
┌──────────────────────────────────────────────────────────────┐
│                     Browser / Next.js UI                     │
│  Google Map  KPI strip  Incident rail  Plans  Approval UI   │
└───────────────────────┬──────────────────────────────────────┘
                        │ human commands
                        │
┌───────────────────────▼──────────────────────────────────────┐
│                     Application Layer                        │
│ InspectNetwork  EvaluateOptions  StagePlan  ApprovePlan      │
│ CommitPlan      RollbackPlan    ReadAudit                    │
│ state revision • command validation • event publication      │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
                │ same use cases                │ ports
                │                               │
┌───────────────▼──────────────┐   ┌────────────▼──────────────┐
│      WebMCP Adapter          │   │   Google/External Adapters │
│ register/unregister tools    │   │ Maps JS • Routes API       │
│ schemas • hints • tool logs  │   │ session cache • fallback   │
└──────────────────────────────┘   └────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│                        Domain Core                            │
│ Network • Vehicle • Demand • Incident • Constraint • Plan    │
│ deterministic simulation • metrics • scoring • state machine │
└──────────────────────────────────────────────────────────────┘
```

## Critical principle
The UI and WebMCP are two adapters over the same application API.

A React button may call `stageRecoveryPlan.execute(command)`. A WebMCP tool calls that exact same use case. Neither contains domain rules.

## Runtime components

### 1. Command-center UI
Responsibilities:
- render Google Map and authored overlays;
- show live simulated state;
- show tool invocation status;
- compare recovery plans;
- collect explicit approval;
- expose reset, replay, and rollback controls.

### 2. Application services
Responsibilities:
- authorize state transitions;
- validate expected revision;
- invoke domain calculation;
- update the state repository atomically;
- append domain and audit events;
- return compact result DTOs.

### 3. Domain core
Pure TypeScript. No framework imports.

Core modules:
- `network`: stops, corridors, links, route topology;
- `fleet`: vehicles, capacity, accessibility, availability;
- `demand`: seeded passenger arrival and queue state;
- `incident`: disruption effects and affected entities;
- `simulation`: deterministic state advancement;
- `recovery`: candidate generation, hard constraints, metrics, ranking;
- `governance`: workflow state and legal transitions;
- `audit`: event definitions.

### 4. WebMCP adapter
Responsibilities:
- detect browser support;
- register valid tools for the current workflow state;
- unregister tools when invalid;
- translate JSON input into application commands;
- runtime-validate with Zod;
- annotate read-only and untrusted data;
- capture invocation telemetry for the visible activity rail;
- return structured errors without stack traces.

### 5. Google adapters
- Maps JavaScript API runs in the browser with a referrer-restricted browser key.
- Routes API is invoked only through a Next.js server route handler with an API-restricted server key.
- Route responses are normalized into the internal `RouteContext` port.
- Responses are held in memory for the current session only.
- An authored synthetic fallback preserves the demo when Google is unavailable.

## State model

```ts
type OperationalPhase =
  | "READY"
  | "INCIDENT_ACTIVE"
  | "OPTIONS_EVALUATED"
  | "PLAN_STAGED"
  | "AWAITING_OPERATOR_APPROVAL"
  | "APPROVED"
  | "APPLYING"
  | "RECOVERED"
  | "ROLLED_BACK";

interface CommandCenterState {
  revision: number;
  scenarioId: string;
  simulatedTime: string;
  phase: OperationalPhase;
  network: NetworkState;
  activeIncident?: Incident;
  evaluatedPlans: RecoveryPlan[];
  stagedPlanId?: string;
  approval?: OperatorApproval;
  lastCommittedSnapshot?: StateSnapshot;
  audit: AuditEvent[];
}
```

Every mutation increments `revision`. State-changing commands carry `expectedRevision`. A stale command fails without mutation.

## Recovery calculation

1. Generate a small finite set of operationally distinct candidates.
2. Simulate each candidate against the same snapshot.
3. Calculate metrics in code.
4. Reject candidates violating hard constraints.
5. Rank remaining candidates with an explicit weighted score.
6. Return metrics and reasons, not only a score.

Primary metrics:
- on-time arrival percentage;
- maximum wait;
- mean wait;
- affected and unserved passengers;
- accessibility violations;
- spare vehicles required;
- energy delta;
- projected recovery time.

## Approval protocol

1. Agent stages `planId` at `revision N`.
2. Application enters `AWAITING_OPERATOR_APPROVAL`.
3. Visible UI shows full before/after impact.
4. Human clicks Approve.
5. Approval is bound to `planId` and `revision N`.
6. Application enters `APPROVED` and dynamically exposes `commit_approved_recovery`.
7. Agent commits with the matching plan and revision.
8. Commit consumes approval, records a snapshot, applies events, and increments revision.
9. Any state change before commit invalidates approval.

## Failure strategy
- Google error: use labelled synthetic route context and continue.
- Unsupported WebMCP: app remains manually demonstrable and shows setup guidance.
- Invalid tool input: return structured corrective error.
- Stale command: return current revision and suggested re-inspection.
- Illegal transition: no mutation; show valid next actions.
- Simulation error: restore previous immutable snapshot.

## Deployment
- Vercel application.
- Public GitHub repository.
- No database.
- Environment variables only for keys and map ID.
- Deterministic scenario bundled with the application.
- Build and smoke-test in CI.
