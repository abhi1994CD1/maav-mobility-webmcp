# MAAV Stress Lab Challenge Plan

## Purpose

This document owns the hackathon H0 cut line, implementation order, go/no-go
gates, release evidence, deployment checks, submission contingency, and
fallback policy.

The goal is one trustworthy golden experiment—not a broad prototype whose
features or evidence cannot be verified.

## Deadline

- Official deadline: September 3, 2026 at 1:00 PM Pacific Time.
- South Africa deadline: September 3, 2026 at 10:00 PM SAST.
- Code freeze target: September 2 at noon SAST.
- Internal submission target: September 3 at 4:00 PM SAST.
- The internal target leaves approximately six hours for platform or submission
  failure.

Do not modify the submitted repository, deployment, video, or Devpost entry
during judging after the official deadline.

## Current baseline and migration state

- Repository baseline: `a20bb73`.
- Migration branch: `feat/maav-stress-lab`.
- Gate 1 changes documentation only.
- The Stress Lab engine, route, UI, tools, and tests are not implemented at
  Gate 1.
- The existing runtime remains a superseded, separately recoverable baseline
  until the Stress Lab release gate passes.
- Public CI, deployment, browser evidence, and submission claims for Stress Lab
  must reference a later verified release SHA—not this documentation contract
  alone.

No plan can guarantee a win. The controllable objective is excellent,
reviewable evidence across WebMCP leverage, execution, impact, and ambition.

## Winning thesis

> MAAV Stress Lab lets a human and browser agent design the same controlled
> synthetic experiment, break two alternatives equivalently, and reason from
> deterministic evidence—without allowing the agent to Accept its own finding
> or turn simulation into operational control.

Differentiators:

- counterfactual experiment workbench rather than fleet dashboard;
- immutable scenario, run, comparison, and finding artifacts;
- ledger-derived metrics and hard constraints;
- exact six static WebMCP tools operating meaningful shared state;
- revision, idempotency, stale-evidence, compatibility, and cancellation safety;
- Google presentation separated from simulation truth;
- visible human review and reproducibility proof.

## H0 cut line

H0 ships only:

1. one versioned synthetic Sandton–Rosebank network;
2. one shared seed-07 trace of 120 passenger requests;
3. 08:30–09:00 horizon and deterministic 30-second engine;
4. Scenario A with 12×8 seats and Scenario B with 10×10 seats;
5. maximum wait 3 minutes and battery reserve 20%;
6. equivalent highest-occupancy vehicle failure at 08:42 using the documented
   full tie-break;
7. one transparent dispatch and recovery approximation;
8. immutable event-ledger runs and replay snapshots;
9. service, capacity, energy, battery, recovery, and hard-constraint evidence;
10. current compatible A/B comparison without an opaque score;
11. evidence-bound pending finding and visible human Accept/Challenge;
12. exact six statically registered WebMCP tools;
13. manual, authored-map/list, keyboard, reduced-motion, and unsupported-WebMCP
    paths;
14. one Google Maps presentation adapter that cannot change evidence;
15. deterministic Reset and reproducibility fingerprints.

If a feature is not required for this exact journey, defer it.

## Explicit H1 and V1 deferrals

Do not implement or advertise before all H0 release gates pass:

- arbitrary city/network authoring or GTFS import;
- live passenger, vehicle, traffic, or provider data;
- external optimizer submission or fleet adapters;
- demand surge, charging outage, or charging simulation;
- arbitrary route recalculation during simulation;
- sensitivity/robustness sweeps;
- authentication, database persistence, history workspace, teams, or
  multi-tenancy;
- JSON/PDF/print export suite;
- embedded generic chat;
- 3D, cinematic, or dual-map presentation;
- SUMO, reinforcement learning, V2X, operational dispatch, or vehicle control.

These are roadmap possibilities only. Hidden or absent is better than disabled
promises in the submitted UI.

## Gated implementation order

### Gate 0 — Preserve the fallback

- verify clean known baseline and public CI;
- verify or create the immutable
  `recovery-command-center-v0.1` tag at the approved baseline;
- verify the old deployment remains selectable;
- work only on `feat/maav-stress-lab`.

Stop if the previous submission cannot be recovered.

### Gate 1 — Freeze the Stress Lab contract

- replace the active product mission and ownership documents;
- rename the engine contract to `docs/SIMULATION_ENGINE.md`;
- establish immutable artifact flow, exact six static tools, deterministic
  evidence boundary, Google presentation boundary, human review, and H0
  exclusions;
- change no runtime, tests, dependencies, or configuration;
- pass consistency searches, lint, typecheck, and diff review.

Stop for human review before Gate 2.

### Gate 2 — Two-tool real-browser WebMCP spike

Add an isolated temporary `/lab` slice with only:

- `read_lab_state`;
- `configure_scenario`.

Prove in the exact Chrome 150 target:

- static discovery;
- strict schema and serialization;
- visible activity;
- shared application seam;
- no duplicate registration under remount/Strict Mode;
- structured prerequisite/validation behavior.

Convert the spike into a repeatable contract test. Do not begin the engine until
real discovery and execution are proven.

### Gate 3 — Freeze deterministic inputs

- integer-unit domain types;
- `sandton-rosebank-v1` fixture and validation;
- canonical serializer and fingerprints;
- shared 120-request seed-07 demand trace.

Stop when a complete run input can be produced without UI, WebMCP, Google, or
wall-clock state.

### Gate 4 — Build the headless engine

- vehicle/passenger initialization;
- authored route lookup;
- deterministic dispatch;
- reserve-aware movement;
- 08:42 equivalent failure;
- failure recovery approximation;
- immutable ledger/snapshots;
- cancellation wrapper and invariants.

