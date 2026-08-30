# AGENTS.md

## Mission

Build **MAAV Stress Lab** for the WebMCP Challenge.

MAAV Stress Lab is a browser-native, deterministic counterfactual mobility
assurance lab. A human or browser agent can configure two synthetic scenarios,
apply an equivalent vehicle failure, run reproducible simulations, compare
evidence, and stage a finding. Final **Accept** or **Challenge** authority
remains with the visible human operator.

Product line:

> Design it. Break it. Make it resilient.

Before changing implementation, read the owning documents completely:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/SIMULATION_ENGINE.md`
- `docs/WEBMCP_TOOLS.md`
- `docs/DEMO.md`
- `docs/CHALLENGE_PLAN.md`

The approved planning sources are read-only inputs to the gated build:

- `docs/plans/stress-lab/FUNCTIONAL_REQUIREMENTS.md`
- `docs/plans/stress-lab/TECHNICAL_SPEC.md`
- `docs/plans/stress-lab/BUILD_CHECKLIST.md`

## Product truth

- This is a synthetic decision-support experiment workbench, not a
  fleet-management dashboard, live digital twin, operational optimizer, or
  vehicle-control system.
- Passenger requests, vehicles, assignments, movement, battery, energy,
  failures, recovery, and results are synthetic.
- The model is deterministic and transparent, but not scientifically calibrated
  for real-world operations.
- Never label synthetic values as live, observed, certified, optimal, or
  production-ready.
- The interface must visibly disclose
  `SYNTHETIC SIMULATION • NO LIVE FLEET CONTROL`.
- Do not invent integrations, customers, measured impact, or runtime
  functionality that is not implemented and verified.

## Architecture

- Use a modular monolith with hexagonal boundaries.
- Dependency direction is
  `UI / WebMCP / Google / Zustand adapters -> application services -> domain`.
- Domain and application layers must not import React, Next.js, Zustand,
  Google Maps, browser or WebMCP APIs, network clients, or wall-clock UI state.
- Manual UI commands and WebMCP tools invoke the same application services and
  validation rules.
- Zustand may implement the repository port and ephemeral orchestration; it is
  not a domain or application dependency.
- Create files and directories only for an implemented slice. Do not add empty
  architecture folders or `.gitkeep` placeholders.

The immutable evidence lifecycle is:

```text
Scenario Revision
  -> Run Artifact
  -> Comparison Artifact
  -> Finding Artifact
  -> Human Review
```

Editing a scenario creates a new revision. It never rewrites completed evidence.
Dependent current runs, comparisons, and findings become stale while their
historical artifacts remain inspectable.

## H0 golden experiment

The submission-critical experiment is fixed:

- network: versioned synthetic Sandton–Rosebank corridor;
- passenger trace: 120 synthetic requests;
- service window: 08:30–09:00;
- engine tick: 30 simulated seconds;
- seed: integer `7`, displayed as `07`;
- Scenario A: twelve vehicles with eight seats each;
- Scenario B: ten vehicles with ten seats each;
- hard maximum passenger wait: 180 seconds;
- hard minimum battery reserve: 20%;
- equivalent vehicle failure in both scenarios at 08:42.

At the failure tick, independently select the active vehicle with the highest
onboard occupancy in each scenario. Break ties by reserved-passenger count,
active-service state, then ascending vehicle ID. The selection is never random
or manually chosen to create a dramatic outcome.

## Deterministic engine invariants

- The engine owns passenger arrivals, assignments, movement, boarding, service,
  battery, energy, failure recovery, ledger events, metrics, constraints,
  comparisons, and supported finding claims.
- Final KPIs are folded from an immutable event ledger. Candidate-specific
  result constants and prewritten winner tables are forbidden.
- The same engine, network, demand trace, scenario, disruption, and seed produce
  the same normalized ledger, metrics, and fingerprints.
- Stable ordering and explicit tie-breaks are required for simultaneous events,
  vehicles, passengers, and routes.
- Passenger lifecycle conservation must include every exclusive state; terminal
  reporting must satisfy
  `requested = served + inServiceAtHorizon + unserved`.
- Vehicles never exceed capacity, serve passengers before arrival, use negative
  energy, or accept a leg that would end below the configured reserve.
- LLMs, Google data, animation frames, playback speed, map interactions, and
  wall-clock time never calculate or change evidence.
- Internal invariant failure fails the run closed and publishes no
  comparison-ready KPI set.

## Revision, idempotency, cancellation, and atomicity

- Every successful domain mutation validates `expectedRevision` and increments
  the workspace revision exactly once.
- Every mutating WebMCP operation carries an `operationId`.
- The same operation ID with the same canonical arguments returns the original
  terminal result; reuse with different arguments returns
  `IDEMPOTENCY_CONFLICT`.
- Concurrent writes against one revision produce one commit and structured
  `REVISION_CONFLICT` failures for losers; never use silent last-write-wins.
- A run captures immutable scenario, seed, engine, demand, network, and
  disruption inputs before computation.
- Propagate `AbortSignal` through cancellable work. Cancellation cannot create a
  completed artifact, partial commit, or later ghost mutation.
- Validate and compute before one compare-and-swap commit. Tool success is
  returned only after committed state is observable to the UI.

## WebMCP

Target Google Chrome 150 and the imperative `document.modelContext` API. Never
use `navigator.modelContext`. Use the official `webmcp-types` declarations,
strict JSON Schema plus Zod validation, and
`execute(input, { signal })`. Do not invent `outputSchema`.

The public surface is exactly six tools:

1. `read_lab_state`
2. `configure_scenario`
3. `run_scenario`
4. `inject_disruption`
5. `compare_scenarios`
6. `stage_finding`

Register all six once after the canonical lab store is ready. Keep them
discoverable for the application lifecycle. Enforce prerequisites, revisions,
compatibility, and stale evidence in the application service through structured
errors; do not dynamically hide tools by phase.

Tool adapters are thin:

```text
strictly validate input
  -> inject trusted actor/source context
  -> call shared application service
  -> return compact structured result
  -> expose visible best-effort activity
