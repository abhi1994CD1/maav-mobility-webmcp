# Golden Demo and Release Proof

## Golden prompt

After the operator activates the canonical incident in the visible UI:

> An obstruction has blocked the Rosebank-Sandton corridor. Restore at least 95% on-time arrivals, keep maximum passenger waiting below five minutes, preserve wheelchair-accessible service, and keep additional energy below 8%. Compare the options and stage the best plan for my approval.

## Golden flow

1. The operator uses `Reset scenario` to restore the canonical healthy scenario.
2. The operator activates the Rosebank-Sandton incident through a visible demo control.
3. The agent calls `get_network_snapshot`.
4. The agent calls `evaluate_recovery_options`.
5. The app displays three plans and one deterministic compliant recommendation.
6. The agent calls `stage_recovery_plan`.
7. The app enters `PLAN_STAGED`; the commit tool is not registered.
8. The operator reviews the exact staged plan and clicks Approve.
9. Approval enters `APPROVED`, binds the plan to the resulting revision, and makes `commit_approved_recovery` available after the registry safely reconciles.
10. The agent calls `commit_approved_recovery` with that plan and revision.
11. The domain enters `RECOVERED`; transient UI activity animates the already-committed operational change and KPIs improve.
12. The agent calls `get_action_audit_log` and sees the append-only revision sequence.
13. The operator or agent invokes the rollback use case.
14. Only operational state is restored; the app enters `ROLLED_BACK` and the audit history remains.

Incident activation and reset are never browser-agent tools. Approval is never a browser-agent tool. The agent owns `inspect -> evaluate -> stage -> commit -> audit/rollback`, with the human approval gate between stage and commit.

## Canonical revision trace

A freshly initialized demo may begin at `READY` revision 0. Each successful domain mutation advances exactly once:

```text
human incident activation expectedRevision 0 -> INCIDENT_ACTIVE revision 1
evaluate                  expectedRevision 1 -> OPTIONS_EVALUATED revision 2
stage                     expectedRevision 2 -> PLAN_STAGED revision 3
human approval            expectedRevision 3 -> APPROVED revision 4
  approval.validForRevision = 4
  approval.consumed = false
commit                    expectedRevision 4 -> RECOVERED revision 5
rollback                  expectedRevision 5 -> ROLLED_BACK revision 6
```

Read tools and ephemeral focus, panel, loading, activity, and animation changes leave the revision unchanged. A Reset command applied to an existing session is itself one audited mutation and therefore increments that session's revision once.

## Google fallback demonstration

The same golden sequence and winning plan must complete when Routes API is unavailable. In fallback mode:

- label route context as `AUTHORED FALLBACK`;
- keep `SIMULATED OPERATIONS • GOOGLE MAPS CONTEXT` visible;
- preserve the authored map/network overlays and Google attribution where the Google map is present;
- calculate the same canonical hard-constraint results, metrics, and winning plan as the Google-enriched path;
- never imply that fallback or simulated values are live traffic.

## Supported local environment

- macOS 12.7.6
- Intel x86_64
- Google Chrome 150
- WebMCP testing flag enabled

Local hard gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also run a manual real-WebMCP smoke test in the installed Chrome 150. Do not require downloading the newest Playwright-managed browser to unblock local development. Full Playwright E2E may run in Linux CI.

## Manual Chrome 150 WebMCP smoke test

Run the map preflight in all three supported configurations before the workflow checks. Never print or capture credential values.

1. Maps and Routes configured: verify the Google basemap and attribution; the full authored North Spine as a subdued operational backbone; the road-shaped Google Rosebank-Sandton segment as prominent traffic-aware context; simulated stops and vehicles; and `GOOGLE MAPS + ROUTES CONTEXT`. Confirm the segment changes from cyan to disruption red to verified-recovery green without a route load changing revision.
2. Maps configured and Routes unavailable: verify the Google basemap, attribution, prominent authored operational path, stops, vehicles, and `GOOGLE MAPS • AUTHORED ROUTE FALLBACK`.
3. Maps and Routes unavailable: verify the authored SVG appears immediately with `AUTHORED MAP + ROUTE FALLBACK` and no map-loading state changes domain revision.

If Routes succeeds while Maps JavaScript is unavailable, the supported intermediate label is `AUTHORED MAP • GOOGLE ROUTE CONTEXT`; the SVG remains authored and does not attempt to draw Google geometry. Google traffic is a one-time session snapshot, not a continuous feed, and must not change the canonical plan metrics, winner, revision trace, or audit sequence.

Complete the full workflow in every locally testable configuration and verify Chrome WebMCP remains active throughout.

