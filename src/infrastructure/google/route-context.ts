import type { RouteContext } from "@/domain/types";

export const AUTHORED_ROUTE_CONTEXT: RouteContext = {
  source: "AUTHORED_FALLBACK",
  corridorId: "rosebank-sandton",
  distanceMeters: 7800,
  durationSeconds: 1020,
  delaySeconds: 0,
  capturedForSession: true,
  reasonCode: "CLIENT_UNAVAILABLE",
};

export async function loadRouteContext(
  signal?: AbortSignal,
): Promise<RouteContext> {
  try {
    const response = await fetch("/api/route-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ corridorId: "rosebank-sandton" }),
      signal,
    });
    if (!response.ok) return { ...AUTHORED_ROUTE_CONTEXT };
    const data: unknown = await response.json();
    if (!isRouteContext(data)) return { ...AUTHORED_ROUTE_CONTEXT };
    return data;
  } catch {
    return { ...AUTHORED_ROUTE_CONTEXT };
  }
}

function isRouteContext(value: unknown): value is RouteContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.source === "GOOGLE" ||
      candidate.source === "AUTHORED_FALLBACK") &&
    candidate.corridorId === "rosebank-sandton" &&
    typeof candidate.distanceMeters === "number" &&
    typeof candidate.durationSeconds === "number" &&
    typeof candidate.delaySeconds === "number" &&
    candidate.capturedForSession === true
  );
}
