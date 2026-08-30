import {
  createAuthoredRouteContext,
  parseNormalizedRouteContext,
  type RoutePresentationContext,
} from "./route-context-contract";

export const AUTHORED_ROUTE_CONTEXT = createAuthoredRouteContext(
  "CLIENT_UNAVAILABLE",
);

export async function loadRouteContext(
  signal?: AbortSignal,
): Promise<RoutePresentationContext> {
  try {
    const response = await fetch("/api/route-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ corridorId: "rosebank-sandton" }),
      signal,
    });
    if (!response.ok) return { ...AUTHORED_ROUTE_CONTEXT };
    const data: unknown = await response.json();
    return parseNormalizedRouteContext(data) ?? { ...AUTHORED_ROUTE_CONTEXT };
  } catch {
    return { ...AUTHORED_ROUTE_CONTEXT };
  }
}
