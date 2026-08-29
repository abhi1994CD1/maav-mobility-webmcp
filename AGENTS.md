# AGENTS.md

## Mission
Build a polished WebMCP-enabled mobility disruption recovery command center for the WebMCP Challenge.

The product must let a transport operator and a browser agent inspect a simulated network, evaluate recovery options, stage one option, require explicit human approval, commit the approved recovery, observe measurable recovery, and roll back the last committed action.

Read these documents before changing code:
- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/WEBMCP_TOOLS.md`
- `docs/DEMO.md`

## Product truth
- This is a decision-support digital twin, not a real transport control system.
- Google Maps Platform supplies map, place, and route context.
- Fleet positions, passengers, capacities, incidents, accessibility constraints, energy, and recovery outcomes are simulated.
- Never label simulated values as live or real.
- The interface must visibly display: `SIMULATED OPERATIONS • GOOGLE MAPS CONTEXT`.
- Do not invent integrations, live feeds, or metrics that are not implemented.

## Architecture decision
Use a modular monolith with hexagonal boundaries.

The domain and application layers must not import React, Next.js, Google Maps, browser APIs, or WebMCP APIs.

All human UI actions and WebMCP tool calls must execute the same application use cases. Never duplicate business logic inside tool handlers or React components.

Layer direction:

`UI / WebMCP / Google adapters -> application use cases -> domain model`

## Technology baseline
- Next.js App Router
- React + TypeScript with `strict: true`
- pnpm only
- Tailwind CSS
- Zod for runtime validation
- Zustand for client orchestration state
- Google Maps JavaScript API using `AdvancedMarkerElement`
- Google Routes API through server-side Next.js route handlers
- Vitest for domain/unit/contract tests
- Playwright for end-to-end tests
- Native `document.modelContext.registerTool` via a small typed adapter

Do not add a database, message broker, microservice, authentication system, LLM API backend, Redux, GraphQL, or a second map library.

## Repository boundaries
Expected structure:

```text
src/
  app/                    # Next.js routes, layout, server route handlers
  application/            # use cases, commands, queries, ports
  domain/                 # pure models, rules, simulation, recovery scoring
  infrastructure/
    google/               # Maps/Routes adapters
    webmcp/               # browser WebMCP adapter and registration lifecycle
    persistence/          # in-memory/session adapters only
  features/command-center # React feature composition
  state/                  # Zustand orchestration store
  ui/                     # reusable presentational components
  types/                  # browser API declarations
  data/scenarios/         # authored synthetic scenario seeds
tests/
  unit/
  contract/
  e2e/
docs/
```

## Domain rules
- Simulation must be deterministic for a given scenario seed and Google route-context snapshot.
- The model, not the agent, calculates every KPI.
- Never let an LLM calculate waiting time, capacity, energy, or plan scores.
- Hard constraints are evaluated before soft scoring.
- Accessibility violations are a hard failure in the primary demo scenario.
- Every state-changing command must include an expected state revision.
- Every committed command creates a domain event and an audit record.
- Keep a pre-commit snapshot so the last recovery can be rolled back.

## Workflow state machine
Use explicit states and legal transitions:

```text
READY
  -> INCIDENT_ACTIVE
  -> OPTIONS_EVALUATED
  -> PLAN_STAGED
  -> AWAITING_OPERATOR_APPROVAL
  -> APPROVED
  -> APPLYING
  -> RECOVERED
  -> ROLLED_BACK
