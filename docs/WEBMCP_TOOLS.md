# WebMCP Tool Contracts

## Target and public surface

These contracts target the WebMCP API available in Google Chrome 150.

- Use `document.modelContext`, never `navigator.modelContext`.
- Use the official `webmcp-types` package for TypeScript declarations.
- Register tools with the imperative API through one adapter and central drain-aware registry.
- Validate every input again at runtime with Zod before calling an application use case.
- Propagate `execute(input, { signal })` cancellation into cancellable asynchronous work.
- Do not add `outputSchema`; it is not part of the targeted contract.
- Treat the application/domain result as authoritative. Ephemeral UI effects are best-effort and may not turn a committed mutation into a reported failure.
- Use stable codes and bounded authored labels. Do not reflect arbitrary caller-controlled identifiers in otherwise trusted tool output.

The complete public tool surface is:

1. `get_network_snapshot`
2. `evaluate_recovery_options`
3. `stage_recovery_plan`
4. `commit_approved_recovery`
5. `rollback_last_recovery`
6. `get_action_audit_log`

`activate_demo_incident` is not a WebMCP tool. Activating and resetting the canonical incident are explicit human/demo UI controls. The browser agent's recovery responsibility begins after an incident exists.

Every definition includes `name`, `title`, a concise `description`, serializable JSON `inputSchema`, `annotations`, and `execute(input, { signal })`. Every tool calls one application use case and returns a compact serializable envelope.

## Common result envelope

Success:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "revision": 1,
    "phase": "INCIDENT_ACTIVE"
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "STALE_REVISION",
    "message": "The network changed after the agent inspected it.",
    "recoverable": true,
    "suggestedAction": "Call get_network_snapshot and retry with the current revision."
  },
  "meta": {
    "revision": 1,
    "phase": "INCIDENT_ACTIVE"
  }
}
```

For a successful mutation, `meta` contains the resulting revision and phase. For a query or failure, it contains the unchanged current revision and phase. Failures never expose stack traces, keys, approval secrets, arbitrary reflected caller text, or partially mutated state.

Stable error codes include `INVALID_INPUT`, `STALE_REVISION`, `INVALID_PHASE`, `PLAN_NOT_FOUND`, `PLAN_NOT_COMPLIANT`, `APPROVAL_REQUIRED`, `APPROVAL_MISMATCH`, `APPROVAL_CONSUMED`, `NO_ROLLBACK_AVAILABLE`, `ABORTED`, and `INTERNAL_ERROR`. Messages and suggested actions must be actionable without revealing internals.

## 1. `get_network_snapshot`

Title: `Get network snapshot`

Description: `Inspect simulated operations, the active incident, KPIs, constraints, and legal next actions.`

Read-only. It must not increment revision.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "focus": {
      "type": "string",
      "description": "Area to summarize and focus in the visible command center.",
      "enum": ["network", "incident", "fleet", "demand", "accessibility", "all"]
    }
  },
  "required": ["focus"],
  "additionalProperties": false
}
```

Success `data` includes compact `scenarioId`, requested summary, constraints, route-context source (`GOOGLE` or `AUTHORED_FALLBACK`), legal next actions, and non-secret recovery context:

```json
{
  "nextActor": "HUMAN",
  "nextAction": "APPROVE_STAGED_PLAN",
  "recommendedPlanId": "combined_recovery_c",
  "stagedPlanId": "combined_recovery_c",
  "approvedPlanId": null,
  "rollbackAvailable": false
}
```

Optional plan IDs are omitted or `null` when not applicable. This context lets an agent recover after interruption or a stale revision without exposing the approval record. The snapshot does not return a large state dump or raw Google free-form text.

Annotations:

```json
{
  "readOnlyHint": true,
  "untrustedContentHint": false
}
```

Visible effect: ephemeral map focus and the relevant side panel update; revision does not change.

## 2. `evaluate_recovery_options`

Title: `Evaluate recovery options`

Description: `Calculate and compare deterministic recovery plans against operator objectives.`

