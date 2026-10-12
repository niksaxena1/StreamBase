import { describe, expect, it } from "vitest";

import { mergeRows, normalizeCode, normalizeFile, normalizeHistory, normalizeOverviewRow, sortCodes } from "./normalize";
import { makeRow } from "./testRows";

describe("normalizeOverviewRow", () => {
  it("coerces numerics and fills missing columns", () => {
    const row = normalizeOverviewRow({
      catalog_id: "TG-00001",
      master_duration_s: "185.25",
      file_count: "7",
      has_m_master: true,
      artists: ["A", 5, "B"],
      release_date: "2026-03-01",
    });
    expect(row.master_duration_s).toBe(185.25);
    expect(row.file_count).toBe(7);
    expect(row.has_m_master).toBe(true);
    expect(row.non_exclusive_samples).toBe(false);
    expect(row.artists).toEqual(["A", "B"]);
    expect(row.isrc).toBeNull();
    expect(row.source_folder).toBeNull();
  });

  it("treats null / bad numerics as null", () => {
    expect(normalizeOverviewRow({ catalog_id: "X", master_duration_s: null }).master_duration_s).toBeNull();
    expect(normalizeOverviewRow({ catalog_id: "X", master_duration_s: "abc" }).master_duration_s).toBeNull();
    expect(normalizeOverviewRow({ catalog_id: "X" }).file_count).toBe(0);
  });
});

describe("detail normalizers", () => {
  it("normalizes a file row", () => {
    const f = normalizeFile({ id: 4, catalog_id: "TG-1", rel_path: "a.wav", role: "master", m_version: [2], bytes: "100" });
    expect(f).toMatchObject({ id: 4, role: "master", m_version: [2], bytes: 100, dropbox_path: null });
  });

  it("normalizes codes and puts the primary first", () => {
    const codes = [
      normalizeCode({ isrc: "B", is_primary: false, source: "sheet" }, "isrc"),
      normalizeCode({ isrc: "A", is_primary: true, source: null }, "isrc"),
    ];
    expect(sortCodes(codes).map((c) => c.code)).toEqual(["A", "B"]);
  });

  it("normalizes a history row", () => {
    expect(normalizeHistory({ id: 1, at: "2026-10-12T00:00:00Z", actor: "a@b.c", before: { x: 1 } })).toMatchObject({
      id: 1,
      actor: "a@b.c",
      after: null,
    });
  });
});

describe("mergeRows", () => {
  const a = makeRow({ catalog_id: "A", sheet_title: "old", updated_at: "2026-10-01T00:00:00Z" });
  const b = makeRow({ catalog_id: "B", updated_at: "2026-10-01T00:00:00Z" });

  it("returns the base list when there are no overrides", () => {
    const base = [a, b];
    expect(mergeRows(base, new Map())).toBe(base);
  });

  it("uses an override that is newer than the server row", () => {
    const newer = { ...a, sheet_title: "new", updated_at: "2026-10-02T00:00:00Z" };
    expect(mergeRows([a, b], new Map([["A", newer]]))[0].sheet_title).toBe("new");
  });

  it("drops an override once the server row is newer", () => {
    const stale = { ...a, sheet_title: "mine", updated_at: "2026-09-30T00:00:00Z" };
    const fresh = { ...a, sheet_title: "theirs", updated_at: "2026-10-03T00:00:00Z" };
    expect(mergeRows([fresh, b], new Map([["A", stale]]))[0].sheet_title).toBe("theirs");
  });

  it("appends a new row the server list does not have yet", () => {
    const created = makeRow({ catalog_id: "C" });
    expect(mergeRows([a, b], new Map([["C", created]])).map((r) => r.catalog_id)).toEqual(["A", "B", "C"]);
  });
});
