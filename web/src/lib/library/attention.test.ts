import { describe, expect, it } from "vitest";

import { attentionCounts, matchesAttention, parseAttention, type LibraryAttention } from "./attention";
import { makeRow } from "./testRows";
import type { LibraryRow } from "./types";

const TODAY = "2026-10-12";
const hit = (rule: LibraryAttention, over: Partial<LibraryRow> = {}) => matchesAttention(makeRow(over), rule, TODAY);

describe("no_master", () => {
  const base = { release_date: "2026-10-01", source_folder: "Y:\\x", has_m_master: false };
  it("flags a released release on the drive without an M master", () => {
    expect(hit("no_master", base)).toBe(true);
    expect(hit("no_master", { ...base, release_date: TODAY })).toBe(true);
  });
  it("ignores upcoming, undated, no-folder and mastered releases", () => {
    expect(hit("no_master", { ...base, release_date: "2026-10-13" })).toBe(false);
    expect(hit("no_master", { ...base, release_date: null })).toBe(false);
    expect(hit("no_master", { ...base, source_folder: null })).toBe(false);
    expect(hit("no_master", { ...base, has_m_master: true })).toBe(false);
  });
});

describe("no_isrc / no_upc", () => {
  it("flags released TG and P releases missing the code", () => {
    expect(hit("no_isrc", { entity: "tg", release_date: "2026-01-01", isrc: null })).toBe(true);
    expect(hit("no_isrc", { entity: "p", release_date: "2026-01-01", isrc: " " })).toBe(true);
    expect(hit("no_upc", { entity: "tg", release_date: "2026-01-01", upc: null })).toBe(true);
    expect(hit("no_upc", { entity: "p", release_date: "2026-01-01", upc: null })).toBe(true);
  });
  it("skips other entities, upcoming, undated and releases that have the code", () => {
    expect(hit("no_isrc", { entity: "legacy", release_date: "2026-01-01" })).toBe(false);
    expect(hit("no_isrc", { entity: "tg", release_date: "2026-11-01" })).toBe(false);
    expect(hit("no_isrc", { entity: "tg", release_date: null })).toBe(false);
    expect(hit("no_isrc", { entity: "tg", release_date: "2026-01-01", isrc: "USABC2600001" })).toBe(false);
    expect(hit("no_upc", { entity: "n", release_date: "2026-01-01" })).toBe(false);
    expect(hit("no_upc", { entity: "tg", release_date: "2026-01-01", upc: "012345678905" })).toBe(false);
  });
});

describe("no_contract", () => {
  it("flags TG releases on the drive without a signed contract", () => {
    expect(hit("no_contract", { entity: "tg", source_folder: "Y:\\x", has_signed_contract: false })).toBe(true);
  });
  it("skips other entities, no folder and signed releases", () => {
    expect(hit("no_contract", { entity: "p", source_folder: "Y:\\x" })).toBe(false);
    expect(hit("no_contract", { entity: "tg", source_folder: null })).toBe(false);
    expect(hit("no_contract", { entity: "tg", source_folder: "Y:\\x", has_signed_contract: true })).toBe(false);
  });
});

describe("upcoming_no_folder", () => {
  it("flags upcoming TG releases with no drive folder", () => {
    expect(hit("upcoming_no_folder", { entity: "tg", release_date: "2026-10-13", source_folder: null })).toBe(true);
  });
  it("skips today, past, other entities, undated and releases with a folder", () => {
    expect(hit("upcoming_no_folder", { entity: "tg", release_date: TODAY, source_folder: null })).toBe(false);
    expect(hit("upcoming_no_folder", { entity: "tg", release_date: "2026-01-01", source_folder: null })).toBe(false);
    expect(hit("upcoming_no_folder", { entity: "p", release_date: "2026-11-01", source_folder: null })).toBe(false);
    expect(hit("upcoming_no_folder", { entity: "tg", release_date: null, source_folder: null })).toBe(false);
    expect(hit("upcoming_no_folder", { entity: "tg", release_date: "2026-11-01", source_folder: "Y:\\x" })).toBe(false);
  });
});

describe("unassigned", () => {
  it("flags the unassigned entity and rows with no entity", () => {
    expect(hit("unassigned", { entity: "unassigned" })).toBe(true);
    expect(hit("unassigned", { entity: null })).toBe(true);
    expect(hit("unassigned", { entity: "tg" })).toBe(false);
  });
});

describe("attentionCounts", () => {
  it("counts every rule over all rows and hides zero-count rules", () => {
    const rows = [
      makeRow({ catalog_id: "A", entity: "tg", release_date: "2026-01-01", source_folder: "Y:\\a", has_m_master: false, has_signed_contract: false }),
      makeRow({ catalog_id: "B", entity: "unassigned", release_date: null }),
      makeRow({ catalog_id: "C", entity: "p", release_date: "2026-01-01", isrc: "USABC2600001", upc: "012345678905" }),
    ];
    const counts = attentionCounts(rows, TODAY);
    expect(Object.fromEntries(counts.map((c) => [c.rule, c.count]))).toEqual({
      no_master: 1,
      no_isrc: 1,
      no_upc: 1,
      no_contract: 1,
      unassigned: 1,
    });
    expect(counts.find((c) => c.rule === "upcoming_no_folder")).toBeUndefined();
    expect(counts[0].label).toBe("Released without an M master");
  });
  it("returns nothing when no row needs attention", () => {
    expect(attentionCounts([], TODAY)).toEqual([]);
  });
});

describe("parseAttention", () => {
  it("accepts rule keys only", () => {
    expect(parseAttention("no_master")).toBe("no_master");
    expect(parseAttention("nope")).toBe("");
    expect(parseAttention(null)).toBe("");
  });
});