Analytical domain mutation from `INCIDENT_ACTIVE` to `OPTIONS_EVALUATED`.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "expectedRevision": {
      "type": "integer",
      "description": "Current domain revision returned by get_network_snapshot or the preceding successful mutation.",
      "minimum": 0
    },
    "objectives": {
      "type": "object",
      "properties": {
        "minimumOnTimePercent": {
          "type": "number",
          "description": "Hard minimum projected on-time passenger percentage.",
          "minimum": 0,
          "maximum": 100
        },
        "maximumWaitMinutes": {
          "type": "number",
          "description": "Hard maximum projected passenger wait in minutes.",
          "exclusiveMinimum": 0
        },
        "preserveAccessibility": {
          "type": "boolean",
          "description": "When true, any projected accessibility violation makes a plan non-compliant."
        },
        "maximumEnergyIncreasePercent": {
          "type": "number",
          "description": "Hard maximum additional recovery energy relative to the authored baseline.",
          "minimum": 0
        }
      },
      "required": [
        "minimumOnTimePercent",
        "maximumWaitMinutes",
        "preserveAccessibility",
        "maximumEnergyIncreasePercent"
      ],
      "additionalProperties": false
    }
  },
  "required": ["expectedRevision", "objectives"],
  "additionalProperties": false
}
```

Success `data` includes `engineVersion`, `baseRevision`, projection horizon, compact plan IDs, calculated metrics and deltas, normalized score components, hard-constraint pass/fail, bounded explanation codes, and `recommendedPlanId` when at least one plan is compliant. The counterfactual model calculates every value from the current operational snapshot and action-only candidates; the agent does not. Internal cohorts, assignments, and operational projections are never returned.

```json
{
  "engineVersion": "corridor-flow-v1",
  "baseRevision": 1,
  "horizonMinutes": 30,
  "modelSource": "AUTHORED_SIMULATION",
  "recommendedPlanId": "combined_recovery_c",
  "plans": []
}
```

If no plan satisfies all hard constraints, `recommendedPlanId` is omitted and the tool still returns the evaluated failures. It never invents a recommendation.

Annotations:

```json
{
  "readOnlyHint": false,
  "untrustedContentHint": false
}
```

Visible effect: the plan comparison opens and alternatives render on the map. The successful canonical call at expected revision 1 returns revision 2 and phase `OPTIONS_EVALUATED`.

## 3. `stage_recovery_plan`

Title: `Stage recovery plan`

Description: `Stage one evaluated recovery plan for visible human review without applying it.`

Reversible governance mutation from `OPTIONS_EVALUATED` to `PLAN_STAGED`. It does not change operational fleet, demand, or KPI truth.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "planId": {
      "type": "string",
      "description": "ID of a compliant plan returned by the current evaluate_recovery_options result.",
      "minLength": 1,
      "maxLength": 128
    },
    "expectedRevision": {
      "type": "integer",
      "description": "Resulting revision from the successful evaluate_recovery_options call.",
      "minimum": 0
    }
  },
  "required": ["planId", "expectedRevision"],
  "additionalProperties": false
}
```

Success `data` includes `planId`, calculated impact summary, and `approvalRequired: true`.

An unknown plan ID returns `PLAN_NOT_FOUND` without reflecting the caller-supplied value in the trusted error message.

Annotations:

```json
{
  "readOnlyHint": false,
  "untrustedContentHint": false
}
```

Visible effect: a translucent preview and approval drawer appear. For the canonical sequence, `stage_recovery_plan(expectedRevision=2)` returns revision 3 and phase `PLAN_STAGED`.

## Human-only approval use case

Approval is intentionally not a WebMCP tool. The operator approves the visible staged plan through the UI using the same application layer.

For the canonical sequence, approval at `expectedRevision=3` produces revision 4 and phase `APPROVED`, with:

```json
{
  "planId": "combined_recovery_c",
  "validForRevision": 4,
  "consumed": false
}
```

Only after this succeeds may the registry expose `commit_approved_recovery`.

## 4. `commit_approved_recovery`

Title: `Commit approved recovery`

Description: `Apply the exact recovery plan explicitly approved in the visible UI.`

Consequential mutation from `APPROVED` directly to `RECOVERED`. Execution and animation are transient UI/tool activity, not a durable phase.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "planId": {
      "type": "string",
      "description": "Exact approved plan ID returned by the staged plan and visible approval state.",
      "minLength": 1,
      "maxLength": 128
    },
    "expectedRevision": {
      "type": "integer",
      "description": "Resulting APPROVED-state revision returned after visible human approval.",
      "minimum": 0
    }
  },
  "required": ["planId", "expectedRevision"],
  "additionalProperties": false
}
```

Atomic preconditions:

- current revision equals `expectedRevision`;
- phase is `APPROVED`;
- approval exists;
- approval `validForRevision` equals current revision;
- approval and staged-plan IDs both match input `planId`;
- approval `consumed` is `false`.

A valid commit first captures an operational-only snapshot, then applies the plan, consumes approval, appends events/audit, and increments revision once. Any intervening mutation invalidates approval. These checks run even if delayed registry removal leaves the tool temporarily discoverable.

Success `data` includes `planId`, post-recovery metrics, and the committed audit sequence. It does not expose the approval record as an authorization secret.

Annotations:

```json
{
  "readOnlyHint": false,
  "untrustedContentHint": false
}
```

Visible effect: operational overlays and KPIs change to recovered values while the UI animates the transition. For the canonical sequence, expected revision 4 returns revision 5 and phase `RECOVERED`.

## 5. `rollback_last_recovery`

Title: `Roll back last recovery`

Description: `Restore the operational state from immediately before the last committed recovery.`

Consequential, reversible mutation from `RECOVERED` to `ROLLED_BACK`.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "reason": {
      "type": "string",
      "description": "Short operator or agent reason retained as untrusted audit content.",
      "minLength": 1,
      "maxLength": 240
    },
    "expectedRevision": {
      "type": "integer",
      "description": "Current RECOVERED-state revision returned by the successful commit or a fresh snapshot.",
      "minimum": 0
    }
  },
  "required": ["reason", "expectedRevision"],
  "additionalProperties": false
}
```

