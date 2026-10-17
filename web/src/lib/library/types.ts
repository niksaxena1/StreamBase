import type { LibraryLicense, LibraryLicenseDetail } from "./licensing";

/** One row of `catalog.track_overview` (numerics normalised by the loader). */
export type LibraryRow = {
  catalog_id: string;
  entity: string | null;
  release_date: string | null;
  sheet_artist: string | null;
  sheet_title: string | null;
  title: string | null;
  artists: string[] | null;
  distributor_account: string | null;
  status: string | null;
  isrc: string | null;
  upc: string | null;
  master_duration_s: number | null;
  has_m_master: boolean;
  non_exclusive_samples: boolean;
  dropbox_link: string | null;
  source_folder: string | null;
  label_genre: string | null;
  originality: string | null;
  exclusivity: string | null;
  comment_1: string | null;
  comment_2: string | null;
  cover_original_artist: string | null;
  new_distro: string | null;
  genre: string | null;
  file_count: number;
  updated_at: string | null;
  /** True when the drive holds a signed contract for this release. */
  has_signed_contract: boolean;
  licensing: LibraryLicense[];
  /** Streams, merged in on the client from `track_streams()`; absent until then. */
  total_streams?: number | null;
  streams_7d?: number | null;
  album_image_url?: string | null;
  spotify_track_id?: string | null;
};

/** One row of `catalog.track_streams()`. */
export type LibraryStream = {
  catalog_id: string;
  isrc: string | null;
  total_streams: number | null;
  streams_7d: number | null;
  as_of: string | null;
  album_image_url: string | null;
  spotify_track_id: string | null;
};

/** One point of a release's daily cumulative stream series. */
export type LibraryStreamPoint = { date: string; streams_cumulative: number };

export type LibraryEntity = {
  code: string;
  name: string;
  active: boolean;
  catalog_id_prefix: string | null;
};

export type LibraryDistributor = { name: string; owner: string | null };

export type LibraryFile = {
  id: string | number;
  catalog_id: string;
  rel_path: string;
  role: string;
  m_version: number[] | null;
  bytes: number | null;
  duration_s: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  width: number | null;
  height: number | null;
  dropbox_path: string | null;
};

export type LibraryCode = {
  code: string;
  is_primary: boolean;
  source: string | null;
};

export type LibraryHistoryEntry = {
  id: string | number;
  at: string;
  actor: string | null;
  action: string | null;
  target: string | null;
  before: unknown;
  after: unknown;
};

export type LibraryTrackDetail = {
  licensing: LibraryLicenseDetail[];
  files: LibraryFile[];
  isrcs: LibraryCode[];
  upcs: LibraryCode[];
  history: LibraryHistoryEntry[];
};

/** Every column of the overview, in export order. */
export const LIBRARY_COLUMNS = [
  "catalog_id",
  "entity",
  "release_date",
  "sheet_artist",
  "sheet_title",
  "title",
  "artists",
  "distributor_account",
  "status",
  "isrc",
  "upc",
  "master_duration_s",
  "has_m_master",
  "non_exclusive_samples",
  "dropbox_link",
  "source_folder",
  "label_genre",
  "originality",
  "exclusivity",
  "comment_1",
  "comment_2",
  "cover_original_artist",
  "new_distro",
  "genre",
  "file_count",
  "updated_at",
  "has_signed_contract",
  "licensing",
] as const satisfies ReadonlyArray<keyof LibraryRow>;

/** Columns added after the overview: streams, artwork and readable licensing summaries. */
export const LIBRARY_CSV_STREAM_COLUMNS = ["total_streams", "streams_7d", "album_image_url", "Uniqode", "Evenfall"] as const;

export const LIBRARY_ORIGINALITY_OPTIONS = ["Original", "Cover"] as const;
export const LIBRARY_EXCLUSIVITY_OPTIONS = ["Exclusive", "Non-Exclusive"] as const;
