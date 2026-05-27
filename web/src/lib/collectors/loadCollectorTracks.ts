import type { CollectorTrackRow } from "@/app/(main-flat)/collectors/collectorsTypes";
import { getEffectiveCollectorPlaylists } from "@/app/(main-flat)/collectors/collectorsUtils";
import { supabaseService } from "@/lib/supabase/service";

const COLLECTORS = ["A", "K", "N", "PL", "TG", "NL"] as const;

export async function loadCollectorTracks(args: {
  selectedCollector: string;
  latestRunDate: string;
  prevRunDate: string;
  useEntityPlaylistsForTotals: boolean;
}): Promise<CollectorTrackRow[]> {
  const svc = supabaseService();
  const { selectedCollector, latestRunDate, prevRunDate, useEntityPlaylistsForTotals } = args;

  const { data: playlistRows } = await svc
    .from("playlists")
    .select("playlist_key,display_name,collector,spotify_playlist_image_url")
    .or(`collector.in.(${[...COLLECTORS].join(",")}),playlist_key.in.(tg_total,p_total)`);

  const playlists = playlistRows ?? [];
  const selectedPlaylists = getEffectiveCollectorPlaylists(
    playlists,
    selectedCollector,
    useEntityPlaylistsForTotals,
  );

  const nameByKey = new Map(selectedPlaylists.map((p) => [p.playlist_key, p.display_name]));
  const imageByKey = new Map(
    selectedPlaylists.map((p) => [p.playlist_key, p.spotify_playlist_image_url ?? null]),
  );
  const allPlaylistsImageByKey = new Map(
    playlists.map((p) => [p.playlist_key, p.spotify_playlist_image_url ?? null]),
  );

  const mapPlaylistKeysToNames = (keys: string[] | null): string[] | null => {
    if (!keys?.length) return keys;
    return keys.map((k) => String(nameByKey.get(String(k)) ?? k));
  };

  const mapPlaylistKeysToImageUrls = (keys: string[] | null): (string | null)[] | null => {
    if (!keys?.length) return keys?.length === 0 ? [] : null;
    return keys.map((k) => allPlaylistsImageByKey.get(String(k)) ?? null);
  };

  const pageSize = 1000;
  const hardCap = 50_000;
  const all: Record<string, unknown>[] = [];

  for (let offset = 0; offset < hardCap; offset += pageSize) {
    const { data, error } = useEntityPlaylistsForTotals
      ? await svc.rpc("collector_tracks_paged_scoped", {
          collector: selectedCollector,
          run_date: latestRunDate,
          prev_date: prevRunDate,
          offset_rows: offset,
          limit_rows: pageSize,
          p_use_entity_playlists: true,
        })
      : await svc.rpc("collector_tracks_paged", {
          collector: selectedCollector,
          run_date: latestRunDate,
          prev_date: prevRunDate,
          offset_rows: offset,
          limit_rows: pageSize,
        });

    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  return all.map((r): CollectorTrackRow => ({
    isrc: String(r.isrc),
    name: r.name == null ? null : String(r.name),
    release_date: r.release_date == null ? null : String(r.release_date),
    album_image_url: r.album_image_url == null ? null : String(r.album_image_url),
    artist_names: (r.artist_names ?? null) as string[] | null,
    artist_ids: (r.artist_ids ?? null) as string[] | null,
    playlist_keys: (r.playlist_keys ?? null) as string[] | null,
    playlist_names: mapPlaylistKeysToNames((r.playlist_keys ?? null) as string[] | null),
    distro_playlist_keys: (r.distro_playlist_keys ?? null) as string[] | null,
    distro_playlist_names: mapPlaylistKeysToNames((r.distro_playlist_keys ?? null) as string[] | null),
    distro_playlist_image_urls: mapPlaylistKeysToImageUrls((r.distro_playlist_keys ?? null) as string[] | null),
    total_streams_cumulative: r.total_streams_cumulative == null ? null : Number(r.total_streams_cumulative),
    daily_streams_delta: r.daily_streams_delta == null ? null : Number(r.daily_streams_delta),
  }));
}
