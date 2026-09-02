"use client";

import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  Polyline,
  RenderingType,
  useApiIsLoaded,
  useMap,
} from "@vis.gl/react-google-maps";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { StressLabApplicationState } from "@/application/stress-lab-ports";
import {
  SANDTON_ROSEBANK_V1_NETWORK,
  SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
} from "@/data/scenarios/sandton-rosebank-v1";
import type { ScenarioSlot } from "@/domain/stress-lab/types";
import { ReplayClock, type ReplaySpeed } from "./replay-clock";
import {
  createAuthoredNetworkProjection,
  createReplayModel,
  nearestReplayFrameIndex,
  StressLabMapProjectionError,
  type AuthoredNetworkProjection,
  type MapCoordinate,
  type ReplayFrameProjection,
  type ReplayModel,
  type ReplayPassengerProjection,
  type ReplayVehicleProjection,
} from "./replay-projection";
import {
  pageRouteRequestCoordinator,
  loadGoogleRoutesLibrary,
  projectFrameOntoPresentedRoutes,
  ROUTE_SEMANTIC_PALETTE,
  summarizePresentedRoutes,
  type PresentedRoute,
  type RoutePresentationSummary,
} from "./route-presentation";
import styles from "./stress-lab-map.module.css";

export type GoogleMapReadiness =
  | "CONFIG_ERROR"
  | "LOADING"
  | "READY"
  | "LOAD_ERROR"
  | "AUTH_ERROR";

type RoutesReadiness =
  | "ROUTES_LOADING"
  | "ROUTES_READY"
  | "ROUTES_PARTIAL_FALLBACK"
  | "ROUTES_CONFIGURATION_REQUIRED"
  | "ROUTES_UNAVAILABLE"
  | "AUTHORED_FALLBACK";

type LayerKey = "network" | "vehicles" | "demand" | "passengers" | "failure";
type SelectedEntity =
  | { readonly kind: "VEHICLE"; readonly id: string }
  | { readonly kind: "PASSENGER"; readonly id: string }
  | null;

const GOOGLE_LIBRARIES = Object.freeze(["maps", "marker"]);
const DEFAULT_LAYERS: Readonly<Record<LayerKey, boolean>> = Object.freeze({
  network: true,
  vehicles: true,
  demand: true,
  passengers: false,
  failure: true,
});
const BASELINE_NETWORK = createAuthoredNetworkProjection(
  SANDTON_ROSEBANK_V1_NETWORK,
  SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
);
const AUTHORED_ROUTE_SUMMARY = summarizePresentedRoutes(BASELINE_NETWORK.routes, new Map());
const FALLBACK_DASH: readonly google.maps.IconSequence[] = Object.freeze([{
  icon: Object.freeze({
    path: "M 0,-1 0,1",
    strokeColor: "rgba(148, 163, 184, 0.66)",
    strokeOpacity: 0.8,
    strokeWeight: 1.5,
  }),
  offset: "0",
  repeat: "10px",
}]);

function safeReplayModel(
  application: StressLabApplicationState,
  slot: ScenarioSlot,
): { readonly model: ReplayModel | null; readonly error: string } {
  const runId = application.currentRunIds[slot];
  const run = runId ? application.runs[runId] : undefined;
  if (!run) return { model: null, error: "" };
  try {
    return { model: createReplayModel(run), error: "" };
  } catch (error) {
    if (error instanceof StressLabMapProjectionError) {
      return {
        model: null,
        error: `Committed replay cannot be projected safely at ${error.path}.`,
      };
    }
    return { model: null, error: "Committed replay cannot be projected safely." };
  }
}

function routeClass(active: boolean, selected: boolean, slot: ScenarioSlot | null): string {
  if (selected) return slot === "B" ? styles.fallbackSelectedB : styles.fallbackSelectedA;
  if (active) return slot === "B" ? styles.fallbackActiveB : styles.fallbackActiveA;
  return styles.fallbackRoute;
}

