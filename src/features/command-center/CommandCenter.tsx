"use client";

import { useEffect, useMemo, useState } from "react";
import { CANONICAL_OBJECTIVES } from "@/application/command-center-service";
import type {
  AuditEvent,
  CommandResult,
  OperationalMetrics,
  OperationalPhase,
  RecoveryPlan,
} from "@/domain/types";
import { loadRouteContext } from "@/infrastructure/google/route-context";
import type { AgentActivityItem } from "@/infrastructure/persistence/zustand-repository";
import { WebMcpBridge } from "@/infrastructure/webmcp/WebMcpBridge";
import { useCommandCenterStore } from "@/state/hooks";
import {
  announce,
  commandCenterService,
  openPanel,
  resetEphemeralUi,
  setRouteContext,
  triggerRecoveryAnimation,
} from "@/state/runtime";
import { MapCanvas } from "./MapCanvas";

const GOLDEN_PROMPT =
  "An obstruction has blocked the Rosebank–Sandton corridor. Restore at least 95% on-time arrivals, keep maximum passenger waiting below five minutes, preserve wheelchair-accessible service, and keep additional energy below 8%. Compare the options and stage the best plan for my approval.";

const PHASE_STEPS: Array<{ phase: OperationalPhase; label: string }> = [
  { phase: "READY", label: "Ready" },
  { phase: "INCIDENT_ACTIVE", label: "Incident" },
  { phase: "OPTIONS_EVALUATED", label: "Evaluate" },
  { phase: "PLAN_STAGED", label: "Stage" },
  { phase: "APPROVED", label: "Approve" },
  { phase: "RECOVERED", label: "Recover" },
  { phase: "ROLLED_BACK", label: "Rollback" },
];

