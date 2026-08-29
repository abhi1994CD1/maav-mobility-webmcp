# Golden Demo and Build Order

## Golden prompt
“An obstruction has blocked the Rosebank-Sandton corridor. Restore at least 95% on-time arrivals, keep maximum passenger waiting below five minutes, preserve wheelchair-accessible service, and keep additional energy below 8%. Compare the options and stage the best plan for my approval.”

## Golden flow
1. Reset scenario.
2. Activate incident.
3. Agent calls `get_network_snapshot`.
4. Agent calls `evaluate_recovery_options`.
5. App displays three plans and one compliant recommendation.
6. Agent calls `stage_recovery_plan`.
7. Operator clicks Approve.
8. App dynamically registers `commit_approved_recovery`.
9. Agent commits.
10. App animates recovery and shows KPI improvement.
11. Agent reads the audit log.
12. Operator or agent can roll back.

## Internal build order

### Slice 0 — repository contract
- scaffold Next.js;
- add AGENTS.md and docs;
- strict TypeScript, lint, test, build scripts;
- CI and environment template.

### Slice 1 — deterministic domain
- scenario types and seed;
- state machine;
- incident activation;
- three candidate plans;
- metrics, constraints, ranking;
- unit tests.

### Slice 2 — command-center shell
- full-screen layout;
- Google Map;
- static corridor/station/vehicle overlays;
- KPI strip, incident panel, timeline;
- fallback mode.

### Slice 3 — application use cases
- inspect, evaluate, stage, approve, commit, rollback, audit;
- revision checks;
- immutable snapshots;
- structured errors.

### Slice 4 — WebMCP
- browser type declarations;
- adapter;
- tool schemas and handlers;
- dynamic registration;
- visible invocation activity;
- contract tests.

### Slice 5 — Google route context
- server-side Routes proxy;
- normalized route context;
- in-session cache;
- authored fallback;
- API failure tests.

### Slice 6 — polish and submission
- complete animation and approval UX;
- Playwright golden flow;
- deployed smoke test;
- README, architecture diagram, screenshots;
- under-three-minute public demo video;
- submission freeze.

## Recommended first Codex prompt

```text
Read AGENTS.md and every file in docs/. Do not change product scope.

Implement Slice 0 only. Scaffold the Next.js TypeScript repository using pnpm, create the directory boundaries defined in docs/ARCHITECTURE.md, configure strict type checking, linting, Vitest, Playwright, environment validation, and a minimal CI workflow. Add a simple full-screen placeholder route that states “Simulated Operations • Google Maps Context”.

Before editing, report the files you will create and the verification commands. After editing, run lint, typecheck, unit tests, and build. Do not add Google Maps or WebMCP implementation yet. Stop after Slice 0 and summarize the diff and any risks.
```

## Next Codex prompt

```text
Read AGENTS.md and docs/. Implement Slice 1 only: the deterministic domain and application contracts. Do not create React components or call external APIs.

Create the canonical Johannesburg-inspired morning-peak scenario, explicit workflow state machine, domain events, three recovery candidates, hard-constraint evaluation, transparent metrics, and deterministic ranking. Add tests for replay determinism, accessibility hard failure, stale revisions, legal/illegal transitions, and ranking. Run all verification commands and stop after Slice 1.
```
