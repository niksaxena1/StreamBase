import "server-only";

import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import type { supabaseService } from "@/lib/supabase/service";
import { assembleHealthEvents, type EventWindow } from "./events";
import { effectiveDailyTotals, eventRows, streamCursorFilter } from "./eventQueries.server";

type Input = Parameters<typeof assembleHealthEvents>[0];
/** Called only after the Events endpoint's admin and dataset gates. */
export async function loadOwnHealthEvents(svc: ReturnType<typeof supabaseService>, window: EventWindow) {
  return cachedQuery(async () => {
    const [availability, newTracks, additions, removals, playlists, overrides, runs, dailyTotals] = await Promise.all([
      eventRows<NonNullable<Input["availability"]>[number]>(() => svc.from("spotify_track_availability_events")
        .select("id,isrc,event,detected_at,suppressed_reason,tracks(isrc,name,spotify_artist_ids)")
        .gte("detected_at", window.start).lt("detected_at", window.until).order("detected_at").order("id")),
      eventRows<Input["newTracks"][number]>(() => svc.from("tracks").select("isrc,name,spotify_artist_ids,first_seen")
        .gte("first_seen", window.start).lt("first_seen", window.until).order("first_seen").order("isrc")),
      eventRows<Input["additions"][number]>(() => svc.from("playlist_memberships")
        .select("id,playlist_key,isrc,valid_from,valid_to,tracks(isrc,name,spotify_artist_ids)")
        .gte("valid_from", window.start).lt("valid_from", window.until).order("valid_from").order("id")),
      eventRows<Input["removals"][number]>(() => svc.from("playlist_memberships")
        .select("id,playlist_key,isrc,valid_from,valid_to,tracks(isrc,name,spotify_artist_ids)")
        .gte("valid_to", window.start).lt("valid_to", window.until).order("valid_to").order("id")),
      eventRows<Input["playlists"][number]>(() => svc.from("playlists").select("playlist_key,display_name").order("playlist_key")),
      eventRows<Input["overrides"][number]>(() => svc.from("track_daily_stream_overrides").select("date,note")
        .gte("date", window.start).lt("date", window.until).order("date").order("isrc")),
      eventRows<Input["runs"][number]>(() => svc.from("ingestion_runs").select("id,run_date,status,logs_url")
        .gte("run_date", window.start).lt("run_date", window.until).order("run_date").order("id")),
      effectiveDailyTotals((cursor) => {
        let q = svc.from("track_daily_streams_effective_public").select("date,isrc,streams_cumulative")
          .gte("date", window.streamsStart).lt("date", window.until).order("date").order("isrc");
        if (cursor) q = q.or(streamCursorFilter(cursor));
        return q;
      }, window),
    ]);
    return { data: assembleHealthEvents({ window, availability, newTracks, additions, removals, playlists, overrides, runs, dailyTotals }), error: null };
  }, `health-events-own:${window.start}:${window.end}`, CACHE_TTL_1H, ["health"]);
}
