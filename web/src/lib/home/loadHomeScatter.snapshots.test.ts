import { describe, expect, it, vi } from "vitest";
import type { supabaseService } from "@/lib/supabase/service";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import { loadHomeScatterPoints } from "./loadHomeDashboard";

vi.mock("@/lib/supabase/cache", () => ({
  cachedQuery: async (query: () => Promise<unknown>) => query(),
}));

function client(snapshotVersion: string | null, rowCount = 3) {
  const rpcLabels: string[] = [];
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    isrc: `TRACK${i === 1 ? 0 : i}`, name: `Track ${i}`, release_date: "2026-01-02",
    artist_names: ["Artist"], artist_ids: ["artist"], album_image_url: null,
    spotify_track_id: `spotify${i}`, total_streams_cumulative: 100000 - i,
    daily_streams_delta: 100 - i, has_prev_day: true,
  }));
  const build = (schema: string) => ({
    schema: (next: string) => build(next),
    rpc: (name: string, args?: { label_key: string; run_date: string; prev_date: string }) => {
      expect(schema).toBe("competitor");
      if (name === "spotibase_override_version") return Promise.resolve({ data: "7-2-100", error: null });
      expect(name).toBe("home_track_scatter_points_for_label");
      expect(args?.run_date).toBe("2026-10-11");
      expect(args?.prev_date).toBe("2026-10-10");
      rpcLabels.push(args!.label_key);
      let start = 0;
      let end = rows.length;
      const query = {
        range: (from: number, to: number) => { start = from; end = to + 1; return query; },
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({
          data: rows.slice(start, end), error: null, count: rows.length,
        }).then(resolve),
      };
      return query;
    },
    from: (table: string) => {
      expect(schema).toBe("competitor");
      const data = table === "home_diag_snapshots"
        ? snapshotVersion == null ? null : { payload: rows, override_version: snapshotVersion, computed_at: "2026-10-11T02:00:00Z" }
        : table === "ingestion_runs" ? { finished_at: "2026-10-11T01:00:00Z" }
        : table === "labels" ? [{ label_key: "a", display_name: "A" }, { label_key: "b", display_name: "B" }]
        : [];
      const query = {
        select: () => query, eq: () => query, order: () => query, limit: () => query,
        in: () => query, lte: () => query, or: () => query,
        maybeSingle: () => Promise.resolve({ data, error: null }),
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return query;
    },
  });
  return { svc: build("public") as unknown as ReturnType<typeof supabaseService>, rpcLabels };
}

describe("competitor scatter snapshot parity", () => {
  const args = { datasetMode: "competitor" as const, competitorLabelKey: "a",
    competitorLabelName: "A", selectedRunDate: "2026-10-11" };

  it.each(["a", ALL_COMPETITORS_KEY])("keeps the rendered points identical for %s", async (competitorLabelKey) => {
    const live = client(null);
    const snapshot = client("7-2-100");
    const expected = await loadHomeScatterPoints({ ...args, competitorLabelKey, svc: live.svc });
    expect(await loadHomeScatterPoints({ ...args, competitorLabelKey, svc: snapshot.svc })).toEqual(expected);
    expect(snapshot.rpcLabels).toEqual([]);
    expect(live.rpcLabels).toEqual(competitorLabelKey === "a" ? ["a"] : ["a", "b"]);
  });

  it("falls back to the paged RPC when the override version differs", async () => {
    const stale = client("6-1-50");
    await loadHomeScatterPoints({ ...args, svc: stale.svc });
    expect(stale.rpcLabels).toEqual(["a"]);
  });

  it("preserves the 10,000-row bound before ISRC deduplication", async () => {
    const live = client(null, 10050);
    const snapshot = client("7-2-100", 10050);
    const expected = await loadHomeScatterPoints({ ...args, svc: live.svc });
    const actual = await loadHomeScatterPoints({ ...args, svc: snapshot.svc });
    expect(actual).toEqual(expected);
    expect(actual.points).toHaveLength(9999);
    expect(snapshot.rpcLabels).toEqual([]);
  });
});
