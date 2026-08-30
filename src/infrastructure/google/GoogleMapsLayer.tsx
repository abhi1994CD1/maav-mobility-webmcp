"use client";

import {
  AdvancedMarker,
  APIProvider,
  Map,
  Pin,
  Polyline,
} from "@vis.gl/react-google-maps";
import type { GoogleMapOverlayModel } from "./map-presentation";

const JOHANNESBURG_CORRIDOR_CENTER = { lat: -26.116, lng: 28.062 };
const MAP_STYLE = { width: "100%", height: "100%" } as const;

interface GoogleMapsLayerProps {
  apiKey: string;
  mapId: string;
  overlays: GoogleMapOverlayModel;
  animationNonce: number;
  ready: boolean;
  onLoad: () => void;
  onError: () => void;
}

export function GoogleMapsLayer({
  apiKey,
  mapId,
  overlays,
  animationNonce,
  ready,
  onLoad,
  onError,
}: GoogleMapsLayerProps) {
  return (
    <div
      className={`google-map-layer ${ready ? "is-ready" : ""}`}
      aria-hidden={!ready}
      data-animation-nonce={animationNonce}
    >
      <APIProvider
        apiKey={apiKey}
        version="weekly"
        onLoad={onLoad}
        onError={onError}
      >
        <Map
          mapId={mapId}
          defaultCenter={JOHANNESBURG_CORRIDOR_CENTER}
          defaultZoom={12}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
          backgroundColor="#091319"
          style={MAP_STYLE}
        >
          {overlays.authoredBackbone ? (
            <Polyline
              key={overlays.authoredBackbone.id}
              path={overlays.authoredBackbone.path}
              strokeColor={overlays.authoredBackbone.strokeColor}
              strokeOpacity={overlays.authoredBackbone.strokeOpacity}
              strokeWeight={overlays.authoredBackbone.strokeWeight}
              zIndex={overlays.authoredBackbone.zIndex}
              editable={false}
              draggable={false}
            />
          ) : null}

          {overlays.googleRouteContext ? (
            <Polyline
              key={overlays.googleRouteContext.id}
              encodedPath={overlays.googleRouteContext.encodedPath}
              strokeColor={overlays.googleRouteContext.strokeColor}
              strokeOpacity={0.96}
              strokeWeight={7}
              zIndex={3}
              editable={false}
              draggable={false}
            />
          ) : null}

          {overlays.stops.map((stop) => (
            <AdvancedMarker
              key={stop.id}
              position={stop.position}
              title={`${stop.name}${stop.accessible ? " · accessible" : ""}`}
              zIndex={4}
            >
              <Pin
                background="#eaf6f6"
                borderColor="#0b171c"
                glyphColor="#0b171c"
                scale={0.78}
              />
            </AdvancedMarker>
          ))}

          {overlays.vehicles.map((vehicle) => (
            <AdvancedMarker
              key={vehicle.id}
              position={vehicle.position}
              title={`${vehicle.label} · ${vehicle.status}`}
              zIndex={5}
            >
              <span
                className={`google-vehicle-marker status-${vehicle.status.toLowerCase()}`}
                aria-hidden="true"
              >
                <span>{vehicle.label}</span>
              </span>
            </AdvancedMarker>
          ))}
        </Map>
      </APIProvider>
    </div>
  );
}