function AuthoredNetworkFallback({
  network,
  model,
  frame,
  layers,
  selected,
}: {
  readonly network: AuthoredNetworkProjection;
  readonly model: ReplayModel | null;
  readonly frame: ReplayFrameProjection | null;
  readonly layers: Readonly<Record<LayerKey, boolean>>;
  readonly selected: SelectedEntity;
}) {
  const { north, south, east, west } = network.bounds;
  const project = (position: MapCoordinate) => ({
    x: ((position.lng - west) / Math.max(0.000001, east - west)) * 880 + 60,
    y: ((north - position.lat) / Math.max(0.000001, north - south)) * 440 + 30,
  });
  const activeEdges = new Set(frame?.vehicles.flatMap((vehicle) => vehicle.activeEdgeId ?? []) ?? []);
  const selectedVehicle = selected?.kind === "VEHICLE"
    ? frame?.vehicles.find((vehicle) => vehicle.id === selected.id)
    : undefined;
  return (
    <div className={styles.fallback} data-testid="authored-network-fallback">
      <svg
        viewBox="0 0 1000 500"
        role="img"
        aria-label={frame ? `Authored network replay for Scenario ${frame.scenarioSlot}` : "Authored baseline network without a committed replay"}
      >
        {layers.network
          ? network.routes.map((route) => {
              const active = activeEdges.has(route.edgeId);
              const isSelected = selectedVehicle?.activeEdgeId === route.edgeId;
              return (
                <polyline
                  key={route.edgeId}
                  points={route.path.map((point) => {
                    const projected = project(point);
                    return `${projected.x},${projected.y}`;
                  }).join(" ")}
                  className={routeClass(active, isSelected, frame?.scenarioSlot ?? null)}
                />
              );
            })
          : null}
        {layers.demand && model && frame
          ? model.demand.map((demand) => {
              const point = project(demand.position);
              return (
                <g key={demand.zoneId}>
                  <circle cx={point.x} cy={point.y} r={Math.min(22, 7 + demand.requestCount / 5)} className={styles.fallbackDemand} />
                  <text x={point.x + 13} y={point.y - 11}>{demand.zoneName} · {demand.requestCount}</text>
                </g>
              );
            })
          : null}
        {layers.vehicles && frame
          ? frame.vehicles.map((vehicle) => {
              const point = project(vehicle.position);
              return (
                <g key={vehicle.id}>
                  <circle cx={point.x} cy={point.y} r="6" className={vehicle.failed ? styles.fallbackFailed : styles.fallbackVehicle} />
                  <text x={point.x + 9} y={point.y + 4}>{vehicle.id}</text>
                </g>
              );
            })
          : null}
        {layers.failure && frame?.failure ? (() => {
          const point = project(frame.failure.position);
          return <path d={`M ${point.x - 9} ${point.y - 9} L ${point.x + 9} ${point.y + 9} M ${point.x + 9} ${point.y - 9} L ${point.x - 9} ${point.y + 9}`} className={styles.fallbackFailure} />;
        })() : null}
      </svg>
      <span>Authored SVG fallback · deterministic evidence remains valid</span>
    </div>
  );
}

function FitCommittedBounds({ bounds, identity, resetGeneration }: {
  readonly bounds: google.maps.LatLngBoundsLiteral;
  readonly identity: string;
  readonly resetGeneration: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.fitBounds(bounds, 56);
  }, [bounds, identity, map, resetGeneration]);
  return null;
}

