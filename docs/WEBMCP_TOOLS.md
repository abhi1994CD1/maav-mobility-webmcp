# WebMCP Tool Contracts

## Tool strategy
Expose only tools that represent clear user-visible capabilities. Each tool calls one application use case.

## 1. `get_network_snapshot`
Read-only.

Purpose: inspect the current operational state, incident, constraints, key KPIs, and legal next actions.

Input:
```json
{
  "focus": "network | incident | fleet | demand | accessibility | all"
}
```

Output:
```json
{
  "scenarioId": "jhb-morning-peak-v1",
  "revision": 3,
  "phase": "INCIDENT_ACTIVE",
  "summary": {},
  "constraints": {},
  "legalNextActions": ["evaluate_recovery_options"]
}
```

Annotations: `readOnlyHint: true`.

Visible effect: map camera and side panel focus on the requested area.

## 2. `activate_demo_incident`
Demo-state mutation.

Purpose: activate one authored disruption scenario.

Input:
```json
{
  "incidentId": "rosebank_sandton_blockage",
  "expectedRevision": 0
}
```

Visible effect: incident overlay, route violation, queue growth, KPI degradation.

## 3. `evaluate_recovery_options`
Analytical mutation of the shared workspace, not an operational commit.

Purpose: simulate and compare recovery options against explicit objectives.

Input:
```json
{
  "expectedRevision": 1,
  "objectives": {
    "minimumOnTimePercent": 95,
    "maximumWaitMinutes": 5,
    "preserveAccessibility": true,
    "maximumEnergyIncreasePercent": 8
  }
}
```

Output includes each plan's metrics, hard-constraint status, explanation codes, and recommended plan ID.

Visible effect: plan comparison drawer appears and alternatives render on the map.

## 4. `stage_recovery_plan`
Reversible workspace mutation.

Purpose: stage one evaluated plan for human review without changing operational state.

Input:
```json
{
  "planId": "combined_recovery_c",
  "expectedRevision": 2
}
```

Visible effect: translucent route/fleet preview and approval drawer.

## 5. `commit_approved_recovery`
Consequential mutation. Dynamically registered only in `APPROVED` state.

Purpose: apply the exact plan that the human approved.

Input:
```json
{
  "planId": "combined_recovery_c",
  "expectedRevision": 4
}
```

Preconditions:
- approval exists;
- approval plan matches input plan;
- approval revision matches current state;
- approval is unused and unexpired;
- phase is `APPROVED`.

Visible effect: recovery animation, KPI changes, audit events, recovery state.

## 6. `rollback_last_recovery`
Consequential but reversible mutation. Registered only after a committed plan.

Purpose: restore the pre-commit operational snapshot.

Input:
```json
{
  "reason": "Operator requested rollback after review",
  "expectedRevision": 6
}
```

Visible effect: map and KPIs return to the previous snapshot; audit remains append-only.

## 7. `get_action_audit_log`
Read-only.

Purpose: inspect who/what performed each action, at which revision, with what result.

Input:
```json
{
  "afterSequence": 0,
  "limit": 25
}
```

Annotations: `readOnlyHint: true`.

## Structured tool error
All tools return this shape on failure:

```json
{
  "ok": false,
  "error": {
    "code": "STALE_REVISION",
    "message": "The network changed after the agent inspected it.",
    "recoverable": true,
    "suggestedAction": "Call get_network_snapshot and retry with the current revision."
  }
}
```

## Dynamic registration matrix

| Phase | Registered tools |
|---|---|
| READY | get snapshot, activate incident, audit |
| INCIDENT_ACTIVE | get snapshot, evaluate options, audit |
| OPTIONS_EVALUATED | get snapshot, evaluate options, stage plan, audit |
| PLAN_STAGED / AWAITING APPROVAL | get snapshot, evaluate options, stage plan, audit |
| APPROVED | get snapshot, commit approved recovery, audit |
| RECOVERED | get snapshot, rollback, audit |
| ROLLED_BACK | get snapshot, evaluate options, audit |