export function CommandCenter() {
  const domain = useCommandCenterStore((state) => state.domain);
  const ui = useCommandCenterStore((state) => state.ui);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadRouteContext(controller.signal).then(setRouteContext);
    return () => controller.abort();
  }, []);

  const stagedPlan = useMemo(
    () =>
      domain.evaluatedPlans.find((plan) => plan.id === domain.stagedPlanId),
    [domain.evaluatedPlans, domain.stagedPlanId],
  );

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(GOLDEN_PROMPT);
      setPromptCopied(true);
      announce("Golden prompt copied.", "SUCCESS");
      window.setTimeout(() => setPromptCopied(false), 1800);
    } catch {
      announce("Copy unavailable. Select the prompt text manually.", "ERROR");
    }
  };

  const applyResult = <T,>(
    result: CommandResult<T>,
    successMessage: string,
    panel?: "incident" | "plans" | "approval" | "audit",
  ) => {
    if (result.ok) {
      announce(successMessage, "SUCCESS");
      if (panel) openPanel(panel);
    } else {
      announce(`${result.error.code}: ${result.error.message}`, "ERROR");
    }
  };

  const reset = () => {
    const result = commandCenterService.resetScenario(domain.revision);
    if (result.ok) resetEphemeralUi();
    else applyResult(result, "");
  };

  const activateIncident = () => {
    applyResult(
      commandCenterService.activateIncident(domain.revision),
      "Canonical incident activated. Browser agent recovery tools are now live.",
      "incident",
    );
  };

  const evaluateManually = () => {
    applyResult(
      commandCenterService.evaluateRecoveryOptions(
        domain.revision,
        CANONICAL_OBJECTIVES,
        "HUMAN",
      ),
      "Three deterministic recovery plans evaluated.",
      "plans",
    );
  };

  const stageManually = (planId: string) => {
    applyResult(
      commandCenterService.stageRecoveryPlan(
        planId,
        domain.revision,
        "HUMAN",
      ),
      "Plan staged for explicit operator approval.",
      "approval",
    );
  };

  const approve = () => {
    applyResult(
      commandCenterService.approveStagedPlan(domain.revision),
      "Approval recorded. The commit tool is now authorized for this revision.",
      "approval",
    );
  };

  const commitManually = () => {
    if (!domain.stagedPlanId) return;
    const result = commandCenterService.commitApprovedRecovery(
      domain.stagedPlanId,
      domain.revision,
      "HUMAN",
    );
    if (result.ok) triggerRecoveryAnimation();
    applyResult(result, "Approved recovery committed.", "audit");
  };

  const rollbackManually = () => {
    const result = commandCenterService.rollbackLastRecovery(
      "Operator requested rollback after recovery review",
      domain.revision,
      "HUMAN",
    );
    if (result.ok) triggerRecoveryAnimation();
    applyResult(
      result,
      "Operational state restored; audit history preserved.",
      "audit",
    );
  };

  return (
    <main className={`command-center phase-${domain.phase.toLowerCase()}`}>
      <WebMcpBridge />
      <header className="command-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <p className="eyebrow">NEXUS / RECOVERY CONTROL</p>
            <h1>Mobility Command</h1>
          </div>
        </div>
        <div className="truth-banner">
          <span className="truth-pulse" />
          SIMULATED OPERATIONS <b>•</b> GOOGLE MAPS CONTEXT
        </div>
        <div className="header-actions">
          <div
            className={`webmcp-chip status-${ui.webMcpStatus.toLowerCase()}`}
          >
            <span />
            <div>
              <small>Chrome WebMCP</small>
              <strong>{ui.webMcpMessage}</strong>
            </div>
          </div>
          <div
            className="revision-chip"
            aria-label={`State revision ${domain.revision}`}
          >
            <small>REVISION</small>
            <strong>{String(domain.revision).padStart(2, "0")}</strong>
          </div>
          <button
            className="ghost-button"
            onClick={reset}
            aria-label="Reset scenario"
          >
            <ResetIcon />
            Reset
          </button>
        </div>
      </header>

      <section className="kpi-band" aria-label="Operational KPIs">
        <Kpi
          label="On-time arrivals"
          value={`${domain.operational.metrics.onTimePercent.toFixed(1)}%`}
          target="Target ≥95%"
          state={metricState(
            domain.operational.metrics.onTimePercent >= 95,
            domain.phase,
          )}
          spark={[96, 97, 98, 96, domain.operational.metrics.onTimePercent]}
        />
        <Kpi
          label="Maximum wait"
          value={`${domain.operational.metrics.maximumWaitMinutes.toFixed(1)} min`}
          target="Limit ≤5.0 min"
          state={metricState(
            domain.operational.metrics.maximumWaitMinutes <= 5,
            domain.phase,
          )}
          spark={[
            3.1,
            3.4,
            3.0,
            3.2,
            domain.operational.metrics.maximumWaitMinutes,
          ]}
        />
        <Kpi
          label="Passengers affected"
          value={domain.operational.metrics.affectedPassengers.toLocaleString()}
          target={`${domain.operational.metrics.unservedPassengers} unserved`}
          state={
            domain.phase === "INCIDENT_ACTIVE" ? "danger" : "neutral"
          }
          spark={[
            0,
            0,
            0,
            0,
            domain.operational.metrics.affectedPassengers / 5,
          ]}
        />
        <Kpi
          label="Accessibility"
          value={
            domain.operational.metrics.accessibilityViolations === 0
              ? "Protected"
              : `${domain.operational.metrics.accessibilityViolations} violation`
          }
          target="Hard constraint"
          state={metricState(
            domain.operational.metrics.accessibilityViolations === 0,
            domain.phase,
          )}
          spark={[
            0,
            0,
            0,
            0,
            domain.operational.metrics.accessibilityViolations * 40,
          ]}
        />
        <Kpi
          label="Energy delta"
          value={`${domain.operational.metrics.energyDeltaPercent.toFixed(1)}%`}
          target="Limit ≤8.0%"
          state={metricState(
            domain.operational.metrics.energyDeltaPercent <= 8,
            domain.phase,
          )}
          spark={[
            0,
            0,
            0,
            0,
            domain.operational.metrics.energyDeltaPercent * 7,
          ]}
        />
      </section>

      <section className="workspace">
        <div className="map-workspace">
          <MapCanvas
            operational={domain.operational}
            animationNonce={ui.animationNonce}
            routeContextSource={ui.routeContext.source}
          />
          <div className="map-topline">
            <div>
              <small>NETWORK / JHB NORTH SPINE</small>
              <strong>{domain.operational.network.corridors[0]?.name}</strong>
            </div>
            <div
              className={`phase-badge badge-${domain.phase.toLowerCase()}`}
            >
              {formatPhase(domain.phase)}
            </div>
          </div>
          <div className="map-legend" aria-label="Map legend">
            <span>
              <i className="legend-line active" /> Active corridor
            </span>
            <span>
              <i className="legend-vehicle" /> Synthetic fleet
            </span>
            <span>
              <i className="legend-demand" /> Passenger demand
            </span>
          </div>
          {ui.notice ? (
            <div
              className={`notice notice-${ui.notice.tone.toLowerCase()}`}
              role="status"
            >
              <span />
              {ui.notice.message}
            </div>
          ) : null}
          {domain.evaluatedPlans.length > 0 &&
          (ui.openPanel === "plans" || ui.openPanel === "approval") ? (
            <PlanDock
              plans={domain.evaluatedPlans}
              stagedPlan={stagedPlan}
              phase={domain.phase}
              onStage={stageManually}
              onApprove={approve}
              onCommit={commitManually}
              webMcpAvailable={ui.webMcpStatus === "AVAILABLE"}
            />
          ) : null}
        </div>

        <aside
          className="operations-rail"
          aria-label="Incident and agent activity"
        >
          <IncidentPanel
            phase={domain.phase}
            metrics={domain.operational.metrics}
            incidentTitle={domain.operational.activeIncident?.title}
            simulatedTime={domain.operational.simulatedTime}
            onActivate={activateIncident}
            onEvaluate={evaluateManually}
            onRollback={rollbackManually}
            webMcpAvailable={ui.webMcpStatus === "AVAILABLE"}
          />
          <AgentRail
            activities={ui.agentActivity}
            webMcpStatus={ui.webMcpStatus}
          />
        </aside>
      </section>

      <footer className="timeline-footer">
        <div
          className="protocol-progress"
          aria-label="Recovery workflow progress"
        >
          {PHASE_STEPS.map((step, index) => {
            const currentIndex = PHASE_STEPS.findIndex(
              (item) => item.phase === domain.phase,
            );
            const state =
              index < currentIndex
                ? "complete"
                : index === currentIndex
                  ? "current"
                  : "future";
            return (
              <div className={`protocol-step ${state}`} key={step.phase}>
                <span>{index + 1}</span>
                <small>{step.label}</small>
              </div>
            );
          })}
        </div>
        <AuditTimeline audit={domain.audit} onOpen={() => openPanel("audit")} />
        <div className="prompt-console">
          <div>
            <small>GOLDEN AGENT PROMPT</small>
            <p>{GOLDEN_PROMPT}</p>
          </div>
          <button onClick={copyPrompt} aria-label="Copy golden demo prompt">
            <CopyIcon />
            {promptCopied ? "Copied" : "Copy"}
          </button>
        </div>
      </footer>
      {ui.openPanel === "audit" ? (
        <AuditDrawer
          audit={domain.audit}
          onClose={() => openPanel("incident")}
        />
      ) : null}
    </main>
  );
}