function GoogleRoutesGeometry({ network, onGeometry, onUnavailable }: {
  readonly network: AuthoredNetworkProjection;
  readonly onGeometry: (summary: RoutePresentationSummary) => void;
  readonly onUnavailable: () => void;
}) {
  const apiLoaded = useApiIsLoaded();
  const generation = useRef(0);
  useEffect(() => {
    if (!apiLoaded) return;
    generation.current += 1;
    const current = generation.current;
    void loadGoogleRoutesLibrary()
      .then((routesLibrary) => {
        const compute = (request: google.maps.routes.ComputeRoutesRequest) =>
          routesLibrary.Route.computeRoutes(request);
        return Promise.all(network.routes.map((route) =>
          pageRouteRequestCoordinator.load(network.networkFingerprint, route, network.bounds, compute)));
      })
      .then((paths) => {
        if (generation.current !== current) return;
        const googlePaths = new Map<string, readonly MapCoordinate[]>();
        paths.forEach((path, index) => {
          if (path) googlePaths.set(network.routes[index].edgeId, path);
        });
        onGeometry(summarizePresentedRoutes(network.routes, googlePaths));
      })
      .catch(() => {
        if (generation.current === current) onUnavailable();
      });
    return () => {
      generation.current += 1;
    };
  }, [apiLoaded, network, onGeometry, onUnavailable]);
  return null;
}

function RouteLayers({ routes, frame, selected }: {
  readonly routes: readonly PresentedRoute[];
  readonly frame: ReplayFrameProjection | null;
  readonly selected: SelectedEntity;
}) {
  const activeEdges = new Set(frame?.vehicles.flatMap((vehicle) => vehicle.activeEdgeId ?? []) ?? []);
  const selectedVehicle = selected?.kind === "VEHICLE"
    ? frame?.vehicles.find((vehicle) => vehicle.id === selected.id)
    : undefined;
  const activeColor = frame?.scenarioSlot === "B"
    ? ROUTE_SEMANTIC_PALETTE.scenarioB
    : ROUTE_SEMANTIC_PALETTE.scenarioA;
  return (
    <>
      {routes.map((route) => (
        <Polyline
          key={`baseline-${route.edgeId}`}
          path={[...route.path]}
          strokeColor={ROUTE_SEMANTIC_PALETTE.baseline}
          strokeOpacity={route.source === "GOOGLE" ? 0.74 : 0}
          strokeWeight={2}
          icons={route.source === "AUTHORED" ? [...FALLBACK_DASH] : undefined}
          clickable={false}
        />
      ))}
      {frame ? routes.filter((route) => activeEdges.has(route.edgeId)).map((route) => (
        <Polyline
          key={`active-${route.edgeId}`}
          path={[...route.path]}
          strokeColor={activeColor}
          strokeOpacity={0.72}
          strokeWeight={4}
          clickable={false}
        />
      )) : null}
      {selectedVehicle?.activeEdgeId ? routes
        .filter((route) => route.edgeId === selectedVehicle.activeEdgeId)
        .flatMap((route) => [
          <Polyline key={`selected-halo-${route.edgeId}`} path={[...route.path]} strokeColor={ROUTE_SEMANTIC_PALETTE.selectedHalo} strokeOpacity={0.7} strokeWeight={8} clickable={false} />,
          <Polyline key={`selected-${route.edgeId}`} path={[...route.path]} strokeColor={activeColor} strokeOpacity={1} strokeWeight={5} clickable={false} />,
        ]) : null}
    </>
  );
}

