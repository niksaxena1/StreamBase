import "server-only";

import { addDaysISO } from "@/lib/sotDates";
import type { DailyTotal, EventWindow } from "./events";

type PageQuery = { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
/** PostgREST caps responses at 1,000 rows; never silently truncate event counts. */
export async function eventRows<T>(query: () => PageQuery): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await query().range(offset, offset + 999);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export type StreamSnapshot = { date: string; isrc: string; streams_cumulative: number | null };
export type StreamCursor = Pick<StreamSnapshot, "date" | "isrc">;
export function streamCursorFilter(cursor: StreamCursor): string {
  // Quoted PostgREST literals keep even unusual stored ISRCs out of filter syntax.
  const isrc = `"${cursor.isrc.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `date.gt.${cursor.date},and(date.eq.${cursor.date},isrc.gt.${isrc})`;
}
/** Legacy fold retained for regression coverage; Events loaders use SQL daily totals. */
export async function effectiveDailyTotals(
  query: (cursor?: StreamCursor) => PageQuery,
  window: EventWindow,
  inScope: (isrc: string, date: string) => boolean = () => true,
): Promise<Array<Pick<DailyTotal, "date" | "streams">>> {
  const totals: Array<Pick<DailyTotal, "date" | "streams">> = [];
  let previous = new Map<string, number>();
  let current = new Map<string, number>();
  let date = "";
  let previousDate = "";
  let sum = 0;
  let pairs = 0;
  let adjacent = false;
  let cursor: StreamCursor | undefined;
  const finish = () => {
    if (date) totals.push({ date, streams: pairs > 0 ? sum : null });
    previous = current;
    previousDate = date;
    current = new Map();
    sum = 0;
    pairs = 0;
  };
  for (;;) {
    const result = await query(cursor).range(0, 999);
    if (result.error) throw new Error(result.error.message);
    const page = (result.data ?? []) as StreamSnapshot[];
    for (const row of page) {
      if (row.date !== date) { finish(); date = row.date; adjacent = previousDate === addDaysISO(date, -1); }
      if (row.date < window.streamsStart || row.date > window.end || row.streams_cumulative == null) continue;
      const value = Number(row.streams_cumulative);
      if (!Number.isFinite(value)) continue;
      current.set(row.isrc, value);
      const prior = previous.get(row.isrc);
      if (prior != null && adjacent && inScope(row.isrc, date)) {
        sum += value - prior;
        pairs++;
      }
    }
    if (page.length < 1000) { finish(); return totals; }
    const last = page[page.length - 1];
    cursor = { date: last.date, isrc: last.isrc };
  }
}
