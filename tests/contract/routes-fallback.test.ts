import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTHORED_ROUTE_CONTEXT,
  loadRouteContext,
} from "@/infrastructure/google/route-context";

describe("Routes API fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the authored fallback on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(loadRouteContext()).resolves.toEqual(AUTHORED_ROUTE_CONTEXT);
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
          delaySeconds: 160,
          capturedForSession: true,
        }),
      }),
    );

    await expect(loadRouteContext()).resolves.toMatchObject({
      source: "GOOGLE",
      distanceMeters: 7600,
      delaySeconds: 160,
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
});
