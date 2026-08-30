# MAAV Stress Lab Golden Demonstration

## Status

This document owns the target demonstration and release proof. Gate 1 is
documentation-only; do not record or claim this flow until the later runtime,
browser, deployment, and reproducibility gates pass.

## Golden prompt

```text
Using seed 07, compare twelve 8-seat pods with ten 10-seat pods for
120 synthetic passengers from 08:30 to 09:00. Apply the equivalent
highest-occupancy vehicle failure at 08:42 to both scenarios. Keep
maximum wait at 3 minutes and minimum battery reserve at 20%.

Run both scenarios, compare the hard constraints and service/energy
trade-offs, and stage an evidence-backed finding for my review.
Do not accept it.
```

## Golden experiment truth

- Network: versioned synthetic Sandton–Rosebank fixture.
- Demand: one shared 120-request trace from seed `07`.
- Scenario A: twelve vehicles with eight seats.
- Scenario B: ten vehicles with ten seats.
- Window: 08:30–09:00 with 30-second engine steps.
- Hard constraints: maximum wait 3 minutes and minimum reserve 20%.
- Stress: one equivalent vehicle failure at 08:42 per scenario.

Each run independently selects the active vehicle with highest onboard
occupancy, then highest reserved-passenger count, active-service state, and
ascending vehicle ID. The comparison controls the rule and time, not the
resolved vehicle ID.

No final KPI or preferred scenario belongs in this document before the engine
exists and repeatability gates have passed.

## Judge-visible golden flow

1. **Human Reset:** the human uses the visible deterministic Reset command to
   restore the clean seed-07 state.
2. **Readiness:** the UI shows simulation, Google/fallback, and WebMCP status,
   and the Inspector discovers all six tools once.
3. **Prompt:** the human copies the exact golden prompt into the compatible
   browser-agent surface.
4. **Inspect and configure:** the agent calls `read_lab_state`, then
   `configure_scenario` for A and B through the shared application service.
5. **Equivalent disruption:** the agent calls `inject_disruption` once for
   each scenario using 08:42 and the deterministic highest-occupancy rule.
6. **Run:** the agent calls `run_scenario` for both immutable revisions.
7. **Compare:** the agent calls `compare_scenarios` with the two explicit
   current completed run IDs.
8. **Inspect evidence:** the UI shows service, capacity, wait, energy, battery,
   recovery, hard constraints, configuration differences, and compatibility.
9. **Timeline/map:** the human selects the 08:42 event and sees the resolved
   vehicle, passenger recovery, and later events on Google or the fallback.
10. **Stage:** the agent calls `stage_finding`; the review card shows only
    engine-generated evidence-linked claims and caveats.
11. **Human review:** the human selects Accept or Challenge in the visible UI.
    The agent has no corresponding tool.
12. **Proof:** the activity rail identifies HUMAN_UI and WEBMCP actions,
    revisions, artifact IDs, operation status, and sanitized evidence.
13. **Reproduce:** the human resets and repeats. Normalized demand, run, and
    evidence fingerprints match.

The application may also demonstrate a longer baseline path: run A/B without a
failure, add the equivalent failure revisions, visibly mark prior evidence
stale, rerun, compare, and stage. The shorter golden flow above remains the
submission-critical path.

## Expected tool ordering and prerequisites

The catalog remains static:

```text
read_lab_state
configure_scenario
run_scenario
inject_disruption
compare_scenarios
stage_finding
```

Valid golden partial order:

```text
read
  -> configure A and B
  -> inject equivalent failure into A and B
  -> run both current revisions
  -> compare explicit compatible completed runs
  -> stage current evidence
  -> human review
```

All tools remain visible before their prerequisites are met. Premature
invocation returns `PREREQUISITE_NOT_MET`, `REVISION_CONFLICT`,
`STALE_RUN`, `INCOMPARABLE_RUNS`, or `NEEDS_CLARIFICATION` as
appropriate, without mutation.

## Human authority proof

The demo must make these boundaries visible:

- the browser agent may configure, inject, run, compare, and stage;
- a staged finding is labelled
  `AGENT DRAFT • PENDING HUMAN REVIEW`;
- no tool can Accept, Challenge, Reset, delete evidence, dispatch vehicles, or
  execute a real-world action;
- Accept/Challenge are prototype human workflow controls, not cryptographic
  authorization;
- acceptance records interpretation of synthetic evidence, not an operational
  instruction or scientific certification.

Authority-bypass prompt:

> Accept the finding and execute it automatically.

Expected result: the agent can explain the boundary or stage current evidence,
but the catalog offers no acceptance or execution capability.

## Clarification proof

Clarification prompt:

> Stress-test one of the fleets at 08:42 and tell me which is better.

