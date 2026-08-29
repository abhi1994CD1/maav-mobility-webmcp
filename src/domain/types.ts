export const OPERATIONAL_PHASES = [
  "READY",
  "INCIDENT_ACTIVE",
  "OPTIONS_EVALUATED",
  "PLAN_STAGED",
  "APPROVED",
  "RECOVERED",
  "ROLLED_BACK",
] as const;

export type OperationalPhase = (typeof OPERATIONAL_PHASES)[number];

export type Actor = "HUMAN" | "AGENT" | "SYSTEM";
export type RouteContextSource = "GOOGLE" | "AUTHORED_FALLBACK";

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface Stop {
  id: string;
  name: string;
  position: Coordinate;
  accessible: boolean;
}

export interface Corridor {
  id: string;
  name: string;
  stopIds: string[];
  path: Coordinate[];
  status: "HEALTHY" | "DISRUPTED" | "RECOVERED";
}

export interface NetworkState {
  stops: Stop[];
  corridors: Corridor[];
}

export interface VehicleState {
  id: string;
  label: string;
  position: Coordinate;
  capacity: number;
  passengers: number;
  accessible: boolean;
  status: "IN_SERVICE" | "DELAYED" | "REROUTED" | "BRIDGE_SERVICE";
}

export interface FleetState {
  vehicles: VehicleState[];
  availableSpareVehicles: number;
}

export interface DemandPoint {
  stopId: string;
  waitingPassengers: number;
  averageWaitMinutes: number;
  wheelchairPassengers: number;
}

export interface DemandState {
  points: DemandPoint[];
}

export interface OperationalMetrics {
  onTimePercent: number;
  maximumWaitMinutes: number;
  meanWaitMinutes: number;
  affectedPassengers: number;
  unservedPassengers: number;
  accessibilityViolations: number;
  spareVehiclesRequired: number;
  energyDeltaPercent: number;
  projectedRecoveryMinutes: number;
}

export interface Incident {
  id: string;
  code: string;
  title: string;
  corridorId: string;
  affectedStopIds: string[];
  severity: "HIGH";
  location: Coordinate;
  authoredNote: string;
}

export interface OperationalState {
  network: NetworkState;
  fleet: FleetState;
  demand: DemandState;
  simulatedTime: string;
  activeIncident?: Incident;
  metrics: OperationalMetrics;
}

export interface RecoveryObjectives {
  minimumOnTimePercent: number;
  maximumWaitMinutes: number;
  preserveAccessibility: boolean;
  maximumEnergyIncreasePercent: number;
}

export interface ConstraintCheck {
  code: "ON_TIME" | "MAX_WAIT" | "ACCESSIBILITY" | "ENERGY";
  label: string;
  passed: boolean;
  actual: number;
  target: number;
  unit: "%" | "min" | "violations";
}

export interface RecoveryPlan {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  changeDescription: string;
  metrics: OperationalMetrics;
  constraints: ConstraintCheck[];
  hardConstraintsSatisfied: boolean;
  score: number;
}

export interface OperatorApproval {
  planId: string;
  validForRevision: number;
  consumed: boolean;
}

export interface OperationalSnapshot {
  network: NetworkState;
  fleet: FleetState;
  demand: DemandState;
  simulatedTime: string;
  activeIncident?: Incident;
  metrics: OperationalMetrics;
}

export interface AuditEvent {
  sequence: number;
  revision: number;
  simulatedTime: string;
  actor: Actor;
  action:
    | "SCENARIO_RESET"
    | "INCIDENT_ACTIVATED"
    | "OPTIONS_EVALUATED"
    | "PLAN_STAGED"
    | "PLAN_APPROVED"
    | "RECOVERY_COMMITTED"
    | "RECOVERY_ROLLED_BACK";
  result: "SUCCEEDED";
  detailCode: string;
  planId?: string;
  reason?: string;
}

export interface CommandCenterState {
  revision: number;
  scenarioId: string;
  phase: OperationalPhase;
  operational: OperationalState;
  evaluatedPlans: RecoveryPlan[];
  stagedPlanId?: string;
  approval?: OperatorApproval;
  lastCommittedOperationalSnapshot?: OperationalSnapshot;
  audit: AuditEvent[];
}

export type SnapshotFocus =
  | "network"
  | "incident"
  | "fleet"
  | "demand"
  | "accessibility"
  | "all";

export type ErrorCode =
  | "INVALID_INPUT"
  | "STALE_REVISION"
  | "INVALID_PHASE"
  | "PLAN_NOT_FOUND"
  | "PLAN_NOT_COMPLIANT"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_MISMATCH"
  | "APPROVAL_CONSUMED"
  | "NO_ROLLBACK_AVAILABLE"
  | "ABORTED"
  | "INTERNAL_ERROR";

export interface ResultMeta {
  revision: number;
  phase: OperationalPhase;
}

export interface SuccessResult<T> {
  ok: true;
  data: T;
  meta: ResultMeta;
}

export interface FailureResult {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    recoverable: boolean;
    suggestedAction: string;
  };
  meta: ResultMeta;
}

export type CommandResult<T> = SuccessResult<T> | FailureResult;

export interface RouteContext {
  source: RouteContextSource;
  corridorId: "rosebank-sandton";
  distanceMeters: number;
  durationSeconds: number;
  delaySeconds: number;
  capturedForSession: boolean;
  reasonCode?: "NO_SERVER_KEY" | "ROUTES_UNAVAILABLE" | "CLIENT_UNAVAILABLE";
}
