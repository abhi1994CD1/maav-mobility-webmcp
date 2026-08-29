import {
  activateCanonicalIncident,
  auditTimeForRevision,
  cloneAudit,
  cloneOperationalState,
  createCanonicalOperationalState,
} from "@/domain/scenario";
import { applyRecoveryPlan, evaluateRecoveryPlans } from "@/domain/recovery";
import { isLegalTransition, legalNextPhase } from "@/domain/workflow";
import type {
  Actor,
  AuditEvent,
  CommandCenterState,
  CommandResult,
  ErrorCode,
  FailureResult,
  OperationalPhase,
  RecoveryObjectives,
  RouteContextSource,
  SnapshotFocus,
  SuccessResult,
} from "@/domain/types";
import type { CommandCenterRepository } from "./ports";

const CANONICAL_OBJECTIVES: RecoveryObjectives = {
  minimumOnTimePercent: 95,
  maximumWaitMinutes: 5,
  preserveAccessibility: true,
  maximumEnergyIncreasePercent: 8,
};

type MutationAction = AuditEvent["action"];

function meta(state: CommandCenterState) {
  return { revision: state.revision, phase: state.phase };
}

function success<T>(state: CommandCenterState, data: T): SuccessResult<T> {
  return { ok: true, data, meta: meta(state) };
}

function failure(
  state: CommandCenterState,
  code: ErrorCode,
  message: string,
  suggestedAction: string,
  recoverable = true,
): FailureResult {
  return {
    ok: false,
    error: { code, message, recoverable, suggestedAction },
    meta: meta(state),
  };
}

function staleRevision(
  state: CommandCenterState,
  expectedRevision: number,
): FailureResult | undefined {
  if (state.revision === expectedRevision) {
    return undefined;
  }
  return failure(
    state,
    "STALE_REVISION",
    `Expected revision ${expectedRevision}, but the current revision is ${state.revision}.`,
    "Call get_network_snapshot and retry with the current revision.",
  );
}

function invalidPhase(
  state: CommandCenterState,
  expectedPhase: OperationalPhase,
): FailureResult {
  return failure(
    state,
    "INVALID_PHASE",
    `This action requires ${expectedPhase}; the current phase is ${state.phase}.`,
    legalNextAction(state.phase),
  );
}

function aborted(state: CommandCenterState): FailureResult {
  return failure(
    state,
    "ABORTED",
    "The tool invocation was cancelled before the mutation committed.",
    "Inspect the current network state before deciding whether to retry.",
  );
}

function legalNextAction(phase: OperationalPhase): string {
  const actions: Record<OperationalPhase, string> = {
    READY: "Activate the canonical incident from the visible operator controls.",
    INCIDENT_ACTIVE: "Call evaluate_recovery_options.",
    OPTIONS_EVALUATED: "Call stage_recovery_plan with a compliant plan.",
    PLAN_STAGED: "Ask the operator to approve the visible staged plan.",
    APPROVED: "Call commit_approved_recovery with the approved plan and revision.",
    RECOVERED: "Read the audit log or call rollback_last_recovery.",
    ROLLED_BACK: "Reset the scenario from the visible operator controls.",
  };
  return actions[phase];
}

function appendAudit(
  previous: CommandCenterState,
  revision: number,
  actor: Actor,
  action: MutationAction,
  detailCode: string,
  extra: Pick<AuditEvent, "planId" | "reason"> = {},
): AuditEvent[] {
  return [
    ...cloneAudit(previous.audit),
    {
      sequence: previous.audit.length + 1,
      revision,
      simulatedTime: auditTimeForRevision(revision),
      actor,
      action,
      result: "SUCCEEDED",
      detailCode,
      ...extra,
    },
  ];
}

function legalActions(phase: OperationalPhase): string[] {
  const common = ["get_network_snapshot", "get_action_audit_log"];
  const action: Partial<Record<OperationalPhase, string>> = {
    INCIDENT_ACTIVE: "evaluate_recovery_options",
    OPTIONS_EVALUATED: "stage_recovery_plan",
    APPROVED: "commit_approved_recovery",
    RECOVERED: "rollback_last_recovery",
  };
  return action[phase] ? [common[0], action[phase], common[1]] : common;
}

