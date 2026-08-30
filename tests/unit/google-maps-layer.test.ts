import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCanonicalOperationalState } from "@/domain/scenario";
import { GoogleMapsLayer } from "@/infrastructure/google/GoogleMapsLayer";
import { deriveRoutePresentation } from "@/infrastructure/google/map-presentation";
import {
  createAuthoredRouteContext,
  type RoutePresentationContext,
} from "@/infrastructure/google/route-context-contract";

const GOOGLE_ROUTE_CONTEXT: RoutePresentationContext = {
  source: "GOOGLE",
  corridorId: "rosebank-sandton",
  distanceMeters: 7600,
  durationSeconds: 1180,
  staticDurationSeconds: 1020,
  delaySeconds: 160,
  encodedPolyline: "abc123",
  capturedForSession: true,
};

const captures = vi.hoisted(() => ({
  provider: {} as Record<string, unknown>,
  map: {} as Record<string, unknown>,
  polylines: [] as Record<string, unknown>[],
  markers: [] as Record<string, unknown>[],
}));

vi.mock("@vis.gl/react-google-maps", async () => {
  const React = await import("react");

  function childrenOf(props: Record<string, unknown>): ReactNode {
    return props.children as ReactNode;
  }

  return {
    APIProvider: (props: Record<string, unknown>) => {
      captures.provider = props;
      return React.createElement("div", null, childrenOf(props));
    },
    Map: (props: Record<string, unknown>) => {
      captures.map = props;
      return React.createElement("div", null, childrenOf(props));
    },
    Polyline: (props: Record<string, unknown>) => {
      captures.polylines.push(props);
      return null;
    },
    AdvancedMarker: (props: Record<string, unknown>) => {
      captures.markers.push(props);
      return React.createElement("div", null, childrenOf(props));
    },
    Pin: () => React.createElement("span"),
  };
});

describe("GoogleMapsLayer", () => {
  beforeEach(() => {
    captures.provider = {};
    captures.map = {};
    captures.polylines.length = 0;
    captures.markers.length = 0;
  });

  it("wires safe load and failure callbacks and renders every operational overlay", () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    const overlays = deriveRoutePresentation(
      createCanonicalOperationalState(),
      createAuthoredRouteContext("NO_SERVER_KEY"),
    );

    const markup = renderToStaticMarkup(
      createElement(GoogleMapsLayer, {
        apiKey: "configured",
        mapId: "configured",
        overlays,
        animationNonce: 0,
        ready: true,
        onLoad,
        onError,
      }),
    );

    expect(markup).toContain("google-map-layer is-ready");
    expect(captures.provider.version).toBe("weekly");
    expect(captures.map).toMatchObject({
      defaultCenter: { lat: -26.116, lng: 28.062 },
      defaultZoom: 12,
      gestureHandling: "greedy",
      disableDefaultUI: true,
    });
    expect(captures.polylines).toHaveLength(1);
    expect(captures.polylines[0]).toMatchObject({
      path: overlays.authoredBackbone?.path,
      strokeColor: "#55d8ff",
      editable: false,
      draggable: false,
    });
    expect(captures.markers).toHaveLength(
      overlays.stops.length + overlays.vehicles.length,
    );

    (captures.provider.onLoad as () => void)();
    (captures.provider.onError as () => void)();
    expect(onLoad).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(markup).not.toContain("configured");
  });

  it("renders a subdued authored backbone below encoded Google route context", () => {
    const overlays = deriveRoutePresentation(
      createCanonicalOperationalState(),
      GOOGLE_ROUTE_CONTEXT,
    );

    renderToStaticMarkup(
      createElement(GoogleMapsLayer, {
        apiKey: "configured",
        mapId: "configured",
        overlays,
        animationNonce: 0,
        ready: true,
        onLoad: vi.fn(),
        onError: vi.fn(),
      }),
    );

    expect(captures.polylines).toHaveLength(2);
    expect(captures.polylines[0]).toMatchObject({
      path: overlays.authoredBackbone?.path,
      strokeColor: "#68858d",
      strokeWeight: 3,
      zIndex: 1,
    });
    expect(captures.polylines[1]).toMatchObject({
      encodedPath: "abc123",
      strokeColor: "#55d8ff",
      strokeWeight: 7,
      zIndex: 3,
      editable: false,
      draggable: false,
    });
    expect(captures.polylines[1]).not.toHaveProperty("path");
  });
});
