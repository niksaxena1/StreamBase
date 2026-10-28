import { redirect } from "next/navigation";

import type { PlaylistWatchRow } from "@/app/(main-flat)/playlist-watch/PlaylistWatchClient";
import type { PlaylistWatchCollection } from "@/app/(main-flat)/playlist-watch/collectionsModel";
import { CACHE_TTL_1H } from "@/lib/constants";
import {
  getDemoFollowerSnapshots,
  getDemoLatestFollowerCount,
  isPlaylistWatchDemoPlaylistId,
  PLAYLIST_WATCH_DEMO_IMAGE_URL,
  PLAYLIST_WATCH_DEMO_OWNER_NAME,
} from "@/lib/playlistWatch/demoPlaylist";
import { buildFollowerHistory } from "@/lib/playlistWatch/history";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

type PlaylistRow = {
  spotify_playlist_id: string;
  display_name: string | null;
  owner_spotify_id: string | null;
  owner_display_name: string | null;
  spotify_url: string | null;
  image_url: string | null;
  watch_status: "active" | "archived";
  last_check_status: string | null;
  last_check_message: string | null;
  latest_follower_count: number | null;
  latest_snapshot_date: string | null;
  latest_checked_at: string | null;
};

type SnapshotRow = {
  date: string;
  spotify_playlist_id: string;
  follower_count: number;
};

type MarkRow = {
  spotify_playlist_id: string;
  is_favorite: boolean;
};

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function deltaSince(rows: SnapshotRow[], latest: number | null, days: number) {
  if (latest === null) return null;
  const target = isoDaysAgo(days);
  const baseline = rows
    .filter((row) => row.date <= target)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!baseline) return null;
  return latest - Number(baseline.follower_count);
}

/**
 * Collections are small, user-edited and shared, so they are read fresh (not through the 1h
 * snapshot cache) and a mutation followed by router.refresh() shows up immediately.
 */
async function loadCollections(): Promise<PlaylistWatchCollection[]> {
  const pw = supabaseService().schema("playlist_watch");
  const [{ data: collections, error: collectionsErr }, { data: members, error: membersErr }] = await Promise.all([
    pw
      .from("collections")
      .select("id,name,color,sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    pw.from("collection_playlists").select("collection_id,spotify_playlist_id").limit(20000),
  ]);
  if (collectionsErr) throw new Error(collectionsErr.message);
  if (membersErr) throw new Error(membersErr.message);
  const byCollection = new Map<string, string[]>();
  for (const m of (members ?? []) as { collection_id: string; spotify_playlist_id: string }[]) {
    const bucket = byCollection.get(m.collection_id) ?? [];
    bucket.push(m.spotify_playlist_id);
    byCollection.set(m.collection_id, bucket);
  }
  return ((collections ?? []) as { id: string; name: string; color: string | null; sort_order: number }[]).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    sortOrder: c.sort_order,
    playlistIds: byCollection.get(c.id) ?? [],
  }));
}

