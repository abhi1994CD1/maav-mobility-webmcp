# WebMCP Challenge Upgrade Plan

## Objective

Turn the current finalist-quality prototype into a judge-ready release whose public evidence makes a strong case across all four official criteria: WebMCP Leverage, Execution, Potential Impact, and Creativity & Ambition.

No plan can make winning or a 5/5 score certain. The controllable goal is to make the implementation and evidence deserve a top score while preserving an honest account of what remains simulated and unvalidated.

## Deadline truth

- Official deadline: September 3, 2026 at 1:00 PM Pacific Time, as listed on the [official Devpost page](https://webmcp.devpost.com/).
- South Africa time: September 3 at 10:00 PM SAST.
- Internal code freeze: September 2 at noon SAST.
- Internal submission target: September 3 at 4:00 PM SAST, leaving six hours of contingency.
- September 6 is after the official deadline and is not a usable delivery target.

After the official deadline, do not modify the submitted Devpost entry, public repository, demo video, or live application during judging.

## Winning thesis

> Existing transport systems show operators what is happening. This product lets a browser agent help recover service without allowing it to approve its own plan, act on stale state, bypass hard constraints, erase history, or prevent rollback.

The reusable innovation is **human-authorized capability choreography**:

- WebMCP exposes only the capability legal in the current domain phase;
- evaluation is calculated by a deterministic decision core, not by an LLM;
- the human-only approval mutation creates a short-lived exact-revision commit capability;
- runtime preconditions defend against stale discovery, replay, mismatch, and lifecycle delay;
- audit and operational-only rollback make consequential agent action reviewable and reversible.

Do not position the project as another fleet dashboard, autonomous dispatcher, production digital twin, or generic chatbot.

## Current baseline

### Strong today

- six real Chrome 150 WebMCP tool definitions;
- dynamic phase-based registration;
- explicit human-only approval;
- one-mutation/one-revision semantics;
- stale-state and approval replay protection;
- operational-only rollback with append-only audit;
- premium map-first command-center UI;
- deterministic Google-independent fallback;
- local lint, typecheck, 25 tests, production build, and `git diff --check` pass.

### Blocking today

- public CI is red because the pushed `layout.tsx` uses unavailable `LayoutProps`;
- the local fix is not published and local/remote `main` have diverged;
- no discoverable public deployment or repository homepage URL exists;
- no public video, screenshots, or release evidence report exists;
- candidate final metrics and committed projections are authored constants;
- Playwright demonstrates manual fallback controls, not the real WebMCP bridge;
- rapid asynchronous registry reconciliation is not proven to converge on the newest phase;
- no genuine operator research or measured product hypothesis is documented;
- repository presentation contains substantial judge-irrelevant guidance material.

## Score-to-evidence map

| Criterion | Top-score evidence target | Failure mode to remove |
|---|---|---|
| WebMCP Leverage | Native tool run, exact state matrix, human-created commit capability, stale/replay defenses, public adversarial evals | “The buttons work, but WebMCP is decorative” |
| Execution | Green public CI, reliable HTTPS deployment, repeatable golden/fallback flows, polished video and test instructions | “Strong local prototype that judges cannot reliably run” |
| Potential Impact | Specific operator workflow, incumbent-system integration seam, genuine operator feedback, measurable validation hypotheses | “Humanity-scale claims without users or evidence” |
| Creativity & Ambition | Derived counterfactual recovery intelligence plus reusable governance pattern | “Scripted plan picker inside a familiar mobility dashboard” |

## Impact evidence protocol

Potential impact must be demonstrated with bounded evidence, not humanity-scale
claims. Use the canonical scenario as a repeatable research task and record:

- time from incident presentation to a compliant staged plan;
- unsafe or non-compliant plan selections before correction;
- whether the participant understands who can approve and commit;
- whether the participant can identify the responsible actor and revision from the audit;
- whether rollback can be completed without losing prior history;
- the operator's current workflow, integration expectations, and trust concern.

Seek two or more relevant operator conversations and, if practical, five
moderated scenario runs. Small-sample findings are directional usability
evidence, not proof of real-world time savings or safety improvement. Publish
the task, participant roles, observed results, limitations, and any design
change the evidence caused. Do not publish names or quotes without permission.

## Non-negotiable cut lines

Do not add before submission:

- another public WebMCP tool;
- an embedded LLM or AI API backend;
- a second incident;
- a real fleet connector or fake partner integration;
- authentication, database, message broker, microservice, or GraphQL;
- a second map library or complex live-Google scoring dependency;
- a broad visual redesign after August 31.

If Google enrichment threatens reliability, submit the labelled authored fallback. If operator interviews do not happen, state that honestly. If the counterfactual engine is not fully green at its cut gate, keep the last stable release rather than submitting a half-migrated model.

## Sequenced delivery contract

- [x] **1. Freeze the winning architecture — August 29**
  Contract: `PRODUCT.md`, `ARCHITECTURE.md`, `RECOVERY_ENGINE.md`, `WEBMCP_TOOLS.md`, and `DEMO.md` define the target without changing the six tools or seven phases.
  Acceptance: no authored final candidate KPIs are permitted; public claims and deadline are explicit.
  Verify: documentation consistency scan and `git diff --check`.

- [ ] **2. Reconcile the public branch and turn CI green — August 29**
  Contract: preserve both histories, publish the local layout type fix, and avoid force-push/reset.
  Acceptance: `main` is synchronized with `origin/main`; public quality and E2E jobs are green at one SHA.
  Verify: local hard gates, GitHub Actions result, clean reviewed status.
  Gate: absolute blocker for every submission artifact.

- [ ] **3. Deploy the stable baseline immediately — August 29–30**
  Contract: public HTTPS, origin isolation, `tools` Permissions Policy, no keys in bundles, authored fallback usable.
  Acceptance: incognito load succeeds; Reset and the golden manual fallback run twice; repository homepage links the deployment.
  Verify: response headers, production smoke, secret scan, Chrome 150 availability check.
  Reason: deployment risk must surface before the engine migration, not afterward.

- [ ] **4. Replace result templates with action-only model inputs — August 30**
  Spec: `RECOVERY_ENGINE.md > Domain inputs`.
  Acceptance: candidate catalog contains actions/resources but no final metrics; demand forecasts and explicit vehicle resources are immutable typed scenario data.
  Verify: structural tests reject candidate `metrics`; strict typecheck and deterministic fixture tests.

- [ ] **5. Implement the counterfactual compiler, simulation, metrics, safety kernel, and ranking — August 30**
  Spec: `RECOVERY_ENGINE.md > Feasibility compiler` through `Safety kernel and ranking`.
  Acceptance: all KPIs are calculated; conservation and monotonicity hold; only coordinated recovery satisfies the canonical objectives; alternate objectives change eligibility predictably.
  Verify: pure unit/property-style tests with no new runtime dependency.
  Cut gate: if not fully green by August 31 morning, restore the stable release and document the limitation.

- [ ] **6. Integrate exact evaluated projections with staging, commit, and rollback — August 30–31**
  Spec: `RECOVERY_ENGINE.md > Evaluation, staging, and commit`.
  Acceptance: evaluation uses current operational state; explicit DTO mapper prevents internal leakage; committed operations equal the exact staged projection; A/B/C apply distinct projections when compliant; revision and approval traces remain unchanged.
  Verify: application tests for success, stale input, abort, approval mismatch/consumption, and rollback restoration.

- [ ] **7. Harden and prove WebMCP capability choreography — August 30–31**
  Spec: `ARCHITECTURE.md > Human-authorized WebMCP capability choreography`.
  Acceptance: serialized/coalesced reconciliation converges on the newest phase; teardown drains; domain results survive UI-effect failures; invalid IDs are not reflected; snapshot provides safe recovery context; schema descriptions guide correct parameters.
  Verify: adversarial contract tests for rapid phase changes, delayed registration, stale retained callbacks, simultaneous/replayed commit, wrong plan, malicious text, pre-abort, JSON serialization, and manual-UI fallback.

- [ ] **8. Add browser-adapter E2E and native Chrome evidence — August 31**
  Contract: Playwright injects a host shim before the app loads, captures registrations from the real bridge, and executes the registered callbacks. This is labelled adapter integration evidence, not native-Chrome proof.
  Acceptance: snapshot/evaluate/stage/commit/audit/rollback execute through the bridge; commit is absent before approval; human approval occurs through UI; exact revision and actor sequence pass.
  Verify: Linux E2E plus a dated manual Chrome 150 evidence report for the deployed release.

- [ ] **9. Make the decision and trust model judge-visible — August 31**
  Contract: improve clarity inside existing surfaces; no redesign or new domain state.
  Acceptance: plan comparison shows `PROJECTED`, engine version, metric deltas, hard failures, score components, and bounded reasons; an ephemeral trust strip shows current revision, native WebMCP status, active capabilities, and human approval state.
  Verify: keyboard/focus pass and screenshots at 1366×768 and 1440×900.

- [ ] **10. Gather honest impact evidence in parallel — August 29–31**
  Contract: contact up to five transport operations, fleet, or mobility professionals; seek at least two short conversations.
  Acceptance: record role, current disruption workflow, trust/approval concern, expected integration boundary, and one product change influenced by feedback.
  Verify: dated private notes and an anonymized accurate summary only with permission. Never invent quotes, pilots, or partnerships.

- [ ] **11. Produce the release candidate and evidence pack — September 1**
  Acceptance: one release SHA passes lint, typecheck, unit/contract tests, production build, Linux E2E, native Chrome smoke, Google-offline smoke, secrets scan, accessibility checks, and `git diff --check`.
  Evidence: README live URL, architecture image, five screenshots, CI link, WebMCP report, testing-client disclosure, AI/Codex disclosure, limitations, and operator research if obtained.
  Gate: feature freeze begins when this passes.

- [ ] **12. Record, review, freeze, and submit — September 2–3**
  Demo: follow `DEMO.md > Judge-first demonstration contract`.
  Acceptance: public YouTube video is under three minutes with audio; live URL and repo work in incognito; submission is not a draft; release URLs all identify the frozen version.
  Verify: final Devpost checklist and live project read-back before September 3 at 4:00 PM SAST.

## Public WebMCP safety case

| Claim | Enforcement | Required proof |
|---|---|---|
| Agent cannot approve | No approval tool; human UI use case only | Exact tool matrix and video |
| Agent cannot commit early | Commit absent plus application phase checks | `PLAN_STAGED` registration capture |
| Agent cannot act on stale state | `expectedRevision` on every mutation | Stale-command test and envelope |
| Agent cannot replay approval | Exact revision binding plus `consumed` | Duplicate/simultaneous commit tests |
| Agent cannot stage an unsafe plan | Domain hard constraints before scoring | Accessibility adversarial test |
| Agent cannot erase history | Operational-only rollback | Before/after audit proof |
| Lifecycle cannot break an invocation | In-flight drain, result-delivery grace, serialized reconciliation | Delayed/reordered registration tests |
| Rendering cannot rewrite domain truth | Domain-authoritative result boundary | Forced UI-effect failure test |
| Untrusted text cannot become instructions | Normalized trusted outputs; selective untrusted hint | Malicious ID/reason tests |

## Submission artifact checklist

- public HTTPS application;
- public repository with visible MIT license, description, and homepage;
- green CI release SHA;
- public YouTube video under three minutes with audio;
- hero, evaluation, approval, recovered, and rollback/audit screenshots;
- architecture diagram and calculation model summary;
- dated WebMCP evidence report;
- exact browser/agent testing disclosure;
- AI and Codex usage disclosure;
- honest simulated-data and integration limitations;
- operator research summary only if genuinely completed;
- Devpost description explaining what humans and agents can now do together.

## Final decision rule

Protect the differentiator, not the feature count. A smaller release with calculated outcomes, undeniable native WebMCP proof, green public execution, and honest impact evidence is stronger than a larger release with more screens, tools, or unsupported claims.
