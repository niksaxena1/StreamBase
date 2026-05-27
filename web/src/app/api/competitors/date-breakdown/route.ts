import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";
import { prior7DayAverageDaily } from "@/lib/dateBreakdownStats";
import { addDaysISO, dataDateFromRunDate, runDateFromDataDate } from "@/lib/sotDates";
import { isMissingPostgresFunctionError } from "@/lib/supabase/rpcErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TrackInfo = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  daily_streams_delta: number | null;
  total_streams_cumulative: number | null;
};

type RosterEntry = TrackInfo & { cumulative_streams: number };

type LabelBreakdown = {
  daily_streams: number;
  avg7_streams: number;
  delta_pct: number | null;
  top_tracks: TrackInfo[];
  roster_additions: RosterEntry[];
  roster_removals: RosterEntry[];
  roster_cumulative_impact: number;
};

function isActiveOnDate(
  validFrom: string | null,
  validTo: string | null,
  runDate: string,
): boolean {
  const from = (validFrom ?? "").slice(0, 10);
  const to = validTo ? validTo.slice(0, 10) : null;
  if (from && from > runDate) return false;
  if (to && to < runDate) return false;
  return true;
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const dataDate = String(body.data_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
    return apiJsonErr("invalid data_date (expected YYYY-MM-DD)", 400);
  }

  const labelsRaw = Array.isArray(body.label_keys) ? (body.label_keys as unknown[]) : [];
  const labelKeys = labelsRaw.map((k) => String(k ?? "").trim()).filter(Boolean);
  if (!labelKeys.length) {
    return apiJsonErr("missing label_keys", 400);
  }

  const runDate = runDateFromDataDate(dataDate);
  const runDateStart = runDateFromDataDate(addDaysISO(dataDate, -7));
  const prevRunDate = addDaysISO(runDate, -1);

  const svc = supabaseService();
  const comp = svc.schema("competitor");

  const { data: playlistsRaw, error: playlistsError } = await comp
    .from("playlists")
    .select("playlist_key,label_key")
    .in("label_key", labelKeys)
    .eq("is_active", true);

  if (playlistsError) return apiJsonErr(playlistsError.message, 500);

  const playlists = (playlistsRaw ?? []) as Array<{ playlist_key: string; label_key: string }>;
  const playlistKeys = playlists.map((p) => p.playlist_key);
  const playlistToLabel = new Map(playlists.map((p) => [p.playlist_key, p.label_key]));
  const playlistsByLabel = new Map<string, string[]>();
  for (const p of playlists) {
    const arr = playlistsByLabel.get(p.label_key) ?? [];
    arr.push(p.playlist_key);
    playlistsByLabel.set(p.label_key, arr);
  }

  if (!playlistKeys.length) {
    const empty: Record<string, LabelBreakdown> = Object.fromEntries(
      labelKeys.map((k) => [
        k,
        {
          daily_streams: 0,
          avg7_streams: 0,
          delta_pct: null,
          top_tracks: [],
          roster_additions: [],
          roster_removals: [],
          roster_cumulative_impact: 0,
        },
      ]),
    );
    return apiJsonOk({ ok: true as const, data_date: dataDate, labels: empty });
  }

  const [{ data: seriesRaw, error: seriesError }, { data: moversRaw, error: moversError }, { data: membershipsRaw, error: membershipsError }] =
    await Promise.all([
      comp.rpc("label_daily_series", {
        p_start_date: runDateStart,
        p_end_date: runDate,
      }),
      comp.rpc("label_top_tracks_daily", {
        p_run_date: runDate,
        p_limit: 500,
        p_direction: "gainers",
      }),
      comp.from("playlist_memberships").select("isrc,playlist_key,valid_from,valid_to").in("playlist_key", playlistKeys),
    ]);

  let statsError = seriesError;
  let statsRows = (seriesRaw ?? []) as Array<{
    date: string;
    label_key: string;
    daily_streams_net: number | string | null;
  }>;

  if (seriesError && isMissingPostgresFunctionError(seriesError)) {
    const fallback = await comp
      .from("playlist_daily_stats")
      .select("playlist_key,date,daily_streams_net")
      .in("playlist_key", playlistKeys)
      .gte("date", runDateStart)
      .lte("date", runDate);
    statsError = fallback.error;
    statsRows = (fallback.data ?? []).map((row) => ({
      date: String(row.date ?? "").slice(0, 10),
      label_key: playlistToLabel.get(String(row.playlist_key ?? "")) ?? "",
      daily_streams_net: row.daily_streams_net,
    }));
  }

  if (statsError) return apiJsonErr(statsError.message, 500);
  if (moversError) return apiJsonErr(moversError.message, 500);
  if (membershipsError) return apiJsonErr(membershipsError.message, 500);

  const aggByLabelDataDate = new Map<string, Map<string, number>>();
  for (const row of statsRows) {
    const labelKey = String(row.label_key ?? "").trim();
    if (!labelKey || !labelKeys.includes(labelKey)) continue;
    const dataDateKey = dataDateFromRunDate(String(row.date ?? "").slice(0, 10));
    const byDate = aggByLabelDataDate.get(labelKey) ?? new Map<string, number>();
    byDate.set(dataDateKey, (byDate.get(dataDateKey) ?? 0) + Number(row.daily_streams_net ?? 0));
    aggByLabelDataDate.set(labelKey, byDate);
  }

  type MoverRow = {
    isrc: string;
    name: string | null;
    album_image_url: string | null;
    artist_names: string[] | null;
    artist_ids: string[] | null;
    label_keys: string[] | null;
    daily_delta: number;
    total: number;
  };

  const moversByLabel = new Map<string, MoverRow[]>();
  for (const raw of (moversRaw ?? []) as MoverRow[]) {
    const keys = raw.label_keys ?? [];
    for (const labelKey of keys) {
      if (!labelKeys.includes(labelKey)) continue;
      const arr = moversByLabel.get(labelKey) ?? [];
      arr.push(raw);
      moversByLabel.set(labelKey, arr);
    }
  }

  const membershipRows = (membershipsRaw ?? []) as Array<{
    isrc: string;
    playlist_key: string;
    valid_from: string | null;
    valid_to: string | null;
  }>;

  const isrcsForRoster = new Set<string>();
  for (const m of membershipRows) {
    if (isActiveOnDate(m.valid_from, m.valid_to, runDate)) isrcsForRoster.add(m.isrc);
    if (isActiveOnDate(m.valid_from, m.valid_to, prevRunDate)) isrcsForRoster.add(m.isrc);
  }

  const trackMeta = new Map<string, { name: string | null; album_image_url: string | null; artist_names: string[] | null; artist_ids: string[] | null }>();
  if (isrcsForRoster.size > 0) {
    const isrcList = [...isrcsForRoster];
    for (let i = 0; i < isrcList.length; i += 200) {
      const chunk = isrcList.slice(i, i + 200);
      const { data: tracksRaw, error: tracksError } = await comp
        .from("tracks")
        .select("isrc,name,spotify_album_image_url,spotify_artist_names,spotify_artist_ids")
        .in("isrc", chunk);
      if (tracksError) return apiJsonErr(tracksError.message, 500);
      for (const t of tracksRaw ?? []) {
        trackMeta.set(String(t.isrc), {
          name: (t.name as string | null) ?? null,
          album_image_url: (t.spotify_album_image_url as string | null) ?? null,
          artist_names: (t.spotify_artist_names as string[] | null) ?? null,
          artist_ids: (t.spotify_artist_ids as string[] | null) ?? null,
        });
      }
    }
  }

  const cumulativeByIsrc = new Map<string, number>();
  if (isrcsForRoster.size > 0) {
    const isrcList = [...isrcsForRoster];
    for (let i = 0; i < isrcList.length; i += 200) {
      const chunk = isrcList.slice(i, i + 200);
      const { data: streamsRaw, error: streamsError } = await comp
        .from("track_daily_streams")
        .select("isrc,streams_cumulative")
        .eq("date", runDate)
        .in("isrc", chunk);
      if (streamsError) return apiJsonErr(streamsError.message, 500);
      for (const s of streamsRaw ?? []) {
        cumulativeByIsrc.set(String(s.isrc), Number(s.streams_cumulative ?? 0));
      }
    }
  }

  let labelEntries: [string, LabelBreakdown][];
  try {
    labelEntries = labelKeys.map((labelKey): [string, LabelBreakdown] => {
      const byDataDate = aggByLabelDataDate.get(labelKey) ?? new Map<string, number>();
      const dailyStreams = byDataDate.get(dataDate) ?? 0;
      const avg7 = prior7DayAverageDaily(byDataDate, dataDate);
      const deltaPct = avg7 > 0 ? ((dailyStreams - avg7) / avg7) * 100 : null;

      const topTracks: TrackInfo[] = (moversByLabel.get(labelKey) ?? [])
        .sort((a, b) => Number(b.daily_delta ?? 0) - Number(a.daily_delta ?? 0))
        .slice(0, 10)
        .map((t) => ({
          isrc: String(t.isrc ?? ""),
          name: t.name ?? null,
          album_image_url: t.album_image_url ?? null,
          artist_names: t.artist_names ?? null,
          artist_ids: t.artist_ids ?? null,
          daily_streams_delta: t.daily_delta == null ? null : Number(t.daily_delta),
          total_streams_cumulative: t.total == null ? null : Number(t.total),
        }))
        .filter((t) => t.isrc);

      const labelPlaylistKeys = playlistsByLabel.get(labelKey) ?? [];
      const todayIsrcs = new Set<string>();
      const yesterdayIsrcs = new Set<string>();
      for (const m of membershipRows) {
        if (!labelPlaylistKeys.includes(m.playlist_key)) continue;
        if (isActiveOnDate(m.valid_from, m.valid_to, runDate)) todayIsrcs.add(m.isrc);
        if (isActiveOnDate(m.valid_from, m.valid_to, prevRunDate)) yesterdayIsrcs.add(m.isrc);
      }

      const rosterAdditions: RosterEntry[] = [];
      const rosterRemovals: RosterEntry[] = [];
      let rosterCumulativeImpact = 0;

      for (const isrc of todayIsrcs) {
        if (yesterdayIsrcs.has(isrc)) continue;
        const meta = trackMeta.get(isrc);
        const cumulative = cumulativeByIsrc.get(isrc) ?? 0;
        rosterAdditions.push({
          isrc,
          name: meta?.name ?? isrc,
          album_image_url: meta?.album_image_url ?? null,
          artist_names: meta?.artist_names ?? null,
          artist_ids: meta?.artist_ids ?? null,
          daily_streams_delta: null,
          total_streams_cumulative: cumulative,
          cumulative_streams: cumulative,
        });
        rosterCumulativeImpact += cumulative;
      }

      for (const isrc of yesterdayIsrcs) {
        if (todayIsrcs.has(isrc)) continue;
        const meta = trackMeta.get(isrc);
        const cumulative = cumulativeByIsrc.get(isrc) ?? 0;
        rosterRemovals.push({
          isrc,
          name: meta?.name ?? isrc,
          album_image_url: meta?.album_image_url ?? null,
          artist_names: meta?.artist_names ?? null,
          artist_ids: meta?.artist_ids ?? null,
          daily_streams_delta: null,
          total_streams_cumulative: cumulative,
          cumulative_streams: cumulative,
        });
        rosterCumulativeImpact -= cumulative;
      }

      rosterAdditions.sort((a, b) => b.cumulative_streams - a.cumulative_streams);
      rosterRemovals.sort((a, b) => b.cumulative_streams - a.cumulative_streams);

      return [
        labelKey,
        {
          daily_streams: dailyStreams,
          avg7_streams: avg7,
          delta_pct: deltaPct,
          top_tracks: topTracks,
          roster_additions: rosterAdditions,
          roster_removals: rosterRemovals,
          roster_cumulative_impact: rosterCumulativeImpact,
        },
      ];
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiJsonErr(msg, 500);
  }

  const labels: Record<string, LabelBreakdown> = Object.fromEntries(labelEntries);
  return apiJsonOk({ ok: true as const, data_date: dataDate, labels });
}
