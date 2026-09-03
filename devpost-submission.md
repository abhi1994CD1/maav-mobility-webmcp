# Title

MAAV Stress Lab

## One-line Summary

MAAV Stress Lab is a browser-native, deterministic mobility assurance workbench where a human and a browser agent configure, stress, replay, compare, and review two synthetic fleet designs through six trusted WebMCP tools.

## Problem

Early mobility-design decisions are often discussed through disconnected dashboards, opaque assumptions, or AI-generated prose that cannot be reproduced. Even when an agent can operate software, it can be difficult to tell which claims came from trusted evidence, whether two scenarios received an equivalent stress test, or whether the agent silently crossed a human decision boundary.

MAAV Stress Lab turns that uncertainty into a controlled experiment. It keeps configuration, disruption policy, deterministic execution, immutable evidence, comparison, and human review in one browser-native workflow.

All passengers, vehicles, assignments, events, and outcomes are synthetic. MAAV Stress Lab is not a live fleet-management system, an operational dispatcher, a scientifically calibrated transport model, or an autonomous optimizer.

## Solution

The lab runs one bounded, reproducible A/B experiment on an authored synthetic Sandton–Rosebank network:

- Scenario A uses 12 vehicles with 8 seats each.
- Scenario B uses 10 vehicles with 10 seats each.
- Both use the same seed-07 trace of 120 synthetic passenger requests from 08:30 to 09:00.
- Each scenario receives the same deterministic vehicle-failure policy at 08:42.
- The engine independently selects the affected vehicle from authoritative state using a fixed tie-break policy.
- Completed runs produce immutable event ledgers, metrics, constraint results, provenance, and fingerprints.
- Compatible runs can be compared and used to stage an evidence-linked finding.
- The browser agent can stage a finding, but only the visible human interface can Accept or Challenge it.

The golden experiment demonstrates a real trade-off rather than manufacturing a universal winner. Scenario A serves 82 passengers, has 29 still in service at the horizon, leaves 9 unserved, and recovers in 120 seconds. Scenario B serves 81, has 28 still in service, leaves 11 unserved, uses less energy, and reduces maximum wait from 1,050 to 780 seconds. Both violate the hard maximum-wait constraint. The resulting finding is `TRADE_OFF / BALANCED` and remains `PENDING HUMAN REVIEW` until a human acts.

## Why This Matters

WebMCP makes the application operable by a browser agent without turning the agent into the source of truth. The same application service serves both the manual interface and all WebMCP tools, so the agent does not operate a parallel demo path. Revisions, idempotency, cancellation, evidence compatibility, and stale-artifact invalidation are enforced below the UI and adapter layers.

This creates a more useful human-agent collaboration model:

- the agent can execute a multi-step experiment rather than merely describe one;
- every result is grounded in committed, inspectable evidence;
- retries and concurrent writes fail safely;
- the human sees tool activity and shared state as it changes;
- final judgment remains explicitly human-controlled.

## How We Used AI

The AI is an experiment orchestrator, not a simulation engine. Through the browser's WebMCP surface it can:

1. inspect the current lab revision and prerequisites;
2. configure Scenario A and Scenario B;
3. attach one equivalent deterministic failure to each scenario;
4. run both current immutable revisions;
5. compare the two verified result artifacts; and
6. stage an evidence-backed finding for human review.

The public catalog is static and contains exactly six tools:

1. `read_lab_state`
2. `configure_scenario`
3. `run_scenario`
4. `inject_disruption`
5. `compare_scenarios`
6. `stage_finding`

The tools use strict schemas and compact structured results. They carry expected workspace revisions and source-aware operation IDs, propagate cancellation, and expose visible best-effort activity. The WebMCP adapter never calculates simulation outcomes, metrics, comparisons, findings, target selection, or final authority decisions.

The AI cannot Accept, Challenge, Reset, delete evidence, dispatch vehicles, or control a real fleet. Those capabilities are intentionally absent from the tool catalog. Google Maps is also presentation-only and never supplies routing, traffic, distance, timing, energy, or evidence authority.

## How We Used Codex

OpenAI Codex was used as an implementation and release-gate collaborator throughout the build. It helped translate the product contract into a modular TypeScript architecture, implement the deterministic simulation and evidence lifecycle, construct the strict six-tool WebMCP adapter, and build the shared manual UI and replay experience.

Codex also supported adversarial verification rather than only code generation. That work included revision-conflict and idempotency cases, cancellation and no-ghost publication checks, immutable artifact provenance, human-authority boundaries, strict schema rejection, output sanitization, deterministic fingerprint regression tests, and browser/runtime diagnosis. One concrete browser finding was that the Chrome agent could omit the callback options argument; the boundary was hardened while preserving an explicitly supplied `AbortSignal` by identity.

Claude was used for a visual-only premium-interface iteration on a separate design branch. Simulation authority, evidence contracts, WebMCP schemas, and human-control boundaries remained outside that visual redesign scope.

## Key Features

