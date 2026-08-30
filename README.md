# Nexus Mobility Recovery Command

A premium, human-governed mobility disruption recovery command center built for the OpenAI WebMCP Challenge.

The application exposes six real browser-native WebMCP tools in Google Chrome 150. A browser agent can inspect a deterministic synthetic transport network, evaluate code-scored recovery plans, stage one plan, wait for explicit operator approval, commit only the approved revision, inspect the audit trail, and roll back operational state without erasing governance history.

> **SIMULATED OPERATIONS • GOOGLE MAPS CONTEXT**
> This is a decision-support digital twin, not a real transport control system. Fleet, passenger, incident, accessibility, energy, and recovery data are authored and deterministic.

## Golden workflow

```text
Human activates incident
  → agent inspects
  → agent evaluates
  → agent stages
  → human approves in the visible UI
  → agent commits
  → RECOVERED
  → agent audits or rolls back
```

The durable domain phases are:

```text
READY → INCIDENT_ACTIVE → OPTIONS_EVALUATED → PLAN_STAGED
      → APPROVED → RECOVERED → ROLLED_BACK
```

Every successful domain mutation validates `expectedRevision` and increments revision exactly once. Approval is one-time, plan-bound, and valid only for the resulting `APPROVED` revision.

## WebMCP tools

| Tool | Availability |
|---|---|
| `get_network_snapshot` | All phases; read-only |
| `evaluate_recovery_options` | `INCIDENT_ACTIVE` |
| `stage_recovery_plan` | `OPTIONS_EVALUATED` |
| `commit_approved_recovery` | `APPROVED` after visible human approval |
| `rollback_last_recovery` | `RECOVERED` |
| `get_action_audit_log` | All phases; read-only |

Incident activation, reset, and approval are intentionally human-only UI controls. There is no generic mutation tool.

## Architecture

```text
React UI / WebMCP / Google adapters
                 ↓
        application use cases
                 ↓
        deterministic domain core
```

- Modular monolith with hexagonal boundaries.
- UI and WebMCP invoke the same `CommandCenterService` use cases.
- Domain and application layers do not import React, Next.js, browser APIs, Google, WebMCP, or Zustand.
- Zustand implements the in-memory repository adapter and separate ephemeral UI state.
- The central WebMCP registry tracks in-flight executions and drains before aborting a registration.
- Rollback snapshots only network, fleet, demand, simulated time, incident, and metrics; audit and governance are never rewound.

## Google context and fallback

With both services configured, the UI uses Google Maps JavaScript API and `AdvancedMarkerElement`, while a narrow server route requests traffic-aware duration, static duration, distance, and encoded geometry for the fixed Rosebank-Sandton segment. The real road-shaped segment is shown prominently above the subdued authored North Spine.

The North Spine, fleet, passengers, incident, and operational status remain authored simulated truth. Google route data is an ephemeral session snapshot—not a continuous traffic feed—and is never persisted or used for hard constraints, scoring, plan ranking, approval, audit, or rollback. Without keys—or when Routes is unavailable—the app uses a clearly labelled authored map and route fallback. The entire golden workflow remains functional and selects the same winning plan.

Use an uncommitted `.env.local` to enable Google enrichment:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GOOGLE_MAP_ID=
GOOGLE_ROUTES_API_KEY=
```

Use separate restricted keys:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Maps JavaScript API, HTTP-referrer restricted.
- `NEXT_PUBLIC_GOOGLE_MAP_ID`: optional Google map ID; the UI otherwise uses `DEMO_MAP_ID`.
- `GOOGLE_ROUTES_API_KEY`: Routes API only, API-restricted, server-side.

Never commit populated environment files.

## Local development

Requirements:

- Node.js 20+
- pnpm 8.11.0
- Google Chrome 150 with WebMCP testing enabled for real-tool smoke testing

```bash
pnpm install
pnpm dev
```

Open exactly `http://localhost:3000`. The app remains fully demonstrable with manual fallback controls when WebMCP or Google APIs are unavailable.

## Verification

Local hard gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Full Playwright E2E is configured for Linux CI and does not require downloading the newest Playwright browser for ordinary local development:

```bash
pnpm test:e2e
```

The test suite covers deterministic replay, hard-constraint filtering/ranking, legal transitions, stale revisions, approval binding and invalidation, operational-only rollback, strict tool schemas, exact phase registration, drain-aware removal, Routes fallback, and the golden UI flow.

## Chrome 150 smoke flow

1. Open the app as the top-level same-origin page and confirm the WebMCP status reads available.
2. Activate the incident in the UI.
3. Invoke `get_network_snapshot`, `evaluate_recovery_options`, and `stage_recovery_plan` through Chrome WebMCP.
4. Confirm `commit_approved_recovery` is absent before approval.
5. Approve the staged plan in the visible UI; confirm commit becomes available.
6. Commit through WebMCP and verify revision 5, `RECOVERED`, and 96.8% on-time arrivals.
7. Read the audit and roll back; verify revision 6, `ROLLED_BACK`, restored operational metrics, and preserved audit history.

## Contract documents

- [`AGENTS.md`](./AGENTS.md)
- [`docs/PRODUCT.md`](./docs/PRODUCT.md)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- [`docs/WEBMCP_TOOLS.md`](./docs/WEBMCP_TOOLS.md)
- [`docs/DEMO.md`](./docs/DEMO.md)

## License

MIT — see [`LICENSE`](./LICENSE).
