# Product Brief

## Working product category
Agent-native mobility disruption recovery command center.

## User
A transport control-room operator responsible for a bus, shuttle, campus, airport, event, tram, or autonomous-fleet network.

## Problem
When a route, station, or vehicle fails, operators must rapidly combine fragmented information, compare interventions, protect accessibility, control passenger waiting, and issue a safe recovery plan. Conventional dashboards display data but still leave the operator to manually reason across many controls under time pressure.

## Product promise
The operator states the recovery objective in natural language. A browser agent uses structured WebMCP tools to inspect the shared digital twin, evaluate measurable recovery options, stage the best option, and ask the operator for approval. After approval, it commits the action, animates the recovery, records an audit trail, and can roll back the last plan.

## End product
A hosted full-screen web application with:
- a Google Map centered on a Johannesburg-inspired corridor;
- an animated synthetic fleet and passenger-demand digital twin;
- a canonical disruption scenario;
- three measurable recovery plans;
- browser-agent operation through WebMCP;
- visible tool activity;
- explicit human approval before a consequential action;
- post-action recovery animation and metrics;
- an audit log and one-click rollback;
- deterministic reset for judging.

## Canonical demo story
1. Healthy morning-peak network.
2. Rosebank-Sandton corridor disruption activates.
3. Reliability falls and queues grow.
4. Operator asks the agent to restore at least 95% on-time arrivals, keep maximum wait under five minutes, preserve accessibility, and keep extra energy below 8%.
5. Agent inspects the network.
6. Agent evaluates three options.
7. Agent stages the only option satisfying all hard constraints.
8. Operator reviews visible impact and clicks Approve.
9. Commit tool becomes available; agent commits.
10. Fleet routes change, queues reduce, and KPIs recover.
11. Audit log explains every action.
12. Operator can roll back.

## Success criteria
- A judge understands the problem in 15 seconds.
- A judge sees genuine WebMCP tool use within 45 seconds.
- Every tool call causes a visible, meaningful application-state change.
- The human remains in control of consequential action.
- The complete golden flow succeeds repeatedly without manual repair.
- The project never misrepresents synthetic data as live operational data.

## Non-goals
This submission is not a production transport-control system, a real-time Johannesburg data feed, a passenger route planner, a generic chatbot, or a full MAAV simulator.
