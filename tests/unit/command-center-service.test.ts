import { describe, expect, it } from "vitest";
import {
  CANONICAL_OBJECTIVES,
  CommandCenterService,
} from "@/application/command-center-service";
import { createInitialCommandCenterState } from "@/domain/scenario";
import type { CommandResult } from "@/domain/types";
import { TestRepository } from "../helpers/test-repository";

function setup() {
  const repository = new TestRepository(createInitialCommandCenterState());
  return { repository, service: new CommandCenterService(repository) };
}

function expectSuccess<T>(result: CommandResult<T>): asserts result is Extract<CommandResult<T>, { ok: true }> {
  expect(result.ok).toBe(true);
}

function advanceToEvaluated(service: CommandCenterService) {
  expectSuccess(service.activateIncident(0));
  const result = service.evaluateRecoveryOptions(
    1,
    CANONICAL_OBJECTIVES,
    "AGENT",
  );
  expectSuccess(result);
  return result.data.recommendedPlanId!;
}

function advanceToApproved(service: CommandCenterService) {
  const planId = advanceToEvaluated(service);
  expectSuccess(service.stageRecoveryPlan(planId, 2, "AGENT"));
  const approval = service.approveStagedPlan(3);
  expectSuccess(approval);
  return { planId, approval: approval.data };
}

describe("CommandCenterService", () => {
  it("completes the golden flow with exactly one revision per mutation", () => {
    const { repository, service } = setup();

    expectSuccess(service.activateIncident(0));
    expect(repository.getState().phase).toBe("INCIDENT_ACTIVE");
    expect(repository.getState().revision).toBe(1);

    const evaluated = service.evaluateRecoveryOptions(
      1,
      CANONICAL_OBJECTIVES,
      "AGENT",
    );
    expectSuccess(evaluated);
    expect(evaluated.meta).toEqual({ revision: 2, phase: "OPTIONS_EVALUATED" });

    const planId = evaluated.data.recommendedPlanId!;
    const staged = service.stageRecoveryPlan(planId, 2, "AGENT");
    expectSuccess(staged);
    expect(staged.meta).toEqual({ revision: 3, phase: "PLAN_STAGED" });

    const approved = service.approveStagedPlan(3);
    expectSuccess(approved);
    expect(approved.data).toEqual({
      planId: "combined_recovery_c",
      validForRevision: 4,
      consumed: false,
    });

    const committed = service.commitApprovedRecovery(planId, 4, "AGENT");
    expectSuccess(committed);
    expect(committed.meta).toEqual({ revision: 5, phase: "RECOVERED" });
    expect(repository.getState().approval?.consumed).toBe(true);
    expect(committed.data.metrics).toMatchObject({
      onTimePercent: 96.8,
      maximumWaitMinutes: 4.2,
      accessibilityViolations: 0,
      energyDeltaPercent: 7.2,
    });

    const rolledBack = service.rollbackLastRecovery(
      "Operator review",
      5,
      "AGENT",
    );
    expectSuccess(rolledBack);
    expect(rolledBack.meta).toEqual({ revision: 6, phase: "ROLLED_BACK" });
    expect(repository.getState().audit.map((event) => event.revision)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("rejects stale revisions without state or audit mutation", () => {
    const { repository, service } = setup();
    expectSuccess(service.activateIncident(0));
    const before = repository.getState();

    const result = service.evaluateRecoveryOptions(
      0,
      CANONICAL_OBJECTIVES,
      "AGENT",
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_REVISION" },
      meta: { revision: 1, phase: "INCIDENT_ACTIVE" },
    });
    expect(repository.getState()).toBe(before);
    expect(repository.getState().audit).toHaveLength(1);
  });

  it("binds approval to the resulting approved-state revision", () => {
    const { repository, service } = setup();
    const { planId, approval } = advanceToApproved(service);

    expect(approval.validForRevision).toBe(4);
    expect(repository.getState().revision).toBe(4);
    expect(repository.getState().phase).toBe("APPROVED");
    expectSuccess(service.commitApprovedRecovery(planId, 4, "AGENT"));
  });

  it("invalidates approval after any intervening domain mutation", () => {
    const { repository, service } = setup();
    const { planId } = advanceToApproved(service);
    expectSuccess(service.resetScenario(4));

    expect(repository.getState().approval).toBeUndefined();
    const result = service.commitApprovedRecovery(planId, 5, "AGENT");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_PHASE" },
      meta: { revision: 5, phase: "READY" },
    });
  });

  it("restores only operational state and preserves governance history", () => {
    const { repository, service } = setup();
    const { planId } = advanceToApproved(service);
    const operationalBeforeCommit = repository.getState().operational;
    expectSuccess(service.commitApprovedRecovery(planId, 4, "AGENT"));
    const committedAudit = repository.getState().audit;

    expectSuccess(service.rollbackLastRecovery("Safety review", 5, "AGENT"));
    const rolledBack = repository.getState();

    expect(rolledBack.operational).toEqual(operationalBeforeCommit);
    expect(rolledBack.phase).toBe("ROLLED_BACK");
    expect(rolledBack.revision).toBe(6);
    expect(rolledBack.approval).toBeUndefined();
    expect(rolledBack.stagedPlanId).toBeUndefined();
    expect(rolledBack.evaluatedPlans).toEqual([]);
    expect(rolledBack.lastCommittedOperationalSnapshot).toBeUndefined();
    expect(rolledBack.audit.slice(0, -1)).toEqual(committedAudit);
    expect(rolledBack.audit.at(-1)).toMatchObject({
      action: "RECOVERY_ROLLED_BACK",
      reason: "Safety review",
      revision: 6,
    });
  });

  it("rejects a hard-constraint-failing plan", () => {
    const { repository, service } = setup();
    advanceToEvaluated(service);

    const result = service.stageRecoveryPlan("short_turn_b", 2, "AGENT");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PLAN_NOT_COMPLIANT" },
    });
    expect(repository.getState().revision).toBe(2);
    expect(repository.getState().phase).toBe("OPTIONS_EVALUATED");
  });

  it("does not mutate when an invocation is already aborted", () => {
    const { repository, service } = setup();
    expectSuccess(service.activateIncident(0));
    const controller = new AbortController();
    controller.abort();

    const result = service.evaluateRecoveryOptions(
      1,
      CANONICAL_OBJECTIVES,
      "AGENT",
      controller.signal,
    );

    expect(result).toMatchObject({ ok: false, error: { code: "ABORTED" } });
    expect(repository.getState().revision).toBe(1);
  });
});
