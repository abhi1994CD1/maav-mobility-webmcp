# AGENTS.md

## Mission

Build a polished WebMCP-enabled mobility disruption recovery command center for the WebMCP Challenge.

The product must let a transport operator and a browser agent inspect a simulated network, evaluate recovery options, stage one option, require explicit human approval, commit the approved recovery, observe measurable recovery, and roll back the last committed recovery.

Before changing code, read these documents completely:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/WEBMCP_TOOLS.md`
- `docs/DEMO.md`

Those documents own the detailed product, architecture, tool, and demo contracts. This file is the concise durable contract.

## Product truth

- This is a decision-support digital twin, not a real transport control system.
- Google Maps Platform supplies geographic, map, place, and route context.
- Fleet positions, passengers, capacities, incidents, accessibility constraints, energy, and recovery outcomes are simulated.
- Never label simulated values as live or real.
- The interface must visibly display `SIMULATED OPERATIONS • GOOGLE MAPS CONTEXT`.
- Do not invent integrations, live feeds, or metrics that are not implemented.

## Architecture

- Use a modular monolith with hexagonal boundaries.
- Layer direction is `UI / WebMCP / Google adapters -> application use cases -> domain model`.
- The domain and application layers must not import React, Next.js, Google Maps, browser APIs, WebMCP APIs, or Zustand.
- Human UI actions and WebMCP tools must invoke the same application use cases. Do not duplicate business logic in tool handlers or React components.
- Keep revisioned application/domain state separate from ephemeral UI state. Ephemeral UI changes never increment the domain revision.
- Zustand may implement a repository adapter and UI orchestration, but it is not a domain or application dependency.
- Create directories when an implemented slice needs them. Do not add empty architecture folders or `.gitkeep` files merely to mirror a planned structure.

## Domain and workflow

The authoritative workflow is:

```text
READY
  -> INCIDENT_ACTIVE
  -> OPTIONS_EVALUATED
  -> PLAN_STAGED
  -> APPROVED
  -> RECOVERED
  -> ROLLED_BACK
```

`PLAN_STAGED` means a plan is staged and waiting for explicit human approval. There is no durable `AWAITING_OPERATOR_APPROVAL` or `APPLYING` phase. Execution and animation are transient activity state.

- Simulation is deterministic for a scenario seed and its authored operational context.
- The model, not an agent or LLM, calculates every KPI and plan score.
- Evaluate hard constraints before soft scoring. Accessibility violations are a hard failure in the canonical scenario.
- Every successful domain mutation checks `expectedRevision` and increments revision exactly once. A stale or invalid command does not mutate state.
- Human approval is bound to one plan and the resulting `APPROVED`-state revision, is one-time use, and is invalidated by any intervening domain mutation.
- Rollback uses a narrow operational snapshot, never a snapshot of the entire command-center state. Audit history remains append-only.
- Canonical incident activation and reset are human/demo UI controls, not public WebMCP tools.

## WebMCP

- Target the WebMCP API available in Google Chrome 150 and use `document.modelContext`, never `navigator.modelContext`.
- Use the official `webmcp-types` package for TypeScript declarations and Zod for runtime input validation.
- The public tool surface is exactly:
  - `get_network_snapshot`
  - `evaluate_recovery_options`
  - `stage_recovery_plan`
  - `commit_approved_recovery`
  - `rollback_last_recovery`
  - `get_action_audit_log`
- Consequential tools are state-gated both by registration and application preconditions. `commit_approved_recovery` is unavailable until the visible UI records the operator's approval.
- Use a central, drain-aware registration lifecycle. Do not remove a tool while one of its invocations is in flight, and propagate invocation `AbortSignal`s into cancellable work.
- Return the serializable success/failure envelopes defined in `docs/WEBMCP_TOOLS.md`; do not invent `outputSchema` for the Chrome 150 target.
- Read tools set `readOnlyHint: true`. Set `untrustedContentHint: true` only when the actual result can contain untrusted external or user-supplied content.
- Never expose API keys, approval secrets, internal stack traces, raw unnecessary third-party text, or generic unrestricted mutation tools.

## Human approval

An agent may inspect, evaluate, and stage a plan. It may not approve a plan or commit a recovery until the operator explicitly approves the currently staged plan in the visible UI.

Approval must contain `planId`, `validForRevision`, and `consumed`. The commit use case must verify the current revision, approval revision, plan, consumed flag, and `APPROVED` phase atomically. Do not simulate approval inside a tool handler.

## Google boundary

- Browser key: Maps JavaScript API only, restricted by allowed HTTP referrers.
- Server key: Routes API only, never exposed to client bundles.
- Keep Google calls behind ports/adapters and cache normalized context in memory for the demo session only.
- Do not commit API responses, route polylines, place content, or keys.
- Live Google traffic may enrich geography and visualization, but it must not change the canonical scenario's hard-constraint result or winning recovery plan.
- The entire golden workflow must work with a clearly labelled authored fallback when Routes API is unavailable.
- Preserve Google attribution.

## Technology and scope

Use Next.js App Router, React, strict TypeScript, pnpm only, Tailwind CSS, Zod, Zustand, Google Maps JavaScript API with `AdvancedMarkerElement`, server-side Routes API handlers, Vitest, and Playwright in Linux CI.

Do not add a database, message broker, microservice, authentication system, LLM API backend, Redux, GraphQL, a second map library, real dispatch integrations, real passenger or fleet feeds, SUMO, reinforcement learning, V2X, payments, user accounts, production multi-tenancy, or a general-purpose chatbot.

## UX and reliability

- Use a full-screen enterprise command-center with the map as the primary canvas.
- Required surfaces are the network map, KPI strip, incident panel, agent activity rail, plan comparison, approval drawer, event timeline, reset control, and demo prompt.
- Show a visible response to every tool call without treating read-only or rendering activity as a domain mutation.
- Keep loading, empty, and failure states visible; use restrained motion and high information clarity.
- Red means an active violation; green means verified recovery.
- Do not add fake loading delays. Preserve keyboard access and core semantic labels.
- Keep the app usable at 1366x768 and 1440x900.
- Routes failure must not break the app or WebMCP registration. Avoid network calls and wall-clock time inside deterministic simulation.

## Security

- WebMCP runs only in an origin-isolated secure document allowed by the `tools` Permissions Policy. Do not enable `document.domain`.
- Top-level same-origin tools are sufficient; do not add cross-origin exposure.
- Validate enums, ranges, IDs, revisions, schemas, and transition eligibility.
- Treat external route text, incident notes, and user-entered reasons as untrusted.
- Use narrow server route handlers and reject arbitrary upstream URLs.
- Do not use `dangerouslySetInnerHTML` for tool or external content.
- Keep secrets out of source, logs, screenshots, and tool output.

## Verification and change discipline

The local development target is macOS 12.7.6 on Intel x86_64 with Google Chrome 150 and the WebMCP testing flag enabled.

Local hard gates are:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run the manual Chrome 150 real-WebMCP smoke flow. Full Playwright E2E may run in Linux CI and the newest locally downloaded Playwright browser must not block local development.

Before coding, state the intended files, contract impact, and verification commands. Prefer the smallest vertical slice with visible value. Do not weaken tests, broaden scope, rename public contracts, add dependencies, or perform broad refactors without explicit approval. Update the owning document when a public contract changes.

After coding, review the diff for boundary violations and generated junk, run the relevant checks, and report changes, tests, limitations, and the next slice.
