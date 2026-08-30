# Gate 2 Chrome 150 WebMCP evidence

Status: **clean-session proof passed; repeated-inspector caveat recorded**

Date: 2026-08-30

Route: `http://localhost:3000/lab`

Browser: Google Chrome `150.0.7871.125` with the WebMCP testing flag enabled

This record covers only the isolated Gate 2 provisional integration proof. It
is not simulation evidence and does not claim that the deterministic engine or
the remaining four H0 tools exist.

## Independent discovery and invocation

The browser-agent instruction described the desired inspection and bounded
Scenario A change without supplying either tool name. The agent independently
selected the exact static catalog:

1. `read_lab_state`
2. `configure_scenario`

Observed clean-session sequence:

| Step | Tool | Input summary | Authoritative result |
| --- | --- | --- | --- |
| 1 | `read_lab_state` | `{}` | `ok: true`, revision `0`, Scenario A/B absent, provisional disclosure present |
| 2 | `configure_scenario` | Scenario A replacement, expected revision `0`, operation `op-config-scenario-a-001`, 12 vehicles, 8 seats | `ok: true`, artifact `scenario-A-r1`, revision `1`, source `WEBMCP`, total seats `96` |
| 3 | `read_lab_state` | `{}` | `ok: true`, revision `1`, Scenario A read back with the committed values |

The result remained explicit that this is
`PROVISIONAL_INTEGRATION_TEST` state with no simulation results.

## Visible UI evidence

The live `/lab` projection after the agent run showed:

- workspace revision `1`;
- Scenario A labelled `Agent proof — twelve compact pods`;
- 12 vehicles, 8 seats per vehicle, and 96 total provisional seats;
- WebMCP status `AVAILABLE` with two static tools registered;
- an initial `WEBMCP • SUCCEEDED • REV 0` read activity;
- a `WEBMCP • SUCCEEDED • REV 1 • scenario-A-r1` configure activity;
- a `WEBMCP • SUCCEEDED • REV 1` readback activity.

The browser agent therefore changed the same state rendered by the human UI;
it did not operate the form.

## Automated contract evidence

`tests/contract/stress-lab-webmcp-spike.test.ts` covers:

- exact two-tool names, order, descriptions, schemas, and annotations;
- unknown-field rejection;
- compact read-only state output;
- atomic revision-aware mutation and visible `WEBMCP` provenance;
- the shared application service used by manual and tool paths;
- invalid, ambiguous, stale, and cancelled requests without mutation;
- operation-ID idempotency and conflict behavior;
- no direct Zustand mutation in tool adapters;
- Strict Mode/remount registration without duplicates;
- canonical store and coordinator identity across module reload.

`tests/e2e/stress-lab-spike.spec.ts` ran in the installed Chrome 150 binary and
covers visible shared-state synchronization plus the unsupported-WebMCP manual
fallback. It uses a browser-adapter seam and is not presented as the real-agent
proof above.

Final verification results:

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS — 9 files, 69 tests
pnpm build      PASS — /lab statically generated
Chrome 150 E2E  PASS — 2 tests
git diff checks PASS
```

## Repeated-inspector caveat

After the successful clean run, a separate repeated inspector attempt reported
that a supplied value was not a native `RegisteredTool`. Chrome rejected those
calls before MAAV's execute callback, so they created no rejected application
activity and did not mutate revision `1`. A later read-only invocation again
succeeded at revision `1`.

This is recorded as browser-agent/inspector handle instability outside MAAV's
tool handler, not as an application success. For the judged demo, begin from a
fresh `/lab` session and rediscover the static catalog before invocation. If the
inspector reproduces the failure in a clean session, Gate 3 must pause until the
client integration is made reliable.

## Gate decision

The clean-session Gate 2 exit statement is demonstrated: a real browser agent
discovered the page tools, read provisional state, committed one validated
Scenario A mutation through the shared application boundary, caused an
immediate visible update, read back revision `1`, and left attributable
activity evidence.

Gate 3 may begin only after review of this evidence and the repeated-inspector
caveat. No simulator work was started during Gate 2.