- **Exactly six static WebMCP tools:** discoverable throughout the application lifecycle, with no hidden approval or generic mutation tool.
- **Shared human and agent runtime:** manual actions and WebMCP calls use one per-tab repository, one application service, one revision, and one audit trail.
- **Deterministic A/B stress testing:** one fixed network, seed, demand trace, time horizon, tick, disruption type, and transparent failure-selection rule.
- **Immutable evidence lifecycle:** scenario revision → run artifact → comparison artifact → finding artifact → human review.
- **Revision-safe mutations:** optimistic concurrency prevents stale or simultaneous commands from silently overwriting state.
- **Source-aware idempotency:** exact retries return the original terminal result; changed arguments or cross-source reuse fail closed.
- **Cancellable execution:** abort signals reach cancellable simulation work, and cancelled runs publish no partial artifact or ghost completion.
- **Evidence-first comparison:** hard constraints and metric trade-offs remain separate; the UI does not invent a winner score.
- **Human-only review:** Accept, Challenge, and Reset exist only in the visible manual interface.
- **Deterministic replay:** the map and timeline project committed snapshots and ledger events without generating intermediate evidence.
- **Presentation-only Google Maps:** the authored network and trusted artifacts remain authoritative; the full workflow has an authored fallback when Google is unavailable.
- **Accessible degraded modes:** the experiment remains usable without WebMCP or Google Maps.

## Architecture

MAAV Stress Lab is a strict TypeScript modular monolith with hexagonal boundaries:

```text
React UI / WebMCP / Google Maps / Zustand adapters
                         ↓
              StressLabService application layer
                         ↓
           deterministic domain engine and policies
```

The domain owns passenger arrivals, assignments, movement, boarding, service, battery, energy, failure recovery, ledger events, metrics, constraints, comparisons, and supported finding claims. It has no dependency on React, Next.js, Zustand, Google Maps, WebMCP, network clients, or wall-clock UI state.

The application layer owns command validation, source authority, expected revisions, idempotency, cancellation, compatibility, invalidation, and atomic publication. Zustand implements the repository port and subscriber-visible per-tab runtime. The UI and WebMCP bridge are thin adapters over that shared application authority.

Every completed run binds its scenario, seed, network, demand, disruption, normalized event ledger, result, and fingerprints. Editing a scenario creates a new revision and invalidates only the application-authoritative current pointers that depend on it; historical artifacts remain immutable and inspectable.

Replay controls, selected entities, map camera, layer visibility, animation speed, and Google road geometry are ephemeral presentation state. They never enter application commands, audits, artifacts, canonical serialization, or trusted fingerprints.

## Testing Instructions

### Local setup

Requirements:

- Node.js 20+
- pnpm 8.11.0
- Google Chrome 150 with WebMCP testing enabled for native browser-agent testing

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/lab`.

The manual workflow works without a Google key and without WebMCP support. To test the Google presentation surface, provide restricted browser values for `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID` in an ignored `.env.local`; never commit them.

### Manual golden flow

1. Reset the lab from the visible human control.
2. Configure Scenario A as 12 vehicles × 8 seats.
3. Configure Scenario B as 10 vehicles × 10 seats.
4. Inject the deterministic 08:42 vehicle failure independently into A and B.
5. Run A, then run B, using the latest visible workspace revision before each action.
6. Compare the current compatible runs.
7. Stage `TRADE_OFF / BALANCED`.
8. Verify the finding remains `PENDING HUMAN REVIEW`.
9. Accept or Challenge only through the visible human UI.

For the browser-agent path, issue this prompt in a fresh supported Chrome tab:

> Configure the seed-07 A/B Stress Lab, apply the equivalent deterministic 08:42 failure to each scenario, run both, compare verified evidence, and stage a TRADE_OFF / BALANCED finding for human review.

Verify that the agent uses distinct operation IDs, reads the latest workspace revision between mutations, exposes no Accept/Challenge/Reset tool, and leaves no activity stuck in a non-terminal state.

### Automated checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The latest local evidence recorded during development includes a full Vitest run of 36 files and 278 passing tests. Before release, rerun all checks at the exact public release SHA and record the deployed Chrome smoke result.

## Public Demo Link

`[TODO — deploy the current release to a public HTTPS URL ending in /lab]`

The local development URL is `http://localhost:3000/lab`; it is not the judge-facing demo URL.

## Public Repository Link

https://github.com/abhi1994CD1/maav-mobility-webmcp

The repository is public and includes an MIT license. Before final entry, push the reviewed release commit and confirm the public default branch or release tag resolves to the exact tested source.

## Demo Video

`[TODO — public YouTube URL, under 3 minutes, with audible narration]`

### Suggested video outline

| Time | What the judge sees |
|---|---|
| 0:00–0:15 | MAAV Stress Lab, the synthetic/non-operational boundary, and the A/B question |
| 0:15–0:35 | Exactly six WebMCP tools and the golden browser-agent prompt |
| 0:35–1:05 | Agent configures A/B and attaches equivalent 08:42 failures while the UI updates |
| 1:05–1:35 | Deterministic runs and exact replay at the authoritative failure event |
| 1:35–2:05 | Constraint-first A/B comparison and the service/energy/recovery trade-off |
| 2:05–2:30 | Agent stages `TRADE_OFF / BALANCED`; finding remains pending |
| 2:30–2:48 | Human-only Accept/Challenge boundary and immutable fingerprint provenance |
| 2:48–2:58 | Product line: “Design it. Break it. Make it resilient.” |

