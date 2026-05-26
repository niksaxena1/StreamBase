import type { SupabaseClient } from "@supabase/supabase-js";

import { isAllCompetitorsKey } from "@/lib/competitorContext";
import { chunk } from "@/lib/competitorLabelScope";

type CompetitorDb = Pick<SupabaseClient, "from">;

export type CompetitorLabelScope = {
  /** When null, no ISRC filtering (all competitors). */
  scopedIsrcs: Set<string> | null;
  /** When null, any playlist key is allowed. */
  playlistKeys: Set<string> | null;
};

const MEMBERSHIP_ISRC_CHUNK = 500;

/**
 * Active competitor playlist ISRCs for a single label at a run date.
 * Returns unscoped sets when viewing all competitors.
 */
export async function loadCompetitorLabelScope(
  client: CompetitorDb,
  args: { labelKey: string | null; latestRunDate: string | null },
): Promise<CompetitorLabelScope> {
  const labelKey = args.labelKey?.trim() ?? "";
  if (!labelKey || isAllCompetitorsKey(labelKey)) {
    return { scopedIsrcs: null, playlistKeys: null };
  }

  const { data: playlistRows } = await client
    .from("playlists")
    .select("playlist_key")
    .eq("is_active", true)
    .eq("label_key", labelKey);

  const playlistKeys = new Set(
    (playlistRows ?? []).map((r: { playlist_key: string }) => r.playlist_key).filter(Boolean),
  );
  if (!playlistKeys.size || !args.latestRunDate) {
    return { scopedIsrcs: new Set(), playlistKeys };
  }

  const { data: memberships } = await client
    .from("playlist_memberships")
    .select("isrc")
    .in("playlist_key", [...playlistKeys])
    .lte("valid_from", args.latestRunDate)
    .or(`valid_to.is.null,valid_to.gte.${args.latestRunDate}`);

  const scopedIsrcs = new Set(
    ((memberships ?? []) as Array<{ isrc: string }>).map((r) => r.isrc).filter(Boolean),
  );
  return { scopedIsrcs, playlistKeys };
}

export async function sumCompetitorStreamsForIsrcs(
  client: CompetitorDb,
  args: { isrcs: string[]; latestRunDate: string },
): Promise<number> {
  const unique = [...new Set(args.isrcs.filter(Boolean))];
  if (!unique.length) return 0;

  let total = 0;
  for (const part of chunk(unique, MEMBERSHIP_ISRC_CHUNK)) {
    const { data: streamRows } = await client
      .from("track_daily_streams")
      .select("streams_cumulative")
      .eq("date", args.latestRunDate)
      .in("isrc", part);
    total += (streamRows ?? []).reduce(
      (sum: number, row: { streams_cumulative?: number | null }) =>
        sum + Number(row.streams_cumulative ?? 0),
      0,
    );
  }
  return total;
}

export async function loadCompetitorTracksForArtist(
  client: CompetitorDb,
  artistId: string,
  scopedIsrcs: Set<string> | null,
): Promise<Array<{ isrc: string; spotify_artist_ids: string[] | null }>> {
  const id = artistId.trim();
  if (!id) return [];

  if (scopedIsrcs && scopedIsrcs.size === 0) return [];

  if (scopedIsrcs) {
    const isrcList = [...scopedIsrcs];
    const rows: Array<{ isrc: string; spotify_artist_ids: string[] | null }> = [];
    for (const part of chunk(isrcList, MEMBERSHIP_ISRC_CHUNK)) {
      const { data } = await client
        .from("tracks")
        .select("isrc,spotify_artist_ids")
        .in("isrc", part)
        .contains("spotify_artist_ids", [id]);
      rows.push(
        ...((data ?? []) as Array<{ isrc: string; spotify_artist_ids: string[] | null }>),
      );
    }
    return rows;
  }

  const { data: trackRows } = await client
    .from("tracks")
    .select("isrc,spotify_artist_ids")
    .contains("spotify_artist_ids", [id])
    .limit(5000);
  return (trackRows ?? []) as Array<{ isrc: string; spotify_artist_ids: string[] | null }>;
}