Stop when A and B complete deterministically with genuine ledgers and no KPI
constants.

### Gate 5 — Derive evidence

- fold every metric from events;
- evaluate hard constraints separately;
- compare explicit compatible completed runs;
- build bounded evidence claims with no opaque winner score.

Stop when every displayed number and supported claim resolves to immutable
evidence.

### Gate 6 — Application safety

- repository port and tab-scoped adapter;
- one shared application service;
- immutable revisions and stale propagation;
- expected-revision compare-and-swap;
- operation idempotency;
- cancellation/late-result protection;
- human-only review and Reset commands.

Stop when the golden flow passes headlessly through service commands.

### Gate 7 — Complete static WebMCP catalog

- implement all six strict schemas and thin adapters;
- use common safe envelopes and bounded clarification;
- register all six once;
- prove cancellation, prerequisite errors, UI visibility, and no duplicates;
- complete the exact tool chain in the real browser agent.

### Gate 8 — Complete manual non-map vertical slice

- A/B configuration, clone, validation, and differences;
- run, disruption, stale/current status, comparison, findings, review, activity;
- full manual workflow with Google and WebMCP unavailable.

Do not begin map polish until the complete product logic is usable without a
map.

### Gate 9 — Replay and map projections

- one replay-derived presentation frame;
- interactive SVG/list fallback first;
- synchronized timeline;
- Google basemap, Advanced Markers, authored overlays, and degradation;
- equality tests proving maps and playback cannot change evidence.

### Gate 10 — Judge-visible evidence quality

- constraint-first comparison and explicit trade-offs;
- evidence-linked pending finding;
- human Accept/Challenge;
- activity and assumptions;
- keyboard, screen-reader, reduced-motion, 1366×768, and 1440×900 polish.

### Gate 11 — Release verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also require:

- Linux Playwright golden/degraded paths;
- repeated deterministic fingerprints;
- real Chrome 150 exact prompt 5/5;
- clarification and authority-bypass prompts;
- cancellation/idempotency/revision/stale/incompatible tests;
- Google keys/configuration review;
- public HTTPS deployment smoke.

### Gate 12 — Cut over and submit

Only after Gate 11 is green:

- switch the root route to Stress Lab;
- rerun every gate;
- remove legacy runtime only after cutover remains green;
- preserve the fallback tag/deployment;
- capture evidence before optional polish;
- freeze, prepare Devpost materials, and submit by the internal target.

## Go/no-go schedule

| SAST target | Required evidence | If red |
|---|---|---|
| Aug 31 12:00 | Seed-07 engine produces deterministic ledger-derived KPIs and tested failure | Simplify configuration/dispatch; never hard-code results |
| Aug 31 evening | A/B configure, run, disrupt, compare through application tests | Stop UI polish; repair the state/evidence core |
| Sep 1 evening | Exact six tools complete the golden path in the real target browser | Drop all H1/polish; repair WebMCP |
| Sep 2 12:00 | Public HTTPS release passes three clean runs and degraded paths | Use authored fallback; no new features |
| Sep 2 evening | Video, screenshots, transcript, README, and release evidence captured | Feature freeze; blockers only |
| Sep 3 16:00 | Verified release submitted | Preserve six-hour contingency |

## Release evidence pack

The final release must include:

- public repository and green CI at one release SHA;
- public HTTPS URL that identifies the same release;
- exact Chrome 150 version, flags, browser-agent/client, and native smoke report;
- six-tool catalog and representative success/error/clarification envelopes;
- five successful exact golden-prompt runs from Reset;
- deterministic demand, input, run, comparison, and finding fingerprints;
- 08:42 resolved-target and recovery ledger evidence;
- hard-constraint and trade-off comparison;
- human-only review proof and authority-bypass result;
- Google-present, Google-blocked, and WebMCP-unsupported proof;
- cancellation, idempotency, revision, stale, and incompatible evidence proof;
- keyboard/reduced-motion and target viewport checks;
- synthetic-data, non-operational, non-calibration, and AI/Codex disclosures.

Never include keys, raw prompts, private browser state, fabricated metrics,
roadmap claims, unapproved quotes, or customer/partner claims.

## Demo assets

Capture only after a release candidate passes:

1. initial A/B workbench and six tools ready;
2. 08:42 failure on map/timeline or fallback;
3. immutable comparison with hard constraints and trade-offs;
4. evidence-linked pending finding;
5. visible human Accept/Challenge boundary;
6. Reset/repeat fingerprint equality;
7. authored fallback with results unaffected;
8. under-three-minute video with audio and synthetic-data narration.

## Deployment checks

- clean frozen install/build;
- restricted separate browser/server Google keys;
- configured Map ID;
- secure origin isolation and `tools` Permissions Policy;
- no `document.domain`;
- real WebMCP on deployed top-level origin;
- no console-breaking errors;
- Google success and blocked fallback;
- manual workflow without WebMCP;
- release SHA visible or otherwise traceable;
- no secret in source, output, screenshots, or transcripts.

## Submission contingency

The tagged **Recovery Command Center** is a release fallback only. It is not a
mode, feature, route, or component of MAAV Stress Lab and must not appear in the
new product story.

If Stress Lab has not passed the Gate 11 reliability and deployed real-browser
gates by the September 2 go/no-go point:

1. stop Stress Lab feature work;
2. retain its branch for later development;
3. restore the tagged prior application or last verified deployment;
4. submit the strongest verified product with honest positioning;
5. do not merge a partially reliable Stress Lab simply to preserve the pivot.

## Final decision rule

Protect deterministic evidence and human authority, not feature count. A
smaller lab with one reproducible experiment, undeniable real WebMCP use,
Google-independent truth, and clear human review is stronger than a broad
simulation surface with unverifiable claims.
