import type { FollowerHistoryPoint } from "@/lib/playlistWatch/history";

import { parseSpotifyPlaylistId } from "@/lib/playlistWatch/spotifyPlaylistId";

import type { PlaylistWatchRow } from "./playlistWatchClientModel";

/** Ad status of a playlist inside one collection: an ad promotes it now, or its ads ended. */
export type AdStatus = "live" | "stopped";
/** Status switch value, kept in the URL as `?status=`. */
export type StatusFilter = "all" | AdStatus;

export type CollectionMember = {
  playlistId: string;
  adStatus: AdStatus | null;
  adStatusChangedAt: string | null;
};

/** A shared, named group of watched playlists (e.g. one ad account). */
export type PlaylistWatchCollection = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  /** Same playlists as `members`, kept for compatibility. */
  playlistIds: string[];
  members: CollectionMember[];
};

/** `all`, `unassigned`, or a collection id. */
export type CollectionSelection = string;
export const COLLECTION_ALL = "all";
export const COLLECTION_UNASSIGNED = "unassigned";

export const COLLECTION_COLOR_PRESETS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

export const COLLECTION_NAME_MAX = 60;
export const COLLECTION_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type CollectionTotals = {
  playlistCount: number;
  /** Sum of latest follower counts; null when no member has a count. */
  followers: number | null;
  /** Latest snapshot date vs the previous date, over members that have both. */
  today: number | null;
  /** Sum of members' 7d / 30d deltas (members without enough history are skipped). */
  delta7d: number | null;
  delta30d: number | null;
};

export type CombinedPoint = {
  date: string;
  total: number;
  /** Like-for-like change vs the previous included date; null on the first point. */
  gain: number | null;
  playlistCount: number;
};

export type CollectionCompareRow = CollectionTotals & {
  id: string;
  name: string;
  color: string | null;
};

export function normalizeSelection(
  value: string | null | undefined,
  collections: readonly PlaylistWatchCollection[],
): CollectionSelection {
  if (!value || value === COLLECTION_ALL) return COLLECTION_ALL;
  if (value === COLLECTION_UNASSIGNED) return COLLECTION_UNASSIGNED;
  return collections.some((c) => c.id === value) ? value : COLLECTION_ALL;
}

export function normalizeStatusFilter(value: string | null | undefined): StatusFilter {
  return value === "live" || value === "stopped" ? value : "all";
}

export function isAdStatus(value: unknown): value is AdStatus {
  return value === "live" || value === "stopped";
}

