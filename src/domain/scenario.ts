import type {
  AuditEvent,
  CommandCenterState,
  Incident,
  OperationalMetrics,
  OperationalSnapshot,
  OperationalState,
} from "./types";

export const CANONICAL_SCENARIO_ID = "jhb-morning-peak-v1";
export const CANONICAL_INCIDENT_ID = "rosebank_sandton_blockage";

const HEALTHY_METRICS: OperationalMetrics = {
  onTimePercent: 97.8,
  maximumWaitMinutes: 3.1,
  meanWaitMinutes: 1.9,
  affectedPassengers: 0,
  unservedPassengers: 0,
  accessibilityViolations: 0,
  spareVehiclesRequired: 0,
  energyDeltaPercent: 0,
  projectedRecoveryMinutes: 0,
};

export const INCIDENT_METRICS: OperationalMetrics = {
  onTimePercent: 71.8,
  maximumWaitMinutes: 11.6,
  meanWaitMinutes: 7.4,
  affectedPassengers: 438,
  unservedPassengers: 62,
  accessibilityViolations: 1,
  spareVehiclesRequired: 0,
  energyDeltaPercent: 0,
  projectedRecoveryMinutes: 42,
};

export const CANONICAL_INCIDENT: Incident = {
  id: CANONICAL_INCIDENT_ID,
  code: "CORRIDOR_BLOCKED",
  title: "Rosebank–Sandton obstruction",
  corridorId: "north-spine",
  affectedStopIds: ["rosebank", "sandton"],
  severity: "HIGH",
  location: { lat: -26.126, lng: 28.0485 },
  authoredNote:
    "Authored demo disruption: northbound service is blocked between Rosebank and Sandton.",
};

export function createCanonicalOperationalState(): OperationalState {
  return {
    simulatedTime: "2026-08-29T06:30:00.000Z",
    network: {
      stops: [
        {
          id: "park-station",
          name: "Park Station",
          position: { lat: -26.1974, lng: 28.0427 },
          accessible: true,
        },
        {
          id: "braamfontein",
          name: "Braamfontein",
          position: { lat: -26.191, lng: 28.0335 },
          accessible: true,
        },
        {
          id: "rosebank",
          name: "Rosebank",
          position: { lat: -26.1458, lng: 28.0419 },
          accessible: true,
        },
        {
          id: "sandton",
          name: "Sandton",
          position: { lat: -26.1076, lng: 28.0567 },
          accessible: true,
        },
        {
          id: "marlboro",
          name: "Marlboro",
          position: { lat: -26.0834, lng: 28.0919 },
          accessible: true,
        },
        {
          id: "midrand",
          name: "Midrand",
          position: { lat: -25.996, lng: 28.1263 },
          accessible: true,
        },
      ],
      corridors: [
        {
          id: "north-spine",
          name: "North mobility spine",
          stopIds: [
            "park-station",
            "braamfontein",
            "rosebank",
            "sandton",
            "marlboro",
            "midrand",
          ],
          path: [
            { lat: -26.1974, lng: 28.0427 },
            { lat: -26.191, lng: 28.0335 },
            { lat: -26.1458, lng: 28.0419 },
            { lat: -26.1076, lng: 28.0567 },
            { lat: -26.0834, lng: 28.0919 },
            { lat: -25.996, lng: 28.1263 },
          ],
          status: "HEALTHY",
        },
      ],
    },
    fleet: {
      availableSpareVehicles: 3,
      vehicles: [
        {
          id: "veh-17",
          label: "NX-17",
          position: { lat: -26.181, lng: 28.036 },
          capacity: 70,
          passengers: 51,
          accessible: true,
          status: "IN_SERVICE",
        },
        {
          id: "veh-23",
          label: "NX-23",
          position: { lat: -26.151, lng: 28.04 },
          capacity: 70,
          passengers: 64,
          accessible: true,
          status: "IN_SERVICE",
        },
        {
          id: "veh-31",
          label: "NX-31",
          position: { lat: -26.119, lng: 28.052 },
          capacity: 58,
          passengers: 42,
          accessible: false,
          status: "IN_SERVICE",
        },
        {
          id: "veh-44",
          label: "NX-44",
          position: { lat: -26.071, lng: 28.098 },
          capacity: 70,
          passengers: 47,
          accessible: true,
          status: "IN_SERVICE",
        },
      ],
    },
    demand: {
      points: [
        {
          stopId: "rosebank",
          waitingPassengers: 22,
          averageWaitMinutes: 2.2,
          wheelchairPassengers: 2,
        },
        {
          stopId: "sandton",
          waitingPassengers: 28,
          averageWaitMinutes: 2.7,
          wheelchairPassengers: 3,
        },
        {
          stopId: "marlboro",
          waitingPassengers: 17,
          averageWaitMinutes: 1.8,
          wheelchairPassengers: 1,
        },
      ],
    },
    metrics: { ...HEALTHY_METRICS },
  };
}