export class CommandCenterService {
  constructor(private readonly repository: CommandCenterRepository) {}

  currentState(): CommandCenterState {
    return this.repository.getState();
  }

  invalidInput(message: string): FailureResult {
    return failure(
      this.repository.getState(),
      "INVALID_INPUT",
      message,
      "Correct the tool input and retry.",
    );
  }

  internalError(): FailureResult {
    return failure(
      this.repository.getState(),
      "INTERNAL_ERROR",
      "The command could not be completed.",
      "Inspect the current state and retry. If the failure persists, use the manual controls.",
    );
  }

  getNetworkSnapshot(
    focus: SnapshotFocus,
    routeContextSource: RouteContextSource,
  ): CommandResult<{
    scenarioId: string;
    focus: SnapshotFocus;
    summary: {
      incidentTitle?: string;
      corridorStatus: string;
      vehiclesInService: number;
      waitingPassengers: number;
      metrics: CommandCenterState["operational"]["metrics"];
    };
    constraints: RecoveryObjectives;
    routeContextSource: RouteContextSource;
    legalNextActions: string[];
  }> {
    const state = this.repository.getState();
    return success(state, {
      scenarioId: state.scenarioId,
      focus,
      summary: {
        incidentTitle: state.operational.activeIncident?.title,
        corridorStatus:
          state.operational.network.corridors[0]?.status ?? "UNKNOWN",
        vehiclesInService: state.operational.fleet.vehicles.length,
        waitingPassengers: state.operational.demand.points.reduce(
          (total, point) => total + point.waitingPassengers,
          0,
        ),
        metrics: { ...state.operational.metrics },
      },
      constraints: { ...CANONICAL_OBJECTIVES },
      routeContextSource,
      legalNextActions: legalActions(state.phase),
    });
  }

  getAuditLog(
    afterSequence: number,
    limit: number,
  ): CommandResult<{ items: AuditEvent[]; nextSequence: number }> {
    const state = this.repository.getState();
    const items = state.audit
      .filter((event) => event.sequence > afterSequence)
      .slice(0, limit)
      .map((event) => ({ ...event }));
    return success(state, {
      items,
      nextSequence: items.at(-1)?.sequence ?? afterSequence,
    });
  }

  resetScenario(
    expectedRevision: number,
  ): CommandResult<{ scenarioId: string }> {
    const current = this.repository.getState();
    const stale = staleRevision(current, expectedRevision);
    if (stale) return stale;

    const revision = current.revision + 1;
    const next: CommandCenterState = {
      revision,
      scenarioId: current.scenarioId,
      phase: "READY",
      operational: createCanonicalOperationalState(),
      evaluatedPlans: [],
      audit: appendAudit(
        current,
        revision,
        "HUMAN",
        "SCENARIO_RESET",
        "CANONICAL_SCENARIO_RESTORED",
      ),
    };
    this.repository.replaceState(next);
    return success(next, { scenarioId: next.scenarioId });
  }

  activateIncident(
    expectedRevision: number,
  ): CommandResult<{ incidentId: string; title: string }> {
    const current = this.repository.getState();
    const stale = staleRevision(current, expectedRevision);
    if (stale) return stale;
    if (!isLegalTransition(current.phase, "INCIDENT_ACTIVE")) {
      return invalidPhase(current, "READY");
    }

    const revision = current.revision + 1;
    const operational = activateCanonicalIncident(current.operational);
    const next: CommandCenterState = {
      ...current,
      revision,
      phase: "INCIDENT_ACTIVE",
      operational,
      evaluatedPlans: [],
      stagedPlanId: undefined,
      approval: undefined,
      lastCommittedOperationalSnapshot: undefined,
      audit: appendAudit(
        current,
        revision,
        "HUMAN",
        "INCIDENT_ACTIVATED",
        "ROSEBANK_SANDTON_BLOCKED",
      ),
    };
    this.repository.replaceState(next);
    return success(next, {
      incidentId: operational.activeIncident?.id ?? "unknown",
      title: operational.activeIncident?.title ?? "Active incident",
    });
  }

