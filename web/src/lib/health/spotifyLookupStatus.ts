import type { supabaseService } from "@/lib/supabase/service";
import type { TrackBase } from "./types";

/** Older Health RPCs do not return lookup status. Hydrate only placeholders. */
export async function hydrateSpotifyLookupStatus(
  svc: ReturnType<typeof supabaseService>,
  tracks: TrackBase[],
) {
  const pending = tracks.filter((track) =>
    !track.album_image_url && track.spotify_not_found_since === undefined,
  );
  const isrcs = [...new Set(pending.map((track) => track.isrc))];
  for (let offset = 0; offset < isrcs.length; offset += 200) {
    try {
      const { data, error } = await svc.from("tracks")
        .select("isrc,spotify_not_found_since")
        .in("isrc", isrcs.slice(offset, offset + 200));
      if (error) continue;
      const sinceByIsrc = new Map((data ?? []).map((row) => [row.isrc, row.spotify_not_found_since]));
      for (const track of pending) {
        if (sinceByIsrc.has(track.isrc)) track.spotify_not_found_since = sinceByIsrc.get(track.isrc) ?? null;
      }
    } catch {
      // Lookup status must not hide other Health diagnostics on a read failure.
    }
  }
}
