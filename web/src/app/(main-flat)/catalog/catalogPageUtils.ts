// Row types + pure helpers for the server-rendered catalog page (`page.tsx`).

/** Extra days to load before the chart range so MA7 matches home (window uses days before the first visible day). */
export const MA7_LOOKBACK_DAYS = 6;

export type TrackRow = {
  isrc: string;
  name: string | null;
  spotify_artist_ids: string[] | null;
  spotify_artist_names: string[] | null;
  spotify_album_image_url: string | null;
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

export function clampRangeDays(x: unknown) {
  const n = Number(x ?? "30") || 30;
  return Math.max(7, Math.min(365, n));
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
