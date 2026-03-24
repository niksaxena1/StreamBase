import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { SOT_DATA_LAG_DAYS } from "@/lib/sotDates";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const rawBody = await readJsonBodyOptional(req);
  const body = rawBody;

  const dataDate = String(body.data_date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
    return apiJsonErr("invalid data_date (expected YYYY-MM-DD)", 400);
  }

  const collectorsRaw = Array.isArray(body.collectors) ? (body.collectors as unknown[]) : [];
  const collectors = collectorsRaw
    .map((c) => String(c ?? "").trim().toUpperCase())
    .filter(Boolean);
  if (!collectors.length) {
    return apiJsonErr("missing collectors", 400);
  }

  const svc = supabaseService();
  const runDate = addDaysIso(dataDate, SOT_DATA_LAG_DAYS);
  const runDateMinus7 = addDaysIso(runDate, -7);
  const prevRunDate = addDaysIso(runDate, -1);

  const { data: aggRows, error: aggError } = await svc
    .from("collector_daily_agg")
    .select("collector,date,daily_streams_net")
    .in("collector", collectors)
    .gte("date", runDateMinus7)
    .lte("date", runDate)
    .order("date", { ascending: true });

  if (aggError) {
    return apiJsonErr(aggError.message, 500);
  }

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

  type CollectorBreakdown = {
    daily_streams: number;
    avg7_streams: number;
    delta_pct: number | null;
    top_tracks: TrackInfo[];
    roster_additions: RosterEntry[];
    roster_removals: RosterEntry[];
    roster_cumulative_impact: number;
  };

  async function getAllCollectorTracks(
    collector: string,
    runDate: string,
    prevDate: string,
  ): Promise<any[]> {
    const all: any[] = [];
    const hardCap = 50_000; // safety guard against runaway pagination
    for (let offset = 0; offset < hardCap; offset += 500) {
      const { data, error } = await svc.rpc("collector_tracks_paged", {
        collector,
        run_date: runDate,
        prev_date: prevDate,
        offset_rows: offset,
        limit_rows: 500,
      });
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      all.push(...data);
      if (data.length < 500) break;
    }
    return all;
  }

  // Process all collectors in parallel — each is independent.
  // Wall time becomes max(single collector) instead of Σ(all collectors).
  let collectorEntries: [string, CollectorBreakdown][];
  try {
    collectorEntries = await Promise.all(
    collectors.map(async (collector): Promise<[string, CollectorBreakdown]> => {
      const rows = (aggRows ?? []).filter(
        (r: any) => String(r.collector ?? "").toUpperCase() === collector,
      );

      const targetRow = rows.find((r: any) => r.date === runDate);
      const dailyStreams = Number(targetRow?.daily_streams_net ?? 0);

      const prevRows = rows.filter((r: any) => r.date < runDate);
      const avg7 =
        prevRows.length > 0
          ? prevRows.reduce((s: number, r: any) => s + Number(r.daily_streams_net ?? 0), 0) / prevRows.length
          : 0;

      const deltaPct = avg7 > 0 ? ((dailyStreams - avg7) / avg7) * 100 : null;

      // Top tracks by daily delta
      const { data: trackRows, error: trackError } = await svc.rpc("collector_tracks_paged", {
        collector,
        run_date: runDate,
        prev_date: prevRunDate,
        offset_rows: 0,
        limit_rows: 10,
      });

      if (trackError) throw new Error(trackError.message);

      const topTracks: TrackInfo[] = ((trackRows ?? []) as any[])
        .map((r: any) => ({
          isrc: String(r.isrc ?? ""),
          name: (r.name ?? null) as string | null,
          album_image_url: (r.album_image_url ?? null) as string | null,
          artist_names: (r.artist_names ?? null) as string[] | null,
          artist_ids: (r.artist_ids ?? null) as string[] | null,
          daily_streams_delta: r.daily_streams_delta == null ? null : Number(r.daily_streams_delta),
          total_streams_cumulative: r.total_streams_cumulative == null ? null : Number(r.total_streams_cumulative),
        }))
        .filter((t) => t.isrc);

      // Roster change detection: compare full track sets between the two dates
      let rosterAdditions: RosterEntry[] = [];
      let rosterRemovals: RosterEntry[] = [];
      let rosterCumulativeImpact = 0;

      try {
        const prevPrevDate = addDaysIso(prevRunDate, -1);
        const [todayTracks, yesterdayTracks] = await Promise.all([
          getAllCollectorTracks(collector, runDate, prevRunDate),
          getAllCollectorTracks(collector, prevRunDate, prevPrevDate),
        ]);

        const todayMap = new Map<string, any>();
        for (const t of todayTracks) todayMap.set(t.isrc, t);

        const yesterdayIsrcs = new Set<string>();
        for (const t of yesterdayTracks) yesterdayIsrcs.add(t.isrc);

        // Additions: in today but not yesterday
        for (const t of todayTracks) {
          if (!yesterdayIsrcs.has(t.isrc)) {
            const cumulative = Number(t.total_streams_cumulative ?? 0);
            rosterAdditions.push({
              isrc: String(t.isrc ?? ""),
              name: (t.name ?? null) as string | null,
              album_image_url: (t.album_image_url ?? null) as string | null,
              artist_names: (t.artist_names ?? null) as string[] | null,
              artist_ids: (t.artist_ids ?? null) as string[] | null,
              daily_streams_delta: t.daily_streams_delta == null ? null : Number(t.daily_streams_delta),
              total_streams_cumulative: t.total_streams_cumulative == null ? null : Number(t.total_streams_cumulative),
              cumulative_streams: cumulative,
            });
            rosterCumulativeImpact += cumulative;
          }
        }

        // Removals: in yesterday but not today
        for (const t of yesterdayTracks) {
          if (!todayMap.has(t.isrc)) {
            const cumulative = Number(t.total_streams_cumulative ?? 0);
            rosterRemovals.push({
              isrc: String(t.isrc ?? ""),
              name: (t.name ?? null) as string | null,
              album_image_url: (t.album_image_url ?? null) as string | null,
              artist_names: (t.artist_names ?? null) as string[] | null,
              artist_ids: (t.artist_ids ?? null) as string[] | null,
              daily_streams_delta: null,
              total_streams_cumulative: t.total_streams_cumulative == null ? null : Number(t.total_streams_cumulative),
              cumulative_streams: cumulative,
            });
            rosterCumulativeImpact -= cumulative;
          }
        }

        rosterAdditions.sort((a, b) => b.cumulative_streams - a.cumulative_streams);
        rosterRemovals.sort((a, b) => b.cumulative_streams - a.cumulative_streams);
      } catch {
        // Non-fatal: roster detection failed, continue without it
      }

      return [collector, {
        daily_streams: dailyStreams,
        avg7_streams: avg7,
        delta_pct: deltaPct,
        top_tracks: topTracks,
        roster_additions: rosterAdditions,
        roster_removals: rosterRemovals,
        roster_cumulative_impact: rosterCumulativeImpact,
      }];
    }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return apiJsonErr(msg, 500);
  }

  const collectorData: Record<string, CollectorBreakdown> = Object.fromEntries(collectorEntries);

  return apiJsonOk({ ok: true as const, data_date: dataDate, collectors: collectorData });
}
