# MAAV Stress Lab Product Contract

## Status

This document owns product behavior, scope, language, and success criteria for
MAAV Stress Lab. Gate 1 establishes the contract; it does not claim the Stress
Lab runtime is implemented.

## Product essence

**MAAV Stress Lab** is a browser-native, deterministic counterfactual mobility
assurance lab.

> Design it. Break it. Make it resilient.

A human or browser agent configures two synthetic fleet scenarios, applies the
same documented stress treatment, runs them against one shared passenger trace,
compares immutable evidence, and stages a finding for visible human review.

It is a decision-support experiment workbench. It is not a fleet-management
dashboard, autonomous dispatcher, live digital twin, external optimizer
marketplace, generic chatbot, scientifically calibrated model, or production
multi-tenant platform.

## Problem

Early mobility-design decisions are difficult to challenge when assumptions,
stress conditions, and evidence live in separate tools or ungrounded prose.
Conventional dashboards can display operations, but they do not necessarily
create a controlled, reproducible experiment that a human and browser agent can
operate together.

Stress Lab makes the experimental chain explicit:

```text
configuration
  -> deterministic stress run
  -> immutable ledger evidence
  -> compatible comparison
  -> evidence-linked finding
  -> human decision
```

## Target users

- **First-time explorer:** needs a credible template, plain language, safe
  defaults, visible assumptions, and a complete manual path.
- **Mobility planner or researcher:** needs explicit units, reproducible seeds,
  inspectable event evidence, constraint results, and honest model limits.
- **Human using a browser agent:** needs shared state, visible tool activity,
  stale-result protection, structured clarification, and human-only review.
- **Hackathon judge or reviewer:** needs one reliable, resettable golden
  experiment that proves meaningful WebMCP use in minutes.

The prototype does not claim adoption by operators, deployment into a control
room, or fitness for operational decisions.

## H0 promise

From a clean reset, a human or browser agent can:

1. configure Scenario A and Scenario B against one fixed synthetic network and
   passenger trace;
2. apply an equivalent vehicle failure at the same simulated time;
3. run both immutable scenario revisions;
4. inspect service, capacity, energy, battery, and recovery evidence;
5. compare only compatible completed runs;
6. see hard constraints separately from trade-offs;
7. stage an engine-grounded finding;
8. leave final Accept or Challenge authority to the human.

The experiment remains usable without Google Maps or WebMCP. Those degraded
paths are product behavior, not secondary demos.

## Golden experiment

| Field | Contract |
|---|---|
| Network | `sandton-rosebank-v1`, synthetic and versioned |
| Passenger requests | 120 |
| Service window | 08:30–09:00 |
| Deterministic seed | integer 7, displayed as `07` |
| Scenario A | 12 vehicles with 8 seats each |
| Scenario B | 10 vehicles with 10 seats each |
| Maximum passenger wait | 3 minutes |
| Minimum battery reserve | 20% |
| Equivalent disruption | vehicle failure at 08:42 |

For each scenario, select the active vehicle with the highest onboard
occupancy. Break ties using reserved-passenger count, active-service state, then
ascending vehicle ID. The controlled treatment is the rule and time, not a
shared vehicle ID.

The engine must calculate all results. The product contract intentionally
contains no golden KPI values or preferred-scenario constant before the model is
implemented and verified.

## User journey

1. The human resets to the clean seed-07 experiment.
2. Readiness distinguishes application, simulation, Google, and WebMCP status.
3. The human uses the manual template or gives the golden prompt to a compatible
   browser agent.
4. A and B become immutable scenario revisions with a visible difference
   summary.
5. Equivalent 08:42 failure specifications are attached to both scenarios.
6. Both scenarios run against the same authored network and passenger trace.
7. Timeline, map or fallback, activity, metrics, and constraints point to the
   immutable runs.
8. Comparison first verifies compatibility, then produces evidence-linked
   deltas without an opaque winner score.
9. The agent stages a bounded finding derived from the comparison artifact.
10. The human inspects the evidence and selects Accept or Challenge.
11. Reset and repetition reproduce the same normalized evidence fingerprints.

Editing a scenario never mutates a completed run. It creates a new scenario
revision and marks dependent current comparisons and findings stale.

## Human-control and honesty principles

- The agent may operate the synthetic lab but cannot Accept, Challenge, Reset,
  dispatch, delete evidence, or execute a real-world action.
- Accept and Challenge are visible prototype workflow boundaries, not
  cryptographic authorization or regulatory approval.
- A finding is an interpretation of synthetic evidence, not a certified
  recommendation.
- Agent prose is never evidence. Displayed claims and numbers must resolve to
  immutable run and comparison artifacts.
- Unsupported inputs return precise errors; the product never pretends to have
  simulated an unsupported city, transport mode, feed, or control action.
- Synthetic data and model limitations remain visible before and after a run.

## Product language

Prefer:

- synthetic;
- deterministic;
- versioned;
- immutable;
- evidence-linked;
- human-reviewed;
- authored network;
- presentation context;
- reproducible experiment.

Avoid unqualified claims such as:

- live or real-time;
- optimal;
- production control;
- autonomous execution;
- fleet orchestration;
- scientifically validated;
- digital twin.

## Success criteria

The H0 product is successful only when:

- a first-time user understands the experiment and synthetic boundary quickly;
- the exact golden prompt can configure, stress, run, compare, and stage through
  real WebMCP tools;
- manual and agent paths produce equivalent application state;
- identical normalized inputs produce byte-identical normalized outputs and
  fingerprints;
- every metric and finding claim is traceable to immutable evidence;
- stale and incompatible evidence cannot produce a current finding;
- final finding acceptance through a WebMCP tool occurs zero times;
- Google-unavailable and WebMCP-unavailable paths remain complete;
- keyboard and non-map users can inspect the same material evidence;
- the public release, CI, deployment, documentation, and demo identify one
  verified revision.

The project may report only evidence actually collected. It must not claim
real-world cost, safety, energy, or passenger improvements from synthetic runs.

## H0 non-goals

The submitted build excludes:

- arbitrary city or network creation;
- live passenger, vehicle, GTFS, traffic, or customer feeds;
- external optimizer submission or provider adapters;
- demand surge, charging outage, or charging simulation;
- arbitrary Google route recalculation during runs;
- authentication, database persistence, team workspaces, or multi-tenancy;
- export suites;
- embedded generic chat;
- SUMO, reinforcement learning, or opaque optimization;
- operational dispatch, V2X execution, payments, or real passenger data.

Future ideas may be documented only as clearly labelled roadmap possibilities.
They are not part of the H0 promise.

## Documentation ownership

- Architecture and state flow: `docs/ARCHITECTURE.md`
- Simulation and metrics: `docs/SIMULATION_ENGINE.md`
- Exact tools and envelopes: `docs/WEBMCP_TOOLS.md`
- Demonstration: `docs/DEMO.md`
- Deadline and release strategy: `docs/CHALLENGE_PLAN.md`
- Full approved planning source: `docs/plans/stress-lab/`