export async function loadPlaylistWatchPage(includeArchived: boolean): Promise<{
  rows: PlaylistWatchRow[];
  collections: PlaylistWatchCollection[];
  isAdmin: boolean;
  latestRun: {
    run_date: string | null;
    status: string | null;
    success_count: number | null;
    failure_count: number | null;
  } | null;
}> {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");

  const [{ data: canAccess }, { data: isAdmin }] = await Promise.all([
    sb.rpc("can_access_playlist_watch"),
    sb.rpc("is_playlist_watch_admin"),
  ]);
  if (!canAccess) redirect("/");

  const cacheKey = `playlist-watch-${includeArchived ? "all" : "active"}`;

  const [cached, collections] = await Promise.all([cachedQuery(
    async () => {
      const pw = supabaseService().schema("playlist_watch");
      let playlistQuery = pw
        .from("playlists")
        .select(
          "spotify_playlist_id,display_name,owner_spotify_id,owner_display_name,spotify_url,image_url,watch_status,last_check_status,last_check_message,latest_follower_count,latest_snapshot_date,latest_checked_at",
        )
        .order("latest_follower_count", { ascending: false, nullsFirst: false })
        .order("display_name", { ascending: true })
        .limit(1000);
      if (!includeArchived) playlistQuery = playlistQuery.eq("watch_status", "active");

      const { data: playlistsRaw, error: playlistsErr } = await playlistQuery;
      if (playlistsErr) return { data: null, error: playlistsErr };

      const playlistRows = (playlistsRaw ?? []) as PlaylistRow[];
      const playlistIds = playlistRows.map((p) => p.spotify_playlist_id);
      const since = isoDaysAgo(35);

      const [{ data: snapshotsRaw }, { data: marksRaw }, { data: latestRun }] = await Promise.all([
        playlistIds.length
          ? pw
              .from("follower_snapshots")
              .select("date,spotify_playlist_id,follower_count")
              .in("spotify_playlist_id", playlistIds)
              .gte("date", since)
          : Promise.resolve({ data: [] as SnapshotRow[], error: null }),
        playlistIds.length
          ? pw
              .from("user_playlist_marks")
              .select("spotify_playlist_id,is_favorite")
              .eq("user_id", userData.user!.id)
              .in("spotify_playlist_id", playlistIds)
          : Promise.resolve({ data: [] as MarkRow[], error: null }),
        pw
          .from("ingestion_runs")
          .select("run_date,status,success_count,failure_count,finished_at")
          .order("run_date", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const snapshotsByPlaylist = new Map<string, SnapshotRow[]>();
      for (const row of (snapshotsRaw ?? []) as SnapshotRow[]) {
        const bucket = snapshotsByPlaylist.get(row.spotify_playlist_id) ?? [];
        bucket.push(row);
        snapshotsByPlaylist.set(row.spotify_playlist_id, bucket);
      }

      const favoriteIds = new Set(
        ((marksRaw ?? []) as MarkRow[])
          .filter((row) => row.is_favorite)
          .map((row) => row.spotify_playlist_id),
      );

      const rows: PlaylistWatchRow[] = playlistRows.map((playlist) => {
        const isDemo = isPlaylistWatchDemoPlaylistId(playlist.spotify_playlist_id);
        const snapshots = isDemo
          ? getDemoFollowerSnapshots()
          : (snapshotsByPlaylist.get(playlist.spotify_playlist_id) ?? []);
        const latest = isDemo
          ? getDemoLatestFollowerCount()
          : playlist.latest_follower_count === null
            ? null
            : Number(playlist.latest_follower_count);
        return {
          spotifyPlaylistId: playlist.spotify_playlist_id,
          displayName: playlist.display_name ?? playlist.spotify_playlist_id,
          ownerSpotifyId: playlist.owner_spotify_id,
          ownerName: isDemo ? PLAYLIST_WATCH_DEMO_OWNER_NAME : playlist.owner_display_name,
          spotifyUrl: playlist.spotify_url,
          imageUrl: isDemo ? (playlist.image_url ?? PLAYLIST_WATCH_DEMO_IMAGE_URL) : playlist.image_url,
          watchStatus: playlist.watch_status,
          lastCheckStatus: playlist.last_check_status,
          lastCheckMessage: playlist.last_check_message,
          latestFollowerCount: latest,
          latestSnapshotDate: playlist.latest_snapshot_date,
          latestCheckedAt: playlist.latest_checked_at,
          isFavorite: favoriteIds.has(playlist.spotify_playlist_id),
          delta1d: deltaSince(snapshots, latest, 1),
          delta7d: deltaSince(snapshots, latest, 7),
          delta30d: deltaSince(snapshots, latest, 30),
          history: buildFollowerHistory(snapshots),
        };
      });

      const latestRunRow = latestRun as {
        run_date?: string | null;
        status?: string | null;
        success_count?: number | null;
        failure_count?: number | null;
      } | null;

      return {
        data: {
          rows,
          latestRun: latestRunRow
            ? {
                run_date: latestRunRow.run_date ?? null,
                status: latestRunRow.status ?? null,
                success_count: latestRunRow.success_count ?? null,
                failure_count: latestRunRow.failure_count ?? null,
              }
            : null,
        },
        error: null,
      };
    },
    cacheKey,
    CACHE_TTL_1H,
  ), loadCollections()]);

  if (cached.error) throw new Error(cached.error.message);

  return {
    rows: cached.data?.rows ?? [],
    collections,
    isAdmin: Boolean(isAdmin),
    latestRun: cached.data?.latestRun ?? null,
  };
}