Narration should explicitly say that the experiment is synthetic, the model is deterministic but not scientifically calibrated, Google is presentation-only, and no live vehicle control occurs.

## Screenshot Shot List

Use the strongest existing evidence captures as source material, then recapture the final deployed release with consistent branding and no development chrome:

1. **Hero / browser-agent workflow:** dominant map, six-tool readiness, scenario selector, timeline, and activity.
   - Existing reference: `artifacts/gate9-correction/scenario-a-road-geometry-1440x900.jpg`
2. **Exact 08:42 disruption evidence:** selected Scenario B failure with the resolved vehicle and authoritative timeline.
   - Existing reference: `artifacts/gate9-correction/scenario-b-failure-1366x768.jpg`
3. **A/B comparison:** both committed result summaries, constraints, deltas, evidence IDs, and fingerprints.
   - Existing reference: `artifacts/gate8/maav-gate8-comparison-1440x900.jpg`
4. **Pending human review:** `TRADE_OFF / BALANCED`, evidence-linked claims, caveats, and visible Accept/Challenge controls.
   - Existing reference: `artifacts/gate8/maav-gate8-pending-review-1366x768.jpg`
5. **Graceful baseline/fallback:** map shell before a run or after Reset, showing that the manual lab remains usable without fabricated replay evidence.
   - Existing references: `artifacts/gate9-correction/map-before-run-1440x900.jpg` and `artifacts/gate9-correction/map-after-reset-1366x768.jpg`

Final screenshots should show the public HTTPS origin, preserve Google attribution when the Google surface is visible, avoid exposing keys or request URLs, and match the release SHA used for the video.

## Submission Readiness Notes

### Ready

- Product positioning, synthetic boundary, and human-control boundary are explicit.
- The manual `/lab` workflow and six-tool WebMCP workflow are implemented on a shared application service.
- Deterministic engine, immutable evidence, comparison, finding, replay, sanitization, cancellation, and idempotency tests exist.
- The public repository exists and includes an MIT license.
- Gate 8 and Gate 9 evidence images are available in the repository.

### Required before final handoff

- Deploy the reviewed release to a public HTTPS URL accessible in supported Chrome.
- Push or merge the exact reviewed release source to the public repository.
- Rerun lint, typecheck, all tests, and production build at that release SHA.
- Complete the native Chrome/WebMCP golden prompt against the deployed URL and save a sanitized transcript.
- Record and publish the under-three-minute YouTube demo with audio.
- Recapture final screenshots from the deployed release.
- Confirm Google Cloud referrer/API restrictions without exposing the browser key.
- Complete the personal and status-specific official form fields listed below.

The source is consolidated on `main`; treat the deployed build as the release only after its public commit SHA matches the final verification, screenshots, and video.

## Known Limitations

- The H0 release is intentionally limited to one authored synthetic network, one seed-07 demand trace, two scenario slots, and one vehicle-failure policy.
- Results are deterministic decision-support evidence, not scientifically calibrated predictions or operational recommendations.
- There is no live passenger, fleet, GTFS, traffic, customer, or vehicle-control integration.
- State and immutable artifacts are scoped to the current browser tab; there is no account system, database, team workspace, or multi-user persistence.
- Google Maps and optional road geometry affect presentation only. The experiment remains valid and usable through the authored fallback.
- Native WebMCP behavior depends on a supported Chrome/browser-agent environment; unsupported browsers use the complete manual interface.
- The agent can stage a finding but cannot Accept, Challenge, Reset, dispatch, or execute any real-world action.

## TODO Official Form Fields

These fields come from the live WebMCP Challenge entry form and need final confirmation:

- **Submitter Type:** `[TODO — Individual or Team]`
- **Country of residence:** `[TODO — select the participant’s country]`
- **Organization / school:** `[Optional — add only if applicable]`
- **App Status:** `[TODO — confirm New App or Existing App]`
- **Existing-app updates:** `[Required only if Existing App — summarize work completed during the contest period]`
- **Live URL:** `[TODO — public HTTPS /lab URL]`
- **Testing instructions:** Use the concise local/deployed steps above; add any release-specific browser flag or login requirement.
- **Public repository URL:** https://github.com/abhi1994CD1/maav-mobility-webmcp
- **Agents/clients tested:** `[TODO — confirm exact Chrome version, browser-agent/extension name and version, and operating system]`
- **AI tools used:** OpenAI Codex for architecture, implementation, testing, and release-gate review; Claude for a visual-only UI iteration; `[TODO — confirm the exact browser-agent product/model used in the demo]`.
- **AI learning level:** `[TODO — choose None, Moderate, or Significant]`
- **AI career value:** `[TODO — Yes or No]`
- **Public demo video:** `[TODO — public YouTube URL under 3 minutes]`
- **Final release commit:** `[TODO — exact public commit SHA used by deployment, tests, screenshots, and video]`
