import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  HUMAN_UI_INVOCATION_CONTEXT,
  type CurrentRunRecord,
  type StressLabApplicationState,
} from "@/application/stress-lab-ports";
import { StressLabMap } from "@/features/stress-lab/map/StressLabMap";
import { ReplayClock } from "@/features/stress-lab/map/replay-clock";
import {
  createAuthoredNetworkProjection,
  createReplayModel,
  nearestReplayFrameIndex,
  StressLabMapProjectionError,
  type MapCoordinate,
} from "@/features/stress-lab/map/replay-projection";
import {
  createGoogleRouteRequest,
  interpolatePresentationPath,
  loadGoogleRoutesLibrary,
  projectFrameOntoPresentedRoutes,
  ROUTE_SEMANTIC_PALETTE,
  RouteRequestCoordinator,
  summarizePresentedRoutes,
  validateGoogleRoutePath,
} from "@/features/stress-lab/map/route-presentation";
import {
  SANDTON_ROSEBANK_V1_NETWORK,
  SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
} from "@/data/scenarios/sandton-rosebank-v1";
import type { SimulationSnapshot, VehicleState } from "@/domain/stress-lab/types";
import { createStressLabRuntime, type StressLabRuntime } from "@/state/stress-lab-runtime";

const GOLDEN = Object.freeze({
  inputA: "sha256-v1:5156b1558d9767d60d1d050df868adb54b8075a0681ccea50dad07071b64afae",
  inputB: "sha256-v1:e1e6b94a79218c817ac346922309f87f35755bbd3721142d68db58b67111d80c",
  ledgerA: "sha256-v1:ca01cda9ae8edcf84ee8319304b7bd4853df5ecc5d0d0262d36a03acdfcc875b",
  ledgerB: "sha256-v1:4df5d2078a36d16240e4f9e12bbb2403a8a4db92f9034e6c27bcc1a8c5bc2eb3",
  resultA: "sha256-v1:d9138005105a050eea5974fe1a6ef0b2680204f15662463ca7fa6d08965d40ad",
  resultB: "sha256-v1:89dbf5e7080850c849d221b6c6646148bdd017db5ac2988285caf49034744511",
});

let runtime: StressLabRuntime;
let application: StressLabApplicationState;
let runA: CurrentRunRecord;
let runB: CurrentRunRecord;

beforeAll(async () => {
  runtime = createStressLabRuntime();
  await runtime.service.resetLab({
    operationId: "map-golden-reset",
    expectedRevision: 0,
  }, HUMAN_UI_INVOCATION_CONTEXT);
  const initial = runtime.service.readLabState();
  const scenarioA = initial.scenarios.A;
  const scenarioB = initial.scenarios.B;
  if (!scenarioA || !scenarioB) throw new Error("Golden scenarios are unavailable.");
  await runtime.service.runScenario({
    operationId: "map-golden-run-a",
    expectedRevision: initial.revision,
    scenarioRevisionId: scenarioA.id,
  }, HUMAN_UI_INVOCATION_CONTEXT);
  const afterA = runtime.service.readLabState();
  await runtime.service.runScenario({
    operationId: "map-golden-run-b",
    expectedRevision: afterA.revision,
    scenarioRevisionId: scenarioB.id,
  }, HUMAN_UI_INVOCATION_CONTEXT);
  application = runtime.repository.getState();
  const runAId = application.currentRunIds.A;
  const runBId = application.currentRunIds.B;
  if (!runAId || !runBId) throw new Error("Golden current runs are unavailable.");
  runA = application.runs[runAId];
  runB = application.runs[runBId];
}, 60_000);

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  runtime.dispose();
});

