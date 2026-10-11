import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollaborationGraph, NetworkPlaylistOption } from "@/app/(main-flat)/network/networkTypes";
import type { NetworkScopeState } from "@/app/(main-flat)/network/networkScope";
import type { NetworkPageShell } from "./loadNetworkPage";
type Track = {
  isrc: string;
  release_date: string | null;
  first_seen: string | null;
  spotify_artist_ids: string[] | null;
};
type Snapshot = {
  isrc: string;
  date: string;
  streams_cumulative: number | null;
};
const PAGE = 1000;
const BATCH = 200;
/** Only metadata and two snapshots are added to the cached graph load; no client graph fetch. */
export async function loadNetworkInsights(svc: SupabaseClient, graph: CollaborationGraph, shell: NetworkPageShell, scope: NetworkScopeState, playlists: NetworkPlaylistOption[]): Promise<CollaborationGraph> {
  if (!graph.nodes.length)
    return graph;
  const db = svc.schema(shell.datasetMode === "competitor" ? "competitor" : "public");
  const crossLabel = shell.graphMode === "cross-label";
  const today = new Date().toISOString().slice(0, 10);
  const tracks = new Map<string, Track>();
  const labelsByIsrc = new Map<string, Set<string>>();
  let excludedIsrcs: Set<string> | null = null;
  try {
    let scopedIsrcs: Set<string> | null = null;
    if (shell.datasetMode === "competitor" || scope.mode !== "catalog") {
      let playlistLabels = new Map(playlists.map((p) => [p.playlist_key, shell.competitorLabelKey ?? ""]));
      if (crossLabel) {
        playlistLabels = new Map();
        for (let offset = 0;; offset += PAGE) {
          const { data, error } = await db.from("playlists").select("playlist_key,label_key").eq("is_active", true).order("playlist_key").range(offset, offset + PAGE - 1);
          if (error)
            throw error;
          for (const row of data ?? [])
            playlistLabels.set(row.playlist_key, row.label_key);
          if ((data ?? []).length < PAGE)
            break;
        }
      }
      const keys = shell.datasetMode === "competitor"
        ? [...playlistLabels.keys()]
        : scope.mode === "playlist" ? [scope.playlistKey!] : scope.customPlaylistKeys;
      const membershipKeys = new Map<string, Set<string>>();
      for (let start = 0; start < keys.length; start += BATCH) {
        for (let offset = 0;; offset += PAGE) {
          const { data, error } = await db.from("playlist_memberships").select("isrc,playlist_key").in("playlist_key", keys.slice(start, start + BATCH))
            .lte("valid_from", today).or(`valid_to.is.null,valid_to.gte.${today}`).order("isrc").order("playlist_key").range(offset, offset + PAGE - 1);
          if (error)
            throw error;
          for (const row of data ?? []) {
            if (!membershipKeys.has(row.isrc))
              membershipKeys.set(row.isrc, new Set());
            membershipKeys.get(row.isrc)!.add(row.playlist_key);
            if (crossLabel) {
              if (!labelsByIsrc.has(row.isrc))
                labelsByIsrc.set(row.isrc, new Set());
              const label = playlistLabels.get(row.playlist_key);
              if (label)
                labelsByIsrc.get(row.isrc)!.add(label);
            }
          }
          if ((data ?? []).length < PAGE)
            break;
        }
      }
      const selected = scope.mode === "playlist" ? [scope.playlistKey!] : scope.customPlaylistKeys;
      scopedIsrcs = new Set([...membershipKeys].filter(([, memberKeys]) => {
        if (crossLabel || scope.mode === "catalog" || !selected.length)
          return true;
        if (scope.mode === "playlist")
          return memberKeys.has(scope.playlistKey!);
        if (scope.customPlaylistMode === "all")
          return selected.every((key) => memberKeys.has(key));
        if (scope.customPlaylistMode === "none")
          return selected.every((key) => !memberKeys.has(key));
        return selected.some((key) => memberKeys.has(key));
      }).map(([isrc]) => isrc));
      // Own-catalog exclusion starts from the whole catalog, not the selected playlists.
      if (shell.datasetMode === "own" && scope.mode === "custom" && scope.customPlaylistMode === "none") {
        scopedIsrcs = null;
        excludedIsrcs = new Set(membershipKeys.keys());
      }
    }
    async function readArtistTracks(excluded: Set<string> | null = null) {
      const ids = graph.nodes.map((node) => node.id);
      for (let start = 0; start < ids.length; start += BATCH) {
        for (let offset = 0;; offset += PAGE) {
          const { data, error } = await db.from("tracks").select("isrc,release_date,first_seen,spotify_artist_ids")
            .overlaps("spotify_artist_ids", ids.slice(start, start + BATCH)).order("isrc").range(offset, offset + PAGE - 1);
          if (error)
            throw error;
          for (const row of (data ?? []) as Track[])
            if (!excluded?.has(row.isrc))
              tracks.set(row.isrc, row);
          if ((data ?? []).length < PAGE)
            break;
        }
      }
    }
    if (scopedIsrcs) {
      const isrcs = [...scopedIsrcs];
      for (let start = 0; start < isrcs.length; start += BATCH) {
        const { data, error } = await db.from("tracks").select("isrc,release_date,first_seen,spotify_artist_ids").in("isrc", isrcs.slice(start, start + BATCH));
        if (error)
          throw error;
        for (const row of (data ?? []) as Track[])
          tracks.set(row.isrc, row);
      }
    }
    else
      await readArtistTracks(excludedIsrcs);
    const dailyByIsrc = new Map<string, number>();
    try {
      const latestResult = await db.from("track_daily_streams_effective_public").select("date").order("date", { ascending: false }).limit(1);
      if (latestResult.error)
        throw latestResult.error;
      const latest = latestResult.data?.[0]?.date as string | undefined;
      if (latest) {
        const previousResult = await db.from("track_daily_streams_effective_public").select("date").lt("date", latest).order("date", { ascending: false }).limit(1);
        if (previousResult.error)
          throw previousResult.error;
        const previous = previousResult.data?.[0]?.date as string | undefined;
        if (previous) {
          const isrcs = [...tracks.keys()];
          for (let start = 0; start < isrcs.length; start += BATCH) {
            const { data, error } = await db.from("track_daily_streams_effective_public").select("isrc,date,streams_cumulative").in("isrc", isrcs.slice(start, start + BATCH)).in("date", [latest, previous]);
            if (error)
              throw error;
            const snapshots = new Map<string, {
              latest?: number;
              previous?: number;
            }>();
            for (const row of (data ?? []) as Snapshot[]) {
              if (row.streams_cumulative == null)
                continue;
              if (!snapshots.has(row.isrc))
                snapshots.set(row.isrc, {});
              snapshots.get(row.isrc)![row.date === latest ? "latest" : "previous"] = Number(row.streams_cumulative);
            }
            for (const [isrc, pair] of snapshots) {
              if (pair.latest != null && pair.previous != null)
                dailyByIsrc.set(isrc, Math.max(0, pair.latest - pair.previous));
            }
          }
        }
      }
    }
    catch (error) {
      dailyByIsrc.clear();
      console.error("network insight stream snapshots failed:", error);
    }
    const dailyByNode = new Map<string, number>();
    for (const [isrc, track] of tracks) {
      const daily = dailyByIsrc.get(isrc);
      if (daily == null)
        continue;
      const ids = crossLabel ? labelsByIsrc.get(isrc) ?? [] : new Set(track.spotify_artist_ids ?? []);
      for (const id of ids)
        dailyByNode.set(id, (dailyByNode.get(id) ?? 0) + daily);
    }
    return {
      nodes: graph.nodes.map((node) => ({ ...node, daily_streams: dailyByNode.get(node.id) ?? null })),
      edges: graph.edges.map((edge) => {
        const shared = edge.shared_tracks.map((track) => ({ ...track, release_date: tracks.get(track.isrc)?.release_date ?? null, first_seen: tracks.get(track.isrc)?.first_seen ?? null, daily_streams: dailyByIsrc.get(track.isrc) ?? null }));
        const known = [...new Map(shared.map((track) => [track.isrc, track])).values()].filter((track) => track.daily_streams != null);
        return { ...edge, shared_tracks: shared, daily_streams: known.length ? known.reduce((sum, track) => sum + track.daily_streams!, 0) : null };
      }),
    };
  }
  catch (error) {
    console.error("network insight enrichment failed:", error);
    return graph;
  }
}
