/**
 * Lower date bound for "latest date" and full-history chart reads of the stream views.
 *
 * Stream history older than the packed-months policy (12 months in the compact tier + the daily window) is archived to
 * R2 and read through a foreign data wrapper that loads whole monthly files. Interactive reads must never do that, so
 * unbounded reads (order by date, "all history of one track") are floored here. 365 days is always inside the
 * compact+daily tiers (the archive starts at least ~13 months back), so output is identical until months are archived.
 */
export const RECENT_STREAM_FLOOR_DAYS = 365;

export function recentStreamFloor(now: Date = new Date(), days: number = RECENT_STREAM_FLOOR_DAYS): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