function Kpi({
  label,
  value,
  target,
  state,
  spark,
}: {
  label: string;
  value: string;
  target: string;
  state: "neutral" | "danger" | "success";
  spark: number[];
}) {
  const max = Math.max(...spark, 1);
  const points = spark
    .map((point, index) => `${index * 22},${28 - (point / max) * 24}`)
    .join(" ");
  const lastValue = spark.at(-1) ?? 0;
  return (
    <div className={`kpi kpi-${state}`}>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <span>{target}</span>
      </div>
      <svg viewBox="0 0 88 32" aria-hidden="true">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="88"
          cy={28 - (lastValue / max) * 24}
          r="3"
          fill="currentColor"
        />
      </svg>
    </div>
  );
}

function IncidentPanel({
  phase,
  metrics,
  incidentTitle,
  simulatedTime,
  onActivate,
  onEvaluate,
  onRollback,
  webMcpAvailable,
}: {
  phase: OperationalPhase;
  metrics: OperationalMetrics;
  incidentTitle?: string;
  simulatedTime: string;
  onActivate: () => void;
  onEvaluate: () => void;
  onRollback: () => void;
  webMcpAvailable: boolean;
}) {
  const incidentOngoing =
    phase !== "READY" && phase !== "RECOVERED" && phase !== "ROLLED_BACK";
  const severity =
    incidentOngoing
      ? "high"
      : phase === "RECOVERED"
        ? "clear"
        : "idle";
  return (
    <section className="rail-section incident-section">
      <div className="section-heading">
        <div>
          <small>OPERATIONAL EVENT</small>
          <h2>{incidentTitle ?? "Network nominal"}</h2>
        </div>
        <span className={`severity severity-${severity}`}>
          {phase === "INCIDENT_ACTIVE"
            ? "HIGH"
            : incidentOngoing
              ? "ACTIVE"
            : phase === "RECOVERED"
              ? "VERIFIED"
              : "STABLE"}
        </span>
      </div>
      <p className="incident-copy">
        {phase === "READY"
          ? "Healthy morning-peak baseline. Activate the authored disruption to begin the recovery workflow."
          : phase === "RECOVERED"
            ? "The approved plan is committed. Every hard objective is verified by the deterministic model."
            : phase === "ROLLED_BACK"
              ? "Pre-commit operations restored. Governance and audit history were not rewound."
              : "Authored obstruction blocks the northbound spine. Fleet, demand, and outcomes remain simulated."}
      </p>
      <div className="incident-facts">
        <div>
          <small>SIM TIME</small>
          <strong>{formatTime(simulatedTime)}</strong>
        </div>
        <div>
          <small>AFFECTED</small>
          <strong>{metrics.affectedPassengers}</strong>
        </div>
        <div>
          <small>RECOVERY</small>
          <strong>{metrics.projectedRecoveryMinutes || "—"} min</strong>
        </div>
      </div>
      {phase === "READY" ? (
        <button
          className="primary-action danger-action"
          onClick={onActivate}
        >
          <AlertIcon /> Activate disruption
        </button>
      ) : null}
      {phase === "INCIDENT_ACTIVE" ? (
        <button className="primary-action" onClick={onEvaluate}>
          <RouteIcon />
          {webMcpAvailable
            ? "Manual evaluation fallback"
            : "Evaluate recovery options"}
        </button>
      ) : null}
      {phase === "RECOVERED" ? (
        <button
          className="primary-action secondary-action"
          onClick={onRollback}
        >
          <ResetIcon /> Roll back recovery
        </button>
      ) : null}
    </section>
  );
}

