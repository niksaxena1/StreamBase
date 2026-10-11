import { beforeEach, describe, expect, it, vi } from "vitest";
import { recomputeActiveWarningSnapshot } from "./activeWarnings";

const fixture = vi.hoisted(() => ({
  tracks: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ table: string; filters: Array<[string, ...unknown[]]> }>,
  trackError: false,
}));

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/service", () => ({
  supabaseService: () => ({
    from: (table: string) => {
      const filters: Array<[string, ...unknown[]]> = [];
      fixture.queries.push({ table, filters });
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "is", "order", "limit", "maybeSingle", "upsert"]) {
        query[method] = (...args: unknown[]) => { filters.push([method, ...args]); return query; };
      }
      query.then = (resolve: (value: unknown) => unknown) => {
        let data: unknown = [];
        if (table === "ingestion_warnings") data = [{
          code: "tracks_missing_enrichment", severity: "info", playlist_key: "releases",
          run_date: "2026-10-11", message: "Missing enrichment",
          details_json: { isrc_list: ["MISSING", "REMOVED", "RESTORED"] },
        }];
        if (table === "tracks") {
          data = fixture.tracks.filter((row) => filters.every(([method, key, value]) => {
            if (method === "is") return row[String(key)] == null;
            if (method === "in") return (value as unknown[]).includes(row[String(key)]);
            return true;
          }));
        }
        return resolve({ data, error: table === "tracks" && fixture.trackError ? new Error("offline") : null });
      };
      return query;
    },
    rpc: async () => ({ data: [], error: null }),
  }),
}));

beforeEach(() => {
  fixture.queries.length = 0;
  fixture.tracks = [];
  fixture.trackError = false;
});

describe("active missing-enrichment warnings", () => {
  it("suppresses a warning when remaining unenriched tracks are confirmed absent", async () => {
    fixture.tracks = [
      { isrc: "REMOVED", spotify_artist_ids: null, spotify_not_found_since: "2026-10-01" },
      { isrc: "RESTORED", spotify_artist_ids: ["artist"], spotify_not_found_since: null },
    ];
    const summary = await recomputeActiveWarningSnapshot("2026-10-11");
    expect(summary.warnings).toEqual([]);
    expect(fixture.queries.find((q) => q.table === "tracks")?.filters)
      .toContainEqual(["is", "spotify_not_found_since", null]);
  });

  it("keeps a mixed warning when an ordinary unenriched track remains", async () => {
    fixture.tracks = [
      { isrc: "MISSING", spotify_artist_ids: null, spotify_not_found_since: null },
      { isrc: "REMOVED", spotify_artist_ids: null, spotify_not_found_since: "2026-10-01" },
    ];
    const summary = await recomputeActiveWarningSnapshot("2026-10-11");
    expect(summary.warnings.map((w) => w.code)).toEqual(["tracks_missing_enrichment"]);
  });

  it("keeps the warning on a failed verification", async () => {
    fixture.trackError = true;
    const summary = await recomputeActiveWarningSnapshot("2026-10-11");
    expect(summary.warnings.map((w) => w.code)).toEqual(["tracks_missing_enrichment"]);
  });
});
