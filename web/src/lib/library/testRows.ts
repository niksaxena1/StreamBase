import type { LibraryRow } from "./types";

/** Test helper: a fully-populated overview row with sensible blanks. */
export function makeRow(overrides: Partial<LibraryRow> = {}): LibraryRow {
  return {
    catalog_id: "TG-00001",
    entity: "tg",
    release_date: "2026-03-01",
    sheet_artist: "Kyden",
    sheet_title: "Fast",
    title: null,
    artists: null,
    distributor_account: null,
    status: null,
    isrc: null,
    upc: null,
    master_duration_s: null,
    has_m_master: false,
    non_exclusive_samples: false,
    dropbox_link: null,
    source_folder: null,
    label_genre: null,
    originality: null,
    exclusivity: null,
    comment_1: null,
    comment_2: null,
    cover_original_artist: null,
    new_distro: null,
    genre: null,
    file_count: 0,
    updated_at: null,
    ...overrides,
  };
}
