import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollaborationGraph, NetworkPlaylistOption } from "@/app/(main-flat)/network/networkTypes";
import type { NetworkScopeState } from "@/app/(main-flat)/network/networkScope";
import type { NetworkPageShell } from "./loadNetworkPage";

type Track = { isrc: string; release_date: string | null; first_seen: string | null; spotify_artist_ids: string[] | null };
type Snapshot = { isrc: string; date: string; streams_cumulative: number | null };
const PAGE = 1000;
const ARTIST_BATCH = 200;
const ISRC_BATCH = 500;
const FILTER_URL_BUDGET = 7600;

/** Reserve URL headroom for the path, selected columns, dates and PostgREST syntax. */
export function networkIdentifierBatches(values: string[], maximum = ISRC_BATCH): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const value of values) {
    const encodedBytes = encodeURIComponent(value).length + 3 + (/[(),:"]/.test(value) ? 6 : 0);
    if (batch.length && (batch.length === maximum || bytes + encodedBytes > FILTER_URL_BUDGET)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(value);
    bytes += encodedBytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** A single limiter covers every pipeline stage, including concurrently loading snapshot dates. */
function queryLimiter() {
  let active = 0;
  const pending: Array<() => void> = [];
  const pump = () => {
    while (active < 4 && pending.length) pending.shift()!();
  };
  return <T,>(task: () => PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => {
    pending.push(() => {
      active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; pump(); });
    });
    pump();
  });
}

/** Cached enrichment only. 1,600 artists/one track each: 8 metadata + 2 date + 4 snapshot
 * requests = 14 round trips in roughly four waves at concurrency 4; scoped membership
 * pagination adds its own reads. 500 ISRCs × 2 dates stays within the 1,000-row API limit. */
export async function loadNetworkInsights(
  svc: SupabaseClient, graph: CollaborationGraph, shell: NetworkPageShell,
  scope: NetworkScopeState, playlists: NetworkPlaylistOption[],
): Promise<CollaborationGraph> {
  if (!graph.nodes.length) return graph;
  const db = svc.schema(shell.datasetMode === "competitor" ? "competitor" : "public");
  const query = queryLimiter();
  const crossLabel = shell.graphMode === "cross-label";
  const today = new Date().toISOString().slice(0, 10);
  const tracks = new Map<string, Track>();
  const labelsByIsrc = new Map<string, Set<string>>();

  async function readSnapshotDates(): Promise<[string, string] | null> {
    try {
      const latestResult = await query(() => db.from("track_daily_streams_effective_public")
        .select("date").order("date", { ascending: false }).limit(1));
      if (latestResult.error) throw latestResult.error;
      const latest = latestResult.data?.[0]?.date as string | undefined;
      if (!latest) return null;
      const previousResult = await query(() => db.from("track_daily_streams_effective_public")
        .select("date").lt("date", latest).order("date", { ascending: false }).limit(1));
      if (previousResult.error) throw previousResult.error;
      const previous = previousResult.data?.[0]?.date as string | undefined;
      return previous ? [latest, previous] : null;
    } catch (error) {
      console.error("network insight stream snapshot dates failed:", error);
      return null;
    }
  }

  async function readTrackMetadata() {
    let scopedIsrcs: Set<string> | null = null;
    let excludedIsrcs: Set<string> | null = null;
    if (shell.datasetMode === "competitor" || scope.mode !== "catalog") {
      let playlistLabels = new Map(playlists.map((p) => [p.playlist_key, shell.competitorLabelKey ?? ""]));
      if (crossLabel) {
        playlistLabels = new Map();
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await query(() => db.from("playlists")
            .select("playlist_key,label_key").eq("is_active", true)
            .order("playlist_key").range(offset, offset + PAGE - 1));
          if (error) throw error;
          for (const row of data ?? []) playlistLabels.set(row.playlist_key, row.label_key);
          if ((data ?? []).length < PAGE) break;
        }
      }
      const keys = shell.datasetMode === "competitor" ? [...playlistLabels.keys()]
        : scope.mode === "playlist" ? [scope.playlistKey!] : scope.customPlaylistKeys;
      const membershipKeys = new Map<string, Set<string>>();
      await Promise.all(networkIdentifierBatches(keys, ARTIST_BATCH).map(async (part) => {
        // Page n+1 depends on page n; independent playlist batches share the same four slots.
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await query(() => db.from("playlist_memberships")
            .select("isrc,playlist_key").in("playlist_key", part)
            .lte("valid_from", today).or(`valid_to.is.null,valid_to.gte.${today}`)
            .order("isrc").order("playlist_key").range(offset, offset + PAGE - 1));
          if (error) throw error;
          for (const row of data ?? []) {
            if (!membershipKeys.has(row.isrc)) membershipKeys.set(row.isrc, new Set());
            membershipKeys.get(row.isrc)!.add(row.playlist_key);
            if (crossLabel) {
              if (!labelsByIsrc.has(row.isrc)) labelsByIsrc.set(row.isrc, new Set());
              const label = playlistLabels.get(row.playlist_key);
              if (label) labelsByIsrc.get(row.isrc)!.add(label);
            }
          }
          if ((data ?? []).length < PAGE) break;
        }
      }));
      const selected = scope.mode === "playlist" ? [scope.playlistKey!] : scope.customPlaylistKeys;
      scopedIsrcs = new Set([...membershipKeys].filter(([, memberKeys]) => {
        if (crossLabel || scope.mode === "catalog" || !selected.length) return true;
        if (scope.mode === "playlist") return memberKeys.has(scope.playlistKey!);
        if (scope.customPlaylistMode === "all") return selected.every((key) => memberKeys.has(key));
        if (scope.customPlaylistMode === "none") return selected.every((key) => !memberKeys.has(key));
        return selected.some((key) => memberKeys.has(key));
      }).map(([isrc]) => isrc));
      // Own-catalog exclusion (or empty custom scope) starts from the whole catalog.
      if (shell.datasetMode === "own" && scope.mode === "custom" &&
          (scope.customPlaylistMode === "none" || !selected.length)) {
        scopedIsrcs = null;
        excludedIsrcs = new Set(membershipKeys.keys());
      }
    }
    if (scopedIsrcs) {
      await Promise.all(networkIdentifierBatches([...scopedIsrcs]).map(async (part) => {
        const { data, error } = await query(() => db.from("tracks")
          .select("isrc,release_date,first_seen,spotify_artist_ids").in("isrc", part));
        if (error) throw error;
        for (const row of (data ?? []) as Track[]) tracks.set(row.isrc, row);
      }));
    } else {
      const ids = graph.nodes.map((node) => node.id);
      await Promise.all(networkIdentifierBatches(ids, ARTIST_BATCH).map(async (part) => {
        for (let offset = 0; ; offset += PAGE) {
          const { data, error } = await query(() => db.from("tracks")
            .select("isrc,release_date,first_seen,spotify_artist_ids")
            .overlaps("spotify_artist_ids", part).order("isrc").range(offset, offset + PAGE - 1));
          if (error) throw error;
          for (const row of (data ?? []) as Track[]) {
            if (!excludedIsrcs?.has(row.isrc)) tracks.set(row.isrc, row);
          }
          if ((data ?? []).length < PAGE) break;
        }
      }));
    }
  }

  try {
    const [dates] = await Promise.all([readSnapshotDates(), readTrackMetadata()]);
    const dailyByIsrc = new Map<string, number>();
    if (dates) {
      try {
        const batchMetrics = await Promise.all(networkIdentifierBatches([...tracks.keys()]).map(async (part) => {
          const { data, error } = await query(() => db.from("track_daily_streams_effective_public")
            .select("isrc,date,streams_cumulative").in("isrc", part).in("date", dates));
          if (error) throw error;
          const snapshots = new Map<string, { latest?: number; previous?: number }>();
          for (const row of (data ?? []) as Snapshot[]) {
            if (row.streams_cumulative == null) continue;
            if (!snapshots.has(row.isrc)) snapshots.set(row.isrc, {});
            snapshots.get(row.isrc)![row.date === dates[0] ? "latest" : "previous"] = Number(row.streams_cumulative);
          }
          const metrics = new Map<string, number>();
          for (const [isrc, pair] of snapshots) {
            if (pair.latest != null && pair.previous != null) {
              metrics.set(isrc, Math.max(0, pair.latest - pair.previous));
            }
          }
          return metrics;
        }));
        for (const metrics of batchMetrics) {
          for (const [isrc, daily] of metrics) dailyByIsrc.set(isrc, daily);
        }
      } catch (error) {
        dailyByIsrc.clear();
        console.error("network insight stream snapshots failed:", error);
      }
    }
    const dailyByNode = new Map<string, number>();
    for (const [isrc, track] of tracks) {
      const daily = dailyByIsrc.get(isrc);
      if (daily == null) continue;
      const ids = crossLabel ? labelsByIsrc.get(isrc) ?? [] : new Set(track.spotify_artist_ids ?? []);
      for (const id of ids) dailyByNode.set(id, (dailyByNode.get(id) ?? 0) + daily);
    }
    return {
      nodes: graph.nodes.map((node) => ({ ...node, daily_streams: dailyByNode.get(node.id) ?? null })),
      edges: graph.edges.map((edge) => {
        const shared = edge.shared_tracks.map((track) => ({
          ...track, release_date: tracks.get(track.isrc)?.release_date ?? null,
          first_seen: tracks.get(track.isrc)?.first_seen ?? null,
          daily_streams: dailyByIsrc.get(track.isrc) ?? null,
        }));
        const known = [...new Map(shared.map((track) => [track.isrc, track])).values()]
          .filter((track) => track.daily_streams != null);
        return {
          ...edge, shared_tracks: shared,
          daily_streams: known.length ? known.reduce((sum, track) => sum + track.daily_streams!, 0) : null,
        };
      }),
    };
  } catch (error) {
    console.error("network insight enrichment failed:", error);
    return graph;
  }
}
