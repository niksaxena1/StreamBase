import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/csv";

import { libraryCsvFilename, libraryCsvRows } from "./exportCsv";
import { makeRow } from "./testRows";
import { LIBRARY_COLUMNS, LIBRARY_CSV_STREAM_COLUMNS } from "./types";

describe("library CSV export", () => {
  it("emits every overview column in order, then the stream columns", () => {
    const csv = toCsv(libraryCsvRows([makeRow()]), { sortForExport: false });
    expect(csv.split("\r\n")[0]).toBe([...LIBRARY_COLUMNS, ...LIBRARY_CSV_STREAM_COLUMNS].join(","));
  });

  it("writes stream figures and the cover URL", () => {
    const row = makeRow({ total_streams: 1234567, streams_7d: 890, album_image_url: "https://i.scdn.co/image/abc" });
    const lines = toCsv(libraryCsvRows([row]), { sortForExport: false }).split("\r\n");
    const header = lines[0].split(",");
    const values = lines[1].split(",");
    expect(values[header.indexOf("total_streams")]).toBe("1234567");
    expect(values[header.indexOf("streams_7d")]).toBe("890");
    expect(values[header.indexOf("album_image_url")]).toBe("https://i.scdn.co/image/abc");
  });

  it("escapes commas, quotes and line breaks", () => {
    const row = makeRow({
      sheet_artist: 'Mina, "The" Band',
      comment_1: "line one\nline two",
      source_folder: "Y:\\Unreleased Ext Drive\\Kyden - Fast",
    });
    const csv = toCsv(libraryCsvRows([row]), { sortForExport: false });
    expect(csv).toContain('"Mina, ""The"" Band"');
    expect(csv).toContain('"line one\nline two"');
    expect(csv).toContain("Y:\\Unreleased Ext Drive\\Kyden - Fast");
  });

  it("joins artist lists with a pipe and writes blanks for nulls", () => {
    const row = makeRow({ artists: ["A", "B"], master_duration_s: 185.2, has_m_master: true });
    const lines = toCsv(libraryCsvRows([row]), { sortForExport: false }).split("\r\n");
    const header = lines[0].split(",");
    const values = lines[1].split(",");
    expect(values[header.indexOf("artists")]).toBe("A | B");
    expect(values[header.indexOf("master_duration_s")]).toBe("185.2");
    expect(values[header.indexOf("has_m_master")]).toBe("true");
    expect(values[header.indexOf("isrc")]).toBe("");
  });

  it("names the file after the date", () => {
    expect(libraryCsvFilename("2026-10-12")).toBe("library-2026-10-12.csv");
  });
});
