/**
 * SpotOnTrack lag:
 * If we ingest on run_date=YYYY-MM-DD, the stream counts often reflect ~2 days earlier.
 * We keep DB storage as ingestion/run dates, and shift dates in the UI.
 */

import { formatDateISO } from "@/lib/format";

export const SOT_DATA_LAG_DAYS = 2;

export function addDaysISO(isoDate: string, deltaDays: number): string {
  // Expect isoDate as YYYY-MM-DD
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function dataDateFromRunDate(runDateISO: string): string {
  return addDaysISO(runDateISO, -SOT_DATA_LAG_DAYS);
}

/** Inverse of {@link dataDateFromRunDate} for DB rows keyed by ingestion/run date. */
export function runDateFromDataDate(dataDateISO: string): string {
  return addDaysISO(dataDateISO, SOT_DATA_LAG_DAYS);
}

export function formatSotDataDateISO(runDateISO: string | null | undefined): string {
  if (!runDateISO) return "—";
  return formatDateISO(dataDateFromRunDate(runDateISO));
}

export function expectedLatestRunDateUtc(todayUtcISO: string): string {
  // If SpotOnTrack lags by 2 days, then the latest *data* date should be today-2.
  // Our DB date column represents ingestion/data snapshot date; so "expected latest"
  // should be today-2 to avoid false "stale data" alarms.
  return addDaysISO(todayUtcISO, -SOT_DATA_LAG_DAYS);
}

