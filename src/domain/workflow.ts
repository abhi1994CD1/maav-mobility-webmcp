import type { OperationalPhase } from "./types";

const NEXT_PHASE: Partial<Record<OperationalPhase, OperationalPhase>> = {
  READY: "INCIDENT_ACTIVE",
  INCIDENT_ACTIVE: "OPTIONS_EVALUATED",
  OPTIONS_EVALUATED: "PLAN_STAGED",
  PLAN_STAGED: "APPROVED",
  APPROVED: "RECOVERED",
  RECOVERED: "ROLLED_BACK",
};

export function isLegalTransition(
  from: OperationalPhase,
  to: OperationalPhase,
): boolean {
  return NEXT_PHASE[from] === to;
}

export function legalNextPhase(
  phase: OperationalPhase,
): OperationalPhase | undefined {
  return NEXT_PHASE[phase];
}