export function sortCollections<T extends { sortOrder: number; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Playlist ids that belong to no collection (considering only the given rows). */
export function unassignedPlaylistIds(
  rows: readonly Pick<PlaylistWatchRow, "spotifyPlaylistId">[],
  collections: readonly PlaylistWatchCollection[],
): Set<string> {
  const assigned = new Set<string>();
  for (const c of collections) for (const id of c.playlistIds) assigned.add(id);
  return new Set(rows.map((r) => r.spotifyPlaylistId).filter((id) => !assigned.has(id)));
}

/** Collections with at least one non-archived member, in display order (empty ones are hidden). */
export function visibleCollections(
  rows: readonly Pick<PlaylistWatchRow, "spotifyPlaylistId" | "watchStatus">[],
  collections: readonly PlaylistWatchCollection[],
): PlaylistWatchCollection[] {
  const liveIds = new Set(rows.filter((r) => r.watchStatus !== "archived").map((r) => r.spotifyPlaylistId));
  return sortCollections(collections).filter((c) => c.playlistIds.some((id) => liveIds.has(id)));
}

/**
 * Normalises a chip choice for display: unknown ids, hidden (empty) collections and an
 * Unassigned chip with nothing unassigned all fall back to All.
 */
export function resolveSelection(
  value: string | null | undefined,
  rows: readonly PlaylistWatchRow[],
  collections: readonly PlaylistWatchCollection[],
): CollectionSelection {
  const normalized = normalizeSelection(value, collections);
  if (normalized === COLLECTION_ALL) return normalized;
  const live = rows.filter((r) => r.watchStatus !== "archived");
  if (normalized === COLLECTION_UNASSIGNED) {
    return collections.length === 0 || unassignedPlaylistIds(live, collections).size === 0 ? COLLECTION_ALL : normalized;
  }
  return visibleCollections(live, collections).some((c) => c.id === normalized) ? normalized : COLLECTION_ALL;
}

export type ScopedStatus = { status: AdStatus; changedAt: string | null };

/**
 * Ad status of each playlist within a chip. Inside a collection it is that membership's status.
 * Under All: live if live in any collection, else stopped if stopped in any (changedAt = the
 * latest "stopped since" among those memberships, i.e. when the last ads ended), else none.
 * Unassigned has no statuses. Playlists without a status are absent from the map.
 */
export function statusMapForSelection(
  collections: readonly PlaylistWatchCollection[],
  selection: CollectionSelection,
): Map<string, ScopedStatus> {
  const out = new Map<string, ScopedStatus>();
  if (selection === COLLECTION_UNASSIGNED) return out;
  const scope = selection === COLLECTION_ALL ? collections : collections.filter((c) => c.id === selection);
  for (const c of scope) {
    for (const m of c.members) {
      if (!m.adStatus) continue;
      const prev = out.get(m.playlistId);
      if (!prev) {
        out.set(m.playlistId, { status: m.adStatus, changedAt: m.adStatusChangedAt });
      } else if (prev.status === m.adStatus) {
        if (m.adStatusChangedAt && (!prev.changedAt || m.adStatusChangedAt > prev.changedAt)) {
          out.set(m.playlistId, { status: prev.status, changedAt: m.adStatusChangedAt });
        }
      } else if (m.adStatus === "live") {
        out.set(m.playlistId, { status: "live", changedAt: m.adStatusChangedAt });
      }
    }
  }
  return out;
}

/** The status switch only applies to All and collection chips. */
export function effectiveStatusFilter(status: StatusFilter, selection: CollectionSelection): StatusFilter {
  return selection === COLLECTION_UNASSIGNED ? "all" : status;
}

/** Keeps rows whose scoped status matches; "all" keeps everything (also rows with no status). */
export function filterRowsByStatus<T extends Pick<PlaylistWatchRow, "spotifyPlaylistId">>(
  rows: readonly T[],
  collections: readonly PlaylistWatchCollection[],
  selection: CollectionSelection,
  status: StatusFilter,
): T[] {
  const effective = effectiveStatusFilter(status, selection);
  if (effective === "all") return [...rows];
  const map = statusMapForSelection(collections, selection);
  return rows.filter((r) => map.get(r.spotifyPlaylistId)?.status === effective);
}

/** Rows for a chip + status switch (archived playlists excluded). */
export function rowsForView(
  rows: readonly PlaylistWatchRow[],
  collections: readonly PlaylistWatchCollection[],
  selection: CollectionSelection,
  status: StatusFilter,
): PlaylistWatchRow[] {
  return filterRowsByStatus(rowsForSelection(rows, collections, selection), collections, selection, status);
}

export type StatusCounts = { all: number; live: number; stopped: number };

/** Segment counts for the status switch within a chip. */
export function statusCounts(
  rows: readonly PlaylistWatchRow[],
  collections: readonly PlaylistWatchCollection[],
  selection: CollectionSelection,
): StatusCounts {
  const scoped = rowsForSelection(rows, collections, selection);
  const map = statusMapForSelection(collections, selection);
  let live = 0;
  let stopped = 0;
  for (const r of scoped) {
    const status = map.get(r.spotifyPlaylistId)?.status;
    if (status === "live") live += 1;
    else if (status === "stopped") stopped += 1;
  }
  return { all: scoped.length, live, stopped };
}

/** Percent growth of a delta over its starting base (followers - delta); null when undefined. */
export function growthPercent(followers: number | null, delta: number | null): number | null {
  if (followers === null || delta === null || !Number.isFinite(followers) || !Number.isFinite(delta)) return null;
  const base = followers - delta;
  if (base <= 0) return null;
  return (delta / base) * 100;
}

export function formatGrowthPercent(percent: number | null): string | null {
  if (percent === null) return null;
  const text = percent.toFixed(1);
  return `${percent > 0 && text !== "0.0" ? "+" : ""}${text}%`;
}

export type GrowingWithoutAds = { count: number; gain7d: number };

/** Of the given (stopped) rows: how many gained followers over 7 days, and the summed gain. */
export function growingWithoutAds(stoppedRows: readonly Pick<PlaylistWatchRow, "delta7d">[]): GrowingWithoutAds {
  let count = 0;
  let gain7d = 0;
  for (const r of stoppedRows) {
    if (r.delta7d !== null && r.delta7d > 0) {
      count += 1;
      gain7d += r.delta7d;
    }
  }
  return { count, gain7d };
}

export type StatusUpdate = { playlistId: string; adStatus: AdStatus | null };

export const MAX_STATUS_UPDATES = 500;

/**
 * Validates the PUT body `status: [{ playlist, ad_status }]`. Duplicate playlists collapse to the
 * last entry. Returns null for any malformed input.
 */
export function parseStatusUpdates(value: unknown): StatusUpdate[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_STATUS_UPDATES) return null;
  const byPlaylist = new Map<string, AdStatus | null>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.playlist !== "string") return null;
    const id = parseSpotifyPlaylistId(entry.playlist);
    if (!id) return null;
    if (!("ad_status" in entry)) return null;
    const status = entry.ad_status;
    if (status !== null && !isAdStatus(status)) return null;
    byPlaylist.set(id, status);
  }
  return Array.from(byPlaylist, ([playlistId, adStatus]) => ({ playlistId, adStatus }));
}

