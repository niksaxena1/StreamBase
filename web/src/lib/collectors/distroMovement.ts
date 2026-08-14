/**
 * Own-catalog distro movement: which tracks moved between distributor
 * playlists (re-distributions), were taken down, or were newly distributed.
 *
 * Mirrors the competitor movement loader but groups by distro playlist instead
 * of label, and pairs removals with additions over a wider window because a
 * takedown → re-upload cycle through another distributor can take days.
 *
 * Only `playlist_type = 'Distro'` playlists participate: churn in
 * releases/ext reflects release cycles, not distribution.
 */

import {
  buildRosterMovement,
  type MembershipEvent,
  type MovementTrackMeta,
} from "@/app/(main-flat)/competitors/competitorWorkspaceAnalytics";
import { CACHE_TTL_1H } from "@/lib/constants";
import type { RosterFlow, RosterMovement } from "@/lib/rosterFlow";
import { addDaysISO } from "@/lib/sotDates";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseService } from "@/lib/supabase/service";
import { mergeMembershipIntervals } from "@/lib/competitors/workspaceInsights";

export const DISTRO_MOVEMENT_WINDOWS = [30, 90, 365] as const;
export type DistroMovementWindow = (typeof DISTRO_MOVEMENT_WINDOWS)[number];

/** Re-distributions can straddle takedown/processing gaps; pair generously. */
const DISTRO_PAIR_WINDOW_DAYS = 14;

export type DistroMovementInsights = {
  window_start: string;
  window_end: string;
  flows: RosterFlow[];
  movements: RosterMovement[];
  /** Distro playlists first tracked inside the window (initial imports). */
  import_targets: string[];
  /** Display name → collector (TG/GB/P/...) for node coloring. */
  collector_by_playlist: Record<string, string>;
};

type MembershipRow = {
  isrc: string;
  playlist_key: string;
  valid_from: string;
  valid_to: string | null;
};

type Svc = ReturnType<typeof supabaseService>;

async function loadDistroMembershipPages(args: {
  svc: Svc;
  playlistKeys: string[];
  field?: "valid_from" | "valid_to";
  start?: string;
  end?: string;
  isrcs?: string[];
}): Promise<{ data: MembershipRow[] | null; error: { message: string } | null }> {
  const rows: MembershipRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = args.svc
      .from("playlist_memberships")
      .select("isrc,playlist_key,valid_from,valid_to")
      .in("playlist_key", args.playlistKeys)
      .order("isrc", { ascending: true })
      .order("valid_from", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.field && args.start && args.end) {
      query = query.gte(args.field, args.start).lte(args.field, args.end);
    }
    if (args.isrcs?.length) query = query.in("isrc", args.isrcs);
    const page = await query;
    if (page.error) return { data: null, error: page.error };
    const batch = (page.data ?? []) as MembershipRow[];
    rows.push(...batch);
    if (batch.length < pageSize) return { data: rows, error: null };
  }
}

