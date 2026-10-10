/** Opt-in cold-cache benchmark: real loaders, synthetic data, 80ms round trips. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixture = vi.hoisted(() => {
  let mode = "own";
  let invalid = false;
  const queries: string[] = [];
  const delay = () => new Promise((resolve) => setTimeout(resolve, 80));
  const history = [{ date: "2026-10-09", track_count: 1, total_streams_cumulative: 1000, daily_streams_net: 100, est_revenue_total: null, est_revenue_daily_net: null, source_run_id: "run" }];
  function client(schema = "public") {
    return {
      auth: {
        getUser: async () => { await delay(); return { data: { user: invalid ? null : { id: "fixture", email: "fixture@example.invalid" } } }; },
        getClaims: async () => ({ data: invalid ? null : { claims: { sub: "fixture", email: "fixture@example.invalid" } }, error: invalid ? new Error("invalid") : null }),
      },
      schema: (name: string) => client(name),
      from: (name: string) => builder(schema, name),
      rpc: (name: string, args?: unknown) => builder(schema, name, args),
    };
  }
  function builder(schema: string, name: string, args?: unknown) {
    const steps: unknown[] = [];
    let single = false;
    let selection = "";
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "not", "or", "order", "limit", "range", "maybeSingle", "single"]) {
      query[method] = (...values: unknown[]) => {
        steps.push([method, ...values]);
        if (method === "select") selection = String(values[0]);
        if (method === "maybeSingle" || method === "single") single = true;
        return query;
      };
    }
    query.then = async (resolve: (value: unknown) => unknown) => {
      queries.push(JSON.stringify([schema, name, args, steps]));
      await delay();
      let data: unknown = [];
      if (name === "is_admin") data = true;
      else if (name === "app_user_access") data = { own_catalog: true, competitor: mode === "competitor" };
      else if (name === "user_settings") data = { dataset_mode: mode, competitor_label_key: "label", hide_stale_override_annotations: false };
      else if (name === "spotibase_override_version") data = "1-1";
      else if (name === "labels") data = [{ label_key: "label", display_name: "Label" }];
      else if (name === "playlists") data = selection.includes("playlist_key") ? [{ playlist_key: "all_catalog", display_name: "All Catalog", is_catalog: true }] : [];
      else if (name === "playlist_daily_stats") data = history;
      else if (name === "track_daily_stream_overrides") data = selection === "id" ? [{ id: 1 }] : [{ date: "2026-10-09", isrc: "ISRC", note: "Manual" }];
      else if (name === "tracks") data = [{ isrc: "ISRC", name: "Track", spotify_artist_names: ["Artist"], release_date: null }];
      else if (name === "playlist_memberships") data = [{ playlist_key: "releases", isrc: "ISRC", valid_from: "2026-10-01", valid_to: null }];
      else if (name === "playlists_latest_track_counts") data = [{ playlist_key: "all_catalog", track_count: 1 }];
      else if (name === "playlist_dashboard_summary") data = null;
      else if (name === "playlist_distinct_artist_count") data = 1;
      if (single && Array.isArray(data)) data = data[0] ?? null;
      return resolve({ data, error: null, count: 1 });
    };
    return query;
  }
  return { client, queries, setMode: (value: string) => { mode = value; }, setInvalid: (value: boolean) => { invalid = value; } };
});
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => fixture.client() }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => fixture.client() }));
vi.mock("@/lib/competitorContext.server", async (original) => ({ ...await original<object>(), loadCompetitorLabelsWithImages: async () => [{ label_key: "label", display_name: "Label", image_url: null, accent_hex: "abcdef" }] }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

vi.mock("@/app/(main-flat)/playlists/PlaylistTracksSection", () => ({ PlaylistTracksSection: function PlaylistTracksSection() { return null; } }));

import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { loadHomeDashboardData } from "@/lib/home/loadHomeDashboard";
import HomePage from "@/app/(main-flat)/page";
import PlaylistsPage from "@/app/(main-flat)/playlists/page";

// Resolve async server boundaries, preserving client props for equality checks.
async function resolveServer(value: unknown): Promise<unknown> {
  value = await value;
  if (Array.isArray(value)) return Promise.all(value.map(resolveServer));
  if (!value || typeof value !== "object" || !("props" in value)) return value;
  const element = value as { type: { name?: string; constructor?: { name: string } }; props: Record<string, unknown> };
  if (element.type?.constructor?.name === "AsyncFunction") return resolveServer((element.type as unknown as (props: unknown) => unknown)(element.props));
  const props = { ...element.props };
  if (props.children) props.children = await resolveServer(props.children);
  if (typeof element.type === "symbol") return props.children;
  return { type: element.type?.name ?? String(element.type), props };
}

describe.skipIf(process.env.STREAMBASE_PERF_LOG !== "1")("web load benchmark", () => {
  it("records outputs and query sets in both universes", async () => {
    process.env.STREAMBASE_PERF_LOG = "1";
    const perfLog = vi.spyOn(console, "info").mockImplementation((message) => process.stdout.write(`${message}\n`));
    const results: Record<string, unknown> = {};
    for (const mode of ["own", "competitor"]) {
      process.stdout.write(`Benchmark dataset=${mode}\n`);
      fixture.setMode(mode);
      const context = await getRequestAppContext();
      fixture.queries.length = 0;
      const home = await loadHomeDashboardData({ sb: context.sb, svc: context.svc, userId: "fixture", sp: {}, settings: context.settings, includeScatter: false, includeDiagnostics: false });
      results[`${mode}.home`] = { output: home, queries: [...fixture.queries].sort() };
      fixture.queries.length = 0;
      const playlists = await resolveServer(PlaylistsPage({ searchParams: Promise.resolve({ playlist_key: "all_catalog" }) }));
      results[`${mode}.playlists`] = { output: playlists, queries: [...fixture.queries].sort() };
    }
    const file = join(tmpdir(), "streambase-web-load-baseline.json");
    const normalized = JSON.parse(JSON.stringify(results, (key, value) => key === "type" && (typeof value === "object" || typeof value === "function") ? (value?.displayName ?? value?.name ?? "component") : key === "_owner" || key === "_store" ? undefined : value));
    if (process.env.STREAMBASE_PERF_BASELINE === "1") writeFileSync(file, JSON.stringify(normalized));
    else expect(normalized).toEqual(JSON.parse(readFileSync(file, "utf8")));
    fixture.setInvalid(true);
    const context = await getRequestAppContext();
    expect(context.user).toBeNull();
    expect(context.isAdmin).toBe(false);
    fixture.setInvalid(false);
    perfLog.mockRestore();
  }, 30000);
});

// Always run the authorization regression; the timing comparison remains opt-in.
describe("request identity gate", () => {
  it("redirects invalid identities before any access or analytics queries", async () => {
    fixture.setInvalid(true);
    fixture.queries.length = 0;
    try {
      const context = await getRequestAppContext();
      expect(context.user).toBeNull();
      expect(context.isAdmin).toBe(false);
      await expect(HomePage({})).rejects.toThrow("redirect:/login");
      await expect(resolveServer(PlaylistsPage({}))).rejects.toThrow("redirect:/login");
      expect(fixture.queries).toEqual([]);
    } finally {
      fixture.setInvalid(false);
    }
  });
  it("keeps invalid playlist redirects from issuing summary/annotation queries", async () => {
    fixture.setMode("own");
    fixture.queries.length = 0;
    await expect(resolveServer(PlaylistsPage({ searchParams: Promise.resolve({ playlist_key: "missing" }) })))
      .rejects.toThrow("redirect:/playlists?playlist_key=all_catalog");
    const queries = fixture.queries.map((query) => JSON.parse(query)[1]);
    expect(queries).not.toContain("playlist_dashboard_summary");
    expect(queries).not.toContain("tracks");
    expect(queries).not.toContain("playlist_removed_tracks");
  });

});
