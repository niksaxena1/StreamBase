import type { SupabaseClient } from "@supabase/supabase-js";

import type { SaiToolCall } from "./types";
import { cachedQuery } from "@/lib/supabase/cache";

export type DataQueryTemplateId =
  | "system_stats"
  | "artist_total_streams"
  | "playlist_total_streams"
  | "track_total_streams"
  | "artist_series"
  | "track_series"
  | "playlist_series"
  | "artist_top_tracks_total"
  | "artist_top_tracks_daily"
  | "playlist_top_tracks_total";

export type DataQueryPlan = {
  templateId: DataQueryTemplateId;
  params: Record<string, unknown>;
};

export type DataQueryResult = {
  toolCall: SaiToolCall;
  payload: unknown;
};

async function latestRunDate(sb: SupabaseClient): Promise<string | null> {
  const { data } = await cachedQuery(
    async () =>
      await sb
        .from("playlist_daily_stats")
        .select("date")
        .eq("playlist_key", "all_catalog")
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    "sai-latest-run-date-v1",
    300,
  );

  return (data as any)?.date ?? null;
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

export function formatDataPayload(templateId: DataQueryTemplateId, payload: any): string {
  try {
    if (!payload) return "No data.";

    if (templateId === "system_stats") {
      return [
        `tracks=${payload.tracks ?? "—"}`,
        `playlists=${payload.playlists ?? "—"}`,
        `artists_distinct=${payload.artists_distinct ?? "—"}`,
        `as_of_run_date=${payload.as_of_run_date ?? "—"}`,
      ].join("\n");
    }

    if (templateId === "artist_total_streams") {
      return `Total streams: ${Intl.NumberFormat().format(Number(payload?.streams ?? 0))}`;
    }

    if (templateId === "playlist_total_streams") {
      return `Total streams: ${Intl.NumberFormat().format(Number(payload?.streams ?? 0))}`;
    }

    if (templateId === "track_total_streams") {
      return `Total streams: ${Intl.NumberFormat().format(Number(payload?.streams ?? 0))}`;
    }

    if (templateId === "artist_series" || templateId === "track_series" || templateId === "playlist_series") {
      const rows = Array.isArray(payload?.rows) ? payload.rows.length : 0;
      const range = payload?.range ? `${payload.range.start_date} → ${payload.range.end_date}` : "";
      return `Series rows: ${rows}${range ? ` (${range})` : ""}`;
    }

    if (templateId.endsWith("_top_tracks_total") || templateId === "artist_top_tracks_daily") {
      const rows = Array.isArray(payload?.rows) ? payload.rows.length : 0;
      return `Top tracks returned: ${rows}`;
    }
  } catch {
    // ignore
  }

  return `Payload: ${JSON.stringify(payload)}`;
}

export async function runDataQuery(
  sb: SupabaseClient,
  plan: DataQueryPlan,
): Promise<DataQueryResult> {
  const runDateDefault = await latestRunDate(sb);

  if (plan.templateId === "system_stats") {
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

  if (plan.templateId === "artist_total_streams") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    if (!artist_id || !run_date) {
      return {
        toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or run_date" },
        payload: null,
      };
    }
    const { data, error } = await sb.rpc("artist_total_streams_for_date", { artist_id, run_date });
    if (error) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, run_date }, rowCount: null, notes: error.message }, payload: null };
    }
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, run_date }, rowCount: 1, notes: "artist_total_streams_for_date()" },
      payload: { artist_id, run_date, streams: Number(data ?? 0) },
    };
  }

  if (plan.templateId === "playlist_total_streams") {
    const playlist_key = String(plan.params.playlist_key ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    if (!playlist_key || !run_date) {
      return {
        toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing playlist_key or run_date" },
        payload: null,
      };
    }
    const { data, error } = await sb.rpc("playlist_total_streams_for_date", { playlist_key, run_date });
    if (error) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { playlist_key, run_date }, rowCount: null, notes: error.message }, payload: null };
    }
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { playlist_key, run_date }, rowCount: 1, notes: "playlist_total_streams_for_date()" },
      payload: { playlist_key, run_date, streams: Number(data ?? 0) },
    };
  }

  if (plan.templateId === "track_total_streams") {
    const isrc = String(plan.params.isrc ?? "").trim().toUpperCase();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    if (!isrc || !run_date) {
      return {
        toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing isrc or run_date" },
        payload: null,
      };
    }
    const { data, error } = await sb.rpc("track_total_streams_for_date", { isrc, run_date });
    if (error) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { isrc, run_date }, rowCount: null, notes: error.message }, payload: null };
    }
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { isrc, run_date }, rowCount: 1, notes: "track_total_streams_for_date()" },
      payload: { isrc, run_date, streams: Number(data ?? 0) },
    };
  }

  if (plan.templateId === "artist_series") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const start_date = asDateString(plan.params.start_date);
    const end_date = asDateString(plan.params.end_date) ?? runDateDefault;
    if (!artist_id || !end_date) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or end_date" }, payload: null };
    }
    const start = start_date ?? end_date; // default to single-day series
    const { data, error } = await sb.rpc("catalog_artist_series", { artist_id, start_date: start, end_date });
    if (error) return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, start_date: start, end_date }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, start_date: start, end_date }, rowCount: rows.length, notes: "catalog_artist_series()" },
      payload: { range: { start_date: start, end_date }, rows },
    };
  }

  if (plan.templateId === "track_series") {
    const isrc = String(plan.params.isrc ?? "").trim().toUpperCase();
    const start_date = asDateString(plan.params.start_date);
    const end_date = asDateString(plan.params.end_date) ?? runDateDefault;
    if (!isrc || !end_date) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing isrc or end_date" }, payload: null };
    }
    const start = start_date ?? end_date;
    const { data, error } = await sb.rpc("track_series", { isrc, start_date: start, end_date });
    if (error) return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { isrc, start_date: start, end_date }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { isrc, start_date: start, end_date }, rowCount: rows.length, notes: "track_series()" },
      payload: { range: { start_date: start, end_date }, rows },
    };
  }

  if (plan.templateId === "playlist_series") {
    const playlist_key = String(plan.params.playlist_key ?? "").trim();
    const start_date = asDateString(plan.params.start_date);
    const end_date = asDateString(plan.params.end_date) ?? runDateDefault;
    if (!playlist_key || !end_date) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing playlist_key or end_date" }, payload: null };
    }
    const start = start_date ?? end_date;
    const { data, error } = await sb.rpc("playlist_series", { playlist_key, start_date: start, end_date });
    if (error) return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { playlist_key, start_date: start, end_date }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { playlist_key, start_date: start, end_date }, rowCount: rows.length, notes: "playlist_series()" },
      payload: { range: { start_date: start, end_date }, rows },
    };
  }

  if (plan.templateId === "artist_top_tracks_total") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    const limit_rows = clamp(asInt(plan.params.limit_rows, 25), 1, 100);
    if (!artist_id || !run_date) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or run_date" }, payload: null };
    }
    const { data, error } = await sb.rpc("catalog_artist_top_tracks_total", { artist_id, run_date, limit_rows });
    if (error) return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, run_date, limit_rows }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, run_date, limit_rows }, rowCount: rows.length, notes: "catalog_artist_top_tracks_total()" },
      payload: { run_date, rows },
    };
  }

  if (plan.templateId === "artist_top_tracks_daily") {
    const artist_id = String(plan.params.artist_id ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    const limit_rows = clamp(asInt(plan.params.limit_rows, 25), 1, 100);
    if (!artist_id || !run_date) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing artist_id or run_date" }, payload: null };
    }
    const { data, error } = await sb.rpc("catalog_artist_top_tracks_daily", { artist_id, run_date, limit_rows });
    if (error) return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, run_date, limit_rows }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { artist_id, run_date, limit_rows }, rowCount: rows.length, notes: "catalog_artist_top_tracks_daily()" },
      payload: { run_date, rows },
    };
  }

  if (plan.templateId === "playlist_top_tracks_total") {
    const playlist_key = String(plan.params.playlist_key ?? "").trim();
    const run_date = asDateString(plan.params.run_date) ?? runDateDefault;
    const limit_rows = clamp(asInt(plan.params.limit_rows, 25), 1, 100);
    if (!playlist_key || !run_date) {
      return { toolCall: { tool: "data_query", templateId: plan.templateId, params: plan.params, rowCount: null, notes: "Missing playlist_key or run_date" }, payload: null };
    }
    const { data, error } = await sb.rpc("playlist_top_tracks_total", { playlist_key, run_date, limit_rows });
    if (error) return { toolCall: { tool: "data_query", templateId: plan.templateId, params: { playlist_key, run_date, limit_rows }, rowCount: null, notes: error.message }, payload: null };
    const rows = Array.isArray(data) ? data : [];
    return {
      toolCall: { tool: "data_query", templateId: plan.templateId, params: { playlist_key, run_date, limit_rows }, rowCount: rows.length, notes: "playlist_top_tracks_total()" },
      payload: { run_date, rows },
    };
  }

  // Exhaustiveness guard
  const neverId: never = plan.templateId;
  throw new Error(`Unknown templateId: ${neverId}`);
}