1. Open the app as a top-level same-origin, secure/origin-isolated document with the `tools` Permissions Policy enabled; verify `document.modelContext` is available and no code probes `navigator.modelContext`.
2. Verify the initial tool set contains only the `READY` matrix tools and never `activate_demo_incident`.
3. Activate the incident through the UI and verify `evaluate_recovery_options` becomes available.
4. Run inspect, evaluate, and stage through the real browser tool surface; verify each result uses the common envelope and visible UI reacts.
5. Before approval, verify `commit_approved_recovery` is absent and a direct stale/invalid call would still fail application preconditions.
6. Approve in the UI; verify the approval is bound to the resulting revision and commit becomes available.
7. Commit; verify phase `RECOVERED`, revision increments once, approval is consumed, and KPI recovery is deterministic.
8. Read the audit log; verify the read leaves revision unchanged.
9. Roll back; verify only operational state is restored, governance is cleared, phase becomes `ROLLED_BACK`, and prior audit entries remain.
10. Read the audit again; verify the rollback event was appended and its operator-supplied reason is treated as untrusted content.
11. Repeat with Routes API unavailable and then with both Google surfaces unavailable; verify the labelled authored fallbacks complete the same workflow and select the same winning plan with the same final revision and audit sequence.
12. Invoke a mutation with a pre-aborted invocation signal and verify `ABORTED`, no revision change, and no audit append. If a slice introduces genuine asynchronous work, also cancel it in flight; do not add a fake delay solely for this test.
13. Verify the audit actor sequence proves ownership: human activation, agent evaluation, agent staging, human approval, agent commit, and agent rollback.
14. Trigger rapid phase notifications with delayed registration promises and verify the final registered set matches the latest phase without duplicate tools.
15. Force an ephemeral notification/rendering failure after a successful mutation and verify the agent still receives the authoritative success result.

Use Chrome's real browser-agent or Model Context Tool Inspector surface for the natural-language run. A deterministic local smoke may use Chrome's developer `document.modelContext.executeTool(...)` test path, but that consumer-only method must not become a production application dependency.

## Judge-first demonstration contract

The public video is under three minutes, includes audio, and shows the running product in the first 10–15 seconds. It must demonstrate native browser-agent participation rather than only manual fallback buttons.

| Time | Evidence |
|---|---|
| 0:00–0:15 | Active obstruction, degraded KPIs, simulated-data label, and the operator objective |
| 0:15–0:40 | Agent discovers/calls snapshot and evaluation tools; visible activity and structured results |
| 0:40–1:05 | Three calculated plans, metric provenance, hard failures, trade-offs, and deterministic recommendation |
| 1:05–1:25 | Agent stages the plan; approval drawer opens; commit capability is visibly absent |
| 1:25–1:45 | Human approves the exact plan/revision; commit capability appears |
| 1:45–2:05 | Agent commits; operational projection and KPIs enter `RECOVERED` |
| 2:05–2:25 | Audit proves HUMAN/AGENT ownership and exact revision sequence |
| 2:25–2:42 | Agent rolls back operational state while audit remains append-only |
| 2:42–2:55 | One architecture frame: existing platform -> governed recovery layer -> human-authorized action |

The narration must say that the data and outcomes are simulated projections. It must explain why WebMCP is essential: the agent receives a safe, state-shaped capability surface instead of guessing through UI controls, and it cannot create its own approval.

## Public WebMCP evidence

The repository must include a dated evidence report for the submitted release with:

- public deployment URL and release commit SHA;
- exact Chrome version and WebMCP flag state;
- origin isolation and `tools` Permissions Policy checks;
- registered tool names captured for every durable phase;
- representative serialized success and structured-failure envelopes;
- revision `1 -> 6` and HUMAN/AGENT audit ownership;
- commit absent before approval and unavailable after consumption;
- stale revision, wrong plan, replayed commit, malicious plan ID, and pre-aborted invocation results;
- Google-unavailable fallback equality;
- distinction between browser-adapter E2E evidence and manual native-Chrome evidence.

Screenshots must include the incident hero, calculated plan comparison, human approval boundary, recovered state, and preserved audit after rollback. Do not expose keys, credentials, raw route responses, or private browser chrome.

## Required release proof

Before recording the final video:

1. Public GitHub CI is green at the release SHA.
2. The public HTTPS deployment identifies the same SHA or release.
3. The live URL works in an incognito session without local state assumptions.
4. The full workflow succeeds twice after Reset.
5. The golden workflow succeeds with Google unavailable.
6. Chrome 150 native WebMCP and the browser-adapter E2E both pass.
7. The UI remains usable at 1366×768 and 1440×900 with keyboard access.
8. The repository shows the live URL, MIT license, testing instructions, screenshots, architecture, limitations, and video link.

## Deadline and freeze

The official submission deadline is September 3, 2026 at 1:00 PM Pacific Time, which is September 3 at 10:00 PM South Africa Standard Time. September 6 is not the submission deadline.

Target code freeze is September 2 at noon SAST. Submit by September 3 at 4:00 PM SAST to retain a six-hour buffer. After the official deadline, do not modify the submission, repository, video, or live deployment during judging.

`docs/CHALLENGE_PLAN.md` owns the remaining execution sequence and cut lines. `docs/RECOVERY_ENGINE.md` owns the counterfactual model implementation contract.
