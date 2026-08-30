import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_OBJECTIVES,
  CommandCenterService,
} from "@/application/command-center-service";
import { createInitialCommandCenterState } from "@/domain/scenario";
import {
  AUTHORED_ROUTE_CONTEXT,
  loadRouteContext,
} from "@/infrastructure/google/route-context";
import {
  createCommandCenterStore,
  ZustandCommandCenterRepository,
} from "@/infrastructure/persistence/zustand-repository";

describe("Routes API fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the authored fallback on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadRouteContext()).resolves.toEqual(AUTHORED_ROUTE_CONTEXT);
  });

  it("propagates client cancellation and resolves to a safe fallback", async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, options: RequestInit) => {
        receivedSignal = options.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          receivedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    );
    const controller = new AbortController();
    const pending = loadRouteContext(controller.signal);

    controller.abort();

    await expect(pending).resolves.toEqual(AUTHORED_ROUTE_CONTEXT);
    expect(receivedSignal).toBe(controller.signal);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("accepts only bounded normalized route context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          source: "GOOGLE",
          corridorId: "rosebank-sandton",
          distanceMeters: 7600,
          durationSeconds: 1180,
          staticDurationSeconds: 1020,
          delaySeconds: 160,
          encodedPolyline: "abc123",
          capturedForSession: true,
        }),
      }),
    );

    await expect(loadRouteContext()).resolves.toMatchObject({
      source: "GOOGLE",
      distanceMeters: 7600,
      staticDurationSeconds: 1020,
      delaySeconds: 160,
      encodedPolyline: "abc123",
    });
  });

  it("accepts a bounded authored response without requiring geometry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          source: "AUTHORED_FALLBACK",
          corridorId: "rosebank-sandton",
          distanceMeters: 7800,
          durationSeconds: 1020,
          staticDurationSeconds: 1020,
          delaySeconds: 0,
          capturedForSession: true,
          reasonCode: "NO_SERVER_KEY",
        }),
      }),
    );

    await expect(loadRouteContext()).resolves.toEqual({
      ...AUTHORED_ROUTE_CONTEXT,
      reasonCode: "NO_SERVER_KEY",
    });
  });

  it("rejects raw or malformed third-party payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ source: "GOOGLE", rawText: "traffic prose" }),
      }),
    );

    await expect(loadRouteContext()).resolves.toEqual(AUTHORED_ROUTE_CONTEXT);
  });

  it("rejects Google results with missing or oversized geometry", async () => {
    for (const encodedPolyline of [undefined, "x".repeat(20_001)]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            source: "GOOGLE",
            corridorId: "rosebank-sandton",
            distanceMeters: 7600,
            durationSeconds: 1180,
            staticDurationSeconds: 1020,
            delaySeconds: 160,
            encodedPolyline,
            capturedForSession: true,
          }),
        }),
      );

      await expect(loadRouteContext()).resolves.toEqual(
        AUTHORED_ROUTE_CONTEXT,
      );
    }
  });

  it("keeps route loading and geometry outside revisioned domain state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          source: "GOOGLE",
          corridorId: "rosebank-sandton",
          distanceMeters: 7600,
          durationSeconds: 1180,
          staticDurationSeconds: 1020,
          delaySeconds: 160,
          encodedPolyline: "abc123",
          capturedForSession: true,
        }),
      }),
    );
    const store = createCommandCenterStore(createInitialCommandCenterState());
    const domainBefore = store.getState().domain;
    const context = await loadRouteContext();

    store.setState((current) => ({
      ...current,
      ui: { ...current.ui, routeContext: context },
    }));

    expect(store.getState().domain).toBe(domainBefore);
    expect(store.getState().domain.revision).toBe(0);
  });

  it("keeps plan metrics and ranking identical across traffic snapshots", () => {
    function evaluateWithTraffic(durationSeconds: number) {
      const store = createCommandCenterStore(createInitialCommandCenterState());
      store.setState((current) => ({
        ...current,
        ui: {
          ...current.ui,
          routeContext: {
            source: "GOOGLE",
            corridorId: "rosebank-sandton",
            distanceMeters: 7600,
            durationSeconds,
            staticDurationSeconds: 1020,
            delaySeconds: Math.max(0, durationSeconds - 1020),
            encodedPolyline: "abc123",
            capturedForSession: true,
          },
        },
      }));
      const service = new CommandCenterService(
        new ZustandCommandCenterRepository(store),
      );
      expect(service.activateIncident(0).ok).toBe(true);
      return service.evaluateRecoveryOptions(
        1,
        CANONICAL_OBJECTIVES,
        "AGENT",
      );
    }

    const lowTraffic = evaluateWithTraffic(1080);
    const highTraffic = evaluateWithTraffic(2400);

    expect(lowTraffic).toEqual(highTraffic);
    expect(lowTraffic).toMatchObject({
      ok: true,
      data: { recommendedPlanId: "combined_recovery_c" },
      meta: { revision: 2, phase: "OPTIONS_EVALUATED" },
    });
  });
});
