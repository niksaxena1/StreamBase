import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HeaderCells, RowCells } from "@/app/(main-flat)/library/LibraryTableCells";

import { LIBRARY_GRID_COLUMNS, LIBRARY_TABLE_COLUMNS, originalityInfo } from "./columns";
import { LIBRARY_COLUMNS } from "./types";
import { makeRow } from "./testRows";

const count = (html: string, role: string) => (html.match(new RegExp(`role="${role}"`, "g")) ?? []).length;

describe("table columns", () => {
  it("puts Comment 1 and Comment 2 right after Label / Genre", () => {
    const ids = LIBRARY_TABLE_COLUMNS.map((c) => c.id);
    const i = ids.indexOf("labelGenre");
    expect(ids.slice(i, i + 3)).toEqual(["labelGenre", "comment1", "comment2"]);
    expect(LIBRARY_TABLE_COLUMNS.find((c) => c.id === "comment1")?.label).toBe("Comment 1");
    expect(LIBRARY_TABLE_COLUMNS.find((c) => c.id === "comment2")?.label).toBe("Comment 2");
  });

  it("puts the originality icon column after Title", () => {
    const ids = LIBRARY_TABLE_COLUMNS.map((c) => c.id);
    expect(ids[ids.indexOf("title") + 1]).toBe("originality");
  });

  it("has one grid track per column", () => {
    expect(LIBRARY_GRID_COLUMNS.replace(/minmax\([^)]*\)/g, "x").split(" ")).toHaveLength(LIBRARY_TABLE_COLUMNS.length);
  });

  it("keeps the comments in the CSV export", () => {
    expect(LIBRARY_COLUMNS).toContain("comment_1");
    expect(LIBRARY_COLUMNS).toContain("comment_2");
  });
});

describe("header and row alignment", () => {
  it("has as many header cells as row cells", () => {
    const header = renderToStaticMarkup(
      createElement(HeaderCells, {
        sort: "release",
        dir: "desc",
        onSort: () => {},
        allSelected: false,
        someSelected: false,
        onToggleAll: () => {},
      }),
    );
    const row = renderToStaticMarkup(
      createElement(RowCells, {
        row: makeRow({ comment_1: "a", comment_2: "b", originality: "Cover", source_folder: "Y:\\x", master_duration_s: 200 }),
        entityNames: new Map([["tg", "TG"]]),
        checked: false,
        onToggle: () => {},
      }),
    );
    expect(count(header, "columnheader")).toBe(LIBRARY_TABLE_COLUMNS.length);
    expect(count(row, "cell")).toBe(count(header, "columnheader"));
  });

  it("renders the comments muted with the full text as a hover title", () => {
    const row = renderToStaticMarkup(
      createElement(RowCells, {
        row: makeRow({ comment_1: "first note", comment_2: null }),
        entityNames: new Map(),
        checked: false,
        onToggle: () => {},
      }),
    );
    expect(row).toContain('title="first note"');
  });
});

describe("originalityInfo", () => {
  it("names the original artist for a cover", () => {
    expect(originalityInfo({ originality: "Cover", cover_original_artist: "Adele" })).toEqual({ kind: "cover", text: "Cover of Adele" });
  });
  it("says just Cover when the artist is unknown", () => {
    expect(originalityInfo({ originality: "cover", cover_original_artist: " " })?.text).toBe("Cover");
  });
  it("says Original for originals", () => {
    expect(originalityInfo({ originality: "Original", cover_original_artist: null })).toEqual({ kind: "original", text: "Original" });
  });
  it("shows nothing when unknown", () => {
    expect(originalityInfo({ originality: null, cover_original_artist: null })).toBeNull();
    expect(originalityInfo({ originality: "Remix", cover_original_artist: null })).toBeNull();
  });
  it("gives the icon an accessible label and a hover title", () => {
    const row = renderToStaticMarkup(
      createElement(RowCells, {
        row: makeRow({ originality: "Cover", cover_original_artist: "Adele" }),
        entityNames: new Map(),
        checked: false,
        onToggle: () => {},
      }),
    );
    expect(row).toContain('aria-label="Cover of Adele"');
    expect(row).toContain('title="Cover of Adele"');
  });
});