Rollback restores only the `OperationalSnapshot`: network, separated fleet/demand state, simulated time, active incident, and operational metrics. It never restores phase, revision, approval, staged/evaluated governance, audit, or activity state. It clears approval/staged governance and the consumed snapshot, appends rollback events/audit, increments revision once, and enters `ROLLED_BACK`.

Success `data` includes restored metric summary and audit sequence. The submitted reason is validated and safely rendered; it becomes untrusted audit content rather than executable markup.

Annotations:

```json
{
  "readOnlyHint": false,
  "untrustedContentHint": false
}
```

Visible effect: map and KPIs return to pre-commit operational values while the append-only audit remains. For the canonical sequence, expected revision 5 returns revision 6 and phase `ROLLED_BACK`.

## 6. `get_action_audit_log`

Title: `Get action audit log`

Description: `Read bounded action, actor, revision, and outcome records from the append-only audit.`

Read-only. It must not increment revision.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "afterSequence": {
      "type": "integer",
      "description": "Return audit items with sequence numbers greater than this cursor.",
      "minimum": 0
    },
    "limit": {
      "type": "integer",
      "description": "Maximum number of bounded audit items to return.",
      "minimum": 1,
      "maximum": 100
    }
  },
  "required": ["afterSequence", "limit"],
  "additionalProperties": false
}
```

Success `data` includes bounded audit items and `nextSequence`. Audit items use codes and structured fields. A validated operator-supplied rollback reason may be included because it is necessary audit evidence; raw third-party route text is not returned.

Annotations:

```json
{
  "readOnlyHint": true,
  "untrustedContentHint": true
}
```

Visible effect: the audit timeline focuses the returned range; revision does not change.

## Dynamic registration matrix

Exact names are shown below. Registration state is an availability hint, not authorization; every executing use case revalidates current phase and revision.

| Phase | Registered tools |
|---|---|
| `READY` | `get_network_snapshot`, `get_action_audit_log` |
| `INCIDENT_ACTIVE` | `get_network_snapshot`, `evaluate_recovery_options`, `get_action_audit_log` |
| `OPTIONS_EVALUATED` | `get_network_snapshot`, `stage_recovery_plan`, `get_action_audit_log` |
| `PLAN_STAGED` | `get_network_snapshot`, `get_action_audit_log` |
| `APPROVED` | `get_network_snapshot`, `commit_approved_recovery`, `get_action_audit_log` |
| `RECOVERED` | `get_network_snapshot`, `rollback_last_recovery`, `get_action_audit_log` |
| `ROLLED_BACK` | `get_network_snapshot`, `get_action_audit_log` |

There is no `activate_demo_incident`, approval, generic execution, or unrestricted state-update tool.

## Drain-aware lifecycle and cancellation

The bridge coordinator serializes and coalesces phase reconciliation so delayed registration promises always converge on the newest desired phase. The central registry owns one registration `AbortController` and in-flight counter per tool. Its execute wrapper increments before dispatch and decrements in `finally`. When a phase change makes a tool invalid, the registry marks it for removal. If executions are in flight, removal waits; when the count reaches zero, the registry waits through the post-settlement result-delivery grace before aborting the registration signal. It never aborts/removes and immediately re-registers the same name while an invocation is active.

Pending removal is cancelled if the capability becomes valid again before drain. Registry teardown does not release document ownership until in-flight calls and registrations settle, so a remount cannot create duplicate registrations. Contract tests delay and reorder registration promises and require the final registered set to match the latest phase exactly.

Do not assume a later `unregisterTool` method or Chrome-153-or-later behavior. A delayed removal can leave a tool visible briefly, which is why phase, revision, and approval checks remain mandatory inside application use cases.

The `signal` received by `execute(input, { signal })` is separate from the registration controller. Pass it to actual cancellable route fetches and async work. Pure synchronous mutations check a pre-aborted signal before the atomic mutation; do not add fake delays merely to manufacture cancellable work. Cancellation before atomic mutation returns `ABORTED`; cancellation must not produce a partial mutation or false success.

## Domain-authoritative execution

Tool execution has two ordered parts:

1. validate input and obtain the application/domain result;
2. render best-effort ephemeral activity, panel focus, announcements, or animation.

Once the domain mutation commits, that success result must be returned even if an ephemeral effect fails. The adapter records rendering failure separately and never emits `INTERNAL_ERROR` for an already committed mutation. A thrown `AbortError` before commit maps to `ABORTED`; unexpected application failures map to `INTERNAL_ERROR` without stack details.

## Browser and content security

- WebMCP requires a secure origin-isolated/origin-keyed document and permission from the `tools` Permissions Policy.
- Do not enable `document.domain`.
- Top-level same-origin registration is sufficient; no cross-origin iframe exposure is required.
- Handle missing API, `SecurityError`, and `NotAllowedError` without breaking the manual app.
- Set `untrustedContentHint: true` only when the actual tool output includes untrusted external or user-supplied content.
- Normalize Google context to bounded structured values. Do not return raw third-party free-form text unless required by the product contract.
- Never expose API keys, approval secrets, stack traces, or generic mutation facilities.