```

Invalid transitions must return structured, actionable errors and must not mutate state.

## WebMCP rules
- Use the imperative API through one adapter module.
- Keep tools single-purpose and non-overlapping.
- Tool names must be precise action verbs in snake_case.
- Validate all tool input again at runtime with Zod.
- Return compact structured results, not large state dumps.
- Read tools use `readOnlyHint`.
- Externally sourced text uses `untrustedContentHint` when applicable.
- Dynamically register consequential tools only when valid in the current workflow state.
- `commit_approved_recovery` must not be registered before a human clicks Approve.
- A tool must update shared application state before it reports success.
- Tool errors must include `code`, `message`, `recoverable`, and `suggestedAction`.
- Never expose API keys, approval secrets, internal stack traces, or unrestricted mutation tools.

Required tools and exact contracts are defined in `docs/WEBMCP_TOOLS.md`.

## Human approval rule
An agent may inspect, evaluate, and stage a plan. It may not commit a recovery until the operator has explicitly approved the currently staged plan in the visible UI.

Approval must be:
- bound to one `planId`;
- bound to one state `revision`;
- one-time use;
- invalidated when the incident, plan, or state revision changes;
- visibly recorded in the audit timeline.

Do not simulate approval inside a tool handler.

## Google Maps rules
- Browser key: Maps JavaScript API only; restrict it by allowed HTTP referrers.
- Server key: Routes API only; never expose it to client bundles.
- Keep Google API calls behind ports/adapters.
- Do not commit Google API responses, route polylines, place content, or API keys to the repository.
- Cache route context in memory for the current demo session only.
- Provide a clearly labelled authored synthetic fallback when Routes API is unavailable.
- Never remove Google attribution.
- Use Google route context as an input; do not make Google data the source of fleet/passenger truth.

## UI principles
- Full-screen enterprise command-center experience.
- The map is the primary canvas; chat is not the primary interface.
- Show visible response to every WebMCP tool call.
- Required surfaces: network map, KPI strip, incident panel, agent activity rail, plan comparison, approval drawer, event timeline, reset control, and demo prompt.
- Use restrained motion and high information clarity.
- Red means active violation only. Green means verified recovery only.
- Do not use fake loading delays.
- Maintain keyboard access and semantic labels for core controls.
- The app must remain usable at 1366x768 and 1440x900.

## Reliability and fallback behavior
- App must load into a usable demo state without the Routes API.
- API failure must not break WebMCP registration.
- A `Reset scenario` control must restore the canonical scenario.
- Avoid network calls inside the deterministic simulation loop.
- No random values without the seeded PRNG.
- No current wall-clock time in deterministic tests.

## Security
- No secrets in source, logs, screenshots, or tool output.
- Treat incident notes and external route text as untrusted.
- Validate enums, numeric ranges, IDs, state revisions, and transition eligibility.
- Use narrow server route handlers; reject arbitrary upstream URLs.
- Never create a generic `execute_action` or `update_state` tool.
- Do not use `dangerouslySetInnerHTML` for tool or external content.

## Testing requirements
Before marking a task complete, run the relevant subset and then the full verification suite:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Minimum required coverage:
- deterministic scenario replay;
- hard-constraint filtering;
- plan ranking;
- invalid state transitions;
- stale revision rejection;
- approval binding and invalidation;
- rollback restoration;
- WebMCP input validation;
- dynamic tool registration state matrix;
- Routes API failure fallback;
- complete golden demo flow.

Do not weaken or delete a test to make a change pass. Fix the implementation or document a genuine contract change.

## Definition of done
A feature is done only when:
- implementation exists;
- UI and WebMCP paths use the same application use case;
- input and output are typed and runtime-validated;
- state transition and audit behavior are correct;
- tests cover success and failure paths;
- loading, empty, and failure states are visible;
- documentation is updated if a public contract changed;
- no secrets or generated junk are present in the diff.

## Coding conventions
- Prefer small pure functions and explicit domain types.
- Use discriminated unions for workflow and command results.
- Use immutable updates at domain boundaries.
- Avoid `any`; `unknown` must be narrowed.
- Keep files focused; split files that mix UI, domain, and integration concerns.
- Comments explain why, not what.
- Use UTC ISO strings for audit records and a simulated service clock for scenario time.
- IDs must be stable within a scenario and opaque outside it.

## Change discipline
Before coding:
1. Read the relevant docs and existing tests.
2. State the intended files, contract impact, and verification commands.
3. Prefer the smallest vertical slice that produces visible value.

After coding:
1. Review the diff for architectural boundary violations.
2. Run verification commands.
3. Report what changed, tests run, known limitations, and next vertical slice.

Do not perform broad refactors, rename public contracts, add dependencies, or change the product scope unless the task explicitly requires it.

## Delivery priority
P0:
- deterministic scenario and recovery engine;
- premium map-based shell;
- WebMCP tools working end to end;
- human approval gate;
- commit, audit, rollback;
- deployed live URL and reproducible golden demo.

P1:
- Google Routes enrichment;
- WebMCP eval suite;
- accessibility polish;
- submission screenshots and diagnostics.

P2 only after P0 and P1 are green:
- secondary incident;
- additional visualization polish;
- optional Places search.

## Explicitly out of scope
- real dispatch operations;
- real passenger or fleet feeds;
- SUMO;
- reinforcement learning;
- V2X;
- payment or ticketing;
- user accounts;
- production-grade multi-tenancy;
- microservices;
- a general-purpose AI chatbot;
- a complete MAAV system.
