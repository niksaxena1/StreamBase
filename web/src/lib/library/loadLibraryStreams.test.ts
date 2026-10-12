import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  rpcResult: { data: null as unknown, error: null as null | { message: string; code?: string } },
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  cache: [] as Array<{ key: string; ttl: unknown; tags: unknown }>,
}));

vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logWarn: vi.fn(), logDebug: vi.fn() }));

vi.mock("@/lib/supabase/cache", () => ({
  cachedQuery: async (fn: () => Promise<unknown>, key: string, ttl: unknown, tags: unknown) => {
    state.cache.push({ key, ttl, tags });
    try {
      return await fn();
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) } };
    }
  },
}));

vi.mock("@/lib/supabase/catalogService", () => ({
  CATALOG_ENV_VARS: [],
  catalogConfigured: () => state.configured,
  catalogService: () => ({
    schema: () => ({
      rpc: async (name: string, args?: unknown) => {
        state.rpcCalls.push({ name, args });
        return state.rpcResult;
      },
    }),
  }),
}));

import { loadLibraryStreamSeries, loadLibraryStreams } from "./loadLibraryStreams";

beforeEach(() => {
  state.configured = true;
  state.rpcResult = { data: null, error: null };
  state.rpcCalls = [];
  state.cache = [];
});

describe("loadLibraryStreams", () => {
  it("reads track_streams, caches it for an hour under its own tag, and normalizes rows", async () => {
    state.rpcResult = {
      data: [
        { catalog_id: "TG-1", isrc: "USABC2600001", total_streams: "1500", streams_7d: 20, as_of: "2026-10-11", album_image_url: null, spotify_track_id: "t1" },
        { catalog_id: "", total_streams: 5 },
      ],
      error: null,
    };
    const streams = await loadLibraryStreams();
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ catalog_id: "TG-1", total_streams: 1500, streams_7d: 20, spotify_track_id: "t1" });
    expect(state.rpcCalls[0].name).toBe("track_streams");
    expect(state.cache[0]).toEqual({ key: "library-streams", ttl: 3600, tags: ["catalog-streams"] });
  });

  it("returns an empty list when the call fails", async () => {
    state.rpcResult = { data: null, error: { message: "statement timeout" } };
    await expect(loadLibraryStreams()).resolves.toEqual([]);
  });

  it("returns an empty list when the catalog is not connected", async () => {
    state.configured = false;
    await expect(loadLibraryStreams()).resolves.toEqual([]);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("loadLibraryStreamSeries", () => {
  it("passes the catalog id and day count and returns clean points", async () => {
    state.rpcResult = {
      data: [
        { date: "2026-10-01", streams_cumulative: 10 },
        { date: "2026-10-02", streams_cumulative: "15" },
        { date: null, streams_cumulative: 1 },
      ],
      error: null,
    };
    const points = await loadLibraryStreamSeries("TG-1", 90);
    expect(points).toEqual([
      { date: "2026-10-01", streams_cumulative: 10 },
      { date: "2026-10-02", streams_cumulative: 15 },
    ]);
    expect(state.rpcCalls[0]).toEqual({ name: "track_stream_series", args: { p_catalog_id: "TG-1", p_days: 90 } });
  });

  it("throws on a database error", async () => {
    state.rpcResult = { data: null, error: { message: "nope" } };
    await expect(loadLibraryStreamSeries("TG-1", 30)).rejects.toThrow("nope");
  });
});