  evaluateRecoveryOptions(
    expectedRevision: number,
    objectives: RecoveryObjectives,
    actor: Actor,
    signal?: AbortSignal,
  ): CommandResult<{
    plans: CommandCenterState["evaluatedPlans"];
    recommendedPlanId?: string;
  }> {
    const current = this.repository.getState();
    if (signal?.aborted) return aborted(current);
    const stale = staleRevision(current, expectedRevision);
    if (stale) return stale;
    if (!isLegalTransition(current.phase, "OPTIONS_EVALUATED")) {
      return invalidPhase(current, "INCIDENT_ACTIVE");
    }

    const plans = evaluateRecoveryPlans(objectives);
    if (signal?.aborted) return aborted(current);
    const revision = current.revision + 1;
    const next: CommandCenterState = {
      ...current,
      revision,
      phase: "OPTIONS_EVALUATED",
      evaluatedPlans: plans,
      stagedPlanId: undefined,
      approval: undefined,
      audit: appendAudit(
        current,
        revision,
        actor,
        "OPTIONS_EVALUATED",
        "THREE_PLANS_SCORED",
      ),
    };
    this.repository.replaceState(next);
    return success(next, {
      plans: plans.map((plan) => ({
        ...plan,
        metrics: { ...plan.metrics },
        constraints: plan.constraints.map((check) => ({ ...check })),
      })),
      recommendedPlanId: plans.find((plan) => plan.hardConstraintsSatisfied)?.id,
    });
  }

  stageRecoveryPlan(
    planId: string,
    expectedRevision: number,
    actor: Actor,
    signal?: AbortSignal,
  ): CommandResult<{
    planId: string;
    approvalRequired: true;
    impact: CommandCenterState["operational"]["metrics"];
  }> {
    const current = this.repository.getState();
    if (signal?.aborted) return aborted(current);
    const stale = staleRevision(current, expectedRevision);
    if (stale) return stale;
    if (!isLegalTransition(current.phase, "PLAN_STAGED")) {
      return invalidPhase(current, "OPTIONS_EVALUATED");
    }
    const plan = current.evaluatedPlans.find((item) => item.id === planId);
    if (!plan) {
      return failure(
        current,
        "PLAN_NOT_FOUND",
        `No evaluated plan exists with ID ${planId}.`,
        "Call evaluate_recovery_options, then stage a returned plan ID.",
      );
    }
    if (!plan.hardConstraintsSatisfied) {
      return failure(
        current,
        "PLAN_NOT_COMPLIANT",
        "The selected plan violates at least one hard recovery constraint.",
        "Stage the recommended compliant plan.",
      );
    }

    const revision = current.revision + 1;
    const next: CommandCenterState = {
      ...current,
      revision,
      phase: "PLAN_STAGED",
      stagedPlanId: plan.id,
      approval: undefined,
      audit: appendAudit(
        current,
        revision,
        actor,
        "PLAN_STAGED",
        "COMPLIANT_PLAN_STAGED",
        { planId },
      ),
    };
    this.repository.replaceState(next);
    return success(next, {
      planId,
      approvalRequired: true,
      impact: { ...plan.metrics },
    });
  }

  approveStagedPlan(
    expectedRevision: number,
  ): CommandResult<{
    planId: string;
    validForRevision: number;
    consumed: false;
  }> {
    const current = this.repository.getState();
    const stale = staleRevision(current, expectedRevision);
    if (stale) return stale;
    if (!isLegalTransition(current.phase, "APPROVED")) {
      return invalidPhase(current, "PLAN_STAGED");
    }
    if (!current.stagedPlanId) {
      return failure(
        current,
        "APPROVAL_REQUIRED",
        "There is no staged plan to approve.",
        "Stage a compliant recovery plan first.",
      );
    }

    const revision = current.revision + 1;
    const approval = {
      planId: current.stagedPlanId,
      validForRevision: revision,
      consumed: false as const,
    };
    const next: CommandCenterState = {
      ...current,
      revision,
      phase: "APPROVED",
      approval,
      audit: appendAudit(
        current,
        revision,
        "HUMAN",
        "PLAN_APPROVED",
        "VISIBLE_OPERATOR_APPROVAL",
        { planId: current.stagedPlanId },
      ),
    };
    this.repository.replaceState(next);
    return success(next, approval);
  }

