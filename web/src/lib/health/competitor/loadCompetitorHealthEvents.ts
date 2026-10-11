import "server-only";

import { CACHE_TTL_1H } from "@/lib/constants";
import { isAllCompetitorsKey } from "@/lib/competitorContext";
import { cachedQuery } from "@/lib/supabase/cache";
import type { supabaseService } from "@/lib/supabase/service";
import { addDaysISO } from "@/lib/sotDates";
import { assembleHealthEvents, dailyTotalsFromRpc, eventSnapshotWindow, type EventWindow, type MembershipEventRow, type HealthDailyTotalRow } from "../events";
import { eventRows } from "../eventQueries.server";

type Input = Parameters<typeof assembleHealthEvents>[0];
/** Reads competitor analytics exclusively; labels are validated by the admin-gated endpoint. */
export async function loadCompetitorHealthEvents(svc: ReturnType<typeof supabaseService>, window: EventWindow, labelKey: string) {
  return cachedQuery(async () => {
    const comp = svc.schema("competitor");
    const snapshots = eventSnapshotWindow(window);
    const playlists = await eventRows<Input["playlists"][number]>(() => {
      let q = comp.from("playlists").select("playlist_key,display_name").eq("is_active", true);
      if (!isAllCompetitorsKey(labelKey)) q = q.eq("label_key", labelKey);
      return q.order("playlist_key");
    });
    const keys = playlists.map((p) => p.playlist_key);
    const memberships = keys.length ? await eventRows<MembershipEventRow>(() => comp.from("playlist_memberships")
      .select("id,playlist_key,isrc,valid_from,valid_to,tracks(isrc,name,spotify_artist_ids)").in("playlist_key", keys)
      .lte("valid_from", snapshots.end).or(`valid_to.is.null,valid_to.gte.${addDaysISO(snapshots.start, -1)}`).order("id")) : [];
    const intervals = new Map<string, MembershipEventRow[]>();
    for (const m of memberships) intervals.set(m.isrc, [...(intervals.get(m.isrc) ?? []), m]);
    const inScope = (isrc: string, date: string) => (intervals.get(isrc) ?? []).some((m) => m.valid_from <= date && (!m.valid_to || m.valid_to >= date));
    // Only discoveries/repairs use ISRC batches; daily totals are one schema-scoped RPC.
    const isrcs = [...intervals.keys()].sort();
    const newTracks: Input["newTracks"] = [];
    const overrides: Input["overrides"] = [];
    for (let offset = 0; offset < isrcs.length; offset += 100) {
      const batch = isrcs.slice(offset, offset + 100);
      const [tracks, repairs] = await Promise.all([
        eventRows<Input["newTracks"][number]>(() => comp.from("tracks").select("isrc,name,spotify_artist_ids,first_seen").in("isrc", batch)
          .gte("first_seen", snapshots.start).lt("first_seen", snapshots.until).order("first_seen").order("isrc")),
        eventRows<Input["overrides"][number] & { isrc: string }>(() => comp.from("track_daily_stream_overrides").select("isrc,date,note").in("isrc", batch)
          .gte("date", snapshots.start).lt("date", snapshots.until).order("date").order("isrc")),
      ]);
      newTracks.push(...tracks.filter((t) => t.first_seen && inScope(t.isrc, t.first_seen)));
      overrides.push(...repairs.filter((r) => inScope(r.isrc, r.date)));
    }
    // Runs are schema-wide: the competitor pipeline ingests every configured label together.
    const [runs, totals] = await Promise.all([
      eventRows<Input["runs"][number]>(() => comp.from("ingestion_runs").select("id,run_date,status,logs_url")
        .gte("run_date", window.start).lt("run_date", window.until).order("run_date").order("id")),
      comp.rpc("health_daily_stream_totals", { p_start: snapshots.streamsStart, p_end: window.end,
        p_label_key: isAllCompetitorsKey(labelKey) ? null : labelKey }),
    ]);
    if (totals.error) throw new Error(totals.error.message);
    return { data: assembleHealthEvents({ window, newTracks, additions: memberships.filter((m) => m.valid_from >= snapshots.start && m.valid_from <= snapshots.end),
      removals: memberships.filter((m) => m.valid_to && m.valid_to >= addDaysISO(snapshots.start, -1) && m.valid_to <= addDaysISO(snapshots.end, -1)), playlists, overrides, runs,
      dailyTotals: dailyTotalsFromRpc((totals.data ?? []) as HealthDailyTotalRow[]) }), error: null };
  }, `health-events-competitor-v2:${labelKey}:${window.start}:${window.end}`, CACHE_TTL_1H, ["health"]);
}
