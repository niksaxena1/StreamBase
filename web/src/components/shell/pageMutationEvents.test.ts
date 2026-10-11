import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchApiJson } from "@/lib/api";
import { mutationNeedsRouterRefresh, ROUTER_MUTATION_EVENT } from "./pageMutationEvents";

afterEach(() => vi.unstubAllGlobals());

describe("router mutation invalidation", () => {
  it("covers settings, health, overrides, catalog/config edits and saved page preferences", () => {
    for (const url of ["/api/user-settings/rate", "/api/user-settings/home-milestones", "/api/health-config/artificial-stream-spike-warning",
      "/api/health-actions", "/api/rapidapi-stale-lookup", "/api/admin/artists/in-house", "/api/admin/spotify/refresh-playlist-thumbnails",
      "/api/collectors/monthly-revenue-forecast", "/api/filters/saved?id=filter"]) {
      expect(mutationNeedsRouterRefresh(url, "POST")).toBe(true);
      expect(mutationNeedsRouterRefresh(url, "GET")).toBe(false);
    }
    expect(mutationNeedsRouterRefresh("/api/admin/artists/in-house", "patch")).toBe(true);
    expect(mutationNeedsRouterRefresh("/api/filters/saved", "DELETE")).toBe(true);
  });
  it("does not invalidate for read-only POST lookups or telemetry", () => {
    for (const url of ["/api/playlists/containing", "/api/tracks/playlist-movements", "/api/competitors/comparison-drilldown",
      "/api/catalog/config/tracks", "/api/home/concentration", "/api/performance", "/api/sai/chat"]) {
      expect(mutationNeedsRouterRefresh(url, "POST")).toBe(false);
    }
  });
  it("notifies the shell only after a successful save", async () => {
    const events = new EventTarget();
    const refresh = vi.fn();
    events.addEventListener(ROUTER_MUTATION_EVENT, refresh);
    vi.stubGlobal("window", events);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { saved: true } })));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchApiJson("/api/user-settings/rate", { method: "POST" })).resolves.toEqual({ saved: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response(JSON.stringify({ success: false, error: "failed" }), { status: 500 }));
    await expect(fetchApiJson("/api/user-settings/rate", { method: "POST" })).rejects.toThrow("failed");
    expect(refresh).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: {} })));
    await fetchApiJson("/api/playlists/containing", { method: "POST" });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
