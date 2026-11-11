import { redirect } from "next/navigation";

import {
  normalizeCandidates,
  normalizeChartPositions,
  type ChartCandidate,
  type ChartPositionRow,
} from "@/app/(main-flat)/playlist-watch/upload/chartLinkModel";
import { normalizeRows, type UploadTrackRow } from "@/app/(main-flat)/playlist-watch/upload/uploadTracksModel";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export type UploadPlaylistMeta = {
  spotifyPlaylistId: string;
  displayName: string;
  ownerDisplayName: string | null;
  imageUrl: string | null;
  trackCount: number | null;
  latestCheckedAt: string | null;
  lastCheckStatus: string | null;
  lastCheckMessage: string | null;
};

const UPLOAD_SLUG = "upload";

/** Same gate as the main Playlist Watch page, then fresh (uncached) reads of the small track set. */
export async function loadUploadTracksPage(): Promise<{
  playlist: UploadPlaylistMeta | null;
  rows: UploadTrackRow[];
  /** Latest snapshot date across all tracks (yyyy-mm-dd), or null when nothing is collected yet. */
  latestSnapshotDate: string | null;
  /** Beatport chart positions of upload tracks (empty when the chart RPCs fail). */
  chartPositions: ChartPositionRow[];
  /** Chart tracks not in the playlist (empty when the chart RPCs fail). */
  candidates: ChartCandidate[];
  /** Active charts with their public URL, for "open on Beatport" links. */
  charts: { chartKey: string; name: string; url: string | null }[];
}> {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: canAccess } = await sb.rpc("can_access_playlist_watch");
  if (!canAccess) redirect("/");

  const pw = supabaseService().schema("playlist_watch");
  /** Chart data is additive: a failure is logged and the page renders without it. */
  const chartRpc = async (fn: "track_watch_chart_positions" | "track_watch_chart_candidates"): Promise<unknown> => {
    try {
      const res = await pw.rpc(fn, { p_slug: UPLOAD_SLUG });
      if (res.error) {
        console.error(`[upload-tracks] ${fn} failed:`, res.error.message);
        return [];
      }
      return res.data;
    } catch (err) {
      console.error(`[upload-tracks] ${fn} threw:`, err);
      return [];
    }
  };

  const chartsList = async (): Promise<{ chartKey: string; name: string; url: string | null }[]> => {
    try {
      const res = await supabaseService().schema("charts").from("charts").select("chart_key,display_name,url").eq("is_active", true);
      if (res.error) throw new Error(res.error.message);
      return (res.data ?? []).map((c: { chart_key: string; display_name: string | null; url: string | null }) => ({
        chartKey: c.chart_key,
        name: c.display_name ?? c.chart_key,
        url: c.url,
      }));
    } catch (err) {
      console.error("[upload-tracks] charts list failed:", err);
      return [];
    }
  };

  const [metaResult, rowsResult, chartPositionsRaw, candidatesRaw, charts] = await Promise.all([
    pw
      .from("track_watch_playlists")
      .select(
        "spotify_playlist_id,slug,display_name,owner_display_name,image_url,track_count,latest_checked_at,last_check_status,last_check_message",
      )
      .eq("slug", UPLOAD_SLUG)
      .maybeSingle(),
    pw.rpc("track_watch_rows", { p_slug: UPLOAD_SLUG }),
    chartRpc("track_watch_chart_positions"),
    chartRpc("track_watch_chart_candidates"),
    chartsList(),
  ]);
  if (metaResult.error) throw new Error(metaResult.error.message);
  if (rowsResult.error) throw new Error(rowsResult.error.message);

  const m = metaResult.data as {
    spotify_playlist_id: string;
    display_name: string | null;
    owner_display_name: string | null;
    image_url: string | null;
    track_count: number | string | null;
    latest_checked_at: string | null;
    last_check_status: string | null;
    last_check_message: string | null;
  } | null;

  const rows = normalizeRows(rowsResult.data);
  let latestSnapshotDate: string | null = null;
  for (const r of rows) {
    if (r.latestDate && (latestSnapshotDate === null || r.latestDate > latestSnapshotDate)) latestSnapshotDate = r.latestDate;
  }

  return {
    playlist: m
      ? {
          spotifyPlaylistId: m.spotify_playlist_id,
          displayName: m.display_name ?? "Upload tracks",
          ownerDisplayName: m.owner_display_name,
          imageUrl: m.image_url,
          trackCount: m.track_count === null ? null : Number(m.track_count),
          latestCheckedAt: m.latest_checked_at,
          lastCheckStatus: m.last_check_status,
          lastCheckMessage: m.last_check_message,
        }
      : null,
    rows,
    latestSnapshotDate,
    chartPositions: normalizeChartPositions(chartPositionsRaw),
    candidates: normalizeCandidates(candidatesRaw),
    charts,
  };
}
