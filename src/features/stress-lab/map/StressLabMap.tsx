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
  BusFront,
  Crosshair,
  Layers,
  Network,
  Pause,
  Play,
  Radar,
  RotateCcw,
  Route as RouteIcon,
  Search,
  StepBack,
  StepForward,
  TriangleAlert,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { StressLabApplicationState } from "@/application/stress-lab-ports";
import {
  SANDTON_ROSEBANK_V1_NETWORK,
  SANDTON_ROSEBANK_V1_NETWORK_FINGERPRINT,
} from "@/data/scenarios/sandton-rosebank-v1";
import type { ScenarioSlot } from "@/domain/stress-lab/types";
import type {
  ReplayAutoplayOutcome,
  ReplayAutoplayRequest,
} from "./replay-autoplay";
import { ReplayClock, type ReplaySpeed } from "./replay-clock";
import {
  createAuthoredNetworkProjection,
  createReplayModel,
  nearestReplayFrameIndex,
  StressLabMapProjectionError,
  summarizeReplayFrame,
  type AuthoredNetworkProjection,
  type MapCoordinate,
  type ReplayFrameProjection,
  type ReplayFrameStateCount,
  type ReplayFrameStateSummary,
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

export function shouldRenderAuthoredFallback(readiness: GoogleMapReadiness): boolean {
  return readiness === "CONFIG_ERROR" || readiness === "LOAD_ERROR" || readiness === "AUTH_ERROR";
}

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
const ENTITY_RESULT_LIMIT = 8;
const DEFAULT_LAYERS: Readonly<Record<LayerKey, boolean>> = Object.freeze({
  network: true,
  vehicles: true,
  demand: true,
  passengers: false,
  failure: true,
});
const LAYER_CONTROLS: readonly {
  readonly key: LayerKey;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = Object.freeze([
  Object.freeze({ key: "network", label: "Network routes", icon: Network }),
  Object.freeze({ key: "vehicles", label: "Vehicles", icon: BusFront }),
  Object.freeze({ key: "demand", label: "Demand", icon: Radar }),
  Object.freeze({ key: "passengers", label: "Passengers", icon: UsersRound }),
  Object.freeze({ key: "failure", label: "Failure evidence", icon: TriangleAlert }),
]);
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
              scale={0.78}
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

function InspectorEmptyState({ frame, slot, hasHistoricalRun }: {
  readonly frame: ReplayFrameProjection | null;
  readonly slot: ScenarioSlot;
  readonly hasHistoricalRun: boolean;
}) {
  const state = frame ? "FRAME_READY" : hasHistoricalRun ? "STALE" : "READY";
  const status = frame
    ? `SCENARIO ${frame.scenarioSlot} · ${frame.displayTime}`
    : hasHistoricalRun
      ? `SCENARIO ${slot} · EVIDENCE INVALIDATED`
      : "INSPECTOR READY";
  const title = frame
    ? "Select a committed entity"
    : hasHistoricalRun
      ? "Current replay cleared"
      : "No replay evidence available";
  const description = frame
    ? "Choose a vehicle or passenger to inspect this exact committed frame."
    : hasHistoricalRun
      ? `Run Scenario ${slot} again to inspect current evidence. Historical artifacts remain preserved.`
      : "Configure and run a scenario to publish inspectable vehicle and passenger evidence.";

  return (
    <div className={styles.inspectorEmpty} data-state={state}>
      <div className={styles.inspectorSignal} aria-hidden="true">
        <Crosshair size={22} strokeWidth={1.45} />
      </div>
      <div className={styles.inspectorEmptyCopy}>
        <span>{status}</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {!frame ? (
        <ul className={styles.inspectorCapabilities} aria-label="Inspectable evidence">
          <li>
            <BusFront size={14} strokeWidth={1.6} aria-hidden="true" />
            <span><strong>Vehicle telemetry</strong><small>State, occupancy and battery</small></span>
          </li>
          <li>
            <UsersRound size={14} strokeWidth={1.6} aria-hidden="true" />
            <span><strong>Passenger trace</strong><small>Assignment, origin and destination</small></span>
          </li>
          <li>
            <Network size={14} strokeWidth={1.6} aria-hidden="true" />
            <span><strong>Evidence provenance</strong><small>Current committed snapshot only</small></span>
          </li>
        </ul>
      ) : null}
      <div className={styles.inspectorSource}>
        <span aria-hidden="true" />
        {frame ? "Committed snapshot available" : hasHistoricalRun ? "Historical evidence preserved" : "Authored baseline active"}
      </div>
    </div>
  );
}

function displayState(state: string): string {
  return state.toLowerCase().replaceAll("_", " ");
}

function FrameStateBand({ label, total, states }: {
  readonly label: string;
  readonly total: number;
  readonly states: readonly ReplayFrameStateCount[];
}) {
  const visibleStates = states.filter((state) => state.count > 0);
  const accessibleSummary = visibleStates
    .map((state) => `${displayState(state.state)} ${state.count}`)
    .join(", ");
  return (
    <div className={styles.frameStateBand}>
      <div className={styles.frameStateBandHeader}>
        <span>{label}</span>
        <strong>{total}</strong>
      </div>
      <div className={styles.frameStateSegments} role="img" aria-label={`${label}: ${accessibleSummary}`}>
        {visibleStates.map((state) => (
          <i
            key={state.state}
            data-state={state.state}
            style={{ flexGrow: state.count }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className={styles.frameStateCounts} aria-hidden="true">
        {visibleStates.map((state) => (
          <span key={state.state}><i data-state={state.state} />{displayState(state.state)} <b>{state.count}</b></span>
        ))}
      </div>
    </div>
  );
}

function FrameStateOverview({ frame, summary }: {
  readonly frame: ReplayFrameProjection;
  readonly summary: ReplayFrameStateSummary;
}) {
  return (
    <section className={styles.frameOverview} aria-label={`Committed frame state at ${frame.displayTime}`} data-testid="frame-state-overview">
      <header>
        <div><span>FRAME STATE</span><strong>{frame.displayTime}</strong></div>
        <small>Scenario {frame.scenarioSlot}</small>
      </header>
      <FrameStateBand label="Vehicles" total={summary.vehicleTotal} states={summary.vehicles} />
      <FrameStateBand label="Passengers" total={summary.passengerTotal} states={summary.passengers} />
      <footer>Snapshot distribution · presentation only</footer>
    </section>
  );
}

interface EntitySearchResult {
  readonly kind: "VEHICLE" | "PASSENGER";
  readonly id: string;
  readonly state: string;
}

function EntityInspector({ selected, frame, slot, hasHistoricalRun, onSelect }: {
  readonly selected: SelectedEntity;
  readonly frame: ReplayFrameProjection | null;
  readonly slot: ScenarioSlot;
  readonly hasHistoricalRun: boolean;
  readonly onSelect: (entity: SelectedEntity) => void;
}) {
  const [query, setQuery] = useState("");
  let vehicle: ReplayVehicleProjection | undefined;
  let passenger: ReplayPassengerProjection | undefined;
  if (selected?.kind === "VEHICLE") vehicle = frame?.vehicles.find((candidate) => candidate.id === selected.id);
  else if (selected?.kind === "PASSENGER") passenger = frame?.passengers.find((candidate) => candidate.id === selected.id);
  const frameSummary = useMemo(() => frame ? summarizeReplayFrame(frame) : null, [frame]);
  const searchResults = useMemo<readonly EntitySearchResult[]>(() => {
    const normalized = query.trim().toUpperCase();
    if (!frame || normalized.length === 0) return Object.freeze([]);
    const results: EntitySearchResult[] = [];
    for (const candidate of frame.vehicles) {
      if (candidate.id.toUpperCase().includes(normalized)) {
        results.push(Object.freeze({ kind: "VEHICLE", id: candidate.id, state: candidate.state }));
        if (results.length === ENTITY_RESULT_LIMIT) return Object.freeze(results);
      }
    }
    for (const candidate of frame.passengers) {
      if (candidate.id.toUpperCase().includes(normalized)) {
        results.push(Object.freeze({ kind: "PASSENGER", id: candidate.id, state: candidate.state }));
        if (results.length === ENTITY_RESULT_LIMIT) break;
      }
    }
    return Object.freeze(results);
  }, [frame, query]);

  return (
    <aside className={styles.inspector} aria-label="Selected replay entity">
      <span className={styles.kicker}>INSPECTOR</span>
      {frame && frameSummary ? <FrameStateOverview frame={frame} summary={frameSummary} /> : null}
      {frame ? (
        <div className={styles.entityFinder}>
          <label htmlFor="replay-entity-search">Find entity</label>
          <div className={styles.entitySearchField}>
            <Search size={14} strokeWidth={1.7} aria-hidden="true" />
            <input
              id="replay-entity-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Vehicle or passenger ID"
              aria-label="Find vehicle or passenger by ID"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {query.trim() ? (
            <div className={styles.entitySearchResults}>
              <span className={styles.entityResultCount} aria-live="polite">
                {searchResults.length > 0 ? `${searchResults.length} matches shown · maximum ${ENTITY_RESULT_LIMIT}` : "No current entity matches"}
              </span>
              {searchResults.length > 0 ? (
                <ul>
                  {searchResults.map((result) => (
                    <li key={`${result.kind}:${result.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect({ kind: result.kind, id: result.id });
                          setQuery("");
                        }}
                      >
                        {result.kind === "VEHICLE"
                          ? <BusFront size={13} strokeWidth={1.65} aria-hidden="true" />
                          : <UsersRound size={13} strokeWidth={1.65} aria-hidden="true" />}
                        <span><strong>{result.id}</strong><small>{displayState(result.state)}</small></span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {vehicle ? (
        <section className={styles.entityDetail} aria-label={`Vehicle ${vehicle.id}`}>
          <header>
            <div><span>VEHICLE</span><strong>{vehicle.id}</strong></div>
            <button type="button" onClick={() => onSelect(null)} aria-label={`Close vehicle ${vehicle.id}`}><X size={13} aria-hidden="true" /></button>
          </header>
          <dl>
            <div><dt>State</dt><dd>{vehicle.state}</dd></div>
            <div><dt>Occupancy</dt><dd>{vehicle.occupancy} / {vehicle.capacity}</dd></div>
            <div><dt>Battery</dt><dd>{vehicle.batteryWh.toLocaleString("en-ZA")} Wh</dd></div>
            <div><dt>Reserve policy</dt><dd>{vehicle.minimumReserveBasisPoints} bp</dd></div>
            <div><dt>Network zone</dt><dd>{vehicle.currentZoneId}</dd></div>
          </dl>
        </section>
      ) : passenger ? (
        <section className={styles.entityDetail} aria-label={`Passenger ${passenger.id}`}>
          <header>
            <div><span>PASSENGER</span><strong>{passenger.id}</strong></div>
            <button type="button" onClick={() => onSelect(null)} aria-label={`Close passenger ${passenger.id}`}><X size={13} aria-hidden="true" /></button>
          </header>
          <dl>
            <div><dt>State</dt><dd>{passenger.state}</dd></div>
            <div><dt>Request</dt><dd>{passenger.requestSecond} s</dd></div>
            <div><dt>Origin</dt><dd>{passenger.originZoneId}</dd></div>
            <div><dt>Destination</dt><dd>{passenger.destinationZoneId}</dd></div>
            <div><dt>Vehicle</dt><dd>{passenger.assignedVehicleId ?? "Unassigned"}</dd></div>
          </dl>
        </section>
      ) : (
        <InspectorEmptyState frame={frame} slot={slot} hasHistoricalRun={hasHistoricalRun} />
      )}
    </aside>
  );
}

function SemanticLegend({ id, onClose }: {
  readonly id: string;
  readonly onClose: () => void;
}) {
  return (
    <aside id={id} className={styles.routeLegend} aria-label="Route presentation legend">
      <header className={styles.legendHeader}>
        <div>
          <span className={styles.kicker}>ROUTE SEMANTICS</span>
          <small>Presentation key</small>
        </div>
        <button type="button" className={styles.legendClose} onClick={onClose} aria-label="Close route semantics">
          <X size={14} aria-hidden="true" />
        </button>
      </header>
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

export function StressLabMap({
  application,
  onReadinessChange,
  actions,
  autoplayRequest = null,
  onAutoplaySettled,
}: {
  readonly application: StressLabApplicationState;
  readonly onReadinessChange?: (status: GoogleMapReadiness) => void;
  readonly actions?: ReactNode;
  readonly autoplayRequest?: ReplayAutoplayRequest | null;
  readonly onAutoplaySettled?: (
    request: ReplayAutoplayRequest,
    outcome: ReplayAutoplayOutcome,
  ) => void;
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
  const [routeLegendOpen, setRouteLegendOpen] = useState(false);
  const priorModelIdentity = useRef<string | null>(null);
  const lastPreparedAutoplayId = useRef<string | null>(null);
  const activeAutoplayRequest = useRef<ReplayAutoplayRequest | null>(null);

  const settleAutoplay = useCallback((outcome: ReplayAutoplayOutcome) => {
    const request = activeAutoplayRequest.current;
    if (!request) return;
    activeAutoplayRequest.current = null;
    onAutoplaySettled?.(request, outcome);
  }, [onAutoplaySettled]);

  useEffect(() => {
    const identity = model?.runId ?? null;
    if (identity !== priorModelIdentity.current) {
      priorModelIdentity.current = identity;
      clock.replaceFrames(model?.frameCount ?? 0, 0);
      setSelectedEntity(null);
    }
  }, [clock, model]);
  useEffect(() => {
    if (
      !autoplayRequest ||
      autoplayRequest.id === lastPreparedAutoplayId.current
    ) {
      return;
    }
    lastPreparedAutoplayId.current = autoplayRequest.id;
    const target = models[autoplayRequest.slot];
    if (!target || target.runId !== autoplayRequest.runId) {
      activeAutoplayRequest.current = autoplayRequest;
      settleAutoplay("RUN_UNAVAILABLE");
      return;
    }

    let cancelled = false;
    const frameRequest = requestAnimationFrame(() => {
      if (cancelled) return;
      activeAutoplayRequest.current = autoplayRequest;
      priorModelIdentity.current = target.runId;
      setSelectedSlot(autoplayRequest.slot);
      clock.replaceFrames(target.frameCount, 0);
      setSelectedEntity(null);
      setResetGeneration((value) => value + 1);

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        settleAutoplay("REDUCED_MOTION");
        return;
      }
      clock.play();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRequest);
    };
  }, [autoplayRequest, clock, models, settleAutoplay]);
  useEffect(() => {
    const request = activeAutoplayRequest.current;
    if (!request) return;
    const target = models[request.slot];
    if (!target || target.runId !== request.runId) {
      settleAutoplay("RUN_UNAVAILABLE");
      return;
    }
    if (
      selectedSlot === request.slot &&
      clockState.frameCount === target.frameCount &&
      clockState.cursor === target.frameCount - 1 &&
      !clockState.playing
    ) {
      settleAutoplay("COMPLETED");
    }
  }, [clockState, models, selectedSlot, settleAutoplay]);
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
  const hasHistoricalRun = Object.values(application.runs).some(
    (run) => run.scenarioRevisionRef.slot === selectedSlot,
  );
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

  const replayReadiness = frame
    ? `Scenario ${selectedSlot} committed replay`
    : projectionError
      ? "Replay unavailable"
      : "No committed replay";
  const readinessMessage: Record<GoogleMapReadiness, string> = {
    CONFIG_ERROR: `Google Maps configuration is unavailable · ${replayReadiness}. Deterministic evidence remains valid.`,
    LOADING: `Google Maps loading · ${replayReadiness}`,
    READY: `Ready · ${replayReadiness}`,
    LOAD_ERROR: `Google Maps could not load · ${replayReadiness}. Deterministic evidence remains valid.`,
    AUTH_ERROR: `Google Maps authorization was rejected · ${replayReadiness}. Deterministic evidence remains valid.`,
  };
  const showAuthoredFallback = shouldRenderAuthoredFallback(readiness);
  const timelineDetails = useMemo(() => {
    if (!model) return null;
    const failureIndex = model.failureSecond === null
      ? null
      : nearestReplayFrameIndex(model.timestamps, model.failureSecond);
    return Object.freeze({
      start: model.projectFrame(0).displayTime,
      end: model.projectFrame(model.frameCount - 1).displayTime,
      failure: failureIndex === null ? null : model.projectFrame(failureIndex).displayTime,
    });
  }, [model]);
  const replayProgress = model && model.frameCount > 1
    ? (clockState.cursor / (model.frameCount - 1)) * 100
    : 0;
  const replayProgressStyle = {
    "--replay-progress": `${replayProgress}%`,
  } as CSSProperties;
  const timelineDisabled = !model || !frame;

  return (
    <section className={styles.mapHero} aria-labelledby="map-title" data-testid="persistent-map-hero">
      <header className={styles.mapHeader}>
        <div>
          <span className={styles.kicker}>{model ? `COMMITTED RUN · ${model.runId}` : "IMMUTABLE BASELINE TOPOLOGY"}</span>
          <h2 id="map-title">Authored Sandton–Rosebank replay</h2>
          <p>Synthetic simulation · No live fleet control · Google Maps is presentation only</p>
        </div>
        <div className={styles.headerControls}>
          <div className={styles.bottomUtilityBar} aria-label="Map utilities">
            {actions}
            <span className={styles.utilityDivider} aria-hidden="true" />
            <div className={styles.routeSemanticsControl}>
              <button
                type="button"
                className={`${styles.routeSemanticsButton} ${routeLegendOpen ? styles.routeSemanticsButtonActive : ""}`}
                onClick={() => setRouteLegendOpen((open) => !open)}
                aria-label="Route semantics"
                aria-expanded={routeLegendOpen}
                aria-controls="route-semantics-panel"
              >
                <RouteIcon size={16} strokeWidth={1.7} aria-hidden="true" />
              </button>
              <span className={styles.utilityTooltip} aria-hidden="true">Route semantics</span>
              {routeLegendOpen ? (
                <SemanticLegend id="route-semantics-panel" onClose={() => setRouteLegendOpen(false)} />
              ) : null}
            </div>
          </div>
          <div className={styles.scenarioSelector} aria-label="Replay scenario">
            {(["A", "B"] as const).map((slot) => (
              <button key={slot} type="button" className={slot === selectedSlot ? styles.selectedScenario : ""} aria-pressed={slot === selectedSlot} disabled={!models[slot]} onClick={() => switchScenario(slot)}>
                Scenario {slot}
              </button>
            ))}
          </div>
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
        {showAuthoredFallback ? <AuthoredNetworkFallback network={BASELINE_NETWORK} model={model} frame={frame} layers={layers} selected={selectedEntity} /> : null}
        <div className={`${styles.mapStatus} ${readiness === "AUTH_ERROR" || readiness === "LOAD_ERROR" || readiness === "CONFIG_ERROR" ? styles.mapStatusWarning : ""}`} role={readiness === "AUTH_ERROR" || readiness === "LOAD_ERROR" || readiness === "CONFIG_ERROR" ? "alert" : "status"} data-testid="map-readiness-status">
          <span aria-hidden="true" />{readinessMessage[readiness]}
        </div>

        <section className={styles.rightDock} aria-label="Map layers and evidence inspection">
          <fieldset className={styles.layerToolbar}>
            <legend className={styles.visuallyHidden}>Map layers</legend>
            <span className={styles.layerToolbarMark} aria-hidden="true">
              <Layers size={15} strokeWidth={1.7} />
            </span>
            {LAYER_CONTROLS.map(({ key, label, icon: Icon }) => (
              <label key={key} className={styles.layerToggle}>
                <input
                  type="checkbox"
                  checked={layers[key]}
                  disabled={!frame && key !== "network"}
                  onChange={(event) => setLayer(key, event.currentTarget.checked)}
                  aria-label={`${label} layer`}
                />
                <span className={styles.layerToggleIcon} aria-hidden="true">
                  <Icon size={16} strokeWidth={1.7} />
                </span>
                <span className={styles.layerTooltip} aria-hidden="true">{label}</span>
              </label>
            ))}
          </fieldset>
          <EntityInspector
            key={`${selectedSlot}:${model?.runId ?? "none"}`}
            selected={selectedEntity}
            frame={frame}
            slot={selectedSlot}
            hasHistoricalRun={hasHistoricalRun}
            onSelect={setSelectedEntity}
          />
        </section>

        <div className={styles.timeline} aria-disabled={timelineDisabled} data-playing={clockState.playing}>
          <div className={styles.timelineIdentity} aria-live="polite">
            <span className={styles.timelineMode}><i aria-hidden="true" />{model ? `Scenario ${selectedSlot}` : "Replay standby"}</span>
            <strong>{frame?.displayTime ?? "—:—:—"}</strong>
            <span className={styles.timelineFrame}>{model && frame ? `Frame ${frame.index + 1} of ${model.frameCount}` : "Replay unavailable"}</span>
            {frame?.failure ? <b>{frame.failure.vehicleId} · failure evidence active</b> : null}
          </div>
          <div className={styles.transportControls}>
            <button type="button" className={styles.restartButton} onClick={() => clock.restart()} disabled={timelineDisabled || clockState.cursor === 0}><RotateCcw size={13} aria-hidden="true" /><span>Restart</span></button>
            <button type="button" className={styles.transportIconButton} onClick={() => clock.previous()} disabled={timelineDisabled || clockState.cursor === 0} aria-label="Previous committed frame"><StepBack size={14} aria-hidden="true" /></button>
            {clockState.playing ? <button type="button" className={styles.playButton} onClick={() => clock.pause()} disabled={timelineDisabled}><Pause size={13} fill="currentColor" aria-hidden="true" /><span>Pause</span></button> : <button type="button" className={styles.playButton} onClick={() => clock.play()} disabled={timelineDisabled || clockState.cursor === (model?.frameCount ?? 1) - 1}><Play size={13} fill="currentColor" aria-hidden="true" /><span>Play</span></button>}
            <button type="button" className={styles.transportIconButton} onClick={() => clock.next()} disabled={timelineDisabled || clockState.cursor === (model?.frameCount ?? 1) - 1} aria-label="Next committed frame"><StepForward size={14} aria-hidden="true" /></button>
            <button type="button" className={styles.failureButton} onClick={() => {
              if (model?.failureSecond !== null && model?.failureSecond !== undefined) clock.seek(nearestReplayFrameIndex(model.timestamps, model.failureSecond));
            }} disabled={timelineDisabled || model?.failureSecond === null}><TriangleAlert size={13} aria-hidden="true" /><span>Jump to failure</span></button>
          </div>
          <label className={styles.scrubber}>
            <span className={styles.scrubberHeader}>
              <span>Exact committed snapshot</span>
              <output>{model && frame ? `${frame.index + 1} / ${model.frameCount}` : "Unavailable"}</output>
            </span>
            <input id="replay-scrubber" style={replayProgressStyle} type="range" min={0} max={Math.max(0, (model?.frameCount ?? 1) - 1)} step={1} value={timelineDisabled ? 0 : clockState.cursor} disabled={timelineDisabled} onChange={(event) => clock.seek(Number(event.currentTarget.value))} aria-valuetext={frame && model ? `${frame.displayTime}, frame ${frame.index + 1} of ${model.frameCount}` : "No committed replay"} />
            <span className={styles.scrubberScale} aria-hidden="true">
              <span>{timelineDetails?.start ?? "Start"}</span>
              <span className={styles.failureTick}>{timelineDetails?.failure ? `Failure ${timelineDetails.failure}` : "No failure event"}</span>
              <span>{timelineDetails?.end ?? "End"}</span>
            </span>
          </label>
          <label className={styles.speedControl}>
            <span>Replay speed</span>
            <select value={clockState.speed} disabled={timelineDisabled} onChange={(event) => clock.setSpeed(Number(event.currentTarget.value) as ReplaySpeed)}>
              <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option>
            </select>
          </label>
          <button type="button" className={styles.cameraButton} onClick={() => setResetGeneration((value) => value + 1)}><Crosshair size={13} aria-hidden="true" /><span>Reset camera</span></button>
        </div>
      </div>

      <footer className={styles.provenance}>
        <span>SYNTHETIC SIMULATION · NO LIVE FLEET CONTROL</span>
        <span>Authored deterministic network overlay</span>
        <code>NETWORK {BASELINE_NETWORK.networkFingerprint.slice(0, 24)}…</code>
        {model ? <><code>INPUT {model.inputFingerprint.slice(0, 24)}…</code><code>LEDGER {model.eventLedgerFingerprint.slice(0, 24)}…</code><code>RESULT {model.resultFingerprint.slice(0, 24)}…</code></> : null}
      </footer>
    </section>
  );
}
