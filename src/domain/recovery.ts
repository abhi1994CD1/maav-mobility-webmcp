import { cloneOperationalState } from "./scenario";
import type {
  ConstraintCheck,
  OperationalMetrics,
  OperationalState,
  RecoveryObjectives,
  RecoveryPlan,
} from "./types";

interface CandidateTemplate {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  changeDescription: string;
  metrics: OperationalMetrics;
}

const CANDIDATES: CandidateTemplate[] = [
  {
    id: "express_bridge_a",
    name: "Express bridge",
    shortName: "Bridge",
    summary: "Insert two spare accessible vehicles around the obstruction.",
    changeDescription: "Two-stop bridge with direct Rosebank–Sandton transfers.",
    metrics: {
      onTimePercent: 91.8,
      maximumWaitMinutes: 5.8,
      meanWaitMinutes: 3.8,
      affectedPassengers: 438,
      unservedPassengers: 18,
      accessibilityViolations: 0,
      spareVehiclesRequired: 2,
      energyDeltaPercent: 5.4,
      projectedRecoveryMinutes: 18,
    },
  },
  {
    id: "short_turn_b",
    name: "Short-turn service",
    shortName: "Short turn",
    summary: "Turn vehicles before the blockage and increase feeder frequency.",
    changeDescription: "High-frequency short turns north and south of the incident.",
    metrics: {
      onTimePercent: 96.2,
      maximumWaitMinutes: 4.6,
      meanWaitMinutes: 3.1,
      affectedPassengers: 438,
      unservedPassengers: 9,
      accessibilityViolations: 1,
      spareVehiclesRequired: 1,
      energyDeltaPercent: 4.1,
      projectedRecoveryMinutes: 14,
    },
  },
  {
    id: "combined_recovery_c",
    name: "Coordinated recovery",
    shortName: "Coordinated",
    summary: "Combine accessible bridge service with balanced short turns.",
    changeDescription:
      "One accessible bridge vehicle plus synchronized short-turn departures.",
    metrics: {
      onTimePercent: 96.8,
      maximumWaitMinutes: 4.2,
      meanWaitMinutes: 2.8,
      affectedPassengers: 438,
      unservedPassengers: 4,
      accessibilityViolations: 0,
      spareVehiclesRequired: 2,
      energyDeltaPercent: 7.2,
      projectedRecoveryMinutes: 12,
    },
  },
];

function evaluateConstraints(
  metrics: OperationalMetrics,
  objectives: RecoveryObjectives,
): ConstraintCheck[] {
  return [
    {
      code: "ON_TIME",
      label: "On-time arrivals",
      passed: metrics.onTimePercent >= objectives.minimumOnTimePercent,
      actual: metrics.onTimePercent,
      target: objectives.minimumOnTimePercent,
      unit: "%",
    },
    {
      code: "MAX_WAIT",
      label: "Maximum passenger wait",
      passed: metrics.maximumWaitMinutes <= objectives.maximumWaitMinutes,
      actual: metrics.maximumWaitMinutes,
      target: objectives.maximumWaitMinutes,
      unit: "min",
    },
    {
      code: "ACCESSIBILITY",
      label: "Accessibility violations",
      passed:
        !objectives.preserveAccessibility ||
        metrics.accessibilityViolations === 0,
      actual: metrics.accessibilityViolations,
      target: 0,
      unit: "violations",
    },
    {
      code: "ENERGY",
      label: "Additional energy",
      passed:
        metrics.energyDeltaPercent <=
        objectives.maximumEnergyIncreasePercent,
      actual: metrics.energyDeltaPercent,
      target: objectives.maximumEnergyIncreasePercent,
      unit: "%",
    },
  ];
}

function calculateScore(metrics: OperationalMetrics): number {
  const score =
    metrics.onTimePercent * 0.48 +
    Math.max(0, 10 - metrics.maximumWaitMinutes) * 3 +
    Math.max(0, 10 - metrics.energyDeltaPercent) * 1.5 -
    metrics.accessibilityViolations * 30 -
    metrics.unservedPassengers * 0.08;

  return Math.round(score * 10) / 10;
}

export function evaluateRecoveryPlans(
  objectives: RecoveryObjectives,
): RecoveryPlan[] {
  return CANDIDATES.map((candidate) => {
    const constraints = evaluateConstraints(candidate.metrics, objectives);
    return {
      ...candidate,
      metrics: { ...candidate.metrics },
      constraints,
      hardConstraintsSatisfied: constraints.every((check) => check.passed),
      score: calculateScore(candidate.metrics),
    };
  }).sort((left, right) => {
    if (left.hardConstraintsSatisfied !== right.hardConstraintsSatisfied) {
      return left.hardConstraintsSatisfied ? -1 : 1;
    }
    return right.score - left.score;
  });
}

export function applyRecoveryPlan(
  operational: OperationalState,
  plan: RecoveryPlan,
): OperationalState {
  const next = cloneOperationalState(operational);
  next.simulatedTime = "2026-08-29T06:48:00.000Z";
  next.metrics = { ...plan.metrics };
  next.network.corridors = next.network.corridors.map((corridor) => ({
    ...corridor,
    status: corridor.id === "north-spine" ? "RECOVERED" : corridor.status,
  }));
  next.fleet.vehicles = next.fleet.vehicles.map((vehicle, index) => ({
    ...vehicle,
    status:
      index === 1
        ? "BRIDGE_SERVICE"
        : index === 2
          ? "REROUTED"
          : "IN_SERVICE",
    passengers: Math.max(18, vehicle.passengers - 14),
  }));
  next.demand.points = next.demand.points.map((point) => ({
    ...point,
    waitingPassengers:
      point.stopId === "rosebank" ? 31 : point.stopId === "sandton" ? 37 : 19,
    averageWaitMinutes:
      point.stopId === "rosebank" ? 3.7 : point.stopId === "sandton" ? 4.2 : 2.6,
  }));
  return next;
}
