// Row types + pure helpers for the server-rendered catalog page (`page.tsx`).

/** Extra days to load before the chart range so MA7 matches home (window uses days before the first visible day). */
export const MA7_LOOKBACK_DAYS = 7;

export type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_artist_ids: string[] | null;
  spotify_artist_names: string[] | null;
  spotify_album_image_url: string | null;
  spotify_not_found_since?: string | null;
  release_date?: string | null;
};

export type TrackOverrideRow = {
  date: string;
  note: string | null;
};

export type TrackOverrideRowWithIsrc = {
  date: string;
  isrc: string;
  note: string | null;
};

export type ManualOverrideAnnotation = {
  date: string;
  note: string;
  title?: string;
  imageUrl?: string | null;
};

export type PlaylistDailyStatsRow = { date: string };
export type CatalogArtistSeriesRow = { date: string; streams_cumulative: number | null };
export type CatalogTopTrackRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  total: number | null;
  daily: number | null;
};
export type PlaylistMembershipRow = {
  playlist_key: string;
  valid_from: string;
  valid_to: string | null;
};

export type PlaylistMetaRow = {
  playlist_key: string;
  display_name: string | null;
  is_catalog: boolean | null;
  playlist_type: string | null;
  display_order: number | null;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
};

export type CatalogSearchParams = {
  artist_id?: string;
  isrc?: string;
  range?: string;
  view?: string;
  start?: string;
  end?: string;
};

export function sumLastNDays(desc: Array<{ date: string; daily: number | null }>, days: number) {
  return desc.slice(0, days).reduce((acc, r) => acc + Number(r.daily ?? 0), 0);
}

/** Own-catalog Catalog "All history" (stream history is loaded back to 2023-07; archived months are served from the cold copy). */
export const CATALOG_ALL_HISTORY_DAYS = 1300;

/** Artist All-history ranges load this many recent days first; older history streams in afterwards. */
export const ARTIST_RECENT_FIRST_DAYS = 365;

export function clampRangeDays(x: unknown) {
  const n = Number(x ?? "30") || 30;
  return Math.max(7, Math.min(CATALOG_ALL_HISTORY_DAYS, n));
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function deriveArtists(rows: TrackRow[]) {
  const byId = new Map<string, string>();
  for (const t of rows) {
    const ids = t.spotify_artist_ids ?? [];
    const names = t.spotify_artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      const id = ids[i];
      const name = names[i];
      if (!id || !name) continue;
      if (!byId.has(id)) byId.set(id, name);
    }
  }
  return Array.from(byId.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function artistNameFor(rows: TrackRow[], artistId: string) {
  for (const t of rows) {
    const ids = t.spotify_artist_ids ?? [];
    const names = t.spotify_artist_names ?? [];
    for (let i = 0; i < Math.min(ids.length, names.length); i++) {
      if (ids[i] === artistId) return names[i] ?? null;
    }
  }
  return null;
}

export function catalogSelectionHref(
  sp: CatalogSearchParams,
  artistId: string,
  isrc: string,
): string {
  const params = new URLSearchParams();
  params.set("artist_id", artistId);
  params.set("isrc", isrc);
  if (sp.range) params.set("range", String(clampRangeDays(sp.range)));
  if (sp.start) params.set("start", sp.start);
  if (sp.end) params.set("end", sp.end);
  return `/catalog?${params.toString()}`;
}

/**
 * Run date of the last day a track's cumulative Spotify total rose, or null when it still gained on the
 * latest day (or never had streams). For a taken-down track this is the best takedown estimate: the total
 * freezes when the track leaves Spotify, and later SpotOnTrack may report 0.
 */
export function lastStreamGainRunDate(
  series: ReadonlyArray<{ date: string; streams_cumulative: number | null }>,
): string | null {
  const asc = [...series].sort((a, b) => a.date.localeCompare(b.date));
  let peak = 0;
  let peakFirstDate: string | null = null;
  for (const row of asc) {
    const value = Number(row.streams_cumulative ?? 0);
    if (value > peak) {
      peak = value;
      peakFirstDate = row.date;
    }
  }
  const latest = asc[asc.length - 1];
  if (!peakFirstDate || !latest || peakFirstDate === latest.date) return null;
  return peakFirstDate;
}

export type TrackAvailabilityRow = {
  status: string | null;
  unavailable_since: string | null;
  last_available_at: string | null;
};

/** Why and when a track is shown as taken down on its Catalog page. */
export type TrackTakedown =
  /** The daily takedown check saw it playable, then unplayable: `date` is the detection day. */
  | { precision: "detected"; date: string; lastAvailableAt: string | null }
  /** Already gone when first checked: `date` is the last day its stream total rose (data date). */
  | { precision: "estimated"; date: string; confirmedMissingSince: string | null }
  /** Gone, but no usable stream history: `date` is the first day it was confirmed missing. */
  | { precision: "at_least"; date: string };

/** True when the takedown date has to be estimated from stream history. */
export function takedownNeedsStreamEstimate(availability: TrackAvailabilityRow | null, spotifyNotFoundSince: string | null): boolean {
  if (availability?.status === "unavailable") return !availability.last_available_at;
  if (availability?.status === "available") return false;
  return !!spotifyNotFoundSince;
}

/**
 * The daily availability check wins (it plays-tests the track); Spotify search misses only count when the
 * check has no row. A track the check still finds playable is never shown as taken down.
 */
export function resolveTrackTakedown(args: {
  availability: TrackAvailabilityRow | null;
  spotifyNotFoundSince: string | null;
  lastStreamGainDate: string | null;
}): TrackTakedown | null {
  const { availability, spotifyNotFoundSince, lastStreamGainDate } = args;
  if (availability?.status === "available") return null;
  let confirmedMissingSince: string | null = null;
  if (availability?.status === "unavailable") {
    if (availability.last_available_at && availability.unavailable_since) {
      return { precision: "detected", date: availability.unavailable_since, lastAvailableAt: availability.last_available_at };
    }
    confirmedMissingSince = availability.unavailable_since;
  } else if (spotifyNotFoundSince) {
    confirmedMissingSince = spotifyNotFoundSince;
  } else {
    return null;
  }
  if (lastStreamGainDate) return { precision: "estimated", date: lastStreamGainDate, confirmedMissingSince };
  return confirmedMissingSince ? { precision: "at_least", date: confirmedMissingSince } : null;
}
