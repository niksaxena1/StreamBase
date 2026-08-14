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

export type DistroPlaylistNode = {
  display_name: string;
  collector: string;
  image_url: string | null;
};

export type DistroMovementInsights = {
  window_start: string;
  window_end: string;
  flows: RosterFlow[];
  movements: RosterMovement[];
  /** Distro playlists first tracked inside the window (initial imports). */
  import_targets: string[];
  /** All distro playlists in the app's canonical order (display_order, name). */
  playlists: DistroPlaylistNode[];
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

  // Canonical app ordering (matches the playlists pages).
  const { data: playlistsRaw, error: playlistsError } = await svc
    .from("playlists")
    .select("playlist_key,display_name,collector,playlist_type,spotify_playlist_image_url")
    .eq("playlist_type", "Distro")
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true });
  if (playlistsError) return { data: null, error: playlistsError };
  const playlists = (playlistsRaw ?? []).map((row) => ({
    playlist_key: row.playlist_key,
    display_name: (row.display_name ?? row.playlist_key).trim(),
    collector: (row.collector ?? "").trim(),
    image_url: row.spotify_playlist_image_url ?? null,
  }));
  const playlistNodes: DistroPlaylistNode[] = playlists.map((playlist) => ({
    display_name: playlist.display_name,
    collector: playlist.collector,
    image_url: playlist.image_url,
  }));
  if (!playlists.length) {
    return {
      data: {
        window_start: windowStart,
        window_end: args.runDate,
        flows: [],
        movements: [],
        import_targets: [],
        playlists: [],
      },
      error: null,
    };
  }
  const playlistKeys = playlists.map((playlist) => playlist.playlist_key);
  const displayNames = new Map(playlists.map((playlist) => [playlist.playlist_key, playlist.display_name]));

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
        playlists: playlistNodes,
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
  const releaseDates = new Map<string, string | null>();
  for (let index = 0; index < eventIsrcs.length; index += 200) {
    const { data, error } = await svc
      .from("tracks")
      .select("isrc,name,spotify_artist_names,spotify_album_image_url,release_date")
      .in("isrc", eventIsrcs.slice(index, index + 200));
    if (error) return { data: null, error };
    for (const row of data ?? []) {
      trackMeta.set(row.isrc, {
        isrc: row.isrc,
        name: row.name ?? row.isrc,
        artist_names: row.spotify_artist_names,
        album_image_url: row.spotify_album_image_url,
      });
      releaseDates.set(row.isrc, row.release_date ?? null);
    }
  }

  // Latest cumulative + day-over-day delta so the flow drill-down can show
  // where each moved track stands today.
  const totalsByIsrc = new Map<string, number>();
  const prevTotalsByIsrc = new Map<string, number>();
  const prevRunDate = addDaysISO(args.runDate, -1);
  for (let index = 0; index < eventIsrcs.length; index += 200) {
    const chunk = eventIsrcs.slice(index, index + 200);
    const [latest, previous] = await Promise.all([
      svc
        .from("track_daily_streams_effective")
        .select("isrc,streams_cumulative")
        .eq("date", args.runDate)
        .in("isrc", chunk),
      svc
        .from("track_daily_streams_effective")
        .select("isrc,streams_cumulative")
        .eq("date", prevRunDate)
        .in("isrc", chunk),
    ]);
    if (latest.error) return { data: null, error: latest.error };
    if (previous.error) return { data: null, error: previous.error };
    for (const row of latest.data ?? []) {
      if (row.isrc != null && row.streams_cumulative != null) totalsByIsrc.set(row.isrc, Number(row.streams_cumulative));
    }
    for (const row of previous.data ?? []) {
      if (row.isrc != null && row.streams_cumulative != null) prevTotalsByIsrc.set(row.isrc, Number(row.streams_cumulative));
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
  const movements = built.movements.slice(0, 250).map((movement) => {
    const total = totalsByIsrc.get(movement.isrc) ?? null;
    const prev = prevTotalsByIsrc.get(movement.isrc) ?? null;
    return {
      ...movement,
      release_date: releaseDates.get(movement.isrc) ?? null,
      total_streams: total,
      daily_streams: total != null && prev != null ? total - prev : null,
    };
  });
  return {
    data: {
      window_start: windowStart,
      window_end: args.runDate,
      flows: built.flows,
      movements,
      import_targets: importTargets,
      playlists: playlistNodes,
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
    `distro-movement-v3-${args.windowDays}-${args.runDate}`,
    CACHE_TTL_1H,
  );
}
