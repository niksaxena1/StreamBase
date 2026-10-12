import { describe, expect, it } from "vitest";

import { MAX_CACHED_OVERVIEW_BYTES, decodeOverview, encodeOverview, encodedOverviewBytes } from "./overviewCodec";
import { makeRow } from "./testRows";
import type { LibraryRow } from "./types";

/** A row with the field lengths a real catalog row tends to have. */
function realisticRow(i: number): LibraryRow {
  const n = String(i).padStart(5, "0");
  return makeRow({
    catalog_id: `TG-${n}`,
    entity: "tg",
    release_date: "2026-10-23",
    sheet_artist: `Artist Name ${n} feat. Someone`,
    sheet_title: `A Reasonably Long Track Title ${n} (Extended Mix)`,
    title: `A Reasonably Long Track Title ${n}`,
    artists: [`Artist Name ${n}`, "Someone Else"],
    distributor_account: "TG1 Amuse",
    status: "released",
    isrc: `USABC26${n}`,
    upc: `0123456${n}`.slice(0, 12),
    master_duration_s: 185.347,
    has_m_master: true,
    non_exclusive_samples: i % 7 === 0,
    dropbox_link: `https://www.dropbox.com/scl/fo/abcdefghijklmnopqrstuvwxyz${n}/AB-cdefGHijKLmnOPqrstUVwx?rlkey=abcdefghijklmnopqrstuvwxy&dl=0`,
    source_folder: `Y:\\Unreleased Ext Drive\\Artist Name ${n} - A Reasonably Long Track Title ${n}`,
    label_genre: "Deep House",
    originality: "Original",
    exclusivity: "Exclusive",
    comment_1: i % 3 === 0 ? "Waiting on the splice certificate from the producer" : null,
    comment_2: null,
    cover_original_artist: null,
    new_distro: "TG2 Amuse",
    genre: "House",
    file_count: 12,
    updated_at: "2026-10-12T08:15:53.123456+00:00",
  });
}

describe("overview cache codec", () => {
  it("round trips rows exactly", () => {
    const rows = [realisticRow(1), makeRow({ catalog_id: "LG-00003", entity: null, release_date: null }), realisticRow(2)];
    expect(decodeOverview(encodeOverview(rows))).toEqual(rows);
  });

  it("round trips through JSON, as the data cache does", () => {
    const rows = [realisticRow(5), realisticRow(6)];
    expect(decodeOverview(JSON.parse(JSON.stringify(encodeOverview(rows))))).toEqual(rows);
  });

  it("keeps ~2,500 realistic rows well under Next's 2 MB cache limit", () => {
    const rows = Array.from({ length: 2500 }, (_, i) => realisticRow(i));
    const compact = encodedOverviewBytes(encodeOverview(rows));
    const asObjects = new TextEncoder().encode(JSON.stringify(rows)).length;
    // Deliberately fat rows (long Dropbox links and drive paths): still fits one cache entry.
    expect(compact).toBeLessThan(MAX_CACHED_OVERVIEW_BYTES);
    expect(MAX_CACHED_OVERVIEW_BYTES).toBeLessThan(2 * 1024 * 1024);
    // The compact form is what makes a single cache entry possible.
    expect(compact).toBeLessThan(asObjects * 0.75);
  });
});
