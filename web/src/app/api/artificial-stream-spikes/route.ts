import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";
import { SOT_DATA_LAG_DAYS, addDaysISO } from "@/lib/sotDates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SPIKE_MIN = 1.1;
const SPIKE_MAX = 5;
const BASELINE_MIN = 1;
const BASELINE_MAX = 50_000;

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const s = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function clampSpike(n: number): number {
  return Math.min(SPIKE_MAX, Math.max(SPIKE_MIN, n));
}

function clampBaseline(n: number): number {
  return Math.min(BASELINE_MAX, Math.max(BASELINE_MIN, n));
}

function parseOptionalIsoDate(raw: string | null): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

export async function GET(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const sp = request.nextUrl.searchParams;
  const spikeRaw = Number(sp.get("spike_ratio") ?? "1.25");
  const baselineRaw = Number(sp.get("min_baseline") ?? "50");
  const includeWeekends = parseBool(sp.get("include_weekends"), false);
  const spikeRatio = clampSpike(Number.isFinite(spikeRaw) ? spikeRaw : 1.25);
  const minBaseline = clampBaseline(Number.isFinite(baselineRaw) ? baselineRaw : 50);
  const startDateRaw = parseOptionalIsoDate(sp.get("start_date"));
  const endDateRaw = parseOptionalIsoDate(sp.get("end_date"));
  /** Params match Home picker (data dates); `track_daily_streams` uses ingestion/run dates. */
  const pStartRun =
    startDateRaw && endDateRaw ? addDaysISO(startDateRaw, SOT_DATA_LAG_DAYS) : null;
  const pEndRun =
    startDateRaw && endDateRaw ? addDaysISO(endDateRaw, SOT_DATA_LAG_DAYS) : null;

  const svc = supabaseService();
  const { data, error } = await svc.rpc("home_artificial_stream_spikes", {
    p_spike_ratio: spikeRatio,
    p_min_baseline: minBaseline,
    p_include_weekends: includeWeekends,
    p_start_date: pStartRun,
    p_end_date: pEndRun,
  });

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  return apiJsonOk({
    rows: rows.map((r) => ({
      isrc: String(r.isrc ?? "").trim(),
      name: typeof r.name === "string" ? r.name : String(r.isrc ?? ""),
      artist_names: Array.isArray(r.artist_names) ? (r.artist_names as string[]) : null,
      artist_ids: Array.isArray(r.artist_ids) ? (r.artist_ids as string[]) : null,
      album_image_url: typeof r.album_image_url === "string" ? r.album_image_url : null,
      date: String(r.date ?? "").slice(0, 10),
      daily_streams: Number(r.daily_streams ?? 0) || 0,
      avg_same_dow:
        r.avg_same_dow != null && Number.isFinite(Number(r.avg_same_dow)) ? Number(r.avg_same_dow) : null,
      spike_ratio:
        r.spike_ratio != null && Number.isFinite(Number(r.spike_ratio)) ? Number(r.spike_ratio) : null,
      streams_cumulative: Number(r.streams_cumulative ?? 0) || 0,
    })),
    spike_ratio: spikeRatio,
    min_baseline: minBaseline,
    include_weekends: includeWeekends,
  });
}
