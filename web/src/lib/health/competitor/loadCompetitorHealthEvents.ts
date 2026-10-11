import "server-only";

import { CACHE_TTL_1H } from "@/lib/constants";
import { isAllCompetitorsKey } from "@/lib/competitorContext";
import { cachedQuery } from "@/lib/supabase/cache";
import type { supabaseService } from "@/lib/supabase/service";
import { assembleHealthEvents, type EventWindow, type MembershipEventRow } from "../events";
import { effectiveDailyTotals, eventRows, streamCursorFilter } from "../eventQueries.server";

type Input = Parameters<typeof assembleHealthEvents>[0];
/** Reads competitor analytics exclusively; labels are validated by the admin-gated endpoint. */
export async function loadCompetitorHealthEvents(svc: ReturnType<typeof supabaseService>, window: EventWindow, labelKey: string) {
  return cachedQuery(async () => {
    const comp = svc.schema("competitor");
    const playlists = await eventRows<Input["playlists"][number]>(() => {
      let q = comp.from("playlists").select("playlist_key,display_name").eq("is_active", true);
      if (!isAllCompetitorsKey(labelKey)) q = q.eq("label_key", labelKey);
      return q.order("playlist_key");
    });
    const keys = playlists.map((p) => p.playlist_key);
    if (!keys.length) return { data: [], error: null };
    const memberships = await eventRows<MembershipEventRow>(() => comp.from("playlist_memberships")
      .select("id,playlist_key,isrc,valid_from,valid_to,tracks(isrc,name,spotify_artist_ids)").in("playlist_key", keys)
      .lte("valid_from", window.end).or(`valid_to.is.null,valid_to.gte.${window.streamsStart}`).order("id"));
    const intervals = new Map<string, MembershipEventRow[]>();
    for (const m of memberships) intervals.set(m.isrc, [...(intervals.get(m.isrc) ?? []), m]);
    const inScope = (isrc: string, date: string) => (intervals.get(isrc) ?? []).some((m) => m.valid_from <= date && (!m.valid_to || m.valid_to >= date));
    // Batch ISRC predicates to keep URLs bounded and avoid reading other labels' snapshots/repairs.
    const isrcs = [...intervals.keys()].sort();
    const newTracks: Input["newTracks"] = [];
    const overrides: Input["overrides"] = [];
    const totals = new Map<string, number>();
    for (let offset = 0; offset < isrcs.length; offset += 100) {
      const batch = isrcs.slice(offset, offset + 100);
      const [tracks, repairs, daily] = await Promise.all([
        eventRows<Input["newTracks"][number]>(() => comp.from("tracks").select("isrc,name,spotify_artist_ids,first_seen").in("isrc", batch)
          .gte("first_seen", window.start).lt("first_seen", window.until).order("first_seen").order("isrc")),
        eventRows<Input["overrides"][number] & { isrc: string }>(() => comp.from("track_daily_stream_overrides").select("isrc,date,note").in("isrc", batch)
          .gte("date", window.start).lt("date", window.until).order("date").order("isrc")),
        effectiveDailyTotals((cursor) => {
          let q = comp.from("track_daily_streams_effective_public").select("date,isrc,streams_cumulative").in("isrc", batch)
            .gte("date", window.streamsStart).lt("date", window.until).order("date").order("isrc");
          if (cursor) q = q.or(streamCursorFilter(cursor));
          return q;
        }, window, inScope),
      ]);
      newTracks.push(...tracks.filter((t) => t.first_seen && inScope(t.isrc, t.first_seen)));
      overrides.push(...repairs.filter((r) => inScope(r.isrc, r.date)));
      for (const day of daily) if (day.streams != null) totals.set(day.date, (totals.get(day.date) ?? 0) + day.streams);
    }
    // Runs are schema-wide: the competitor pipeline ingests every configured label together.
    const runs = await eventRows<Input["runs"][number]>(() => comp.from("ingestion_runs").select("id,run_date,status,logs_url")
      .gte("run_date", window.start).lt("run_date", window.until).order("run_date").order("id"));
    return { data: assembleHealthEvents({ window, newTracks, additions: memberships.filter((m) => m.valid_from >= window.start),
      removals: memberships.filter((m) => m.valid_to && m.valid_to >= window.start), playlists, overrides, runs,
      dailyTotals: [...totals].map(([date, streams]) => ({ date, streams })) }), error: null };
  }, `health-events-competitor:${labelKey}:${window.start}:${window.end}`, CACHE_TTL_1H, ["health"]);
}
