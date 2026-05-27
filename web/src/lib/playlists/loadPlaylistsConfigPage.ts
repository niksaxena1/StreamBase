import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseServer } from "@/lib/supabase/server";

export type PlaylistsConfigPlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  playlist_type: string | null;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
  display_order: number | null;
};

export type PlaylistsConfigStats = {
  track_count: number | null;
  daily_tracks_net: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
};

function mapPlaylistRows(data: unknown[] | null): PlaylistsConfigPlaylistRow[] {
  return (data ?? []).map((p) => {
    const row = p as Record<string, unknown>;
    return {
      playlist_key: String(row.playlist_key ?? ""),
      display_name: String(row.display_name ?? ""),
      is_catalog: Boolean(row.is_catalog ?? false),
      playlist_type: (row.playlist_type as string | null) ?? null,
      display_order: (row.display_order as number | null) ?? null,
      spotify_playlist_id: (row.spotify_playlist_id as string | null) ?? null,
      spotify_playlist_image_url: (row.spotify_playlist_image_url as string | null) ?? null,
      spotify_last_fetched_at: (row.spotify_last_fetched_at as string | null) ?? null,
    };
  });
}

export async function loadPlaylistsConfigPage(): Promise<{
  playlists: PlaylistsConfigPlaylistRow[];
  isAdmin: boolean;
  errorMessage: string | null;
}> {
  const sb = await supabaseServer();
  const { data: isAdminRaw } = await sb.rpc("is_admin");

  const cached = await cachedQuery(
    async () => {
      let playlistsResult: { data: unknown[] | null; error: { message: string } | null } = await sb
        .from("playlists")
        .select(
          "playlist_key,display_name,is_catalog,playlist_type,spotify_playlist_id,spotify_playlist_image_url,spotify_last_fetched_at,display_order",
        )
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("is_catalog", { ascending: false })
        .order("display_name", { ascending: true });

      if (
        playlistsResult.error &&
        (playlistsResult.error.message?.includes("playlist_type") ||
          playlistsResult.error.message?.includes("display_order"))
      ) {
        const fallback = await sb
          .from("playlists")
          .select(
            "playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url,spotify_last_fetched_at",
          )
          .order("is_catalog", { ascending: false })
          .order("display_name", { ascending: true });
        playlistsResult = fallback;
      }

      if (playlistsResult.error) {
        return { data: null, error: playlistsResult.error };
      }

      return {
        data: {
          playlists: mapPlaylistRows((playlistsResult.data ?? []) as unknown[]),
        },
        error: null,
      };
    },
    "playlists-config",
    CACHE_TTL_1H,
  );

  return {
    playlists: cached.data?.playlists ?? [],
    isAdmin: Boolean(isAdminRaw),
    errorMessage: cached.error?.message ?? null,
  };
}
