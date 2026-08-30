import { batteryWhAtBasisPoints } from "./simulation-math";
import {
  count,
  simulatedSecond,
  StressLabEngineInvariantError,
  vehicleId,
  type SimulationState,
  type StressLabRunInput,
  type ZoneId,
} from "./types";

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function allocateInitialZones(input: StressLabRunInput): readonly ZoneId[] {
  const weights = [...input.scenario.fleet.initialZoneWeights].sort(
    (left, right) => compareCodeUnits(left.zoneId, right.zoneId),
  );
  const totalWeight = weights.reduce((total, entry) => total + entry.weight, 0);
  if (totalWeight <= 0) {
    throw new StressLabEngineInvariantError(
      "Initial fleet zone weights must have a positive total.",
    );
  }
  const zones: ZoneId[] = [];
  for (let index = 0; index < input.scenario.fleet.vehicleCount; index += 1) {
    const position = Math.floor(
      ((2 * index + 1) * totalWeight) /
        (2 * input.scenario.fleet.vehicleCount),
    );
    let cumulative = 0;
    let selected = weights.at(-1)?.zoneId;
    for (const weight of weights) {
      cumulative += weight.weight;
      if (position < cumulative) {
        selected = weight.zoneId;
        break;
      }
    }
    if (!selected) {
      throw new StressLabEngineInvariantError(
        "Initial fleet allocation could not select an authored zone.",
      );
    }
    zones.push(selected);
  }
  return Object.freeze(zones);
}

export function deriveInitialOperationalState(
  input: StressLabRunInput,
): SimulationState {
  const initialZones = allocateInitialZones(input);
  const startingBatteryWh = batteryWhAtBasisPoints(
    input.scenario.fleet.batteryCapacityWh,
    input.scenario.fleet.startingBatteryBasisPoints,
  );
  return deepFreeze({
    atSecond: simulatedSecond(0),
    nextEventSequence: count(1),
    passengers: input.demandTrace.requests.map((request) => ({
      request,
      state: "NOT_ARRIVED" as const,
    })),
    vehicles: initialZones.map((currentZoneId, index) => ({
      id: vehicleId(
        `${input.scenarioSlot}-${String(index + 1).padStart(2, "0")}`,
      ),
      state: "IDLE" as const,
      currentZoneId,
      seats: input.scenario.fleet.seatsPerVehicle,
      onboardPassengerIds: Object.freeze([]),
      reservedPassengerIds: Object.freeze([]),
      batteryWh: startingBatteryWh,
    })),
    appliedDisruptionIds: Object.freeze([]),
    recoveryCompletedDisruptionIds: Object.freeze([]),
  });
}
