/** Opt-in cold-cache benchmark: real loaders, synthetic data, 80ms round trips. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixture = vi.hoisted(() => {
  let mode = "own";
  let invalid = false;
  let revoked = false;
  let savedLabelKey: string | null = "label";
  let rollback: string | null = null;
  let settingsOverrides: Record<string, unknown> = {};
  let healthRows: Array<{ key: string; value_numeric: unknown }> = [];
  let labelState: { shellEmpty?: boolean; liveEmpty?: boolean; liveFailed?: boolean } = {};
  const queries: string[] = [];
  const countPreferences: string[] = [];
  const delay = () => new Promise((resolve) => setTimeout(resolve, 80));
  const history = [{ date: "2026-10-09", track_count: 1, total_streams_cumulative: 1000, daily_streams_net: 100, est_revenue_total: null, est_revenue_daily_net: null, source_run_id: "run" }];
  function client(schema = "public") {
    return {
      auth: {
        getUser: async () => { await delay(); return { data: { user: invalid || revoked ? null : { id: "fixture", email: "fixture@example.invalid" } } }; },
        getClaims: async () => ({ data: invalid ? null : { claims: { sub: "fixture", email: "fixture@example.invalid" } }, error: invalid ? new Error("invalid") : null }),
      },
      schema: (name: string) => client(name),
      from: (name: string) => builder(schema, name),
      rpc: (name: string, args?: unknown, options?: { count?: string }) => {
        if (options?.count) countPreferences.push(`${schema}.${name}:${options.count}`);
        return builder(schema, name, args);
      },
    };
  }
  function builder(schema: string, name: string, args?: unknown) {
    const steps: unknown[] = [];
    let single = false;
    let selection = "";
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "gte", "lte", "not", "or", "order", "limit", "range", "maybeSingle", "single", "contains"]) {
      query[method] = (...values: unknown[]) => {
        steps.push([method, ...values]);
        if (method === "select") selection = String(values[0]);
        if (method === "maybeSingle" || method === "single") single = true;
        return query;
      };
    }
    query.setHeader = (header: string, value: string) => {
      expect(header).toBe("Prefer");
      expect(value).toBe("count=exact");
      countPreferences.push(`${schema}.${name}:exact`);
      return query;
    };
    query.then = async (resolve: (value: unknown) => unknown) => {
      queries.push(JSON.stringify([schema, name, args, steps]));
      await delay();
      let data: unknown = [];
      if (name === "is_admin") data = true;
      else if (name === "app_user_access") data = { own_catalog: true, competitor: mode === "competitor" };
      else if (name === "user_settings") data = { dataset_mode: mode, competitor_label_key: savedLabelKey, hide_stale_override_annotations: false, ...settingsOverrides };
      else if (name === "health_config") data = healthRows;
      else if (name === "spotibase_override_version") data = "1-1";
      else if (name === "labels") {
        if (labelState.liveFailed) return resolve({ data: null, error: { message: "labels unavailable" }, count: 0 });
        data = labelState.liveEmpty ? [] : [{ label_key: "label", display_name: "Label" }];
      }
      else if (name === "playlists") data = selection.includes("playlist_key") ? [{ playlist_key: "all_catalog", display_name: "All Catalog", is_catalog: true }] : [];
      else if (name === "playlist_daily_stats") data = history;
      else if (name === "track_daily_stream_overrides") data = selection === "id" ? [{ id: 1 }] : [{ date: "2026-10-09", isrc: "ISRC", note: "Manual" }];
      else if (name === "tracks") data = [{ isrc: "ISRC", name: "Track", spotify_artist_ids: ["artist"], spotify_artist_names: ["Artist"], release_date: "2026-01-01", spotify_album_image_url: null }];
      else if (name === "catalog_artist_options") data = [{ id: "artist", name: "Artist" }];
      else if (name === "track_daily_streams") data = [{ date: "2026-10-09" }];
      else if (name === "home_track_scatter_points" || name === "home_track_scatter_points_for_label") {
        data = Array.from({ length: 6500 }, (_, i) => ({ isrc: `S${i === 1000 ? 999 : i}`, name: `Scatter ${i}`, release_date: "2026-01-01", total_streams_cumulative: 10000 + i, daily_streams_delta: i, has_prev_day: true }));
      }
      else if (name === "track_daily_streams_effective_public") data = Array.from({ length: 3500 }, (_, i) => ({ date: "2026-10-09", streams_cumulative: 10000 - i }));
      else if (name === "catalog_artist_series_fast" || name === "catalog_artist_series_for_label") data = [{ date: "2026-10-08", streams_cumulative: 900 }, { date: "2026-10-09", streams_cumulative: 1000 }];
      else if (name === "catalog_artist_top_tracks_total" || name === "catalog_artist_top_tracks_daily") data = [{ isrc: "ISRC", name: "Track", total: 1000, daily: 100, album_image_url: null }];
      else if (name.startsWith("home_") && !name.includes("scatter")) data = [{ isrc: "ISRC", name: "Track", date: "2026-10-09", daily_streams: 100, streams_cumulative: 1000 }];
      else if (name === "playlist_memberships") data = [{ playlist_key: "releases", isrc: "ISRC", valid_from: "2026-10-01", valid_to: null }];
      else if (name === "playlists_latest_track_counts") data = [{ playlist_key: "all_catalog", track_count: 1 }];
      else if (name === "playlist_dashboard_summary") data = null;
      else if (name === "playlist_distinct_artist_count") data = 1;
      const count = Array.isArray(data) ? data.length : 1;
      const range = steps.find((step) => Array.isArray(step) && step[0] === "range") as [string, number, number] | undefined;
      if (range && Array.isArray(data)) data = data.slice(range[1], range[2] + 1);
      if (single && Array.isArray(data)) data = data[0] ?? null;
      return resolve({ data, error: null, count });
    };
    return query;
  }
  return { client, queries, countPreferences,
    setMode: (value: string) => { mode = value; },
    setInvalid: (value: boolean) => { invalid = value; },
    setRevoked: (value: boolean) => { revoked = value; },
    configure: (label: string | null = "label", rollbackDate: string | null = null, overrides: Record<string, unknown> = {}, health: typeof healthRows = [], labels: typeof labelState = {}) => {
      savedLabelKey = label; rollback = rollbackDate; settingsOverrides = overrides; healthRows = health;
      labelState = labels;
    },
    shellLabels: () => labelState.shellEmpty ? [] : [{ label_key: "label", display_name: "Label", image_url: null, accent_hex: "abcdef" }],
    cookie: () => rollback ? { value: rollback } : undefined,
  };
});
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => fixture.client() }));
vi.mock("@/lib/supabase/service", () => ({ supabaseService: () => fixture.client() }));
vi.mock("@/lib/competitorContext.server", async (original) => ({ ...await original<object>(), loadCompetitorLabelsWithImages: async () => fixture.shellLabels() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => fixture.cookie() }) }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

vi.mock("@/app/(main-flat)/playlists/PlaylistTracksSection", () => ({ PlaylistTracksSection: function PlaylistTracksSection() { return null; } }));
vi.mock("@/lib/spotify", () => ({ getArtistsCached: async () => new Map() }));

import { NextRequest } from "next/server";
import { GET as diagnosticsGET } from "@/app/api/home/diagnostics/route";
import { GET as scatterGET } from "@/app/api/home/scatter/route";
import CatalogPage from "@/app/(main-flat)/catalog/page";
import { getRequestAppContext } from "@/lib/requestAppContext.server";
import { loadHomeDashboardData, loadHomeDiagnosticsDataForUser, loadHomeScatterDataForUser, loadHomeScatterPoints } from "@/lib/home/loadHomeDashboard";
import { resolveHomeDataset } from "@/lib/home/homeDataset.server";
import { normalizeHomeDiagnosticsApiPayload } from "@/lib/home/homeDiagnosticsApi";
import HomePage from "@/app/(main-flat)/page";
import { getNavigationDefaults } from "@/components/shell/navigationDefaults.server";
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

// Debug equality without losing values that JSON's normal representation hides.
function canonical(value: unknown): unknown {
  if (value === undefined) return { $value: "undefined" };
  if (typeof value === "number") {
    if (Object.is(value, -0)) return { $value: "-0" };
    if (!Number.isFinite(value)) return { $value: String(value) };
  }
  if (Array.isArray(value)) return Array.from({ length: value.length }, (_, i) =>
    i in value ? canonical(value[i]) : { $value: "array hole" });
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
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
      for (const [label, run] of [
        ["diagnostics", async () => (await diagnosticsGET(new NextRequest("https://fixture.invalid/api/home/diagnostics"))).json()],
        ["scatter", async () => (await scatterGET(new NextRequest("https://fixture.invalid/api/home/scatter"))).json()],
        ["catalog", () => resolveServer(CatalogPage({ searchParams: Promise.resolve({ artist_id: "artist", isrc: "ISRC" }) }))],
      ] as const) {
        fixture.queries.length = 0;
        fixture.countPreferences.length = 0;
        const start = performance.now();
        const output = await run();
        process.stdout.write(`[perf] ${mode}.${label} ${(performance.now() - start).toFixed(1)} ms\n`);
        results[`${mode}.${label}`] = { output, queries: [...fixture.queries].sort() };
        expect(fixture.countPreferences).toEqual(label === "scatter"
          ? [`${mode === "own" ? "public.home_track_scatter_points" : "competitor.home_track_scatter_points_for_label"}:exact`]
          : label === "catalog" && mode === "own" ? ["public.track_daily_streams_effective_public:exact"] : []);
      }
    }
    const file = join(tmpdir(), "streambase-web-load-baseline.json");
    const normalized = JSON.parse(JSON.stringify(results, (key, value) => key === "type" && (typeof value === "object" || typeof value === "function") ? (value?.displayName ?? value?.name ?? "component") : key === "_owner" || key === "_store" ? undefined : value));
    if (process.env.STREAMBASE_PERF_DIFF === "1") {
      writeFileSync(join(tmpdir(), "streambase-web-load-actual.canonical.json"), JSON.stringify(canonical(normalized), null, 2));
      writeFileSync(join(tmpdir(), "streambase-web-load-expected.canonical.json"), JSON.stringify(canonical(JSON.parse(readFileSync(file, "utf8"))), null, 2));
    }
    if (process.env.STREAMBASE_PERF_BASELINE === "1") writeFileSync(file, JSON.stringify(normalized));
    else {
      const baseline = JSON.parse(readFileSync(file, "utf8"));
      // Keep the captured baseline immutable. Assert ONLY the intended API read
      // replacements, by exact signature, and compare every other query verbatim.
      for (const mode of ["own", "competitor"]) {
        for (const label of ["diagnostics", "scatter"]) {
          const key = `${mode}.${label}`;
          expect(normalized[key].output).toEqual(baseline[key].output);
          const expectedQueries: string[] = [...baseline[key].queries];
          const replaceRead = (oldSignature: string, newSignature?: string) => {
            expect(expectedQueries.filter((q) => q === oldSignature)).toHaveLength(1);
            expectedQueries.splice(expectedQueries.indexOf(oldSignature), 1);
            if (newSignature) expectedQueries.push(newSignature);
          };
          replaceRead(JSON.stringify(["public", "user_settings", null, [
            ["select", label === "diagnostics"
              ? "hide_stale_override_annotations, artificial_streams_spike_ratio, artificial_streams_include_weekends_user, dataset_mode, competitor_label_key"
              : "dataset_mode,competitor_label_key"],
            ["eq", "user_id", "fixture"], ["maybeSingle"],
          ]]), JSON.stringify(["public", "user_settings", null, [
            ["select", "dataset_mode,competitor_label_key,hide_stale_override_annotations,hide_stale_annotations_exclude_catalog,artificial_streams_spike_ratio,artificial_streams_include_weekends_user"],
            ["eq", "user_id", "fixture"], ["maybeSingle"],
          ]]));
          if (mode === "competitor") replaceRead(JSON.stringify([
            "competitor", "labels", null, [["select", "display_name"], ["eq", "label_key", "label"], ["maybeSingle"]],
          ]));
          expect(normalized[key].queries).toEqual(expectedQueries.sort());
          // Restore the captured signatures only after checking the exact delta,
          // so the original aggregate equality assertion remains unchanged.
          normalized[key].queries = baseline[key].queries;
        }
      }
      expect(normalized).toEqual(baseline);
    }
    fixture.setInvalid(true);
    const context = await getRequestAppContext();
    expect(context.user).toBeNull();
    expect(context.isAdmin).toBe(false);
    fixture.setInvalid(false);
    perfLog.mockRestore();
  }, 60000);
});

// Always run the authorization regression; the timing comparison remains opt-in.
describe("Home API loader equivalence", () => {
  it("falls back to live labels when cached shell labels are empty", async () => {
    fixture.setMode("competitor");
    fixture.configure(null, null, {}, [], { shellEmpty: true });
    try {
      const context = await getRequestAppContext();
      fixture.queries.length = 0;
      const selection = await resolveHomeDataset({ svc: context.svc, settings: context.settings, labels: context.shellContext.competitorLabels });
      expect(selection).toEqual({ datasetMode: "competitor", competitorLabelKey: "__all__", competitorLabelName: "All Competitors" });
      expect(fixture.queries.map((q) => JSON.parse(q).slice(0, 2))).toEqual([["competitor", "labels"]]);
      const scatter = await loadHomeScatterDataForUser({ svc: context.svc, userId: "fixture", sp: {}, context });
      expect(scatter.points).toHaveLength(6499);
      expect(fixture.queries.some((q) => {
        const [schema, name] = JSON.parse(q);
        return schema === "public" && ["playlist_daily_stats", "home_track_scatter_points"].includes(name);
      })).toBe(false);
    } finally { fixture.configure(); }
  });

  for (const unavailable of ["empty", "failed"] as const) {
    it(`never reads public analytics when live competitor labels are ${unavailable}`, async () => {
      fixture.setMode("competitor");
      fixture.configure(null, null, {}, [], { shellEmpty: true, liveEmpty: unavailable === "empty", liveFailed: unavailable === "failed" });
      try {
        const context = await getRequestAppContext();
        fixture.queries.length = 0;
        for (const sp of [{}, { xy_date: "2026-10-06" }]) {
          const scatter = await loadHomeScatterDataForUser({ svc: context.svc, userId: "fixture", sp, context });
          expect(scatter).toEqual({ points: [], errorMessage: null, dataDate: sp.xy_date ?? null });
        }
        // A direct caller with a known date must also be unable to select own data.
        expect(await loadHomeScatterPoints({ svc: context.svc, datasetMode: "competitor", competitorLabelKey: null,
          competitorLabelName: null, selectedRunDate: "2026-10-09" })).toEqual({ points: [], errorMessage: null });
        await loadHomeDiagnosticsDataForUser({ sb: context.sb, svc: context.svc, userId: "fixture", sp: {}, context });
        await loadHomeDashboardData({ sb: context.sb, svc: context.svc, userId: "fixture", sp: {}, settings: context.settings,
          includeScatter: true, includeDiagnostics: true });
        expect(fixture.queries.some((q) => {
          const [schema, name] = JSON.parse(q);
          return schema === "public" && (name === "playlist_daily_stats" || name.startsWith("home_"));
        })).toBe(false);
      } finally { fixture.configure(); }
    });
  }

  it("returns 401 for revoked Home API sessions without analytics queries", async () => {
    fixture.setMode("competitor");
    fixture.setRevoked(true);
    try {
      for (const [path, route] of [["diagnostics", diagnosticsGET], ["scatter", scatterGET]] as const) {
        fixture.queries.length = 0;
        const response = await route(new NextRequest(`https://fixture.invalid/api/home/${path}`));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ success: false, error: "unauthenticated" });
        expect(fixture.queries.map((q) => JSON.parse(q)[1]).sort()).toEqual(["app_user_access", "is_admin", "user_settings"]);
      }
    } finally { fixture.setRevoked(false); }
  });

  for (const revoked of [false, true]) {
    it(`rejects ${revoked ? "revoked" : "invalid"} API sessions before analytics`, async () => {
      fixture.setInvalid(!revoked);
      fixture.setRevoked(revoked);
      fixture.queries.length = 0;
      try {
        for (const route of [diagnosticsGET, scatterGET]) {
          const response = await route(new NextRequest("https://fixture.invalid/api/home/diagnostics"));
          expect(response.status).toBe(401);
          expect(await response.json()).toEqual({ success: false, error: "unauthenticated" });
        }
        expect(fixture.queries.every((q) => ["is_admin", "app_user_access", "user_settings"].includes(JSON.parse(q)[1]))).toBe(true);
      } finally {
        fixture.setInvalid(false);
        fixture.setRevoked(false);
      }
    });
  }
  for (const mode of ["own", "competitor"]) {
    for (const label of ["label", "__all__", null, "inactive"]) {
      it(`keeps diagnostic payloads for ${mode}/${label ?? "unset"} with custom ranges and overrides`, async () => {
        fixture.setMode(mode);
        fixture.configure(label, "2026-10-05", {
          artificial_streams_spike_ratio: 2.75, artificial_streams_include_weekends_user: false,
        }, [{ key: "artificial_streams_include_weekends", value_numeric: 1 }, { key: "artificial_streams_min_baseline", value_numeric: "125" }]);
        try {
          const context = await getRequestAppContext();
          const sp = { start: "2026-10-01", end: "2026-10-06", scope: "releases" };
          const args = { sb: context.sb, svc: context.svc, userId: "fixture", sp };
          const original = await loadHomeDashboardData({ ...args, includeScatter: false, includeDiagnostics: true, diagnosticsOnly: true });
          const expected = normalizeHomeDiagnosticsApiPayload({ ...original, errorMessage: original.homeDiagnosticsErrorMessage });
          const actual = await loadHomeDiagnosticsDataForUser({ ...args, context });
          expect(actual).toStrictEqual(expected);
        } finally { fixture.configure(); }
      });
    }
  }

  it("reuses null settings rather than querying them again", async () => {
    fixture.setMode("own");
    const context = await getRequestAppContext();
    fixture.queries.length = 0;
    await loadHomeDiagnosticsDataForUser({ sb: context.sb, svc: context.svc, userId: "fixture", sp: {}, context: { ...context, settings: null } });
    expect(fixture.queries.map((q) => JSON.parse(q)[1])).not.toContain("user_settings");
  });

  for (const label of ["label", "__all__", null, "inactive"]) {
    it(`keeps scatter output and order when reusing ${label ?? "unset"} context`, async () => {
      fixture.setMode("competitor");
      fixture.configure(label);
      try {
        const context = await getRequestAppContext();
        const args = { svc: context.svc, userId: "fixture", sp: { xy_date: "2026-10-06" } };
        const before = await loadHomeScatterDataForUser(args);
        const after = await loadHomeScatterDataForUser({ ...args, context });
        expect(after).toStrictEqual(before);
      } finally { fixture.configure(); }
    });
  }
});

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
  it("rejects a revoked session even when its token claims still verify", async () => {
    fixture.setRevoked(true);
    try {
      const context = await getRequestAppContext();
      expect(context.user).toBeNull();
      expect(context.isAdmin).toBe(false);
      expect(context.settings).toBeNull();
      await expect(HomePage({})).rejects.toThrow("redirect:/login");
    } finally {
      fixture.setRevoked(false);
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


describe("Catalog navigation default rendering", () => {
  function clientProps(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value)) {
      for (const child of value) { const found = clientProps(child); if (found) return found; }
      return null;
    }
    if (!value || typeof value !== "object" || !("props" in value)) return null;
    const element = value as { type: string; props: Record<string, unknown> };
    return element.type === "CatalogPageClient" ? element.props : clientProps(element.props.children);
  }
  for (const mode of ["own", "competitor"] as const) {
    it(`renders bare and artist-only ${mode} entries identically to their resolved deep link`, async () => {
      fixture.setMode(mode);
      fixture.configure("label");
      const explicit = clientProps(await resolveServer(CatalogPage({ searchParams: Promise.resolve({ artist_id: "artist", isrc: "ISRC" }) })));
      expect(explicit).not.toBeNull();
      for (const search of [{}, { artist_id: "artist" }]) {
        fixture.queries.length = 0;
        const resolved = clientProps(await resolveServer(CatalogPage({ searchParams: Promise.resolve(search) })));
        expect(resolved).toEqual(explicit);
        const queries = fixture.queries.map((query) => JSON.parse(query) as [string, string]);
        if (mode === "competitor") {
          expect(queries.some(([schema, table]) => schema === "public" && ["tracks", "playlist_daily_stats", "playlist_memberships"].includes(table))).toBe(false);
        } else {
          expect(queries.some(([schema]) => schema === "competitor")).toBe(false);
        }
      }
    });
  }
});


describe("server navigation defaults", () => {
  it("resolves own entry points without extra own-catalog hot-path reads", async () => {
    fixture.queries.length = 0;
    expect(await getNavigationDefaults("own")).toEqual({ datasetMode: "own" });
    expect(fixture.queries).toEqual([]);
  });
  for (const label of ["label", "__all__"]) {
    it(`scopes ordered competitor playlist defaults to ${label}`, async () => {
      fixture.setMode("competitor");
      fixture.configure(label);
      fixture.queries.length = 0;
      try {
        expect(await getNavigationDefaults("competitor")).toEqual({ datasetMode: "competitor", competitorLabelKey: label, playlistKeys: ["all_catalog"] });
        const queries = fixture.queries.map((query) => JSON.parse(query) as [string, string, unknown, unknown[]]);
        const playlistQuery = queries.find(([schema, table]) => schema === "competitor" && table === "playlists");
        expect(playlistQuery).toBeDefined();
        expect(playlistQuery?.[3]).toContainEqual(["eq", "is_active", true]);
        expect(playlistQuery?.[3]).toContainEqual(["order", "display_order", { ascending: true, nullsFirst: false }]);
        expect(playlistQuery?.[3]).toContainEqual(["order", "display_name", { ascending: true }]);
        if (label === "label") expect(playlistQuery?.[3]).toContainEqual(["eq", "label_key", label]);
        else expect(playlistQuery?.[3]).not.toContainEqual(["eq", "label_key", "__all__"]);
        expect(queries.some(([schema, table]) => schema === "public" && ["tracks", "playlists", "playlist_daily_stats"].includes(table))).toBe(false);
      } finally { fixture.configure(); }
    });
  }
});
