# Golden Demo and Build Order

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
11. Repeat with Routes API unavailable and verify the labelled authored fallback completes the same workflow and selects the same winning plan.
12. Exercise a cancellable async call and a phase change during invocation; verify execution receives its `AbortSignal`, no partial domain mutation occurs, and registry removal waits for the in-flight call to settle.

## Internal build order

### Slice 0 — repository contract and toolchain

- scaffold Next.js only when implementation begins;
- configure strict TypeScript, lint, unit/contract test, build, CI, and environment templates;
- add directories only with real files required by the slice;
- configure Playwright for Linux CI without making a new local browser download a hard gate.

### Slice 1 — deterministic domain

- authored scenario types and seed;
- the seven-phase state machine;
- human-controlled incident activation and reset use cases;
- three candidate plans;
- metrics, hard constraints, ranking, and unit tests;
- revision semantics and `OperationalSnapshot` rollback contract.

### Slice 2 — command-center shell

- full-screen layout;
- Google Map with static corridor, station, and vehicle overlays;
- KPI strip, incident panel, timeline, and human demo controls;
- visibly labelled authored fallback;
- separate ephemeral UI state.

### Slice 3 — application use cases

- inspect, evaluate, stage, human approve, commit, rollback, and audit;
- atomic expected-revision checks;
- approval binding to the resulting `APPROVED` revision;
- operational-only snapshots and append-only audit;
- common success/failure envelopes.

### Slice 4 — Chrome 150 WebMCP

- official `webmcp-types` declarations;
- `document.modelContext` adapter;
- six exact tool definitions, JSON schemas, Zod validation, and annotations;
- drain-aware registration with registration controllers and in-flight tracking;
- propagation of invocation `AbortSignal`;
- visible ephemeral activity and contract tests;
- manual Chrome 150 real-WebMCP smoke test.

### Slice 5 — Google route context

- server-side Routes proxy;
- bounded normalized route context;
- in-session cache;
- deterministic authored fallback;
- proof that live traffic cannot change the canonical winning plan;
- API failure tests.

### Slice 6 — polish and submission

- complete recovery animation and approval UX;
- Linux CI Playwright golden flow;
- deployed smoke test;
- README, architecture diagram, screenshots, and diagnostics;
- under-three-minute public demo video;
- submission freeze.

## Recommended Slice 0 prompt

```text
Read AGENTS.md and every file in docs/. Do not change product scope.

Implement Slice 0 only. Scaffold the Next.js TypeScript repository using pnpm, configure strict type checking, linting, Vitest, production build, environment validation, and CI. Configure Playwright for Linux CI without making the latest local Playwright browser a hard gate. Add a minimal full-screen placeholder route that states “SIMULATED OPERATIONS • GOOGLE MAPS CONTEXT”.

Create architecture directories only when the slice adds a real file; do not create empty folders or .gitkeep placeholders. Before editing, report files and verification commands. After editing, run lint, typecheck, unit tests, and build. Do not add Google Maps, WebMCP, or product-domain implementation. Stop after Slice 0 and summarize the diff and risks.
```

## Recommended Slice 1 prompt

```text
Read AGENTS.md and every file in docs/. Implement Slice 1 only: deterministic domain and application contracts. Do not create React components or call external APIs.

Implement the seven durable phases exactly as documented, canonical authored scenario, domain events, three recovery candidates, hard-constraint evaluation, transparent metrics, deterministic ranking, exact once-per-mutation revision semantics, approval value types, and operational-only rollback snapshots. Incident activation/reset and approval remain human application use cases, not WebMCP tools.

Add tests for replay determinism, accessibility hard failure, stale revisions, legal and illegal transitions, ranking, approval revision binding, and rollback exclusions. Run local hard gates and stop after Slice 1.
```
