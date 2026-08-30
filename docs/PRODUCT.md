# Product Brief

## Working product category

Human-governed, agent-native mobility disruption recovery layer and command center.

## User

A transport control-room operator responsible for a bus, shuttle, campus, airport, event, tram, or autonomous-fleet network.

## Problem

When a route, station, or vehicle fails, operators must rapidly combine fragmented information, compare interventions, protect accessibility, control passenger waiting, and issue a safe recovery plan. Conventional fleet and simulation products are valuable systems of record, but they are primarily human-operated dashboards. They do not automatically provide a browser agent with narrow capabilities, current-state protection, explicit human authority, and a reversible audit trail.

## Product promise

After the operator activates a canonical simulated incident, a browser agent uses structured WebMCP tools to inspect the shared digital twin, evaluate calculated recovery options, and stage the best option. The visible UI requires the operator to approve that exact staged plan and revision. Only then does the commit capability become available. The application applies the calculated projection, shows measurable recovery, records an audit trail, and can roll back the last committed operational change.

## Product position

The product does not replace an incumbent fleet-management, dispatch, or simulation platform. It demonstrates a governed decision-and-action layer that can sit beside one:

```text
existing operations platform -> operational snapshot -> recovery decision core
                                                      -> human approval
                                                      -> governed commit / rollback
```

The hackathon build uses an authored deterministic adapter, not a real fleet integration. A production adapter is a future boundary, not a submission claim. Operators use the command center; compatible browser agents use its WebMCP tools.

The differentiating promise is not autonomous dispatch. It is safe human-agent collaboration for a consequential workflow:

- the agent receives only the capability valid for the current phase;
- the model calculates plan outcomes and rejects hard-constraint violations;
- the agent cannot approve its own recommendation;
- approval is exact-plan, exact-revision, and one-time;
- every mutation is attributable and reversible without erasing history.

## End product

A hosted full-screen web application with:

- a Google Map centered on a Johannesburg-inspired corridor;
- an animated synthetic fleet and passenger-demand digital twin;
- a human-controlled canonical disruption and deterministic reset;
- three measurable recovery plans;
- a transparent deterministic counterfactual engine that derives every plan KPI from the incident snapshot and authored action primitives;
- browser-agent operation through WebMCP after the incident exists;
- visible tool activity;
- explicit human approval before a consequential action;
- post-commit recovery animation and metrics;
- an append-only audit log and one-step rollback;
- a clearly labelled authored fallback when Google Routes is unavailable.

Live Google route and traffic context is visual and geographic enrichment. It does not change the canonical scenario's hard-constraint outcome or winning plan, so the golden recovery remains deterministic.

## Impact contract

The demonstrated impact is decision quality and governance in a simulated disruption. The submission may claim that the prototype:

- makes fragmented recovery trade-offs inspectable in one workflow;
- protects an explicit accessibility obligation as a hard constraint;
- prevents early, stale, mismatched, and replayed agent commits;
- makes human and agent ownership visible in an append-only audit;
- demonstrates a reusable pattern for high-consequence browser-agent actions.

It must not claim reduced real-world disruption time, safety certification, production dispatch readiness, customer adoption, or integration with a named transport platform unless independently implemented and evidenced. Operator conversations may be reported only as attributed research evidence, never as a deployment or partnership.

## Canonical demo story

1. The operator resets the app to the healthy morning-peak scenario.
2. The operator activates the Rosebank-Sandton corridor disruption in the visible UI.
3. Reliability falls and queues grow.
4. The operator asks the agent to restore at least 95% on-time arrivals, keep maximum wait under five minutes, preserve accessibility, and keep extra energy below 8%.
5. The agent inspects the network.
6. The agent evaluates three options.
7. The agent stages the only option satisfying all hard constraints.
8. The operator reviews visible impact and clicks Approve.
9. The commit tool becomes available; the agent commits the approved plan.
10. Fleet routes change, queues reduce, and KPIs recover.
11. The audit log explains the actions and revision sequence.
12. The operator or agent can roll back the committed recovery without erasing audit history.

## Success criteria

- A judge understands the problem in 15 seconds.
- A judge sees genuine WebMCP tool use within 45 seconds.
- A judge can trace every recommended KPI to a versioned deterministic model, current operational snapshot, and authored recovery actions rather than a pre-written result table.
- Every tool call has a visible response; mutation tools produce a meaningful revisioned state change while read tools may change only ephemeral presentation state.
- The human remains in control of consequential action.
- The complete golden flow succeeds repeatedly without manual repair or Google Routes availability.
- The public repository, deployed URL, Chrome 150 evidence, and CI all demonstrate the same release revision.
- The project never misrepresents synthetic data as live operational data.

## Delivery priority

- P0: calculated counterfactual recovery engine, six WebMCP tools end to end, human approval, commit/audit/rollback, green public CI, deployed URL, real-browser evidence, and reproducible golden demo.
- P1: agent recovery context, adversarial WebMCP evaluation coverage, accessibility polish, operator research, submission screenshots, and diagnostics.
- P2 only after P0 and P1 are green: a secondary incident, optional Places search, and additional visualization polish.

## Non-goals

This submission is not a production transport-control system, a real-time Johannesburg data feed, a passenger route planner, a generic chatbot, or a full MAAV simulator.