```

Only `read_lab_state` uses `readOnlyHint: true`. Use
`untrustedContentHint: true` only when returned data actually includes bounded
user-authored or external text.

When essential semantic intent is missing, return
`NEEDS_CLARIFICATION` with bounded decision points, allowed values, and a safe
next action. The browser agent asks the human and retries with a new operation
ID. Do not add a seventh question tool.

## Human authority

A browser agent may inspect state, configure scenarios, schedule the equivalent
failure, run simulations, compare compatible completed runs, and stage an
evidence-backed finding.

Only visible human UI commands may:

- Accept a finding;
- Challenge a finding;
- deterministically reset the lab.

These are prototype workflow boundaries, not cryptographic authorization.
There is no WebMCP acceptance, challenge, reset, deletion, operational execution,
dispatch, or generic mutation tool.

## Google boundary

- Google Maps supplies geographic presentation context only: enterprise
  basemap, Advanced Markers, authored overlays, supported GeoJSON/polygon/line
  layers, interaction, and selection.
- The deterministic engine uses the versioned authored network fixture for
  distance, travel time, dispatch, battery, energy, constraints, comparisons,
  and findings.
- Freeze the network input before a run. Never call Routes during the
  simulation loop or from animation frames.
- Browser and server keys remain separate, restricted, and absent from source,
  logs, screenshots, tool output, and evidence.
- Google failure activates an authored SVG plus structured network-list
  fallback. The complete experiment remains usable and produces identical
  evidence.
- Preserve Google attribution whenever the Google surface is rendered.

## H0 scope and non-goals

H0 ships one fixed network, one seed-07 passenger trace, two scenario slots, one
vehicle-failure type, one transparent dispatch/recovery policy, one ledger-based
comparison, one pending finding, six static tools, human review, and Google plus
authored fallback projections.

Do not add before H0 is green:

- arbitrary cities, networks, imports, or route recalculation during runs;
- live passenger, fleet, GTFS, traffic, or customer data;
- external optimizer or provider integrations;
- demand-surge, charging-outage, or charging simulation;
- authentication, database persistence, team workspaces, or multi-tenancy;
- exports, embedded generic chat, SUMO, reinforcement learning, V2X,
  operational dispatch, or real passenger data.

Roadmap ideas must be labelled future work and must not appear as implemented or
submission-ready.

## Accessibility, reliability, and security

- Keep the primary desktop experience usable at 1366×768 and 1440×900.
- Provide keyboard, screen-reader, reduced-motion, non-colour, and non-map
  equivalents for core evidence and controls.
- Render labels, challenge feedback, and external text as text; never use
  `dangerouslySetInnerHTML`.
- WebMCP requires a secure origin-isolated document permitted by the `tools`
  Permissions Policy. Do not enable `document.domain` or cross-origin tool
  exposure.
- Validate IDs, enums, units, numeric ranges, revisions, operation IDs,
  prerequisites, and artifact compatibility.
- Keep raw prompts, keys, stack traces, browser storage, unrestricted URLs, and
  third-party free-form responses out of tools and evidence.
- Unsupported WebMCP or Google surfaces degrade to a complete honest manual
  workflow; never simulate fake tool calls or live context.

## Verification and change discipline

Use Next.js App Router, React, strict TypeScript, pnpm only, Zod, Zustand,
`@vis.gl/react-google-maps`, Vitest, and Playwright in Linux CI. Do not add a
database, message broker, microservice, GraphQL, Redux, second map library, or
LLM backend.

Local development targets macOS 12.7.6 on Intel x86_64 with Google Chrome 150
and the WebMCP testing flag enabled.

Local hard gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run the applicable real-browser Chrome 150 smoke flow. The newest locally
downloaded Playwright browser must not block local development; full E2E may
run in Linux CI.

Before implementation, state intended files, contract impact, and verification.
Prefer one gated vertical slice. Preserve unrelated user changes. Do not weaken
tests, broaden scope, add dependencies, rename public contracts, commit, push,
or deploy without explicit authorization. Update the owning document when a
public contract changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
