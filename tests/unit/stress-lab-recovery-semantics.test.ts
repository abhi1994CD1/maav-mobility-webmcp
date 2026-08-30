import { describe, expect, it } from "vitest";
import { createGoldenExperimentInputs } from "@/data/scenarios/sandton-rosebank-v1";
import { computeDemandTraceFingerprint } from "@/domain/stress-lab/demand";
import { runDeterministicSimulation } from "@/domain/stress-lab/engine";
import { prepareStressLabRunInput } from "@/domain/stress-lab/run-input";
import type { StressLabRunInput } from "@/domain/stress-lab/types";

function cloneInput(input: StressLabRunInput): StressLabRunInput {
  return JSON.parse(JSON.stringify(input)) as StressLabRunInput;
}

function onePassengerFailure(options: {
  readonly initialZoneId: string;
  readonly originZoneId: string;
  readonly destinationZoneId: string;
  readonly dwellSeconds: number;
  readonly failureSecond: number;
  readonly vehicleCount?: number;
}) {
  const input = cloneInput(createGoldenExperimentInputs().runs.A.input);
  (input.scenario.fleet as {
    vehicleCount: number;
    dwellSeconds: number;
    initialZoneWeights: unknown;
  }).vehicleCount = options.vehicleCount ?? 1;
  (input.scenario.fleet as { dwellSeconds: number }).dwellSeconds =
    options.dwellSeconds;
  (input.scenario.fleet as { initialZoneWeights: unknown }).initialZoneWeights = [
    { zoneId: options.initialZoneId, weight: 1 },
  ];
  (input.demandDefinition as { requestCount: number }).requestCount = 1;
  (input.demandTrace as unknown as { requests: unknown[] }).requests = [
    {
      id: "P-RECOVERY",
      arrivalSecond: 0,
      originZoneId: options.originZoneId,
      destinationZoneId: options.destinationZoneId,
    },
  ];
  (input.demandTrace as { fingerprint: string }).fingerprint =
    computeDemandTraceFingerprint(
      input.demandDefinition,
      input.horizon,
      input.demandTrace,
    );
  (input.disruptions[0] as { atSecond: number }).atSecond =
    options.failureSecond;
  return prepareStressLabRunInput(input);
}

describe("Gate 4 explicit recovery semantics", () => {
  it("records zero affected passengers as immediate no-work recovery", () => {
    const input = cloneInput(createGoldenExperimentInputs().runs.A.input);
    (input.demandDefinition as { requestCount: number }).requestCount = 0;
    (input.demandTrace as unknown as { requests: unknown[] }).requests = [];
    (input.demandTrace as { fingerprint: string }).fingerprint =
      computeDemandTraceFingerprint(
        input.demandDefinition,
        input.horizon,
        input.demandTrace,
      );
    const result = runDeterministicSimulation(prepareStressLabRunInput(input));
    const failure = result.events.find((event) => event.type === "VEHICLE_FAILED");
    const recovery = result.events.find(
      (event) => event.type === "RECOVERY_COMPLETED",
    );
    expect(failure?.facts.onboardPassengerIds).toEqual([]);
    expect(failure?.facts.reservedPassengerIds).toEqual([]);
    expect(recovery).toMatchObject({
      atSecond: 720,
      facts: {
        affectedPassengerIds: [],
        recoveryTimeSeconds: 0,
        reasonCode: "NO_AFFECTED_PASSENGERS",
      },
    });
    expect(
      result.constraints.find((entry) => entry.code === "MAXIMUM_RECOVERY"),
    ).toMatchObject({
      passed: true,
      observed: 0,
      evidenceIds: expect.arrayContaining([recovery?.evidenceId]),
    });
  });

  it("releases reservations when a dwelling vehicle fails", () => {
    const zones = createGoldenExperimentInputs().runs.A.input.network.zones;
    const prepared = onePassengerFailure({
      initialZoneId: zones[0].id,
      originZoneId: zones[0].id,
      destinationZoneId: zones[1].id,
      dwellSeconds: 30,
      failureSecond: 30,
    });
    const result = runDeterministicSimulation(prepared);
    const failure = result.events.find((event) => event.type === "VEHICLE_FAILED");
    expect(failure?.facts.stateBefore).toBe("DWELLING");
    expect(failure?.facts.onboardPassengerIds).toEqual([]);
    expect(failure?.facts.reservedPassengerIds).toEqual(["P-RECOVERY"]);
    expect(
      result.events.find(
        (event) =>
          event.type === "PASSENGERS_REQUEUED" &&
          event.facts.reasonCode === "FAILED_VEHICLE_RESERVED_RELEASE",
      )?.facts.releaseSecond,
    ).toBe(30);
  });

  it("handles empty and occupied in-transit failures distinctly", () => {
    const zones = createGoldenExperimentInputs().runs.A.input.network.zones;
    const empty = runDeterministicSimulation(
      onePassengerFailure({
        initialZoneId: zones[0].id,
        originZoneId: zones[3].id,
        destinationZoneId: zones[2].id,
        dwellSeconds: 0,
        failureSecond: 30,
      }),
    );
    expect(
      empty.events.find((event) => event.type === "VEHICLE_FAILED")?.facts,
    ).toMatchObject({
      stateBefore: "TRAVELLING_EMPTY",
      onboardPassengerIds: [],
      reservedPassengerIds: ["P-RECOVERY"],
    });

    const occupied = runDeterministicSimulation(
      onePassengerFailure({
        initialZoneId: zones[0].id,
        originZoneId: zones[0].id,
        destinationZoneId: zones[3].id,
        dwellSeconds: 0,
        failureSecond: 30,
      }),
    );
    expect(
      occupied.events.find((event) => event.type === "VEHICLE_FAILED")?.facts,
    ).toMatchObject({
      stateBefore: "TRAVELLING_SERVICE",
      onboardPassengerIds: ["P-RECOVERY"],
      reservedPassengerIds: [],
      onboardRecoveryReleaseSecond: 90,
    });
    expect(
      occupied.events.some((event) => event.type === "RECOVERY_COMPLETED"),
    ).toBe(false);
    expect(
      occupied.constraints.find((entry) => entry.code === "MAXIMUM_RECOVERY"),
    ).toMatchObject({ passed: false, observed: null });
  });

  it("distinguishes successful passenger recovery", () => {
    const result = runDeterministicSimulation(
      createGoldenExperimentInputs().runs.A,
    );
    const recovery = result.events.find(
      (event) => event.type === "RECOVERY_COMPLETED",
    );
    expect(recovery?.facts.reasonCode).toBe(
      "ALL_AFFECTED_PASSENGERS_RECOVERED",
    );
    expect(recovery?.facts.recoveryTimeSeconds).toBeGreaterThan(0);
  });

  it("keeps recoveryTransferSeconds inside canonical run identity", () => {
    const baseline = createGoldenExperimentInputs().runs.A;
    const changed = cloneInput(baseline.input);
    (changed.disruptions[0] as { recoveryTransferSeconds: number })
      .recoveryTransferSeconds = 90;
    const prepared = prepareStressLabRunInput(changed);
    expect(prepared.fingerprint).not.toBe(baseline.fingerprint);
    expect(prepared.canonicalJson).toContain('"recoveryTransferSeconds":90');
  });
});
