"use client";

import { useEffect, useRef, useState } from "react";
import type { OperationalState, RouteContextSource } from "@/domain/types";

let googleMapsPromise: Promise<void> | undefined;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof google !== "undefined" && google.maps) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-mobility-google-maps]",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("maps_load")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.dataset.mobilityGoogleMaps = "true";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker&loading=async`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("maps_load")), {
      once: true,
    });
    document.head.appendChild(script);
  });
  return googleMapsPromise;
}

interface MapCanvasProps {
  operational: OperationalState;
  animationNonce: number;
  routeContextSource: RouteContextSource;
}

export function MapCanvas({
  operational,
  animationNonce,
  routeContextSource,
}: MapCanvasProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRefs = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const polylineRefs = useRef<google.maps.Polyline[]>([]);
  const [googleReady, setGoogleReady] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey || !mapElementRef.current) return;
    let cancelled = false;
    void loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !mapElementRef.current) return;
        mapRef.current = new google.maps.Map(mapElementRef.current, {
          center: { lat: -26.116, lng: 28.062 },
          zoom: 12,
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "DEMO_MAP_ID",
          disableDefaultUI: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          backgroundColor: "#091319",
        });
        setGoogleReady(true);
      })
      .catch(() => setGoogleReady(false));
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    if (!googleReady || !mapRef.current) return;
    for (const marker of markerRefs.current) marker.map = null;
    for (const polyline of polylineRefs.current) polyline.setMap(null);
    markerRefs.current = [];
    polylineRefs.current = [];

    const corridor = operational.network.corridors[0];
    if (corridor) {
      const line = new google.maps.Polyline({
        map: mapRef.current,
        path: corridor.path,
        strokeColor:
          corridor.status === "DISRUPTED"
            ? "#ff5c4d"
            : corridor.status === "RECOVERED"
              ? "#45d6a8"
              : "#55d8ff",
        strokeOpacity: 0.94,
        strokeWeight: 5,
      });
      polylineRefs.current.push(line);
    }

    for (const stop of operational.network.stops) {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: mapRef.current,
        position: stop.position,
        title: stop.name,
      });
      markerRefs.current.push(marker);
    }
    for (const vehicle of operational.fleet.vehicles) {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: mapRef.current,
        position: vehicle.position,
        title: `${vehicle.label} · ${vehicle.status}`,
      });
      markerRefs.current.push(marker);
    }
  }, [animationNonce, googleReady, operational]);

  return (
    <div className="map-stage" aria-label="Mobility network map">
      <AuthoredNetworkMap operational={operational} />
      {apiKey ? (
        <div
          ref={mapElementRef}
          className={`google-map-layer ${googleReady ? "is-ready" : ""}`}
          aria-hidden={!googleReady}
        />
      ) : null}
      <div className="map-context-label">
        <span
          className={
            googleReady && routeContextSource === "GOOGLE"
              ? "source-dot google"
              : "source-dot fallback"
          }
        />
        {contextLabel(googleReady, routeContextSource)}
      </div>
    </div>
  );
}

function contextLabel(
  googleMapReady: boolean,
  routeContextSource: RouteContextSource,
): string {
  if (googleMapReady && routeContextSource === "GOOGLE") {
    return "GOOGLE MAPS + ROUTES CONTEXT";
  }
  if (googleMapReady) return "GOOGLE MAPS • AUTHORED ROUTE FALLBACK";
  if (routeContextSource === "GOOGLE") {
    return "AUTHORED MAP • GOOGLE ROUTE CONTEXT";
  }
  return "AUTHORED MAP + ROUTE FALLBACK";
}

function AuthoredNetworkMap({ operational }: { operational: OperationalState }) {
  const corridor = operational.network.corridors[0];
  const status = corridor?.status ?? "HEALTHY";
  const stroke =
    status === "DISRUPTED" ? "#ff5c4d" : status === "RECOVERED" ? "#45d6a8" : "#55d8ff";

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
      className="authored-map"
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