function AgentRail({
  activities,
  webMcpStatus,
}: {
  activities: AgentActivityItem[];
  webMcpStatus: string;
}) {
  return (
    <section className="rail-section activity-section">
      <div className="section-heading compact">
        <div>
          <small>BROWSER AGENT</small>
          <h2>Tool activity</h2>
        </div>
        <span className="live-label">
          <i /> LIVE
        </span>
      </div>
      <div className="activity-list" aria-live="polite">
        {activities.length === 0 ? (
          <div className="activity-empty">
            <AgentIcon />
            <p>
              {webMcpStatus === "AVAILABLE"
                ? "Chrome is ready. Give the browser agent the golden prompt after activating the incident."
                : "Tool calls will appear here. Manual controls exercise the same application use cases."}
            </p>
          </div>
        ) : (
          activities.map((activity) => (
            <div
              className={`activity-item status-${activity.status.toLowerCase()}`}
              key={activity.id}
            >
              <span className="activity-node" />
              <div>
                <strong>{activity.title}</strong>
                <code>{activity.toolName}</code>
                <small>{activity.detail}</small>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function PlanDock({
  plans,
  stagedPlan,
  phase,
  onStage,
  onApprove,
  onCommit,
  webMcpAvailable,
}: {
  plans: RecoveryPlan[];
  stagedPlan?: RecoveryPlan;
  phase: OperationalPhase;
  onStage: (planId: string) => void;
  onApprove: () => void;
  onCommit: () => void;
  webMcpAvailable: boolean;
}) {
  return (
    <section className="plan-dock" aria-label="Recovery plan comparison">
      <div className="plan-dock-header">
        <div>
          <small>MODEL-CALCULATED OPTIONS</small>
          <h2>
            {phase === "PLAN_STAGED" || phase === "APPROVED"
              ? "Human decision gate"
              : "Recovery comparison"}
          </h2>
        </div>
        <span>Hard constraints first · deterministic score</span>
      </div>
      <div className="plan-grid">
        {plans.map((plan, index) => {
          const staged = stagedPlan?.id === plan.id;
          return (
            <article
              className={`plan-row ${plan.hardConstraintsSatisfied ? "compliant" : "failed"} ${staged ? "staged" : ""}`}
              key={plan.id}
            >
              <div className="plan-index">0{index + 1}</div>
              <div className="plan-name">
                <small>
                  {plan.hardConstraintsSatisfied
                    ? "COMPLIANT"
                    : "CONSTRAINT FAILURE"}
                </small>
                <strong>{plan.name}</strong>
                <span>{plan.summary}</span>
              </div>
              <PlanMetric
                label="OTP"
                value={`${plan.metrics.onTimePercent}%`}
                passed={plan.constraints[0]?.passed}
              />
              <PlanMetric
                label="WAIT"
                value={`${plan.metrics.maximumWaitMinutes}m`}
                passed={plan.constraints[1]?.passed}
              />
              <PlanMetric
                label="A11Y"
                value={
                  plan.metrics.accessibilityViolations === 0 ? "PASS" : "FAIL"
                }
                passed={plan.constraints[2]?.passed}
              />
              <PlanMetric
                label="ENERGY"
                value={`+${plan.metrics.energyDeltaPercent}%`}
                passed={plan.constraints[3]?.passed}
              />
              <div className="plan-score">
                <small>SCORE</small>
                <strong>{plan.score}</strong>
              </div>
              {phase === "OPTIONS_EVALUATED" ? (
                <button
                  disabled={!plan.hardConstraintsSatisfied}
                  onClick={() => onStage(plan.id)}
                >
                  {plan.hardConstraintsSatisfied ? "Stage" : "Blocked"}
                </button>
              ) : staged ? (
                <span className="staged-label">STAGED</span>
              ) : null}
            </article>
          );
        })}
      </div>
      {phase === "PLAN_STAGED" && stagedPlan ? (
        <div className="approval-bar">
          <div>
            <span className="human-only">HUMAN ONLY</span>
            <strong>Approve {stagedPlan.name}?</strong>
            <small>
              Bound to plan {stagedPlan.id} at resulting revision{" "}
              {commandCenterService.currentState().revision + 1}
            </small>
          </div>
          <button className="approve-button" onClick={onApprove}>
            Approve plan
          </button>
        </div>
      ) : null}
      {phase === "APPROVED" && stagedPlan ? (
        <div className="approval-bar approved-bar">
          <div>
            <span className="human-only verified">APPROVAL RECORDED</span>
            <strong>{stagedPlan.name} authorized</strong>
            <small>
              The Chrome commit tool is state-gated to this exact revision.
            </small>
          </div>
          <button className="approve-button" onClick={onCommit}>
            {webMcpAvailable
              ? "Manual commit fallback"
              : "Commit approved recovery"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PlanMetric({
  label,
  value,
  passed,
}: {
  label: string;
  value: string;
  passed?: boolean;
}) {
  return (
    <div className={`plan-metric ${passed ? "passed" : "failed"}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function AuditTimeline({
  audit,
  onOpen,
}: {
  audit: AuditEvent[];
  onOpen: () => void;
}) {
  const recent = audit.slice(-3);
  return (
    <button
      className="audit-strip"
      onClick={onOpen}
      aria-label="Open audit timeline"
    >
      <div className="audit-title">
        <small>APPEND-ONLY AUDIT</small>
        <strong>{audit.length} events</strong>
      </div>
      <div className="audit-events">
        {recent.length === 0 ? (
          <span className="audit-empty">Awaiting first domain event</span>
        ) : (
          recent.map((event) => (
            <span key={event.sequence}>
              <i /> R{event.revision} · {formatAuditAction(event.action)}
            </span>
          ))
        )}
      </div>
      <ChevronIcon />
    </button>
  );
}

function AuditDrawer({
  audit,
  onClose,
}: {
  audit: AuditEvent[];
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="audit-drawer-layer">
      <button
        className="audit-drawer-backdrop"
        onClick={onClose}
        aria-label="Close audit timeline"
      />
      <section
        className="audit-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-drawer-title"
      >
        <header>
          <div>
            <small>GOVERNANCE RECORD</small>
            <h2 id="audit-drawer-title">Append-only audit timeline</h2>
            <p>{audit.length} immutable domain events in this demo session</p>
          </div>
          <button onClick={onClose} aria-label="Close audit timeline">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <ol className="audit-drawer-list">
          {audit.length === 0 ? (
            <li className="audit-drawer-empty">
              No domain mutation has occurred yet.
            </li>
          ) : (
            [...audit].reverse().map((event) => (
              <li key={event.sequence}>
                <div className="audit-sequence">{String(event.sequence).padStart(2, "0")}</div>
                <div className="audit-event-copy">
                  <div>
                    <strong>{formatAuditAction(event.action)}</strong>
                    <span>R{event.revision}</span>
                  </div>
                  <p>{event.detailCode.replaceAll("_", " ").toLowerCase()}</p>
                  <dl>
                    <div>
                      <dt>Actor</dt>
                      <dd>{event.actor.toLowerCase()}</dd>
                    </div>
                    <div>
                      <dt>Sim time</dt>
                      <dd>{formatTime(event.simulatedTime)}</dd>
                    </div>
                    {event.planId ? (
                      <div>
                        <dt>Plan</dt>
                        <dd>{event.planId}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </li>
            ))
          )}
        </ol>
      </section>
    </div>
  );
}

function metricState(
  passed: boolean,
  phase: OperationalPhase,
): "neutral" | "danger" | "success" {
  if (phase === "RECOVERED") return passed ? "success" : "danger";
  if (phase === "INCIDENT_ACTIVE") return passed ? "neutral" : "danger";
  return "neutral";
}

function formatPhase(phase: OperationalPhase) {
  return phase.replaceAll("_", " ");
}

function formatTime(value: string) {
  return value.slice(11, 16) + " UTC";
}

function formatAuditAction(action: string) {
  return action.replaceAll("_", " ").toLowerCase();
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.4 6.3A7 7 0 1 1 3 10" />
      <path d="M3 3v4h4" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7" y="7" width="9" height="9" rx="2" />
      <path d="M4 13H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2 18 17H2L10 2Z" />
      <path d="M10 7v4M10 14h.01" />
    </svg>
  );
}
function RouteIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="5" cy="15" r="2" />
      <circle cx="15" cy="5" r="2" />
      <path d="M7 15h2a2 2 0 0 0 2-2V7a2 2 0 0 1 2-2" />
    </svg>
  );
}
function AgentIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <rect x="4" y="7" width="20" height="16" rx="5" />
      <path d="M14 3v4M9 14h.01M19 14h.01M9 19h10" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7 4 6 6-6 6" />
    </svg>
  );
}
