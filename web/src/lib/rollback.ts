/**
 * Server-side rollback helpers.
 *
 * The global time-rollback feature stores a "data date" (YYYY-MM-DD) in a cookie.
 * Server components read this cookie to cap all data queries at that date,
 * effectively showing the app as if later dates don't exist.
 */

import { cookies } from "next/headers";
import { addDaysISO, SOT_DATA_LAG_DAYS } from "@/lib/sotDates";

const COOKIE_NAME = "sb-rollback";

/**
 * Read the global rollback date from the cookie (server-side).
 * Returns the DATA date (YYYY-MM-DD) or null if rollback is not active.
 */
export async function getRollbackDate(): Promise<string | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value ?? null;
  if (!value) return null;
  // Validate ISO date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return value;
}

/**
 * Convert a rollback DATA date to a RUN date for database queries.
 */
export function rollbackDataDateToRunDate(dataDate: string): string {
  return addDaysISO(dataDate, SOT_DATA_LAG_DAYS);
}

/**
 * Cap a run date by the rollback date. If rollback is active and earlier
 * than the actual latest, return the rollback run date instead.
 * Returns the original date unchanged when rollback is off.
 */
export function capRunDate(
  latestRunDate: string | null,
  rollbackDataDate: string | null,
): string | null {
  if (!rollbackDataDate || !latestRunDate) return latestRunDate;
  const rollbackRunDate = rollbackDataDateToRunDate(rollbackDataDate);
  return rollbackRunDate < latestRunDate ? rollbackRunDate : latestRunDate;
}
