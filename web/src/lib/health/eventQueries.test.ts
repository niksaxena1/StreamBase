import { describe, expect, it } from "vitest";
import { effectiveDailyTotals, eventRows, streamCursorFilter, type StreamSnapshot, type StreamCursor } from "./eventQueries.server";
import { eventWindow } from "./events";

function queryFor(rows: unknown[], offsets: number[] = []) {
  return () => ({ range: async (from: number, to: number) => {
    offsets.push(from);
    return { data: rows.slice(from, to + 1), error: null };
  } });
}

function streamQueryFor(rows: StreamSnapshot[]) {
  return (cursor?: StreamCursor) => {
    const start = cursor ? rows.findIndex((r) => r.date === cursor.date && r.isrc === cursor.isrc) + 1 : 0;
    return { range: async (from: number, to: number) => {
      expect(from).toBe(0);
      return { data: rows.slice(start, start + to + 1), error: null };
    } };
  };
}

describe("bounded event queries", () => {
  it("reads beyond the PostgREST row cap", async () => {
    const rows = Array.from({ length: 2001 }, (_, id) => ({ id }));
    const offsets: number[] = [];
    expect(await eventRows(queryFor(rows, offsets))).toEqual(rows);
    expect(offsets).toEqual([0, 1000, 2000]);
  });
  it("rejects query failures instead of returning incomplete counts", async () => {
    await expect(eventRows(() => ({ range: async () => ({ data: null, error: { message: "timeout" } }) }))).rejects.toThrow("timeout");
  });
  it("folds effective counters across page boundaries and counts each ISRC once", async () => {
    const rows: StreamSnapshot[] = ["2026-10-10", "2026-10-11"].flatMap((date, index) => Array.from({ length: 600 }, (_, i) => ({ date, isrc: String(i), streams_cumulative: 100 + index * 10 })));
    const totals = await effectiveDailyTotals(streamQueryFor(rows), eventWindow(7, "2026-10-11"), (isrc) => Number(isrc) < 300);
    expect(totals).toEqual([{ date: "2026-10-10", streams: null }, { date: "2026-10-11", streams: 3000 }]);
  });
  it("quotes cursor ISRCs so stored punctuation cannot alter filters", () => {
    expect(streamCursorFilter({ date: "2026-10-11", isrc: 'A",B' })).toBe('date.gt.2026-10-11,and(date.eq.2026-10-11,isrc.gt."A\\",B")');
  });
  it("never bridges missing dates, null counters or newly observed tracks", async () => {
    const rows = [
      { date: "2026-10-08", isrc: "A", streams_cumulative: 100 },
      { date: "2026-10-10", isrc: "A", streams_cumulative: 150 },
      { date: "2026-10-10", isrc: "B", streams_cumulative: null },
      { date: "2026-10-11", isrc: "A", streams_cumulative: 140 },
      { date: "2026-10-11", isrc: "B", streams_cumulative: 200 },
      { date: "2026-10-11", isrc: "NEW", streams_cumulative: 9999 },
    ];
    expect(await effectiveDailyTotals(queryFor(rows), eventWindow(7, "2026-10-11"))).toEqual([
      { date: "2026-10-08", streams: null }, { date: "2026-10-10", streams: null }, { date: "2026-10-11", streams: -10 },
    ]);
  });
});
