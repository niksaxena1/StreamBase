import { EARLIEST_HISTORY_DATE_ISO } from "./aggregateSeries";

/** Longest range the standard (clipped) views offer; anything longer was asked for explicitly. */
export const STANDARD_MAX_RANGE_DAYS = 365;

/**
 * The global "chart start date" hides everything older than a date the user picked (default 28 Jan 2026). A page that
 * deliberately loads long history (range over 365 days, or Archived history) must never be clipped by it.
 * Returns the start date to use for the page's charts, or null to keep the user's setting (30/90/365-day views).
 */
export function chartClipOverrideIso(args: { rangeDays: number; archivedHistory?: boolean }): string | null {
  return args.archivedHistory || args.rangeDays > STANDARD_MAX_RANGE_DAYS ? EARLIEST_HISTORY_DATE_ISO : null;
}
