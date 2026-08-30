"use client";

import { useCallback, useMemo, useState } from "react";
import type { OperationalState } from "@/domain/types";
import { GoogleMapsLayer } from "@/infrastructure/google/GoogleMapsLayer";
import {
  corridorStrokeColor,
  deriveGoogleTrafficSummary,
  deriveRoutePresentation,
  GOOGLE_MAP_UNAVAILABLE_MESSAGE,
  initialGoogleMapStatus,
  isGoogleMapReady,
  mapContextLabel,
} from "@/infrastructure/google/map-presentation";
import type { RoutePresentationContext } from "@/infrastructure/google/route-context-contract";

interface MapCanvasProps {
  operational: OperationalState;
  animationNonce: number;
  routeContext: RoutePresentationContext;
}

export function MapCanvas({
  operational,
  animationNonce,
  routeContext,
}: MapCanvasProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID?.trim() || "DEMO_MAP_ID";
  const [googleMapStatus, setGoogleMapStatus] = useState(() =>
    initialGoogleMapStatus(apiKey),
  );
  const overlays = useMemo(
    () => deriveRoutePresentation(operational, routeContext),
    [operational, routeContext],
  );
  const trafficSummary = useMemo(
    () => deriveGoogleTrafficSummary(routeContext),
    [routeContext],
  );
  const googleReady = isGoogleMapReady(googleMapStatus);
  const handleGoogleLoad = useCallback(() => setGoogleMapStatus("READY"), []);
  const handleGoogleError = useCallback(() => setGoogleMapStatus("FAILED"), []);

  return (
    <div
      className="map-stage"
      aria-label="Mobility network map"
      data-google-map-status={googleMapStatus}
    >
      <AuthoredNetworkMap operational={operational} hidden={googleReady} />
      {apiKey ? (
        <GoogleMapsLayer
          apiKey={apiKey}
          mapId={mapId}
          overlays={overlays}
          animationNonce={animationNonce}
          ready={googleReady}
          onLoad={handleGoogleLoad}
          onError={handleGoogleError}
        />
      ) : null}
      {googleMapStatus === "FAILED" ? (
        <div
          className={`map-load-note ${trafficSummary ? "with-traffic-summary" : ""}`}
          role="status"
        >
          {GOOGLE_MAP_UNAVAILABLE_MESSAGE}
        </div>
      ) : null}
      {trafficSummary ? (
        <div
          className="map-traffic-summary"
          aria-label="Google traffic-aware route context session snapshot"
        >
          <small>GOOGLE TRAFFIC CONTEXT</small>
          <strong>
            {trafficSummary.distanceKilometers.toFixed(1)} km <b>•</b>{" "}
            {trafficSummary.durationMinutes.toFixed(1)} min <b>•</b> +
            {trafficSummary.delayMinutes.toFixed(1)} min traffic delay
          </strong>
          <span>SESSION SNAPSHOT</span>
        </div>
      ) : null}
      <div className="map-context-label" role="status" aria-live="polite">
        <span
          className={
            googleReady && routeContext.source === "GOOGLE"
              ? "source-dot google"
              : "source-dot fallback"
          }
        />
        {mapContextLabel(googleMapStatus, routeContext.source)}
      </div>
    </div>
  );
}

function AuthoredNetworkMap({
  operational,
  hidden,
}: {
  operational: OperationalState;
  hidden: boolean;
}) {
  const corridor = operational.network.corridors[0];
  const status = corridor?.status ?? "HEALTHY";
  const stroke = corridorStrokeColor(status);

  const points: Record<string, { x: number; y: number }> = {
    "park-station": { x: 185, y: 500 },
    braamfontein: { x: 150, y: 455 },
    rosebank: { x: 315, y: 330 },
    sandton: { x: 455, y: 235 },
    marlboro: { x: 620, y: 170 },
    midrand: { x: 785, y: 70 },
  };

  return (
    <svg
      viewBox="0 0 900 580"
      role="img"
      aria-label="Authored synthetic Johannesburg mobility corridor"
      aria-hidden={hidden}
      className="authored-map"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="grid" width="46" height="46" patternUnits="userSpaceOnUse">
          <path d="M 46 0 L 0 0 0 46" fill="none" stroke="#16303a" strokeWidth="1" />
        </pattern>
        <filter id="glow">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect width="900" height="580" fill="#081217" />
      <rect width="900" height="580" fill="url(#grid)" opacity="0.44" />
      <g className="district-lines" opacity="0.42">
        <path d="M-20 530 C170 420 290 490 480 370 S760 200 940 220" />
        <path d="M70 620 C160 390 315 440 390 250 S590 120 700 -30" />
        <path d="M-50 245 C170 300 360 165 510 210 S765 320 950 110" />
        <path d="M70 80 C220 190 330 115 455 55 S740 100 930 15" />
      </g>
      <polyline
        points="185,500 150,455 315,330 455,235 620,170 785,70"
        fill="none"
        stroke="#173640"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="185,500 150,455 315,330 455,235 620,170 785,70"
        fill="none"
        stroke={stroke}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#glow)"
        className={status === "RECOVERED" ? "recovery-line" : ""}
      />
      {status === "DISRUPTED" ? (
        <g className="incident-pulse" transform="translate(385 282)">
          <circle r="34" fill="none" stroke="#ff5c4d" strokeWidth="2" />
          <circle r="9" fill="#ff5c4d" />
        </g>
      ) : null}
      {operational.network.stops.map((stop) => {
        const point = points[stop.id];
        if (!point) return null;
        return (
          <g key={stop.id} transform={`translate(${point.x} ${point.y})`}>
            <circle r="7" fill="#eaf6f6" stroke="#0b171c" strokeWidth="3" />
            <text x="13" y="4">{stop.name}</text>
          </g>
        );
      })}
      {operational.fleet.vehicles.map((vehicle, index) => {
        const positions = [
          { x: 205, y: 435 },
          { x: 342, y: 310 },
          { x: 474, y: 226 },
          { x: 650, y: 150 },
        ];
        const point = positions[index] ?? positions[0];
        return (
          <g key={vehicle.id} className="vehicle-marker" transform={`translate(${point.x} ${point.y})`}>
            <rect x="-12" y="-8" width="24" height="16" rx="4" fill="#071015" stroke={vehicle.status === "DELAYED" ? "#ffb04a" : "#55d8ff"} strokeWidth="2" />
            <circle cx="-7" cy="9" r="2" fill="#dff9ff" />
            <circle cx="7" cy="9" r="2" fill="#dff9ff" />
          </g>
        );
      })}
      <g className="map-compass" transform="translate(840 510)">
        <path d="M0 -18 L7 9 L0 5 L-7 9 Z" fill="#eaf6f6" />
        <text x="-4" y="-26">N</text>
      </g>
    </svg>
  );
}
