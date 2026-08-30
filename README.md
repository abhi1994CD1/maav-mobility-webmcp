# MAAV Stress Lab

> **Design it. Break it. Make it resilient.**

MAAV Stress Lab is a browser-native, deterministic counterfactual mobility
assurance lab for the WebMCP Challenge. It is designed to help a human and a
browser agent ask a controlled question: how do two synthetic fleet designs
behave under the same passenger demand and equivalent vehicle failure?

The product is not a fleet-management dashboard, operational dispatcher, live
digital twin, or scientifically calibrated transport model. It is a synthetic
decision-support experiment workbench whose evidence is reproducible and whose
final finding remains human-reviewed.

## Migration status

This branch currently contains the approved **Gate 1 documentation contract**.
The Stress Lab simulator, route, UI, six tools, and tests are not implemented
yet. Until later gates pass, the existing application runtime remains the
superseded Recovery Command Center baseline and must not be presented as Stress
Lab evidence.

Gate 2 will first prove a two-tool static WebMCP spike in the real target browser
before the deterministic engine is built.

## The problem

Mobility design discussions often rely on dashboards, opaque assumptions, or
agent prose that cannot be reproduced. MAAV Stress Lab instead makes the
experiment itself the product:

```text
controlled scenario revisions
  -> immutable simulation runs
  -> compatible comparison evidence
  -> evidence-linked finding
  -> visible human review
```

The agent can operate the lab, but it cannot create evidence, Accept its own
finding, dispatch a vehicle, or turn a synthetic result into a real-world
action.

## H0 golden experiment

The submission scope is one bounded experiment:

| Field | H0 value |
|---|---|
| Network | Versioned synthetic Sandton–Rosebank corridor |
| Demand | 120 synthetic passenger requests |
| Window | 08:30–09:00 |
| Tick | 30 simulated seconds |
| Seed | `07` |
| Scenario A | 12 vehicles × 8 seats |
| Scenario B | 10 vehicles × 10 seats |
| Maximum wait | 3 minutes |
| Minimum battery reserve | 20% |
| Stress event | Equivalent vehicle failure at 08:42 |

Each scenario independently fails its active vehicle with the highest onboard
occupancy. Ties use reserved-passenger count, active-service state, then
ascending vehicle ID. The rule is fixed before execution; the vehicle is not
randomly or theatrically selected.

The planned engine derives service, capacity, wait, distance, energy, battery,
constraint, and recovery outcomes from an immutable event ledger. No final KPI
or preferred scenario is prewritten. Golden KPI values will be published only
after the engine exists and reproducibility gates pass.

## Why this is not another fleet dashboard

A dashboard primarily reports current operations. Stress Lab creates and tests
counterfactual evidence:

- immutable A/B scenario revisions;
- one shared deterministic passenger trace;
- equivalent stress treatment;
- replayable event-ledger runs;
- compatibility checks before comparison;
- hard constraints shown separately from trade-offs;
- findings whose numeric claims come only from immutable evidence;
- visible human Accept or Challenge.

It performs no live dispatch and uses no real passenger or fleet feed.

## WebMCP role

The H0 public catalog is exactly:

1. `read_lab_state`
2. `configure_scenario`
3. `run_scenario`
4. `inject_disruption`
5. `compare_scenarios`
6. `stage_finding`

All six will be registered once and remain discoverable. Application
preconditions—not disappearing tools—will enforce ordering, expected revision,
idempotency, compatibility, staleness, and cancellation.

Manual controls and WebMCP tools call the same application service. The browser
agent may configure, run, disrupt, compare, and stage. **Accept finding**,
**Challenge finding**, and deterministic Reset remain visible human UI commands
and are intentionally absent from WebMCP.

## Google Maps role

Google Maps is presentation context only. It may provide the basemap, Advanced
Markers, authored network overlays, supported GeoJSON/polygon/line layers,
selection, and geographic orientation.

The versioned authored fixture—not Google—owns simulation distance, travel time,
dispatch, energy, battery, constraints, metric deltas, and finding evidence.
When Google is unavailable, the same immutable replay is shown through an
authored SVG and structured network-list fallback. Results and fingerprints are
unchanged.

## H0 submission scope

The approved H0 target contains:

- one fixed synthetic corridor and shared seed-07 demand trace;
- two scenario slots;
- one deterministic 30-second simulation model;
- one equivalent vehicle-failure type;
- one transparent dispatch and recovery policy;
- immutable runs, comparisons, findings, and evidence fingerprints;
- exact six static WebMCP tools;
- evidence-linked pending finding and human review;
- Google projection plus authored fallback;
- manual, keyboard, reduced-motion, and unsupported-WebMCP paths.

Not included in H0: arbitrary city creation, live feeds, GTFS import, external
optimizers, provider adapters, demand surge, charging outage, charging
simulation, authentication, database persistence, team workspaces,
multi-tenancy, exports, embedded chat, SUMO, reinforcement learning, V2X,
operational dispatch, or real passenger data.

## Local development

Requirements:

- Node.js 20+
- pnpm 8.11.0
- Google Chrome 150 with WebMCP testing enabled for real-browser gates

```bash
pnpm install
pnpm dev
```

The current baseline opens at `http://localhost:3000`. A later approved gate
will add Stress Lab at `/lab`; do not infer that route exists during Gate 1.

## Verification

Local hard gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Full Playwright E2E may run in Linux CI. The newest locally downloaded
Playwright browser is not a blocking macOS development requirement. Every
implemented WebMCP slice must also pass the documented real Chrome 150 smoke
gate.

## Documentation

- [Product behavior and scope](./docs/PRODUCT.md)
- [Architecture and state flow](./docs/ARCHITECTURE.md)
- [Simulation contract](./docs/SIMULATION_ENGINE.md)
- [WebMCP contracts](./docs/WEBMCP_TOOLS.md)
- [Golden demonstration](./docs/DEMO.md)
- [Challenge delivery plan](./docs/CHALLENGE_PLAN.md)
- [Durable agent guardrails](./AGENTS.md)
- [Approved planning sources](./docs/plans/stress-lab/)

## License

MIT — see [LICENSE](./LICENSE).