  commitApprovedRecovery(
    planId: string,
    expectedRevision: number,
    actor: Actor,
    signal?: AbortSignal,
  ): CommandResult<{
    planId: string;
    metrics: CommandCenterState["operational"]["metrics"];
    auditSequence: number;
  }> {
    const current = this.repository.getState();
    if (signal?.aborted) return aborted(current);
    const stale = staleRevision(current, expectedRevision);
    if (stale) return stale;
    if (current.phase !== "APPROVED") {
      return invalidPhase(current, "APPROVED");
    }
    if (!current.approval) {
      return failure(
        current,
        "APPROVAL_REQUIRED",
        "The operator has not approved the staged plan.",
        "Ask the operator to approve the visible staged plan.",
      );
    }
    if (
      current.approval.planId !== planId ||
      current.stagedPlanId !== planId ||
      current.approval.validForRevision !== current.revision
    ) {
      return failure(
        current,
        "APPROVAL_MISMATCH",
        "The approval does not match this plan and current revision.",
        "Re-inspect the state and ask the operator to approve the current staged plan.",
      );
    }
    if (current.approval.consumed) {
      return failure(
        current,
        "APPROVAL_CONSUMED",
        "This approval has already been used.",
        "Inspect the current recovery state instead of retrying the commit.",
        false,
      );
    }
    const plan = current.evaluatedPlans.find((item) => item.id === planId);
    if (!plan) {
      return failure(
        current,
        "PLAN_NOT_FOUND",
        "The approved plan is no longer available.",
        "Reset the scenario and evaluate recovery options again.",
      );
    }
    if (signal?.aborted) return aborted(current);

    const snapshot = cloneOperationalState(current.operational);
    const operational = applyRecoveryPlan(current.operational, plan);
    const revision = current.revision + 1;
    const audit = appendAudit(
      current,
      revision,
      actor,
      "RECOVERY_COMMITTED",
      "APPROVED_PLAN_APPLIED",
      { planId },
    );
    const next: CommandCenterState = {
      ...current,
      revision,
      phase: "RECOVERED",
      operational,
      approval: { ...current.approval, consumed: true },
      lastCommittedOperationalSnapshot: snapshot,
      audit,
    };
    this.repository.replaceState(next);
    return success(next, {
      planId,
      metrics: { ...operational.metrics },
      auditSequence: audit.at(-1)?.sequence ?? 0,
    });
  }

  rollbackLastRecovery(
    reason: string,
    expectedRevision: number,
    actor: Actor,
    signal?: AbortSignal,
  ): CommandResult<{
    restoredMetrics: CommandCenterState["operational"]["metrics"];
    auditSequence: number;
  }> {
    const current = this.repository.getState();
    if (signal?.aborted) return aborted(current);
    const stale = staleRevision(current, expectedRevision);
    if (stale) return stale;
    if (current.phase !== "RECOVERED") {
      return invalidPhase(current, "RECOVERED");
    }
    if (!current.lastCommittedOperationalSnapshot) {
      return failure(
        current,
        "NO_ROLLBACK_AVAILABLE",
        "No committed operational snapshot is available.",
        "Inspect the audit log to confirm whether a recovery was committed.",
        false,
      );
    }
    if (signal?.aborted) return aborted(current);

    const revision = current.revision + 1;
    const operational = cloneOperationalState(
      current.lastCommittedOperationalSnapshot,
    );
    const audit = appendAudit(
      current,
      revision,
      actor,
      "RECOVERY_ROLLED_BACK",
      "OPERATIONAL_SNAPSHOT_RESTORED",
      { reason },
    );
    const next: CommandCenterState = {
      ...current,
      revision,
      phase: "ROLLED_BACK",
      operational,
      evaluatedPlans: [],
      stagedPlanId: undefined,
      approval: undefined,
      lastCommittedOperationalSnapshot: undefined,
      audit,
    };
    this.repository.replaceState(next);
    return success(next, {
      restoredMetrics: { ...operational.metrics },
      auditSequence: audit.at(-1)?.sequence ?? 0,
    });
  }

  expectedNextPhase(): OperationalPhase | undefined {
    return legalNextPhase(this.repository.getState().phase);
  }
}

export { CANONICAL_OBJECTIVES };
