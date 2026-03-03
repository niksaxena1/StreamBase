import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";
import { PlaylistsConfigClient } from "./PlaylistsConfigClient";

export const revalidate = 86400; // 24h ISR - playlist config is slow-changing

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  playlist_type: string | null;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
  display_order: number | null;
};

export default async function PlaylistsConfigPage({
  searchParams,
}: {
  // keep as `any` to satisfy Next's generated PageProps typing
  // while avoiding sync access to a Promise in Next 16.
  searchParams?: any;
}) {
  const sp = (await searchParams ?? {}) as { refresh_spotify?: string };
  const forceRefreshSpotify = String(sp.refresh_spotify ?? "") === "1";
  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");

  // Try to fetch with playlist_type and display_order, fall back if columns don't exist
  let { data, error } = await sb
    .from("playlists")
    .select(
      "playlist_key,display_name,is_catalog,playlist_type,spotify_playlist_id,spotify_playlist_image_url,spotify_last_fetched_at,display_order",
    )
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("is_catalog", { ascending: false })
    .order("display_name", { ascending: true });

  // If columns don't exist, retry without them
  if (error && (error.message?.includes("playlist_type") || error.message?.includes("display_order"))) {
    const result = await sb
      .from("playlists")
      .select(
        "playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url,spotify_last_fetched_at",
      )
      .order("is_catalog", { ascending: false })
      .order("display_name", { ascending: true });
    data = result.data as any;
    error = result.error;
  }

  const playlists = (data ?? []).map((p: any): PlaylistRow => ({
    playlist_key: p.playlist_key,
    display_name: p.display_name,
    is_catalog: p.is_catalog ?? false,
    playlist_type: p.playlist_type ?? null,
    display_order: p.display_order ?? null,
    spotify_playlist_id: p.spotify_playlist_id ?? null,
    spotify_playlist_image_url: p.spotify_playlist_image_url ?? null,
    spotify_last_fetched_at: p.spotify_last_fetched_at ?? null,
  }));

  // Fetch latest stats for all playlists in a single batched query.
  // Request 3 rows per playlist so we can compute the track-count delta client-side.
  const playlistKeys = playlists.map((p) => p.playlist_key);
  const statsMap = new Map<
    string,
    {
      track_count: number | null;
      daily_tracks_net: number | null;
      total_streams_cumulative: number | null;
      daily_streams_net: number | null;
    }
  >();

  if (playlistKeys.length > 0) {
    try {
      const { data: allRows } = await sb
        .from("playlist_daily_stats")
        .select("playlist_key,date,track_count,total_streams_cumulative,daily_streams_net")
        .in("playlist_key", playlistKeys)
        .order("date", { ascending: false })
        .order("playlist_key", { ascending: true })
        .limit(playlistKeys.length * 3); // up to 3 recent rows per playlist for delta

      // Group rows by playlist_key; rows are already sorted newest-first.
      type StatRow = NonNullable<typeof allRows>[number];
      const byKey = new Map<string, StatRow[]>();
      for (const row of allRows ?? []) {
        const key = String((row as any).playlist_key ?? "");
        if (!key) continue;
        const bucket: StatRow[] = byKey.get(key) ?? [];
        bucket.push(row);
        byKey.set(key, bucket);
      }

      for (const [key, rows] of byKey) {
        const cur = rows[0] ?? null;
        const prev = rows[1] ?? null;
        if (!cur) continue;
        const curTracks = (cur as any).track_count ?? null;
        const prevTracks = prev ? ((prev as any).track_count ?? null) : null;
        const dailyTracksNet =
          curTracks === null || prevTracks === null ? null : Number(curTracks) - Number(prevTracks);
        statsMap.set(key, {
          track_count: (cur as any).track_count ?? null,
          daily_tracks_net: dailyTracksNet,
          total_streams_cumulative: (cur as any).total_streams_cumulative ?? null,
          daily_streams_net: (cur as any).daily_streams_net ?? null,
        });
      }
    } catch {
      // ignore stats fetch errors
    }
  }

  // Best-effort thumbnail refresh.
  // Default behavior is conservative (only fill missing thumbnails).
  // If `?refresh_spotify=1` is present, force-refresh thumbnails for ALL playlists
  // that have a spotify_playlist_id.
  try {
    const candidates = playlists.filter((p) => {
      if (!p.spotify_playlist_id) return false;
      if (forceRefreshSpotify) return true;
      return !p.spotify_playlist_image_url;
    });

    if (candidates.length) {
      const svc = supabaseService();
      // When forcing, refresh everything (small N), otherwise keep it conservative.
      const batch = forceRefreshSpotify ? candidates : candidates.slice(0, 3);
      for (const p of batch) {
        const id = p.spotify_playlist_id;
        if (!id) continue;
        const meta = await getPlaylist(id);
        await svc
          .from("playlists")
          .update({
            spotify_playlist_name: meta.name,
            spotify_playlist_image_url: meta.imageUrl,
            spotify_last_fetched_at: new Date().toISOString(),
          })
          .eq("playlist_key", p.playlist_key);
        p.spotify_playlist_image_url = meta.imageUrl;
        p.spotify_last_fetched_at = new Date().toISOString();
      }
    }
  } catch {
    // ignore refresh errors
  }

  return (
    <PlaylistsConfigClient
      playlists={playlists}
      statsMap={Object.fromEntries(statsMap)}
      isAdmin={Boolean(isAdmin)}
      errorMessage={error?.message ?? null}
    />
  );
}