describe("Gate 9 deterministic map projection", () => {
  it("derives exact ordered bounds and frames without mutating trusted artifacts", () => {
    const beforeA = runA.preparedInput.canonicalJson;
    const beforeResult = runA.verifiedResult.canonicalResultJson;
    const model = createReplayModel(runA);
    const repeated = createReplayModel(runA);
    expect(model.timestamps).toEqual(runA.verifiedResult.snapshots.map((snapshot) => snapshot.atSecond));
    expect(model.frameCount).toBe(runA.verifiedResult.snapshots.length);
    expect(model.startSecond).toBe(runA.verifiedResult.snapshots[0].atSecond);
    expect(model.endSecond).toBe(runA.verifiedResult.snapshots.at(-1)?.atSecond);
    expect(model.frameCount).not.toBe(61);
    expect(model.routes).toHaveLength(runA.preparedInput.input.network.edges.length);
    expect(model.routes.every((route) => route.path.length >= 2)).toBe(true);
    const frame = model.projectFrame(33);
    const repeatedFrame = repeated.projectFrame(33);
    expect(frame).toEqual(repeatedFrame);
    expect(frame.atSecond).toBe(runA.verifiedResult.snapshots[33].atSecond);
    expect(frame.throughEventSequence).toBe(runA.verifiedResult.snapshots[33].throughEventSequence);
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.vehicles)).toBe(true);
    expect(Object.isFrozen(frame.passengers)).toBe(true);
    expect(runA.preparedInput.canonicalJson).toBe(beforeA);
    expect(runA.verifiedResult.canonicalResultJson).toBe(beforeResult);
    expect(runA.preparedInput.fingerprint).toBe(GOLDEN.inputA);
    expect(runA.eventLedger.fingerprint).toBe(GOLDEN.ledgerA);
    expect(runA.verifiedResult.resultFingerprint).toBe(GOLDEN.resultA);
  });

  it("fails closed for unknown authored nodes, edges, entities, and cursor values", () => {
    const snapshot = runA.verifiedResult.snapshots.find(
      (candidate) => candidate.vehicles.some((vehicle) => vehicle.activeLeg),
    );
    if (!snapshot) throw new Error("Expected an active-leg snapshot.");
    const vehicleIndex = snapshot.vehicles.findIndex((vehicle) => vehicle.activeLeg);
    const vehicle = snapshot.vehicles[vehicleIndex];
    const forgedVehicle = {
      ...vehicle,
      activeLeg: {
        ...vehicle.activeLeg!,
        edgeIds: ["unknown-authored-edge"],
      },
    } as unknown as VehicleState;
    const forgedSnapshot = {
      ...snapshot,
      vehicles: snapshot.vehicles.map((candidate, index) =>
        index === vehicleIndex ? forgedVehicle : candidate),
    } as SimulationSnapshot;
    const forgedRun = {
      ...runA,
      verifiedResult: {
        ...runA.verifiedResult,
        snapshots: runA.verifiedResult.snapshots.map((candidate) =>
          candidate === snapshot ? forgedSnapshot : candidate),
      },
    } as CurrentRunRecord;
    expect(() => createReplayModel(forgedRun)).toThrowError(StressLabMapProjectionError);
    const model = createReplayModel(runA);
    expect(() => model.projectFrame(-1)).toThrowError(StressLabMapProjectionError);
    expect(() => model.projectFrame(model.frameCount)).toThrowError(StressLabMapProjectionError);
  });

  it("keeps A and B separate while preserving timestamp selection deterministically", () => {
    const modelA = createReplayModel(runA);
    const modelB = createReplayModel(runB);
    expect(modelA.scenarioSlot).toBe("A");
    expect(modelB.scenarioSlot).toBe("B");
    expect(modelA.inputFingerprint).toBe(GOLDEN.inputA);
    expect(modelB.inputFingerprint).toBe(GOLDEN.inputB);
    expect(modelA.eventLedgerFingerprint).toBe(GOLDEN.ledgerA);
    expect(modelB.eventLedgerFingerprint).toBe(GOLDEN.ledgerB);
    expect(modelB.resultFingerprint).toBe(GOLDEN.resultB);
    const sourceIndex = 24;
    const sourceSecond = modelA.timestamps[sourceIndex];
    const targetIndex = nearestReplayFrameIndex(modelB.timestamps, sourceSecond);
    expect(modelB.timestamps[targetIndex]).toBe(sourceSecond);
    expect(modelA.projectFrame(sourceIndex).vehicles.every((vehicle) => vehicle.id.startsWith("A-"))).toBe(true);
    expect(modelB.projectFrame(targetIndex).vehicles.every((vehicle) => vehicle.id.startsWith("B-"))).toBe(true);
    expect(nearestReplayFrameIndex([0, 30, 60], 45)).toBe(1);
  });

  it("shows only authoritative failures at their exact committed sequence", () => {
    for (const [run, expectedVehicle] of [[runA, "A-09"], [runB, "B-03"]] as const) {
      const model = createReplayModel(run);
      expect(model.failureSecond).toBe(720);
      const failureIndex = nearestReplayFrameIndex(model.timestamps, model.failureSecond!);
      expect(model.timestamps[failureIndex]).toBe(720);
      expect(model.projectFrame(failureIndex - 1).failure).toBeNull();
      const failure = model.projectFrame(failureIndex).failure;
      expect(failure).toMatchObject({
        vehicleId: expectedVehicle,
        atSecond: 720,
      });
      expect(failure?.evidenceId).toMatch(/^[A-Za-z0-9-]+$/u);
      expect(model.projectFrame(model.frameCount - 1).failure?.vehicleId).toBe(expectedVehicle);
    }
  });

  it("plays only exact frames and deterministically pauses on seek, final frame, and invalidation", async () => {
    vi.useFakeTimers();
    const clock = new ReplayClock(3);
    const snapshots: unknown[] = [];
    clock.subscribe(() => snapshots.push(clock.getSnapshot()));
    clock.play();
    expect(clock.getSnapshot()).toMatchObject({ cursor: 0, playing: true, speed: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(clock.getSnapshot()).toMatchObject({ cursor: 1, playing: true });
    clock.setSpeed(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(clock.getSnapshot()).toMatchObject({ cursor: 2, playing: false, speed: 2 });
    clock.play();
    expect(clock.getSnapshot().playing).toBe(false);
    clock.restart();
    expect(clock.getSnapshot()).toMatchObject({ cursor: 0, playing: false });
    clock.next();
    expect(clock.getSnapshot().cursor).toBe(1);
    clock.previous();
    expect(clock.getSnapshot().cursor).toBe(0);
    clock.play();
    clock.seek(2);
    expect(clock.getSnapshot()).toMatchObject({ cursor: 2, playing: false });
    clock.replaceFrames(0, 0);
    expect(clock.getSnapshot()).toEqual({ cursor: 0, frameCount: 0, playing: false, speed: 2 });
    expect(vi.getTimerCount()).toBe(0);
    clock.dispose();
    expect(snapshots.length).toBeGreaterThan(5);
  });

  it("keeps playback, camera, layer, and entity state outside application authority", () => {
    const before = application;
    const beforeRevision = application.revision;
    const beforeAudit = application.audit;
    const model = createReplayModel(runA);
    const clock = new ReplayClock(model.frameCount);
    clock.seek(10);
    clock.setSpeed(0.5);
    clock.next();
    model.projectFrame(clock.getSnapshot().cursor);
    clock.dispose();
    expect(runtime.repository.getState()).toBe(before);
    expect(runtime.repository.getState().revision).toBe(beforeRevision);
    expect(runtime.repository.getState().audit).toBe(beforeAudit);
  });

  it("uses the authored fallback without a Google request when configuration is missing", () => {
    const priorKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const priorMapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    delete process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
    try {
      const html = renderToStaticMarkup(
        createElement(StressLabMap, { application }),
      );
      expect(html).toContain("Authored SVG fallback");
      expect(html).toContain("Google Maps configuration is unavailable");
      expect(html).toContain("Deterministic evidence remains valid");
      expect(html).not.toContain("google-maps-api");
      expect(html).not.toContain("maps.googleapis.com");
      expect(html).not.toContain("apiKey");
    } finally {
      if (priorKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = priorKey;
      if (priorMapId === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
      else process.env.NEXT_PUBLIC_GOOGLE_MAP_ID = priorMapId;
    }
  });

  it("keeps the persistent baseline map mounted before runs, after configuration, invalidation, and reset", async () => {
    const freshRuntime = createStressLabRuntime();
    const fresh = freshRuntime.repository.getState();
    const freshHtml = renderToStaticMarkup(createElement(StressLabMap, { application: fresh }));
    expect(freshHtml).toContain('data-testid="persistent-map-hero"');
    expect(freshHtml).toContain("IMMUTABLE BASELINE TOPOLOGY");
    expect(freshHtml).toContain("No committed replay");
    expect(freshHtml).toContain("Replay unavailable");
    expect(freshHtml).toMatch(/type="range"[^>]*disabled/u);
    expect(freshHtml).not.toContain("failure evidence active");
    expect(freshHtml).not.toContain("COMMITTED RUN");

    await freshRuntime.service.resetLab({
      operationId: "map-persistence-reset",
      expectedRevision: 0,
    }, HUMAN_UI_INVOCATION_CONTEXT);
    const configuredHtml = renderToStaticMarkup(createElement(StressLabMap, {
      application: freshRuntime.repository.getState(),
    }));
    expect(configuredHtml).toContain('data-testid="persistent-map-hero"');
    expect(configuredHtml).toContain("No committed replay");

    const invalidated = Object.freeze({
      ...application,
      currentRunIds: Object.freeze({}),
      currentComparisonId: undefined,
      currentFindingId: undefined,
    });
    const invalidatedHtml = renderToStaticMarkup(createElement(StressLabMap, { application: invalidated }));
    expect(invalidatedHtml).toContain('data-testid="persistent-map-hero"');
    expect(invalidatedHtml).toContain("No committed replay");
    expect(invalidatedHtml).not.toContain(runA.id);
    expect(invalidatedHtml).not.toContain(runB.id);
    freshRuntime.dispose();
  });

  it("builds the strict path-only, driving, traffic-unaware request from authored endpoints", () => {
    const network = createAuthoredNetworkProjection(
      SANDTON_ROSEBANK_V1_NETWORK,
      SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
    );
    const route = network.routes[0];
    const request = createGoogleRouteRequest(route);
    expect(Object.keys(request).sort()).toEqual([
      "destination",
      "fields",
      "origin",
      "routingPreference",
      "travelMode",
    ]);
    expect(request.origin).toEqual(route.path[0]);
    expect(request.destination).toEqual(route.path.at(-1));
    expect(request.fields).toEqual(["path"]);
    expect(request.travelMode).toBe("DRIVING");
    expect(request.routingPreference).toBe("TRAFFIC_UNAWARE");
    expect(request).not.toHaveProperty("departureTime");
    expect(request).not.toHaveProperty("arrivalTime");
    expect(request).not.toHaveProperty("trafficModel");
    expect(request).not.toHaveProperty("computeAlternativeRoutes");
    expect(request).not.toHaveProperty("optimizeWaypointOrder");
  });

  it("validates bounded directed Google paths and rejects empty, reversed, or impossible geometry", () => {
    const network = createAuthoredNetworkProjection(
      SANDTON_ROSEBANK_V1_NETWORK,
      SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
    );
    const route = network.routes[0];
    const midpoint = {
      lat: (route.path[0].lat + route.path.at(-1)!.lat) / 2 + 0.0002,
      lng: (route.path[0].lng + route.path.at(-1)!.lng) / 2 + 0.0002,
    };
    const valid = [route.path[0], midpoint, route.path.at(-1)!];
    expect(validateGoogleRoutePath(valid, route, network.bounds)).toEqual(valid);
    expect(validateGoogleRoutePath([], route, network.bounds)).toBeNull();
    expect(validateGoogleRoutePath([route.path[0]], route, network.bounds)).toBeNull();
    expect(validateGoogleRoutePath([...valid].reverse(), route, network.bounds)).toBeNull();
    expect(validateGoogleRoutePath([
      route.path[0],
      { lat: 0, lng: 0 },
      route.path.at(-1)!,
    ], route, network.bounds)).toBeNull();
    expect(validateGoogleRoutePath([
      route.path[0],
      { lat: Number.NaN, lng: route.path[0].lng },
      route.path.at(-1)!,
    ], route, network.bounds)).toBeNull();
  });

  it("coalesces duplicate edge requests, bounds concurrency, and reuses results across scenarios", async () => {
    const network = createAuthoredNetworkProjection(
      SANDTON_ROSEBANK_V1_NETWORK,
      SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
    );
    const coordinator = new RouteRequestCoordinator(1, 1_000);
    const resolvers: Array<() => void> = [];
    let calls = 0;
    let active = 0;
    let peak = 0;
    const compute = async (request: google.maps.routes.ComputeRoutesRequest) => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => resolvers.push(resolve));
      active -= 1;
      return { routes: [{ path: [request.origin, request.destination] as readonly MapCoordinate[] }] };
    };
    const first = coordinator.load(network.networkFingerprint, network.routes[0], network.bounds, compute);
    const duplicate = coordinator.load(network.networkFingerprint, network.routes[0], network.bounds, compute);
    const secondEdge = coordinator.load(network.networkFingerprint, network.routes[1], network.bounds, compute);
    expect(duplicate).toBe(first);
    expect(calls).toBe(1);
    resolvers.shift()?.();
    await first;
    await vi.waitFor(() => expect(calls).toBe(2));
    resolvers.shift()?.();
    await secondEdge;
    const scenarioSwitchReuse = coordinator.load(network.networkFingerprint, network.routes[0], network.bounds, compute);
    expect(scenarioSwitchReuse).toBe(first);
    expect(calls).toBe(2);
    expect(peak).toBe(1);
  });

  it("coalesces Strict Mode Routes-library ownership without adding another loader", async () => {
    let imports = 0;
    const library = { Route: { computeRoutes: vi.fn() } } as unknown as google.maps.RoutesLibrary;
    const importer = async () => {
      imports += 1;
      return library;
    };
    const first = loadGoogleRoutesLibrary(importer);
    const duplicate = loadGoogleRoutesLibrary(importer);
    expect(duplicate).toBe(first);
    expect(await first).toBe(library);
    expect(imports).toBe(1);
  });

  it("falls back independently for empty, rejected, timed-out, and late route work", async () => {
    const network = createAuthoredNetworkProjection(
      SANDTON_ROSEBANK_V1_NETWORK,
      SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
    );
    const coordinator = new RouteRequestCoordinator(3, 20);
    const success = coordinator.load(network.networkFingerprint, network.routes[0], network.bounds, async (request) => ({
      routes: [{ path: [request.origin, {
        lat: ((request.origin as MapCoordinate).lat + (request.destination as MapCoordinate).lat) / 2,
        lng: ((request.origin as MapCoordinate).lng + (request.destination as MapCoordinate).lng) / 2,
      }, request.destination] as readonly MapCoordinate[] }],
    }));
    const empty = coordinator.load(network.networkFingerprint, network.routes[1], network.bounds, async () => ({ routes: [] }));
    const rejected = coordinator.load(network.networkFingerprint, network.routes[2], network.bounds, async () => {
      throw new Error("private upstream detail");
    });
    const late = coordinator.load(network.networkFingerprint, network.routes[3], network.bounds, async () =>
      new Promise(() => undefined));
    const [successfulPath, emptyPath, rejectedPath, latePath] = await Promise.all([success, empty, rejected, late]);
    expect(successfulPath).toHaveLength(3);
    expect(emptyPath).toBeNull();
    expect(rejectedPath).toBeNull();
    expect(latePath).toBeNull();
    const summary = summarizePresentedRoutes(network.routes, new Map(successfulPath
      ? [[network.routes[0].edgeId, successfulPath]]
      : []));
    expect(summary.googleCount).toBe(1);
    expect(summary.fallbackCount).toBe(network.routes.length - 1);
    expect(summary.roadFollowingCount).toBe(1);
    expect(summary.routes[0].source).toBe("GOOGLE");
    expect(summary.routes[1].source).toBe("AUTHORED");
  });

  it("maps authoritative normalized progress onto cumulative presentation length without mutation", () => {
    const path = Object.freeze([
      Object.freeze({ lat: 0, lng: 0 }),
      Object.freeze({ lat: 0, lng: 3 }),
      Object.freeze({ lat: 4, lng: 3 }),
    ]);
    expect(interpolatePresentationPath(path, 0)).toEqual({ lat: 0, lng: 0 });
    expect(interpolatePresentationPath(path, 3 / 7)).toEqual({ lat: 0, lng: 3 });
    expect(interpolatePresentationPath(path, 1)).toEqual({ lat: 4, lng: 3 });

    const model = createReplayModel(runA);
    let original = model.projectFrame(0);
    let vehicle = original.vehicles.find((candidate) =>
      candidate.activeEdgeProgress !== undefined &&
      candidate.activeEdgeProgress > 0 && candidate.activeEdgeProgress < 1);
    for (let index = 1; !vehicle && index < model.frameCount; index += 1) {
      original = model.projectFrame(index);
      vehicle = original.vehicles.find((candidate) =>
        candidate.activeEdgeProgress !== undefined &&
        candidate.activeEdgeProgress > 0 && candidate.activeEdgeProgress < 1);
    }
    if (!vehicle?.activeEdgeId || vehicle.activeEdgeProgress === undefined) {
      throw new Error("Expected authoritative active-edge progress.");
    }
    const route = model.routes.find((candidate) => candidate.edgeId === vehicle.activeEdgeId)!;
    const enrichedPath = Object.freeze([
      route.path[0],
      Object.freeze({
        lat: (route.path[0].lat + route.path.at(-1)!.lat) / 2 + 0.0001,
        lng: (route.path[0].lng + route.path.at(-1)!.lng) / 2 + 0.0001,
      }),
      route.path.at(-1)!,
    ]);
    const summary = summarizePresentedRoutes(model.routes, new Map([[route.edgeId, enrichedPath]]));
    const projected = projectFrameOntoPresentedRoutes(original, summary.routes);
    const projectedVehicle = projected.vehicles.find((candidate) => candidate.id === vehicle.id)!;
    expect(projectedVehicle.activeEdgeProgress).toBe(vehicle.activeEdgeProgress);
    expect(projectedVehicle.position).not.toEqual(vehicle.position);
    expect(original.vehicles.find((candidate) => candidate.id === vehicle.id)?.position).toBe(vehicle.position);
    expect(runA.preparedInput.fingerprint).toBe(GOLDEN.inputA);
    expect(runA.eventLedger.fingerprint).toBe(GOLDEN.ledgerA);
    expect(runA.verifiedResult.resultFingerprint).toBe(GOLDEN.resultA);
  });

  it("renders distinct route semantics, bounded readiness, and a text legend without trusted recomputation", () => {
    const component = readFileSync(resolve("src/features/stress-lab/map/StressLabMap.tsx"), "utf8");
    const routePresentation = readFileSync(resolve("src/features/stress-lab/map/route-presentation.ts"), "utf8");
    const css = readFileSync(resolve("src/features/stress-lab/map/stress-lab-map.module.css"), "utf8");
    const html = renderToStaticMarkup(createElement(StressLabMap, { application }));
    expect(html).toContain("Route presentation legend");
    expect(html).toContain("Baseline network");
    expect(html).toContain("Scenario A active");
    expect(html).toContain("Scenario B active");
    expect(html).toContain("Selected entity");
    expect(html).toContain("Failure evidence");
    expect(html).toContain("Authored fallback");
    expect(ROUTE_SEMANTIC_PALETTE).toEqual({
      baseline: "rgba(100, 116, 139, 0.26)",
      scenarioA: "#67E8F9",
      scenarioB: "#A78BFA",
      failure: "#F59E0B",
      failedVehicle: "#FB7185",
      selectedHalo: "rgba(255, 255, 255, 0.72)",
      evidencePass: "#6EE7B7",
    });
    expect(css).toContain("stroke-dasharray");
    expect(component).toContain("Google road geometry loading");
    expect(component).toContain("Google road geometry ready");
    expect(component).toContain('const onReady = useCallback(() => setReadiness');
    expect(component).toContain("summary.googleCount === 0");
    expect(component).toContain('? "ROUTES_UNAVAILABLE"');
    expect(component).toContain('aria-label="Inspect committed entity"');
    expect(component).toContain('value={`VEHICLE:${candidate.id}`}');
    expect(`${component}\n${routePresentation}`).not.toMatch(/distanceMeters|durationMillis|trafficModel|departureTime|arrivalTime/u);
  });

  it("keeps one loader surface and excludes legacy APIs, persistence, unsafe HTML, keys, and trusted KPI constants", () => {
    const component = readFileSync(resolve("src/features/stress-lab/map/StressLabMap.tsx"), "utf8");
    const projection = readFileSync(resolve("src/features/stress-lab/map/replay-projection.ts"), "utf8");
    const routePresentation = readFileSync(resolve("src/features/stress-lab/map/route-presentation.ts"), "utf8");
    expect(component.match(/<APIProvider/gu)).toHaveLength(1);
    expect(component).toContain('libraries={[...GOOGLE_LIBRARIES]}');
    expect(`${component}\n${routePresentation}`).not.toMatch(/DirectionsService|DirectionsRenderer|TrafficLayer|PlacesService|Geocoder|fetch\s*\(/u);
    expect(`${component}\n${routePresentation}`).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.open/u);
    expect(component).not.toMatch(/dangerouslySetInnerHTML|innerHTML|Math\.random|Date\.now|new Date/u);
    expect(projection).not.toMatch(/Math\.random|Date\.now|new Date|localeCompare/u);
    expect(`${component}\n${projection}\n${routePresentation}`).not.toMatch(/37_799|31_665|1_050|7_633|7_648/u);
    expect(component).not.toMatch(/console\.(?:log|info|warn|error)/u);
    expect(component).toContain("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
    expect(component).not.toContain("AIza");
  });
});