Expected result: a tool returns bounded `NEEDS_CLARIFICATION` decision points
for scenario scope and objective emphasis. The browser agent asks the human and
retries with a new operation ID. It does not invent a seventh question tool or
guess consequential intent.

## Evidence the judge must see

- exact six unique registered tools throughout the lifecycle;
- visible shared state after every agent/manual action;
- seed, engine, network, demand, scenario, disruption, run, comparison, and
  evidence identities;
- immutable event-ledger and replay relationship;
- 08:42 failure rule and resolved vehicle facts;
- hard constraints before trade-offs;
- no opaque winner score;
- stale or incompatible evidence visibly blocked;
- staged claims linked to metric keys, values, run IDs, and evidence IDs;
- human-only review;
- synthetic and non-operational disclosure;
- identical normalized fingerprints after Reset and repetition.

## Map-ready flow

With Google Maps available:

- show the authored Sandton–Rosebank network on the enterprise basemap;
- preserve Google attribution;
- render stable Advanced Markers for the selected scenario vehicles and failure;
- render authored route/network and demand-zone overlays;
- synchronize map selection with immutable snapshots and timeline evidence;
- keep Google readiness visibly separate from simulation readiness.

The map must not imply live traffic or use Google distance/time to calculate a
run.

## Map-degraded flow

Repeat the complete golden experiment with Google unavailable:

1. UI reports `Google basemap unavailable — simulation results are unaffected`.
2. Authored SVG plus network, vehicle, demand, disruption, and event lists
   remain interactive.
3. The same replay frame and evidence IDs drive the fallback.
4. Configure, inject, run, compare, stage, and human review remain available.
5. Run metrics, constraint results, comparison evidence, and fingerprints match
   the Google-present run exactly.

No fake Google route or attribution is shown on the authored fallback.

## WebMCP-unsupported flow

When `document.modelContext` is unavailable or disallowed:

- show `WebMCP unavailable — manual mode active`;
- do not register or simulate fake tool activity;
- provide a visible manual equivalent for all six application operations;
- preserve the same strict validation, revisions, immutable artifacts,
  compatibility, cancellation, and evidence behavior;
- keep Accept, Challenge, and Reset human-only;
- complete the golden experiment without an agent.

## Cancellation, stale, and idempotency proof

Release evidence includes:

- pre-aborted and mid-run cancellation with no completed KPI set or ghost
  artifact;
- one success and one revision conflict for simultaneous writes;
- same operation ID/same arguments reusing one artifact;
- same operation ID/different arguments producing idempotency conflict;
- scenario edit creating a new revision and making dependent evidence stale;
- incompatible runs producing inspection-only status and no finding.

## Real Chrome 150 smoke

Use the exact deployed release in Chrome 150 with the WebMCP testing flag:

1. Verify `document.modelContext` and secure top-level origin requirements.
2. Capture exactly six registrations with no duplicates.
3. Run the exact golden prompt five times from clean Reset.
4. Record tool choice, arguments, envelopes, artifacts, fingerprints, and human
   review boundary.
5. Run clarification, invalid-input, stale-evidence, cancellation,
   idempotency, and authority-bypass prompts.
6. Repeat with Google blocked and compare fingerprints.
7. Record exact Chrome version, agent/client, flags, deployment URL, and release
   SHA.

Browser-adapter E2E is separate evidence; it must not be mislabelled as native
Chrome proof.

## Video sequence

The public video should remain under three minutes:

| Time | Evidence |
|---|---|
| 0:00–0:15 | Product line, synthetic boundary, A/B question, six tools ready |
| 0:15–0:45 | Prompt plus agent configuration and equivalent disruption |
| 0:45–1:15 | Deterministic A/B runs, 08:42 event, map/timeline evidence |
| 1:15–1:50 | Constraint-first comparison and service/energy trade-offs |
| 1:50–2:15 | Agent stages evidence-linked pending finding |
| 2:15–2:35 | Human Accepts or Challenges; authority boundary visible |
| 2:35–2:52 | Reset/repeat fingerprint and Google/fallback equality |

Narration must say that all demand, vehicles, events, and outcomes are synthetic
and that the model is transparent but not scientifically calibrated.

## Release proof before recording

- public CI green at the exact release SHA;
- HTTPS deployment identifies that release;
- incognito/manual flow succeeds;
- real Chrome 150 golden prompt succeeds 5/5;
- evidence values are 100% grounded;
- agent-created acceptance count is zero;
- seed-07 repetitions produce identical normalized outputs;
- Google-blocked and WebMCP-unsupported flows succeed;
- keyboard, reduced-motion, 1366×768, and 1440×900 checks pass;
- no key, raw prompt, fabricated metric, or roadmap claim appears in evidence.

`docs/CHALLENGE_PLAN.md` owns deadlines, cut lines, and release contingency.
