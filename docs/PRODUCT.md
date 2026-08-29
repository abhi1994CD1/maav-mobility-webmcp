# Product Brief

## Working product category

Agent-native mobility disruption recovery command center.

## User

A transport control-room operator responsible for a bus, shuttle, campus, airport, event, tram, or autonomous-fleet network.

## Problem

When a route, station, or vehicle fails, operators must rapidly combine fragmented information, compare interventions, protect accessibility, control passenger waiting, and issue a safe recovery plan. Conventional dashboards display data but still leave the operator to manually reason across many controls under time pressure.

## Product promise

After the operator activates a canonical simulated incident, a browser agent uses structured WebMCP tools to inspect the shared digital twin, evaluate measurable recovery options, and stage the best option. The visible UI requires the operator to approve that exact staged plan. Only then can the agent commit it. The application shows the recovery, records an audit trail, and can roll back the last committed recovery.

## End product

A hosted full-screen web application with:

- a Google Map centered on a Johannesburg-inspired corridor;
- an animated synthetic fleet and passenger-demand digital twin;
- a human-controlled canonical disruption and deterministic reset;
- three measurable recovery plans;
- browser-agent operation through WebMCP after the incident exists;
- visible tool activity;
- explicit human approval before a consequential action;
- post-commit recovery animation and metrics;
- an append-only audit log and one-step rollback;
- a clearly labelled authored fallback when Google Routes is unavailable.

Live Google route and traffic context is visual and geographic enrichment. It does not change the canonical scenario's hard-constraint outcome or winning plan, so the golden recovery remains deterministic.

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
- Every tool call has a visible response; mutation tools produce a meaningful revisioned state change while read tools may change only ephemeral presentation state.
- The human remains in control of consequential action.
- The complete golden flow succeeds repeatedly without manual repair or Google Routes availability.
- The project never misrepresents synthetic data as live operational data.

## Delivery priority

- P0: deterministic recovery engine, premium map shell, six WebMCP tools end to end, human approval, commit/audit/rollback, deployed URL, and reproducible golden demo.
- P1: Google Routes enrichment, WebMCP evaluation coverage, accessibility polish, submission screenshots, and diagnostics.
- P2 only after P0 and P1 are green: a secondary incident, optional Places search, and additional visualization polish.

## Non-goals

This submission is not a production transport-control system, a real-time Johannesburg data feed, a passenger route planner, a generic chatbot, or a full MAAV simulator.
