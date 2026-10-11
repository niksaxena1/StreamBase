import { broadcastUniverseChange } from "./universeSyncEvents";

export const ROUTER_MUTATION_EVENT = "sb:router-mutation";

/** POST lookup endpoints are reads; invalidate only saves that affect page content. */
export function mutationNeedsRouterRefresh(url: string, method = "GET"): boolean {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method.toUpperCase())) return false;
  const path = url.split("?")[0];
  return path.startsWith("/api/user-settings/") || path.startsWith("/api/health-config/") || [
    "/api/health-actions",
    "/api/rapidapi-stale-lookup",
    "/api/admin/artists/in-house",
    "/api/admin/spotify/refresh-playlist-thumbnails",
    "/api/collectors/monthly-revenue-forecast",
    "/api/filters/saved",
  ].includes(path);
}

export function notifyPageMutation(url: string, method?: string) {
  if (typeof window !== "undefined" && mutationNeedsRouterRefresh(url, method)) {
    if (["/api/user-settings/dataset-context", "/api/user-settings/dataset-mode", "/api/user-settings/competitor-label"].includes(url.split("?")[0])) broadcastUniverseChange();
    window.dispatchEvent(new Event(ROUTER_MUTATION_EVENT));
  }
}