/** Ids a chip selects, or null for "no restriction" (All / unknown collection). */
export function selectionIdSet(
  rows: readonly Pick<PlaylistWatchRow, "spotifyPlaylistId">[],
  collections: readonly PlaylistWatchCollection[],
  selection: CollectionSelection,
): Set<string> | null {
  if (selection === COLLECTION_ALL) return null;
  if (selection === COLLECTION_UNASSIGNED) return unassignedPlaylistIds(rows, collections);
  const collection = collections.find((c) => c.id === selection);
  return collection ? new Set(collection.playlistIds) : null;
}

/** Rows for a chip. Archived playlists are never counted in collection analytics. */
export function rowsForSelection(
  rows: readonly PlaylistWatchRow[],
  collections: readonly PlaylistWatchCollection[],
  selection: CollectionSelection,
): PlaylistWatchRow[] {
  const live = rows.filter((r) => r.watchStatus !== "archived");
  const ids = selectionIdSet(live, collections, selection);
  return ids ? live.filter((r) => ids.has(r.spotifyPlaylistId)) : live;
}

function sumOrNull(values: Array<number | null>): number | null {
  let seen = false;
  let sum = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    seen = true;
    sum += v;
  }
  return seen ? sum : null;
}

/** Latest-vs-previous snapshot gain for one playlist history (null if < 2 points). */
function gainBetween(history: readonly FollowerHistoryPoint[], latest: string, previous: string): number | null {
  let a: number | null = null;
  let b: number | null = null;
  for (const p of history) {
    if (p.date === latest) a = p.followers;
    else if (p.date === previous) b = p.followers;
  }
  return a === null || b === null ? null : a - b;
}