function GoogleMapCanvas({
  apiKey,
  mapId,
  network,
  model,
  frame,
  routes,
  layers,
  selected,
  resetGeneration,
  onReady,
  onLoadError,
  onSelect,
  onGeometry,
  onRoutesUnavailable,
}: {
  readonly apiKey: string;
  readonly mapId: string;
  readonly network: AuthoredNetworkProjection;
  readonly model: ReplayModel | null;
  readonly frame: ReplayFrameProjection | null;
  readonly routes: readonly PresentedRoute[];
  readonly layers: Readonly<Record<LayerKey, boolean>>;
  readonly selected: SelectedEntity;
  readonly resetGeneration: number;
  readonly onReady: () => void;
  readonly onLoadError: () => void;
  readonly onSelect: (entity: SelectedEntity) => void;
  readonly onGeometry: (summary: RoutePresentationSummary) => void;
  readonly onRoutesUnavailable: () => void;
}) {
  return (
    <APIProvider apiKey={apiKey} libraries={[...GOOGLE_LIBRARIES]} authReferrerPolicy="origin" solutionChannel="" onError={onLoadError}>
      <GoogleRoutesGeometry network={network} onGeometry={onGeometry} onUnavailable={onRoutesUnavailable} />
      <GoogleMap
        id="maav-stress-lab-map"
        mapId={mapId}
        className={styles.googleMap}
        defaultBounds={{ ...network.bounds, padding: 56 }}
        colorScheme="DARK"
        renderingType={RenderingType.VECTOR}
        gestureHandling="cooperative"
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl
        reuseMaps
        onTilesLoaded={onReady}
      >
        <FitCommittedBounds bounds={network.bounds} identity={model?.runId ?? network.networkFingerprint} resetGeneration={resetGeneration} />
        {layers.network ? <RouteLayers routes={routes} frame={frame} selected={selected} /> : null}
        {layers.demand && model && frame ? model.demand.map((demand) => (
          <AdvancedMarker key={`demand-${demand.zoneId}`} position={demand.position} title={`${demand.zoneName}: ${demand.requestCount} synthetic requests`} zIndex={2}>
            <span className={styles.demandMarker}>{demand.requestCount}</span>
          </AdvancedMarker>
        )) : null}
        {layers.passengers && frame ? frame.passengers
          .filter((passenger) => passenger.state !== "NOT_ARRIVED" && passenger.state !== "SERVED")
          .map((passenger) => (
            <AdvancedMarker key={passenger.id} position={passenger.position} title={`${passenger.id}: ${passenger.state}`} clickable onClick={() => onSelect({ kind: "PASSENGER", id: passenger.id })} zIndex={3}>
              <span className={styles.passengerMarker} />
            </AdvancedMarker>
          )) : null}
        {layers.vehicles && frame ? frame.vehicles.map((vehicle) => (
          <AdvancedMarker key={vehicle.id} position={vehicle.position} title={`${vehicle.id}: ${vehicle.state}, ${vehicle.occupancy}/${vehicle.capacity} occupied`} clickable onClick={() => onSelect({ kind: "VEHICLE", id: vehicle.id })} zIndex={vehicle.failed ? 8 : 5}>
            <Pin
              background={vehicle.failed ? ROUTE_SEMANTIC_PALETTE.failedVehicle : frame.scenarioSlot === "A" ? ROUTE_SEMANTIC_PALETTE.scenarioA : ROUTE_SEMANTIC_PALETTE.scenarioB}
              borderColor="#091015"
              glyphColor="#091015"
            />
          </AdvancedMarker>
        )) : null}
        {layers.failure && frame?.failure ? (
          <AdvancedMarker position={frame.failure.position} title={`${frame.failure.vehicleId} failed at ${frame.displayTime}`} clickable onClick={() => onSelect({ kind: "VEHICLE", id: frame.failure!.vehicleId })} zIndex={12}>
            <span className={styles.failureMarker} aria-hidden="true">!</span>
          </AdvancedMarker>
        ) : null}
      </GoogleMap>
    </APIProvider>
  );
}

function GoogleAuthBoundary({ children, onAuthFailure }: {
  readonly children: ReactNode;
  readonly onAuthFailure: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    const target = window as typeof window & { gm_authFailure?: () => void };
    const prior = target.gm_authFailure;
    const installed = () => {
      if (generation.current === current) onAuthFailure();
    };
    target.gm_authFailure = installed;
    queueMicrotask(() => {
      if (generation.current === current) setArmed(true);
    });
    return () => {
      generation.current += 1;
      if (target.gm_authFailure === installed) target.gm_authFailure = prior;
    };
  }, [onAuthFailure]);
  return armed ? children : null;
}