async function computeDistroMovement(args: {
  runDate: string;
  windowDays: DistroMovementWindow;
}): Promise<{ data: DistroMovementInsights | null; error: { message: string } | null }> {
  const svc = supabaseService();
  const windowStart = addDaysISO(args.runDate, -(args.windowDays - 1));

  const { data: playlistsRaw, error: playlistsError } = await svc
    .from("playlists")
    .select("playlist_key,display_name,collector,playlist_type")
    .eq("playlist_type", "Distro");
  if (playlistsError) return { data: null, error: playlistsError };
  const playlists = (playlistsRaw ?? []).map((row) => ({
    playlist_key: row.playlist_key,
    display_name: (row.display_name ?? row.playlist_key).trim(),
    collector: (row.collector ?? "").trim(),
  }));
  if (!playlists.length) {
    return {
      data: {
        window_start: windowStart,
        window_end: args.runDate,
        flows: [],
        movements: [],
        import_targets: [],
        collector_by_playlist: {},
      },
      error: null,
    };
  }
  const playlistKeys = playlists.map((playlist) => playlist.playlist_key);
  const displayNames = new Map(playlists.map((playlist) => [playlist.playlist_key, playlist.display_name]));
  const collectorByPlaylist = Object.fromEntries(
    playlists.map((playlist) => [playlist.display_name, playlist.collector]),
  );

  const [additionCandidates, removalCandidates] = await Promise.all([
    loadDistroMembershipPages({ svc, playlistKeys, field: "valid_from", start: windowStart, end: args.runDate }),
    loadDistroMembershipPages({ svc, playlistKeys, field: "valid_to", start: windowStart, end: args.runDate }),
  ]);
  if (additionCandidates.error) return { data: null, error: additionCandidates.error };
  if (removalCandidates.error) return { data: null, error: removalCandidates.error };

  const eventIsrcs = [
    ...new Set([...(additionCandidates.data ?? []), ...(removalCandidates.data ?? [])].map((row) => row.isrc)),
  ];
  if (!eventIsrcs.length) {
    return {
      data: {
        window_start: windowStart,
        window_end: args.runDate,
        flows: [],
        movements: [],
        import_targets: [],
        collector_by_playlist: collectorByPlaylist,
      },
      error: null,
    };
  }

  // Full membership history for the affected tracks so re-listings on the same
  // distro merge into one interval instead of counting as churn.
  const allMemberships: MembershipRow[] = [];
  for (let index = 0; index < eventIsrcs.length; index += 150) {
    const result = await loadDistroMembershipPages({
      svc,
      playlistKeys,
      isrcs: eventIsrcs.slice(index, index + 150),
    });
    if (result.error) return { data: null, error: result.error };
    allMemberships.push(...(result.data ?? []));
  }

  // Group by the distro playlist itself (identity mapping).
  const identity = new Map(playlistKeys.map((key) => [key, key]));
  const intervalsByIsrc = mergeMembershipIntervals(allMemberships, identity);

  const additions: MembershipEvent[] = [];
  const removals: MembershipEvent[] = [];
  for (const [isrc, intervals] of intervalsByIsrc) {
    for (const interval of intervals) {
      const displayName = displayNames.get(interval.labelKey) ?? interval.labelKey;
      if (interval.start >= windowStart && interval.start <= args.runDate) {
        additions.push({ isrc, label_key: interval.labelKey, display_name: displayName, event_date: interval.start });
      }
      if (interval.end) {
        const exitDate = addDaysISO(interval.end, 1);
        if (exitDate >= windowStart && exitDate <= args.runDate) {
          removals.push({ isrc, label_key: interval.labelKey, display_name: displayName, event_date: exitDate });
        }
      }
    }
  }

  const trackMeta = new Map<string, MovementTrackMeta>();
  for (let index = 0; index < eventIsrcs.length; index += 200) {
    const { data, error } = await svc
      .from("tracks")
      .select("isrc,name,spotify_artist_names,spotify_album_image_url")
      .in("isrc", eventIsrcs.slice(index, index + 200));
    if (error) return { data: null, error };
    for (const row of data ?? []) {
      trackMeta.set(row.isrc, {
        isrc: row.isrc,
        name: row.name ?? row.isrc,
        artist_names: row.spotify_artist_names,
        album_image_url: row.spotify_album_image_url,
      });
    }
  }

  // A distro playlist whose earliest membership starts inside the window was
  // just onboarded — its inflow is an initial import, not movement.
  const earliestByPlaylist = new Map<string, string>();
  for (const row of allMemberships) {
    const start = row.valid_from.slice(0, 10);
    const current = earliestByPlaylist.get(row.playlist_key);
    if (!current || start < current) earliestByPlaylist.set(row.playlist_key, start);
  }
  const importTargets = playlists
    .filter((playlist) => {
      const earliest = earliestByPlaylist.get(playlist.playlist_key);
      return earliest != null && earliest >= windowStart;
    })
    .map((playlist) => playlist.display_name);

  const built = buildRosterMovement(additions, removals, trackMeta, DISTRO_PAIR_WINDOW_DAYS);
  return {
    data: {
      window_start: windowStart,
      window_end: args.runDate,
      flows: built.flows,
      movements: built.movements.slice(0, 250),
      import_targets: importTargets,
      collector_by_playlist: collectorByPlaylist,
    },
    error: null,
  };
}

/** Latest successful own-catalog run date (cache key + window anchor). */
export async function latestOwnRunDate(): Promise<string | null> {
  const svc = supabaseService();
  const { data } = await svc
    .from("ingestion_runs")
    .select("run_date")
    .eq("status", "success")
    .order("run_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const runDate = String(data?.run_date ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(runDate) ? runDate : null;
}

export async function loadDistroMovementCached(args: {
  runDate: string;
  windowDays: DistroMovementWindow;
}) {
  return cachedQuery<DistroMovementInsights>(
    () => computeDistroMovement(args),
    `distro-movement-v1-${args.windowDays}-${args.runDate}`,
    CACHE_TTL_1H,
  );
}