export function computeTotals(rows: readonly PlaylistWatchRow[]): CollectionTotals {
  // "Today" = the newest snapshot date across members vs the newest date before it.
  // Only playlists that have a snapshot on both dates contribute.
  let latest: string | null = null;
  for (const r of rows) for (const p of r.history) if (latest === null || p.date > latest) latest = p.date;
  let previous: string | null = null;
  if (latest) {
    for (const r of rows) for (const p of r.history) if (p.date < latest && (previous === null || p.date > previous)) previous = p.date;
  }
  const today =
    latest && previous
      ? sumOrNull(rows.map((r) => gainBetween(r.history, latest!, previous!)))
      : null;
  return {
    playlistCount: rows.length,
    followers: sumOrNull(rows.map((r) => r.latestFollowerCount)),
    today,
    delta7d: sumOrNull(rows.map((r) => r.delta7d)),
    delta30d: sumOrNull(rows.map((r) => r.delta30d)),
  };
}

/**
 * Combined follower series for a set of playlists.
 *
 * Gap handling (documented choice): a date is included only when EVERY member playlist that
 * already existed by then (its first snapshot date <= date) has a snapshot on that date. Days
 * where any live member is missing a snapshot are dropped, so the total never dips because of a
 * failed daily check. A playlist watched from mid-range simply joins the sum from its first day
 * (the total steps up), but `gain` is like-for-like: it only sums playlists present on both the
 * date and the previous included date, so a newly added playlist does not read as growth.
 */
export function buildCombinedSeries(rows: readonly PlaylistWatchRow[]): CombinedPoint[] {
  const byPlaylist = rows
    .map((r) => {
      const map = new Map<string, number>();
      for (const p of r.history) map.set(p.date, p.followers);
      const first = r.history.reduce<string | null>((min, p) => (min === null || p.date < min ? p.date : min), null);
      return { map, first };
    })
    .filter((p) => p.first !== null);
  const dates = Array.from(new Set(byPlaylist.flatMap((p) => Array.from(p.map.keys())))).sort();

  const out: CombinedPoint[] = [];
  let prevDate: string | null = null;
  for (const date of dates) {
    const existing = byPlaylist.filter((p) => p.first! <= date);
    if (existing.length === 0 || existing.some((p) => !p.map.has(date))) continue;
    let total = 0;
    let gain: number | null = null;
    for (const p of existing) {
      const v = p.map.get(date)!;
      total += v;
      if (prevDate !== null) {
        const before = p.map.get(prevDate);
        if (before !== undefined) gain = (gain ?? 0) + (v - before);
      }
    }
    out.push({ date, total, gain: prevDate === null ? null : gain, playlistCount: existing.length });
    prevDate = date;
  }
  return out;
}

/** Adapter so the existing PlaylistFollowerChart can render a combined series. */
export function combinedToHistory(points: readonly CombinedPoint[]): FollowerHistoryPoint[] {
  return points.map((p) => ({ date: p.date, followers: p.total, dailyDelta: p.gain }));
}

/** One row per given collection; `status` filters each collection's own members. */
export function buildCompareRows(
  rows: readonly PlaylistWatchRow[],
  collections: readonly PlaylistWatchCollection[],
  status: StatusFilter = "all",
): CollectionCompareRow[] {
  return sortCollections(collections).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    ...computeTotals(rowsForView(rows, collections, c.id, status)),
  }));
}

/** Count of live playlists per chip, for chip labels. */
export function countForSelection(
  rows: readonly PlaylistWatchRow[],
  collections: readonly PlaylistWatchCollection[],
  selection: CollectionSelection,
): number {
  return rowsForSelection(rows, collections, selection).length;
}

export function validateCollectionName(value: unknown): { ok: true; name: string } | { ok: false; error: string } {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { ok: false, error: "Collection name is required." };
  if (name.length > COLLECTION_NAME_MAX) return { ok: false, error: `Collection name must be ${COLLECTION_NAME_MAX} characters or fewer.` };
  return { ok: true, name };
}
