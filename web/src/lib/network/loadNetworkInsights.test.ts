import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_ADMIN_APP_ACCESS } from "@/lib/appAccess";
import { DEFAULT_NETWORK_SCOPE, type NetworkScopeState } from "@/app/(main-flat)/network/networkScope";
import type { CollaborationGraph } from "@/app/(main-flat)/network/networkTypes";
import { loadNetworkInsights } from "./loadNetworkInsights";
import type { NetworkPageShell } from "./loadNetworkPage";
type Row = Record<string, unknown>;
type RequestLog = {
  schema: string;
  table: string;
};
function fixtureClient(failSnapshots = false) {
  const requests: RequestLog[] = [];
  const tables: Record<string, Row[]> = {
    tracks: [
      { isrc: "shared-1", release_date: "2026-09-01", first_seen: "2026-10-01", spotify_artist_ids: ["a", "b"] },
      { isrc: "shared-2", release_date: null, first_seen: "2026-09-02", spotify_artist_ids: ["a", "b"] },
      { isrc: "solo", release_date: null, first_seen: null, spotify_artist_ids: ["a"] },
      { isrc: "foreign", release_date: null, first_seen: null, spotify_artist_ids: ["a"] },
      { isrc: "missing", release_date: "2026-08-01", first_seen: null, spotify_artist_ids: ["c"] },
    ],
    playlists: [{ playlist_key: "main", label_key: "label", is_active: true }, { playlist_key: "other", label_key: "other-label", is_active: true }],
    playlist_memberships: [
      ...["shared-1", "shared-2", "solo", "missing"].map((isrc) => ({ isrc, playlist_key: "main", valid_from: "2026-01-01", valid_to: null })),
      { isrc: "foreign", playlist_key: "other", valid_from: "2026-01-01", valid_to: null },
      { isrc: "shared-1", playlist_key: "other", valid_from: "2026-01-01", valid_to: null },
    ],
    track_daily_streams_effective_public: [
      ...[["shared-1", 100], ["shared-2", 40], ["solo", 70], ["foreign", 10000]].flatMap(([isrc, daily]) => [
        { isrc, date: "2026-10-10", streams_cumulative: 500 },
        { isrc, date: "2026-10-11", streams_cumulative: 500 + Number(daily) },
      ]),
      { isrc: "missing", date: "2026-10-11", streams_cumulative: 200 },
    ],
  };
  const client = { schema: (schema: string) => ({ from: (table: string) => {
        requests.push({ schema, table });
        let rows = [...(tables[table] ?? [])];
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return query; },
          in: (key: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[key])); return query; },
          overlaps: (key: string, values: unknown[]) => { rows = rows.filter((row) => (row[key] as unknown[]).some((value) => values.includes(value))); return query; },
          lte: (key: string, value: string) => { rows = rows.filter((row) => String(row[key]) <= value); return query; },
          lt: (key: string, value: string) => { rows = rows.filter((row) => String(row[key]) < value); return query; },
          or: () => { rows = rows.filter((row) => row.valid_to == null); return query; },
          order: (key: string, options?: {
            ascending?: boolean;
          }) => {
            rows.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0) * (options?.ascending === false ? -1 : 1));
            return query;
          },
          range: (start: number, end: number) => { rows = rows.slice(start, end + 1); return query; },
          limit: (count: number) => { rows = rows.slice(0, count); return query; },
          then: (resolve: (result: {
            data: Row[] | null;
            error: Error | null;
          }) => void) => resolve(failSnapshots && table === "track_daily_streams_effective_public" ? { data: null, error: new Error("Unavailable") } : { data: rows, error: null }),
        };
        return query;
      } }) };
  return { client: client as unknown as SupabaseClient, requests };
}
const graph = (): CollaborationGraph => ({
  nodes: ["a", "b", "c"].map((id) => ({ id, name: id, image_url: null, track_count: 1 })),
  edges: [{ source: "a", target: "b", weight: 2, shared_tracks: [{ isrc: "shared-1", name: "One" }, { isrc: "shared-2", name: "Two" }] }],
});
const playlists = [{ playlist_key: "main", display_name: "Main", spotify_playlist_image_url: null }];
const shell = (datasetMode: "own" | "competitor", crossLabel = false): NetworkPageShell => ({ datasetMode, graphMode: crossLabel ? "cross-label" : "artists", competitorLabelKey: datasetMode === "competitor" ? "label" : null, appAccess: DEFAULT_ADMIN_APP_ACCESS });
describe("network insight enrichment", () => {
  it("uses public metadata/two snapshots and sums each shared track once", async () => {
    const { client, requests } = fixtureClient();
    const input = graph();
    const result = await loadNetworkInsights(client, input, shell("own"), DEFAULT_NETWORK_SCOPE, playlists);
    expect(result.nodes[0].daily_streams).toBe(10210);
    expect(result.nodes[1].daily_streams).toBe(140);
    expect(result.nodes[2].daily_streams).toBeNull();
    expect(result.edges[0].daily_streams).toBe(140);
    expect(result.edges[0].shared_tracks[0].release_date).toBe("2026-09-01");
    expect(result.edges[0].shared_tracks[1].first_seen).toBe("2026-09-02");
    expect(requests.every((request) => request.schema === "public")).toBe(true);
    expect(input.nodes[0].daily_streams).toBeUndefined();
  });
  it("keeps competitor reads and artist streams inside the selected label's memberships", async () => {
    const { client, requests } = fixtureClient();
    const result = await loadNetworkInsights(client, graph(), shell("competitor"), DEFAULT_NETWORK_SCOPE, playlists);
    expect(result.nodes[0].daily_streams).toBe(210);
    expect(result.nodes[1].daily_streams).toBe(140);
    expect(result.edges[0].daily_streams).toBe(140);
    expect(requests.every((request) => request.schema === "competitor")).toBe(true);
  });
  it("deduplicates shared ISRC metrics", async () => {
    const { client } = fixtureClient();
    const input = graph();
    input.edges[0].shared_tracks.push({ ...input.edges[0].shared_tracks[0] });
    const result = await loadNetworkInsights(client, input, shell("own"), DEFAULT_NETWORK_SCOPE, playlists);
    expect(result.edges[0].daily_streams).toBe(140);
  });
  it("honors own playlist and custom any/all/none scopes", async () => {
    const scope = (mode: "any" | "all" | "none"): NetworkScopeState => ({ mode: "custom", playlistKey: null, customPlaylistKeys: ["main", "other"], customPlaylistMode: mode });
    const expected = { any: 10210, all: 100, none: null };
    for (const mode of ["any", "all", "none"] as const) {
      const { client } = fixtureClient();
      const result = await loadNetworkInsights(client, graph(), shell("own"), scope(mode), playlists);
      expect(result.nodes[0].daily_streams).toBe(expected[mode]);
    }
    const { client } = fixtureClient();
    const result = await loadNetworkInsights(client, graph(), shell("own"), { ...DEFAULT_NETWORK_SCOPE, mode: "playlist", playlistKey: "main" }, playlists);
    expect(result.nodes[0].daily_streams).toBe(210);
  });
  it("uses label memberships for cross-label node metrics", async () => {
    const { client, requests } = fixtureClient();
    const input: CollaborationGraph = { nodes: ["label", "other-label"].map((id) => ({ id, name: id, image_url: null, track_count: 1 })), edges: [{ source: "label", target: "other-label", weight: 1, shared_tracks: [{ isrc: "shared-1", name: "One" }] }] };
    const result = await loadNetworkInsights(client, input, shell("competitor", true), DEFAULT_NETWORK_SCOPE, []);
    expect(result.nodes[0].daily_streams).toBe(210);
    expect(result.nodes[1].daily_streams).toBe(10100);
    expect(result.edges[0].daily_streams).toBe(100);
    expect(requests.every((request) => request.schema === "competitor")).toBe(true);
  });
  it("keeps usable dates when stream metrics are unavailable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => { });
    try {
      const { client } = fixtureClient(true);
      const result = await loadNetworkInsights(client, graph(), shell("own"), DEFAULT_NETWORK_SCOPE, playlists);
      expect(result.nodes.every((node) => node.daily_streams == null)).toBe(true);
      expect(result.edges[0].daily_streams).toBeNull();
      expect(result.edges[0].shared_tracks[0].release_date).toBe("2026-09-01");
    }
    finally {
      spy.mockRestore();
    }
  });
});
