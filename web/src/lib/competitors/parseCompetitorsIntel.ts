import type { ChurnRow, MoverTrackRow } from "@/app/(main-flat)/competitors/competitorsTypes";

export function parseMovers(raw: unknown): MoverTrackRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      isrc: String(r.isrc ?? ""),
      name: String(r.name ?? r.isrc ?? ""),
      album_image_url: (r.album_image_url as string | null) ?? null,
      artist_names: Array.isArray(r.artist_names) ? (r.artist_names as string[]) : null,
      artist_ids: Array.isArray(r.artist_ids) ? (r.artist_ids as string[]) : null,
      label_keys: Array.isArray(r.label_keys) ? (r.label_keys as string[]) : [],
      daily_delta: Number(r.daily_delta ?? 0),
      total: Number(r.total ?? 0),
    };
  });
}

export function parseChurnRows(raw: unknown): Array<{
  label_key: string;
  added_count: number;
  removed_count: number;
  net: number;
}> {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      label_key: String(r.label_key ?? ""),
      added_count: Number(r.added_count ?? 0),
      removed_count: Number(r.removed_count ?? 0),
      net: Number(r.net ?? 0),
    };
  });
}

export type CompetitorsIntelPayload = {
  gainers: MoverTrackRow[];
  losers: MoverTrackRow[];
  churn: ChurnRow[];
  overlapCells: Array<{
    label_a: string;
    label_b: string;
    shared_isrcs: number;
    label_a_total: number;
    label_b_total: number;
    jaccard: number;
  }>;
  overlapArtistCells: Array<{
    label_a: string;
    label_b: string;
    shared_artists: number;
    label_a_total: number;
    label_b_total: number;
    jaccard: number;
  }>;
};