function EntityInspector({ selected, frame, onSelect }: {
  readonly selected: SelectedEntity;
  readonly frame: ReplayFrameProjection | null;
  readonly onSelect: (entity: SelectedEntity) => void;
}) {
  let vehicle: ReplayVehicleProjection | undefined;
  let passenger: ReplayPassengerProjection | undefined;
  if (selected?.kind === "VEHICLE") vehicle = frame?.vehicles.find((candidate) => candidate.id === selected.id);
  else if (selected?.kind === "PASSENGER") passenger = frame?.passengers.find((candidate) => candidate.id === selected.id);
  const inspectablePassengers = frame?.passengers.filter((candidate) => candidate.state !== "NOT_ARRIVED" && candidate.state !== "SERVED") ?? [];
  const selectedValue = selected ? `${selected.kind}:${selected.id}` : "";
  return (
    <aside className={styles.inspector} aria-label="Selected replay entity">
      <span className={styles.kicker}>INSPECTOR</span>
      {frame ? (
        <label className={styles.inspectorPicker}>
          <span>Committed entity</span>
          <select
            aria-label="Inspect committed entity"
            value={selectedValue}
            onChange={(event) => {
              const [kind, id] = event.target.value.split(":", 2);
              onSelect(kind === "VEHICLE" || kind === "PASSENGER" ? { kind, id } : null);
            }}
          >
            <option value="">Choose an entity</option>
            <optgroup label="Vehicles">
              {frame.vehicles.map((candidate) => <option key={candidate.id} value={`VEHICLE:${candidate.id}`}>{candidate.id} · {candidate.state}</option>)}
            </optgroup>
            {inspectablePassengers.length > 0 ? (
              <optgroup label="Active passengers">
                {inspectablePassengers.map((candidate) => <option key={candidate.id} value={`PASSENGER:${candidate.id}`}>{candidate.id} · {candidate.state}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
      ) : null}
      {vehicle ? (
        <>
          <strong>{vehicle.id}</strong>
          <dl>
            <div><dt>State</dt><dd>{vehicle.state}</dd></div>
            <div><dt>Occupancy</dt><dd>{vehicle.occupancy} / {vehicle.capacity}</dd></div>
            <div><dt>Battery</dt><dd>{vehicle.batteryWh.toLocaleString("en-ZA")} Wh</dd></div>
            <div><dt>Reserve policy</dt><dd>{vehicle.minimumReserveBasisPoints} bp</dd></div>
            <div><dt>Network zone</dt><dd>{vehicle.currentZoneId}</dd></div>
          </dl>
        </>
      ) : passenger ? (
        <>
          <strong>{passenger.id}</strong>
          <dl>
            <div><dt>State</dt><dd>{passenger.state}</dd></div>
            <div><dt>Request</dt><dd>{passenger.requestSecond} s</dd></div>
            <div><dt>Origin</dt><dd>{passenger.originZoneId}</dd></div>
            <div><dt>Destination</dt><dd>{passenger.destinationZoneId}</dd></div>
            <div><dt>Vehicle</dt><dd>{passenger.assignedVehicleId ?? "Unassigned"}</dd></div>
          </dl>
        </>
      ) : <p>{frame ? "Select a vehicle or enable the passenger layer to inspect committed state." : "No committed replay. Configure and run a scenario to publish dynamic evidence."}</p>}
    </aside>
  );
}

function SemanticLegend() {
  return (
    <aside className={styles.routeLegend} aria-label="Route presentation legend">
      <span className={styles.kicker}>ROUTE SEMANTICS</span>
      <ul>
        <li><i className={styles.legendBaseline} />Baseline network</li>
        <li><i className={styles.legendA} />Scenario A active</li>
        <li><i className={styles.legendB} />Scenario B active</li>
        <li><i className={styles.legendSelected} />Selected entity</li>
        <li><i className={styles.legendFailure} />Failure evidence</li>
        <li><i className={styles.legendFallback} />Authored fallback</li>
      </ul>
    </aside>
  );
}

export function StressLabMap({ application, onReadinessChange }: {
  readonly application: StressLabApplicationState;
  readonly onReadinessChange?: (status: GoogleMapReadiness) => void;
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "";
  const configurationPresent = apiKey.length > 0 && mapId.length > 0;
  const modelA = useMemo(() => safeReplayModel(application, "A"), [application]);
  const modelB = useMemo(() => safeReplayModel(application, "B"), [application]);
  const models = useMemo(() => ({ A: modelA.model, B: modelB.model }), [modelA.model, modelB.model]);
  const [selectedSlot, setSelectedSlot] = useState<ScenarioSlot>("A");
  const model = models[selectedSlot];
  const [clock] = useState(() => new ReplayClock(model?.frameCount ?? 0));
  const clockState = useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(null);
  const [readiness, setReadiness] = useState<GoogleMapReadiness>(configurationPresent ? "LOADING" : "CONFIG_ERROR");
  const [routeSummary, setRouteSummary] = useState<RoutePresentationSummary>(AUTHORED_ROUTE_SUMMARY);
  const [routesReadiness, setRoutesReadiness] = useState<RoutesReadiness>(configurationPresent ? "ROUTES_LOADING" : "ROUTES_CONFIGURATION_REQUIRED");
  const [resetGeneration, setResetGeneration] = useState(0);
  const priorModelIdentity = useRef<string | null>(null);

  useEffect(() => {
    const identity = model?.runId ?? null;
    if (identity !== priorModelIdentity.current) {
      priorModelIdentity.current = identity;
      clock.replaceFrames(model?.frameCount ?? 0, 0);
      setSelectedEntity(null);
    }
  }, [clock, model]);
  useEffect(() => () => clock.dispose(), [clock]);
  useEffect(() => onReadinessChange?.(readiness), [onReadinessChange, readiness]);
  useEffect(() => {
    if (!configurationPresent || readiness !== "LOADING") return;
    const timeout = setTimeout(() => setReadiness("LOAD_ERROR"), 15_000);
    return () => clearTimeout(timeout);
  }, [configurationPresent, readiness]);
  useEffect(() => {
    if (readiness !== "READY" || routesReadiness !== "ROUTES_LOADING") return;
    const timeout = setTimeout(() => setRoutesReadiness("ROUTES_UNAVAILABLE"), 12_000);
    return () => clearTimeout(timeout);
  }, [readiness, routesReadiness]);

  const authoredFrame = model && clockState.frameCount > 0 ? model.projectFrame(Math.min(clockState.cursor, model.frameCount - 1)) : null;
  const frame = authoredFrame ? projectFrameOntoPresentedRoutes(authoredFrame, routeSummary.routes) : null;
  const projectionError = modelA.error || modelB.error;
  const switchScenario = (slot: ScenarioSlot) => {
    const target = models[slot];
    if (!target || slot === selectedSlot) return;
    const targetSecond = frame?.atSecond ?? target.startSecond;
    setSelectedSlot(slot);
    priorModelIdentity.current = target.runId;
    clock.replaceFrames(target.frameCount, nearestReplayFrameIndex(target.timestamps, targetSecond));
    setSelectedEntity(null);
    setResetGeneration((value) => value + 1);
  };
  const setLayer = (layer: LayerKey, value: boolean) => setLayers((current) => Object.freeze({ ...current, [layer]: value }));
  const onAuthFailure = useCallback(() => {
    setReadiness("AUTH_ERROR");
    setRoutesReadiness("AUTHORED_FALLBACK");
  }, []);
  const onLoadError = useCallback(() => {
    setReadiness("LOAD_ERROR");
    setRoutesReadiness("AUTHORED_FALLBACK");
  }, []);
  const onReady = useCallback(() => setReadiness((current) => current === "AUTH_ERROR" ? current : "READY"), []);
  const onGeometry = useCallback((summary: RoutePresentationSummary) => {
    setRouteSummary(summary);
    setRoutesReadiness(
      summary.googleCount === 0
        ? "ROUTES_UNAVAILABLE"
        : summary.fallbackCount === 0
          ? "ROUTES_READY"
          : "ROUTES_PARTIAL_FALLBACK",
    );
  }, []);
  const onRoutesUnavailable = useCallback(() => setRoutesReadiness("ROUTES_UNAVAILABLE"), []);

  const readinessMessage: Record<GoogleMapReadiness, string> = {
    CONFIG_ERROR: "Google Maps configuration is unavailable. Deterministic evidence remains valid.",
    LOADING: "Loading the Google presentation surface…",
    READY: "Google Maps ready · authored evidence overlay",
    LOAD_ERROR: "Google Maps could not load. Deterministic evidence remains valid.",
    AUTH_ERROR: "Google Maps authorization was rejected. Deterministic evidence remains valid.",
  };
  const routeReadinessMessage: Record<RoutesReadiness, string> = {
    ROUTES_LOADING: "Google road geometry loading",
    ROUTES_READY: "Google road geometry ready",
    ROUTES_PARTIAL_FALLBACK: `Google road geometry · ${routeSummary.googleCount}/${routeSummary.routes.length} · ${routeSummary.fallbackCount} authored fallbacks`,
    ROUTES_CONFIGURATION_REQUIRED: "Authored geometry fallback",
    ROUTES_UNAVAILABLE: "Authored geometry fallback",
    AUTHORED_FALLBACK: "Authored geometry fallback",
  };
  const timelineDisabled = !model || !frame;

  return (
    <section className={styles.mapHero} aria-labelledby="map-title" data-testid="persistent-map-hero">
      <header className={styles.mapHeader}>
        <div>
          <span className={styles.kicker}>{model ? `COMMITTED RUN · ${model.runId}` : "IMMUTABLE BASELINE TOPOLOGY"}</span>
          <h2 id="map-title">Authored Sandton–Rosebank replay</h2>
          <p>Synthetic simulation · No live fleet control · Google Maps is presentation only</p>
        </div>
        <div className={styles.scenarioSelector} aria-label="Replay scenario">
          {(["A", "B"] as const).map((slot) => (
            <button key={slot} type="button" className={slot === selectedSlot ? styles.selectedScenario : ""} aria-pressed={slot === selectedSlot} disabled={!models[slot]} onClick={() => switchScenario(slot)}>
              Scenario {slot}
            </button>
          ))}
        </div>
      </header>

      <div className={styles.mapStage}>
        {configurationPresent ? (
          <GoogleAuthBoundary onAuthFailure={onAuthFailure}>
            <GoogleMapCanvas
              apiKey={apiKey}
              mapId={mapId}
              network={BASELINE_NETWORK}
              model={model}
              frame={frame}
              routes={routeSummary.routes}
              layers={layers}
              selected={selectedEntity}
              resetGeneration={resetGeneration}
              onReady={onReady}
              onLoadError={onLoadError}
              onSelect={setSelectedEntity}
              onGeometry={onGeometry}
              onRoutesUnavailable={onRoutesUnavailable}
            />
          </GoogleAuthBoundary>
        ) : null}
        {readiness !== "READY" ? <AuthoredNetworkFallback network={BASELINE_NETWORK} model={model} frame={frame} layers={layers} selected={selectedEntity} /> : null}
        <div className={`${styles.mapStatus} ${readiness === "AUTH_ERROR" || readiness === "LOAD_ERROR" || readiness === "CONFIG_ERROR" ? styles.mapStatusWarning : ""}`} role={readiness === "AUTH_ERROR" || readiness === "LOAD_ERROR" || readiness === "CONFIG_ERROR" ? "alert" : "status"}>
          <span aria-hidden="true" />{readinessMessage[readiness]}
        </div>
        <div className={styles.routeStatus} role="status" data-google-route-count={routeSummary.googleCount} data-road-following-route-count={routeSummary.roadFollowingCount}>
          {routeReadinessMessage[routesReadiness]}
        </div>
        {!frame ? <div className={styles.noReplay} role={projectionError ? "alert" : "status"}><strong>No committed replay</strong><span>{projectionError || "Configure and run a scenario to publish dynamic evidence."}</span></div> : null}

        <fieldset className={styles.layerControls}>
          <legend>Layers</legend>
          {(Object.keys(DEFAULT_LAYERS) as LayerKey[]).map((layer) => (
            <label key={layer}><input type="checkbox" checked={layers[layer]} disabled={!frame && layer !== "network"} onChange={(event) => setLayer(layer, event.currentTarget.checked)} />{layer}</label>
          ))}
        </fieldset>
        <SemanticLegend />
        <EntityInspector selected={selectedEntity} frame={frame} onSelect={setSelectedEntity} />

        <div className={styles.timeline} aria-disabled={timelineDisabled}>
          <div className={styles.timelineIdentity} aria-live="polite">
            <strong>{frame?.displayTime ?? "—:—:—"}</strong>
            <span>{model && frame ? `Frame ${frame.index + 1} / ${model.frameCount}` : "Replay unavailable"}</span>
            {frame?.failure ? <b>{frame.failure.vehicleId} · failure evidence active</b> : null}
          </div>
          <div className={styles.transportControls}>
            <button type="button" onClick={() => clock.restart()} disabled={timelineDisabled || clockState.cursor === 0}>Restart</button>
            <button type="button" onClick={() => clock.previous()} disabled={timelineDisabled || clockState.cursor === 0} aria-label="Previous committed frame">←</button>
            {clockState.playing ? <button type="button" onClick={() => clock.pause()} disabled={timelineDisabled}>Pause</button> : <button type="button" onClick={() => clock.play()} disabled={timelineDisabled || clockState.cursor === (model?.frameCount ?? 1) - 1}>Play</button>}
            <button type="button" onClick={() => clock.next()} disabled={timelineDisabled || clockState.cursor === (model?.frameCount ?? 1) - 1} aria-label="Next committed frame">→</button>
            <button type="button" onClick={() => {
              if (model?.failureSecond !== null && model?.failureSecond !== undefined) clock.seek(nearestReplayFrameIndex(model.timestamps, model.failureSecond));
            }} disabled={timelineDisabled || model?.failureSecond === null}>Jump to failure</button>
          </div>
          <label className={styles.scrubber}>
            <span>Exact committed snapshot</span>
            <input type="range" min={0} max={Math.max(0, (model?.frameCount ?? 1) - 1)} step={1} value={timelineDisabled ? 0 : clockState.cursor} disabled={timelineDisabled} onChange={(event) => clock.seek(Number(event.currentTarget.value))} aria-valuetext={frame && model ? `${frame.displayTime}, frame ${frame.index + 1} of ${model.frameCount}` : "No committed replay"} />
          </label>
          <label className={styles.speedControl}>
            <span>Replay speed</span>
            <select value={clockState.speed} disabled={timelineDisabled} onChange={(event) => clock.setSpeed(Number(event.currentTarget.value) as ReplaySpeed)}>
              <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
            </select>
          </label>
          <button type="button" className={styles.cameraButton} onClick={() => setResetGeneration((value) => value + 1)}>Reset camera</button>
        </div>
      </div>

      <footer className={styles.provenance}>
        <span>Authored deterministic network overlay</span>
        <code>NETWORK {BASELINE_NETWORK.networkFingerprint.slice(0, 24)}…</code>
        {model ? <><code>INPUT {model.inputFingerprint.slice(0, 24)}…</code><code>LEDGER {model.eventLedgerFingerprint.slice(0, 24)}…</code><code>RESULT {model.resultFingerprint.slice(0, 24)}…</code></> : null}
      </footer>
    </section>
  );
}
