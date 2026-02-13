import { describe, it, expect } from "vitest";
import { toCsv, slugifyForFilename } from "./csv";

// ---------------------------------------------------------------------------
// toCsv
// ---------------------------------------------------------------------------

describe("toCsv", () => {
  it("creates CSV from simple rows", () => {
    const rows = [
      { name: "Track A", streams: 1000 },
      { name: "Track B", streams: 2000 },
    ];
    const csv = toCsv(rows, { sortForExport: false });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("name,streams");
    expect(lines[1]).toBe("Track A,1000");
    expect(lines[2]).toBe("Track B,2000");
  });

  it("escapes cells with commas", () => {
    const rows = [{ name: "Hello, World", value: 1 }];
    const csv = toCsv(rows, { sortForExport: false });
    expect(csv).toContain('"Hello, World"');
  });

  it("escapes cells with quotes", () => {
    const rows = [{ name: 'She said "hi"', value: 1 }];
    const csv = toCsv(rows, { sortForExport: false });
    expect(csv).toContain('"She said ""hi"""');
  });

  it("escapes cells with newlines", () => {
    const rows = [{ name: "Line1\nLine2", value: 1 }];
    const csv = toCsv(rows, { sortForExport: false });
    expect(csv).toContain('"Line1\nLine2"');
  });

  it("handles null/undefined values as empty strings", () => {
    const rows = [{ name: null, value: undefined }];
    const csv = toCsv(rows as any, { sortForExport: false });
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(",");
  });

  it("flattens arrays with pipe separator", () => {
    const rows = [{ artists: ["Artist A", "Artist B"] }];
    const csv = toCsv(rows as any, { sortForExport: false });
    expect(csv).toContain("Artist A | Artist B");
  });

  it("auto-sorts by date field when sortForExport is true", () => {
    const rows = [
      { date: "2026-01-03", value: 3 },
      { date: "2026-01-01", value: 1 },
      { date: "2026-01-02", value: 2 },
    ];
    const csv = toCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("2026-01-01");
    expect(lines[2]).toContain("2026-01-02");
    expect(lines[3]).toContain("2026-01-03");
  });

  it("auto-sorts by month field", () => {
    const rows = [
      { month: "2026-03", value: 3 },
      { month: "2026-01", value: 1 },
    ];
    const csv = toCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("2026-01");
    expect(lines[2]).toContain("2026-03");
  });

  it("uses custom headers when provided", () => {
    const rows = [{ a: 1, b: 2, c: 3 }];
    const csv = toCsv(rows, { headers: ["c", "a"], sortForExport: false });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("c,a");
    expect(lines[1]).toBe("3,1");
  });

  it("handles union of headers from rows with different keys", () => {
    const rows = [
      { a: 1, b: 2 },
      { a: 3, c: 4 },
    ];
    const csv = toCsv(rows, { sortForExport: false });
    const headers = csv.split("\r\n")[0];
    expect(headers).toBe("a,b,c");
  });

  it("handles empty rows array", () => {
    const csv = toCsv([]);
    expect(csv).toBe("");
  });

  it("handles booleans", () => {
    const rows = [{ active: true, deleted: false }];
    const csv = toCsv(rows as any, { sortForExport: false });
    expect(csv).toContain("true,false");
  });
});

// ---------------------------------------------------------------------------
// slugifyForFilename
// ---------------------------------------------------------------------------

describe("slugifyForFilename", () => {
  it("converts to lowercase kebab-case", () => {
    expect(slugifyForFilename("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(slugifyForFilename("Track: All (2026)")).toBe("track-all-2026");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyForFilename("---hello---")).toBe("hello");
  });

  it("collapses multiple special chars to single hyphen", () => {
    expect(slugifyForFilename("a   b   c")).toBe("a-b-c");
  });

  it("handles empty/whitespace", () => {
    expect(slugifyForFilename("   ")).toBe("");
  });
});
