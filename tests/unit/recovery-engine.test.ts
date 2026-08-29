import { describe, expect, it } from "vitest";
import { CANONICAL_OBJECTIVES } from "@/application/command-center-service";
import { evaluateRecoveryPlans } from "@/domain/recovery";
import {
  activateCanonicalIncident,
  createCanonicalOperationalState,
} from "@/domain/scenario";
import { isLegalTransition } from "@/domain/workflow";

describe("deterministic recovery engine", () => {
  it("replays the canonical incident identically", () => {
    const first = activateCanonicalIncident(createCanonicalOperationalState());
    const second = activateCanonicalIncident(createCanonicalOperationalState());

    expect(first).toEqual(second);
    expect(first.metrics.onTimePercent).toBe(71.8);
    expect(first.demand.points.find((point) => point.stopId === "sandton"))
      .toMatchObject({ waitingPassengers: 146, averageWaitMinutes: 11.6 });
  });

  it("evaluates hard constraints before ranking and recommends one plan", () => {
    const plans = evaluateRecoveryPlans(CANONICAL_OBJECTIVES);

    expect(plans).toHaveLength(3);
    expect(plans[0]).toMatchObject({
      id: "combined_recovery_c",
      hardConstraintsSatisfied: true,
    });
    expect(plans.filter((plan) => plan.hardConstraintsSatisfied)).toHaveLength(1);
    expect(
      plans.find((plan) => plan.id === "short_turn_b")?.constraints,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ACCESSIBILITY", passed: false }),
      ]),
    );
  });

  it("returns identical ranking for identical objectives", () => {
    expect(evaluateRecoveryPlans(CANONICAL_OBJECTIVES)).toEqual(
      evaluateRecoveryPlans({ ...CANONICAL_OBJECTIVES }),
    );
  });
});

describe("workflow", () => {
  it("permits only the seven documented forward transitions", () => {
    expect(isLegalTransition("READY", "INCIDENT_ACTIVE")).toBe(true);
    expect(isLegalTransition("INCIDENT_ACTIVE", "OPTIONS_EVALUATED")).toBe(true);
    expect(isLegalTransition("OPTIONS_EVALUATED", "PLAN_STAGED")).toBe(true);
    expect(isLegalTransition("PLAN_STAGED", "APPROVED")).toBe(true);
    expect(isLegalTransition("APPROVED", "RECOVERED")).toBe(true);
    expect(isLegalTransition("RECOVERED", "ROLLED_BACK")).toBe(true);
    expect(isLegalTransition("PLAN_STAGED", "RECOVERED")).toBe(false);
    expect(isLegalTransition("ROLLED_BACK", "OPTIONS_EVALUATED")).toBe(false);
  });
});
