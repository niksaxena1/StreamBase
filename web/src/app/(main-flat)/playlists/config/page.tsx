import Link from "next/link";
import { ArrowLeft, Settings } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";
import { PlaylistFilters } from "./PlaylistFilters";
import { Alert } from "@/components/ui/Alert";

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

  // Fetch latest stats for all playlists
  const playlistKeys = playlists.map((p) => p.playlist_key);
  const statsMap = new Map<string, { track_count: number | null; total_streams_cumulative: number | null; daily_streams_net: number | null }>();
  
  if (playlistKeys.length > 0) {
    try {
      // Fetch latest stats for each playlist
      const statsPromises = playlistKeys.map(async (key) => {
        const { data: statsData } = await sb
          .from("playlist_daily_stats")
          .select("track_count,total_streams_cumulative,daily_streams_net")
          .eq("playlist_key", key)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        
        return { key, stats: statsData };
      });
      
      const statsResults = await Promise.all(statsPromises);
      statsResults.forEach(({ key, stats }) => {
        if (stats) {
          statsMap.set(key, {
            track_count: stats.track_count,
            total_streams_cumulative: stats.total_streams_cumulative,
            daily_streams_net: stats.daily_streams_net,
          });
        }
      });
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
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/playlists"
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            aria-label="Back to playlists dashboard"
            title="Back to playlists dashboard"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </Link>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Playlists
            </h1>
            <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Tracked playlists from configuration.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Link
              href="/playlists/config/settings"
              className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
              aria-label="Playlist settings"
              title="Playlist settings"
            >
              <Settings className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
            </Link>
          ) : null}
        </div>
      </div>

      {error && (
        <Alert variant="error" title="Query error">
          {error.message}
        </Alert>
      )}

      <div className="flex-1 min-h-0">
        <PlaylistFilters 
          playlists={playlists} 
          statsMap={Object.fromEntries(statsMap)} 
        />
      </div>
    </div>
  );
}

