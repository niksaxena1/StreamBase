import type { FollowerHistoryPoint } from "@/lib/playlistWatch/history";

import type { PlaylistWatchRow } from "./playlistWatchClientModel";

/** A shared, named group of watched playlists (e.g. one ad account). */
export type PlaylistWatchCollection = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  playlistIds: string[];
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

export function buildCompareRows(
  rows: readonly PlaylistWatchRow[],
  collections: readonly PlaylistWatchCollection[],
): CollectionCompareRow[] {
  return sortCollections(collections).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    ...computeTotals(rowsForSelection(rows, collections, c.id)),
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