export function createInitialCommandCenterState(): CommandCenterState {
  return {
    revision: 0,
    scenarioId: CANONICAL_SCENARIO_ID,
    phase: "READY",
    operational: createCanonicalOperationalState(),
    evaluatedPlans: [],
    audit: [],
  };
}

export function activateCanonicalIncident(
  operational: OperationalState,
): OperationalState {
  const next = cloneOperationalState(operational);
  next.simulatedTime = "2026-08-29T06:36:00.000Z";
  next.activeIncident = { ...CANONICAL_INCIDENT };
  next.metrics = { ...INCIDENT_METRICS };
  next.network.corridors = next.network.corridors.map((corridor) => ({
    ...corridor,
    status: corridor.id === "north-spine" ? "DISRUPTED" : corridor.status,
  }));
  next.fleet.vehicles = next.fleet.vehicles.map((vehicle) =>
    vehicle.id === "veh-23" || vehicle.id === "veh-31"
      ? { ...vehicle, status: "DELAYED" }
      : vehicle,
  );
  next.demand.points = next.demand.points.map((point) => {
    if (point.stopId === "rosebank") {
      return { ...point, waitingPassengers: 118, averageWaitMinutes: 10.8 };
    }
    if (point.stopId === "sandton") {
      return { ...point, waitingPassengers: 146, averageWaitMinutes: 11.6 };
    }
    return { ...point, waitingPassengers: 54, averageWaitMinutes: 6.7 };
  });
  return next;
}

export function cloneOperationalState(
  operational: OperationalState,
): OperationalSnapshot {
  return {
    simulatedTime: operational.simulatedTime,
    activeIncident: operational.activeIncident
      ? {
          ...operational.activeIncident,
          affectedStopIds: [...operational.activeIncident.affectedStopIds],
          location: { ...operational.activeIncident.location },
        }
      : undefined,
    metrics: { ...operational.metrics },
    network: {
      stops: operational.network.stops.map((stop) => ({
        ...stop,
        position: { ...stop.position },
      })),
      corridors: operational.network.corridors.map((corridor) => ({
        ...corridor,
        stopIds: [...corridor.stopIds],
        path: corridor.path.map((point) => ({ ...point })),
      })),
    },
    fleet: {
      availableSpareVehicles: operational.fleet.availableSpareVehicles,
      vehicles: operational.fleet.vehicles.map((vehicle) => ({
        ...vehicle,
        position: { ...vehicle.position },
      })),
    },
    demand: {
      points: operational.demand.points.map((point) => ({ ...point })),
    },
  };
}

export function cloneAudit(audit: AuditEvent[]): AuditEvent[] {
  return audit.map((event) => ({ ...event }));
}

export function auditTimeForRevision(revision: number): string {
  const baseMilliseconds = Date.parse("2026-08-29T06:30:00.000Z");
  return new Date(baseMilliseconds + revision * 2 * 60_000).toISOString();
}
