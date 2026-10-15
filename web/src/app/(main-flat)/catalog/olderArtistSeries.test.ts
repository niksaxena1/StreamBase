import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/cache", () => ({
  cachedQuery: async (fn: () => Promise<unknown>) => await fn(),
}));

import { fetchOlderCatalogArtistSeries } from "./catalogPageQueries";

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeClient(handlers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: unknown }>) {
  const calls: RpcCall[] = [];
  const sb = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const handler = handlers[name];
      return Promise.resolve(handler ? handler(args) : { data: null, error: null });
    },
  };
  return { sb: sb as never, calls };
}

const pre = [
  { date: "2024-01-01", streams_cumulative: 10 },
  { date: "2024-01-02", streams_cumulative: 15 },
];

describe("fetchOlderCatalogArtistSeries", () => {
  it("serves stable older ranges from the precomputed table only", async () => {
    const { sb, calls } = fakeClient({ catalog_artist_series_precomputed: () => ({ data: pre, error: null }) });
    const out = await fetchOlderCatalogArtistSeries(sb, {
      artistId: "a1", startDate: "2023-07-01", endDate: "2025-10-14", todayIso: "2026-10-15",
    });
    expect(out.data).toEqual(pre);
    expect(calls.map((c) => c.name)).toEqual(["catalog_artist_series_precomputed"]);
    expect(calls[0].args).toEqual({ p_artist: "a1", p_start: "2023-07-01", p_end: "2025-10-14" });
  });

  it("falls back to the on-demand readers when the table has no rows for the artist", async () => {
    const onDemand = [{ date: "2024-01-01", streams_cumulative: 10 }];
    const { sb, calls } = fakeClient({
      catalog_artist_series_precomputed: () => ({ data: [], error: null }),
      stream_compact_from: () => ({ data: null, error: null }),
      catalog_artist_series_fast: () => ({ data: onDemand, error: null }),
    });
    const out = await fetchOlderCatalogArtistSeries(sb, {
      artistId: "a1", startDate: "2023-07-01", endDate: "2025-10-14", todayIso: "2026-10-15",
    });
    expect(out.data).toEqual(onDemand);
    expect(calls.map((c) => c.name)).toContain("catalog_artist_series_fast");
  });

  it("falls back when the precomputed reader errors", async () => {
    const onDemand = [{ date: "2024-01-01", streams_cumulative: 10 }];
    const { sb } = fakeClient({
      catalog_artist_series_precomputed: () => ({ data: null, error: { message: "boom", code: "XX000" } }),
      catalog_artist_series_fast: () => ({ data: onDemand, error: null }),
    });
    const out = await fetchOlderCatalogArtistSeries(sb, {
      artistId: "a1", startDate: "2023-07-01", endDate: "2025-10-14", todayIso: "2026-10-15",
    });
    expect(out.data).toEqual(onDemand);
  });

  it("never reads the precomputed table for ranges touching the recently-changing window", async () => {
    const { sb, calls } = fakeClient({
      catalog_artist_series_precomputed: () => ({ data: pre, error: null }),
      catalog_artist_series_fast: () => ({ data: [], error: null }),
    });
    await fetchOlderCatalogArtistSeries(sb, {
      artistId: "a1", startDate: "2026-01-01", endDate: "2026-10-10", todayIso: "2026-10-15",
    });
    expect(calls.map((c) => c.name)).not.toContain("catalog_artist_series_precomputed");
  });
});
