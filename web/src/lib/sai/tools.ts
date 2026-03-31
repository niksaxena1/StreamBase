import type { SupabaseClient } from "@supabase/supabase-js";

import type { SaiToolCall } from "./types";

/** Whitelisted data templates (safe RPCs only). */
export const DATA_QUERY_TEMPLATE_IDS = [
  "system_stats",
  "artist_total_streams",
  "playlist_total_streams",
  "track_total_streams",
  "artist_series",
  "track_series",
  "playlist_series",
  "artist_top_tracks_total",
  "artist_top_tracks_daily",
  "playlist_top_tracks_total",
] as const;

export type DataQueryTemplateId = (typeof DATA_QUERY_TEMPLATE_IDS)[number];

export type DataQueryPlan = {
  templateId: DataQueryTemplateId;
  params: Record<string, unknown>;
};

export type DataQueryResult = {
  toolCall: SaiToolCall;
  payload: unknown;
};

async function latestRunDate(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from("playlist_daily_stats")
    .select("date")
    .eq("playlist_key", "all_catalog")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as { date?: string } | null)?.date ?? null;
}

function asDateString(x: unknown): string | null {
  const s = String(x ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function asInt(x: unknown, fallback: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatInt(n: unknown): string {
  const x = Number(n ?? 0);
  return Intl.NumberFormat().format(Number.isFinite(x) ? x : 0);
}

function dateMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function summarizeSeries(rows: unknown[], valueKey: string): { first?: unknown; last?: unknown; delta?: number } {
  if (!Array.isArray(rows) || rows.length === 0) return {};
  const first = rows[0] as Record<string, unknown>;
  const last = rows[rows.length - 1] as Record<string, unknown>;
  const a = Number(first?.[valueKey] ?? 0);
  const b = Number(last?.[valueKey] ?? 0);
  return { first, last, delta: Number.isFinite(a) && Number.isFinite(b) ? b - a : undefined };
}

export function formatDataPayload(templateId: DataQueryTemplateId, payload: unknown): string {
  try {
    if (!payload) return "No data.";

    const p = payload as Record<string, unknown>;

    if (templateId === "system_stats") {
      return [
        `tracks=${p.tracks ?? "—"}`,
        `playlists=${p.playlists ?? "—"}`,
        `artists_distinct=${p.artists_distinct ?? "—"}`,
        `as_of_run_date=${p.as_of_run_date ?? "—"}`,
      ].join("\n");
    }

    if (templateId === "artist_total_streams" || templateId === "playlist_total_streams" || templateId === "track_total_streams") {
      return `Total streams: ${formatInt(p?.streams ?? 0)}`;
    }

    if (templateId === "artist_series" || templateId === "track_series" || templateId === "playlist_series") {
      const rowsArr = Array.isArray(p?.rows) ? (p.rows as unknown[]) : [];
      const range = p?.range as { start_date?: string; end_date?: string } | undefined;
      const rangeStr = range ? `${range.start_date} → ${range.end_date}` : "";
      if (templateId === "playlist_series") {
        const s = summarizeSeries(rowsArr, "total_streams_cumulative");
        const last = s.last as Record<string, unknown> | null | undefined;
        const dailySum = rowsArr.reduce(
          (acc: number, r) => acc + Number((r as Record<string, unknown>)?.daily_streams_net ?? 0),
          0,
        );
        return [
          `Series rows: ${rowsArr.length}${rangeStr ? ` (${rangeStr})` : ""}`,
          last
            ? `Latest (${last.date}): total=${formatInt(last.total_streams_cumulative)} daily=${formatInt(last.daily_streams_net)} tracks=${formatInt(last.track_count)}`
            : "Latest: —",
          `Net change over range: ${formatInt(s.delta ?? 0)} (sum of daily: ${formatInt(dailySum)})`,
        ].join("\n");
      }
      if (templateId === "track_series") {
        const s = summarizeSeries(rowsArr, "streams_cumulative");
        const last = s.last as Record<string, unknown> | null | undefined;
        return [
          `Series rows: ${rowsArr.length}${rangeStr ? ` (${rangeStr})` : ""}`,
          last ? `Latest (${last.date}): total=${formatInt(last.streams_cumulative)}` : "Latest: —",
          `Net change over range: ${formatInt(s.delta ?? 0)}`,
        ].join("\n");
      }
      if (templateId === "artist_series") {
        const s = summarizeSeries(rowsArr, "streams_cumulative");
        const last = s.last as Record<string, unknown> | null | undefined;
        return [
          `Series rows: ${rowsArr.length}${rangeStr ? ` (${rangeStr})` : ""}`,
          last ? `Latest (${last.date}): total=${formatInt(last.streams_cumulative)}` : "Latest: —",
          `Net change over range: ${formatInt(s.delta ?? 0)}`,
        ].join("\n");
      }

      return `Series rows: ${rowsArr.length}${rangeStr ? ` (${rangeStr})` : ""}`;
    }

    if (templateId.endsWith("_top_tracks_total") || templateId === "artist_top_tracks_daily") {
      const rowsArr = Array.isArray(p?.rows) ? (p.rows as Record<string, unknown>[]) : [];
      const top = rowsArr.slice(0, 10);
      const lines = top.map((r, i) => {
        const name = String(r?.name ?? r?.isrc ?? "—");
        const total = r?.total != null ? `total=${formatInt(r.total)}` : `total=${formatInt(r?.streams_cumulative ?? 0)}`;
        const daily = r?.daily != null ? ` daily=${formatInt(r.daily)}` : "";
        const isrc = r?.isrc ? ` (${String(r.isrc)})` : "";
        return `${i + 1}. ${name}${isrc} — ${total}${daily}`;
      });
      return [`Top tracks returned: ${rowsArr.length}`, ...(lines.length ? ["", ...lines] : [])].join("\n");
    }
  } catch {
    // ignore
  }

  return `Payload: ${JSON.stringify(payload)}`;
}

function isTemplateId(id: string): id is DataQueryTemplateId {
  return (DATA_QUERY_TEMPLATE_IDS as readonly string[]).includes(id);
}

/**
 * Resolve artist / track / playlist by name (or partial name). Returns raw `search_all` rows.
 */
export async function searchEntities(
  sb: SupabaseClient,
  q: string,
  max_results: number,
): Promise<{ toolCall: SaiToolCall; rows: unknown[]; error?: string }> {
  const mr = clamp(max_results, 1, 30);
  const query = String(q ?? "").trim();
  if (!query) {
    return {
      toolCall: {
        tool: "search_entities",
        params: { q: query, max_results: mr },
        rowCount: 0,
        notes: "Empty query",
      },
      rows: [],
    };
  }

  const { data, error } = await sb.rpc("search_all", { q: query, max_results: mr });
  if (error) {
    return {
      toolCall: {
        tool: "search_entities",
        params: { q: query, max_results: mr },
        rowCount: null,
        notes: error.message,
      },
      rows: [],
      error: error.message,
    };
  }

  const rows = Array.isArray(data) ? data : [];
  return {
    toolCall: {
      tool: "search_entities",
      params: { q: query, max_results: mr },
      rowCount: rows.length,
      notes: "search_all()",
    },
    rows,
  };
}

export async function runDataQuery(sb: SupabaseClient, plan: DataQueryPlan): Promise<DataQueryResult> {
  if (!isTemplateId(plan.templateId)) {
    return {
      toolCall: {
        tool: "data_query",
        templateId: plan.templateId,
        params: plan.params,
        rowCount: null,
        notes: `Unknown templateId: ${plan.templateId}`,
      },
      payload: null,
    };
  }

  const templateId = plan.templateId;
  const runDateDefault = await latestRunDate(sb);

  if (templateId === "system_stats") {
    const { data, error } = await sb.rpc("spotibase_system_stats");
    if (error) {
      return {
        toolCall: {
          tool: "data_query",
          templateId: "system_stats",
          params: {},
          rowCount: null,
          notes: `rpc error: ${error.message}`,
        },
        payload: null,
      };
    }
    return {
      toolCall: {
        tool: "data_query",
        templateId: "system_stats",
        params: {},
        rowCount: null,
        notes: "Derived from spotibase_system_stats()",
      },
      payload: data,
    };
  }

  if (templateId === "artist_total_streams") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    if (!artist_id || !run_date) {
      return {
        toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or run_date" },
        payload: null,
      };
    }
    const { data, error } = await sb.rpc("artist_total_streams_for_date", { artist_id, run_date });
    if (error) {
      return { toolCall: { tool: "data_query", templateId, params: { artist_id, run_date }, rowCount: null, notes: error.message }, payload: null };
    }
    return {
      toolCall: { tool: "data_query", templateId, params: { artist_id, run_date }, rowCount: 1, notes: "artist_total_streams_for_date()" },
      payload: { artist_id, run_date, streams: Number(data ?? 0) },
    };
  }

  if (templateId === "playlist_total_streams") {
    const playlist_key = String(plan.params.playlist_key ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    if (!playlist_key || !run_date) {
      return {
        toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing playlist_key or run_date" },
        payload: null,
      };
    }
    const { data, error } = await sb.rpc("playlist_total_streams_for_date", { playlist_key, run_date });
    if (error) {
      return { toolCall: { tool: "data_query", templateId, params: { playlist_key, run_date }, rowCount: null, notes: error.message }, payload: null };
    }
    return {
      toolCall: { tool: "data_query", templateId, params: { playlist_key, run_date }, rowCount: 1, notes: "playlist_total_streams_for_date()" },
      payload: { playlist_key, run_date, streams: Number(data ?? 0) },
    };
  }

  if (templateId === "track_total_streams") {
    const isrc = String(plan.params.isrc ?? "").trim().toUpperCase();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    if (!isrc || !run_date) {
      return {
        toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing isrc or run_date" },
        payload: null,
      };
    }
    const { data, error } = await sb.rpc("track_total_streams_for_date", { isrc, run_date });
    if (error) {
      return { toolCall: { tool: "data_query", templateId, params: { isrc, run_date }, rowCount: null, notes: error.message }, payload: null };
    }
    return {
      toolCall: { tool: "data_query", templateId, params: { isrc, run_date }, rowCount: 1, notes: "track_total_streams_for_date()" },
      payload: { isrc, run_date, streams: Number(data ?? 0) },
    };
  }

  if (templateId === "artist_series") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const start_date = asDateString(plan.params.start_date);
    const end_date = asDateString(plan.params.end_date) ?? runDateDefault;
    if (!artist_id || !end_date) {
      return { toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or end_date" }, payload: null };
    }
    const start = start_date ?? dateMinusDays(end_date, 29);
    const { data, error } = await sb.rpc("catalog_artist_series", { artist_id, start_date: start, end_date });
    if (error) return { toolCall: { tool: "data_query", templateId, params: { artist_id, start_date: start, end_date }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId, params: { artist_id, start_date: start, end_date }, rowCount: rows.length, notes: "catalog_artist_series()" },
      payload: { range: { start_date: start, end_date }, rows },
    };
  }

  if (templateId === "track_series") {
    const isrc = String(plan.params.isrc ?? "").trim().toUpperCase();
    const start_date = asDateString(plan.params.start_date);
    const end_date = asDateString(plan.params.end_date) ?? runDateDefault;
    if (!isrc || !end_date) {
      return { toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing isrc or end_date" }, payload: null };
    }
    const start = start_date ?? dateMinusDays(end_date, 29);
    const { data, error } = await sb.rpc("track_series", { isrc, start_date: start, end_date });
    if (error) return { toolCall: { tool: "data_query", templateId, params: { isrc, start_date: start, end_date }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId, params: { isrc, start_date: start, end_date }, rowCount: rows.length, notes: "track_series()" },
      payload: { range: { start_date: start, end_date }, rows },
    };
  }

  if (templateId === "playlist_series") {
    const playlist_key = String(plan.params.playlist_key ?? "").trim();
    const start_date = asDateString(plan.params.start_date);
    const end_date = asDateString(plan.params.end_date) ?? runDateDefault;
    if (!playlist_key || !end_date) {
      return { toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing playlist_key or end_date" }, payload: null };
    }
    const start = start_date ?? dateMinusDays(end_date, 29);
    const { data, error } = await sb.rpc("playlist_series", { playlist_key, start_date: start, end_date });
    if (error) return { toolCall: { tool: "data_query", templateId, params: { playlist_key, start_date: start, end_date }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId, params: { playlist_key, start_date: start, end_date }, rowCount: rows.length, notes: "playlist_series()" },
      payload: { range: { start_date: start, end_date }, rows },
    };
  }

  if (templateId === "artist_top_tracks_total") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    const limit_rows = clamp(asInt(plan.params.limit_rows, 25), 1, 100);
    if (!artist_id || !run_date) {
      return { toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or run_date" }, payload: null };
    }
    const { data, error } = await sb.rpc("catalog_artist_top_tracks_total", { artist_id, run_date, limit_rows });
    if (error) return { toolCall: { tool: "data_query", templateId, params: { artist_id, run_date, limit_rows }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId, params: { artist_id, run_date, limit_rows }, rowCount: rows.length, notes: "catalog_artist_top_tracks_total()" },
      payload: { run_date, rows },
    };
  }

  if (templateId === "artist_top_tracks_daily") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    const limit_rows = clamp(asInt(plan.params.limit_rows, 25), 1, 100);
    if (!artist_id || !run_date) {
      return { toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or run_date" }, payload: null };
    }
    const { data, error } = await sb.rpc("catalog_artist_top_tracks_daily", { artist_id, run_date, limit_rows });
    if (error) return { toolCall: { tool: "data_query", templateId, params: { artist_id, run_date, limit_rows }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId, params: { artist_id, run_date, limit_rows }, rowCount: rows.length, notes: "catalog_artist_top_tracks_daily()" },
      payload: { run_date, rows },
    };
  }

  if (templateId === "playlist_top_tracks_total") {
    const playlist_query = String(plan.params.playlist_query ?? "").trim();
    let playlist_key = String(plan.params.playlist_key ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    const limit_rows = clamp(asInt(plan.params.limit_rows, 25), 1, 100);

    if (!playlist_key && playlist_query) {
      const { data: rows, error } = await sb.rpc("search_all", { q: playlist_query, max_results: 10 });
      if (error) {
        return {
          toolCall: {
            tool: "data_query",
            templateId,
            params: { playlist_query, run_date, limit_rows },
            rowCount: null,
            notes: `Failed to resolve playlist from name via search_all(): ${error.message}`,
          },
          payload: null,
        };
      }
      const best = (Array.isArray(rows) ? rows : []).find((r: { type?: string; id?: string }) => r?.type === "playlist" && r?.id);
      if (best?.id) playlist_key = String(best.id);
    }

    if (!playlist_key || !run_date) {
      return { toolCall: { tool: "data_query", templateId, params: plan.params, rowCount: null, notes: "Missing playlist_key or run_date" }, payload: null };
    }
    const { data, error } = await sb.rpc("playlist_top_tracks_total", { playlist_key, run_date, limit_rows });
    if (error) return { toolCall: { tool: "data_query", templateId, params: { playlist_key, run_date, limit_rows }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: {
        tool: "data_query",
        templateId,
        params: { playlist_key, playlist_query: playlist_query || undefined, run_date, limit_rows },
        rowCount: rows.length,
        notes: playlist_query ? "Resolved playlist via search_all() → playlist_top_tracks_total()" : "playlist_top_tracks_total()",
      },
      payload: { run_date, rows },
    };
  }

  const neverId: never = templateId;
  throw new Error(`Unknown templateId: ${neverId}`);
}
