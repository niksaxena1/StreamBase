import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";

export type ReleaseWeekTrack = {
  isrc: string; name: string | null; artist_names: string[] | null; album_image_url?: string | null; release_date: string | null;
  prev_streams: number | null; cur_streams: number | null; reset_drop: number | null;
  reset_run_date: string | null; run_date: string;
};
export type ReleaseBucket = {
  key: string; label: string; kind: "week" | "month" | "year" | "unknown"; sortDate: string;
  /** Inclusive release-date range this bucket covers (null for "unknown"), used for competitor drill-downs. */
  from: string | null; to: string | null;
  trackCount: number; prev: number; cur: number; change: number; pct: number | null; tracks: ReleaseWeekTrack[];
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}
/** "2nd Jun 2025" (UTC, date-only). Options add a weekday prefix or drop the year. */
export function prettyDate(iso: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = [ordinal(d.getUTCDate()), MONTHS[d.getUTCMonth()]];
  if (opts.year !== false) parts.push(String(d.getUTCFullYear()));
  return `${opts.weekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ""}${parts.join(" ")}`;
}
export function releaseWeekStart(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return addDaysISO(isoDate, -((day + 2) % 7));
}
type BucketDef = Pick<ReleaseBucket, "key" | "label" | "kind" | "sortDate" | "from" | "to">;

function lastDayOfMonth(ym: string): string {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
const minIso = (a: string, b: string) => (a < b ? a : b);

/** Bucketing rules shared by own-catalog tracks and competitor rows (relative to the latest data date). */
export function releaseBucketer(dataDate: string): (date: string | null) => BucketDef {
  const weeklyFloor = addDaysISO(dataDate, -91);
  const firstWeeklyFriday = releaseWeekStart(weeklyFloor) < weeklyFloor ? addDaysISO(releaseWeekStart(weeklyFloor), 7) : weeklyFloor;
  const floorDate = new Date(`${weeklyFloor.slice(0, 7)}-01T00:00:00Z`);
  floorDate.setUTCMonth(floorDate.getUTCMonth() - 12);
  const monthFloor = floorDate.toISOString().slice(0, 7);
  const beforeWeekly = addDaysISO(firstWeeklyFriday, -1);
  const beforeMonthly = addDaysISO(`${monthFloor}-01`, -1);
  return (date) => {
    const friday = date ? releaseWeekStart(date) : null;
    if (!date || !friday) return { kind: "unknown", key: "unknown", label: "Unknown", sortDate: "", from: null, to: null };
    if (friday >= weeklyFloor) {
      return {
        kind: "week", key: `week:${friday}`, sortDate: friday, from: friday, to: addDaysISO(friday, 6),
        label: `Week of ${prettyDate(friday, { weekday: true })}`,
      };
    }
    const ym = date.slice(0, 7);
    if (ym >= monthFloor) {
      return {
        kind: "month", key: `month:${ym}`, sortDate: `${ym}-01`, from: `${ym}-01`, to: minIso(lastDayOfMonth(ym), beforeWeekly),
        label: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`,
      };
    }
    const y = date.slice(0, 4);
    return { kind: "year", key: `year:${y}`, label: y, sortDate: `${y}-01-01`, from: `${y}-01-01`, to: minIso(`${y}-12-31`, beforeMonthly) };
  };
}

export function groupReleaseWeeks(tracks: ReleaseWeekTrack[], dataDate: string) {
  const bucketFor = releaseBucketer(dataDate);
  const groups = new Map<string, ReleaseBucket>();
  for (const track of tracks) {
    const { key, label, kind, sortDate, from, to } = bucketFor(track.release_date);
    let bucket = groups.get(key);
    if (!bucket) { bucket = { key, label, kind, sortDate, from, to, trackCount: 0, prev: 0, cur: 0, change: 0, pct: null, tracks: [] }; groups.set(key, bucket); }
    bucket.tracks.push(track); bucket.trackCount++; bucket.prev += Number(track.prev_streams ?? 0); bucket.cur += Number(track.cur_streams ?? 0);
  }
  const buckets = [...groups.values()];
  for (const b of buckets) {
    b.change = b.cur - b.prev; b.pct = b.prev === 0 ? null : b.change / b.prev;
    b.tracks.sort ( (a, c) => (Number(a.cur_streams ?? 0) - Number(a.prev_streams ?? 0)) - (Number(c.cur_streams ?? 0) - Number(c.prev_streams ?? 0)) || a.isrc.localeCompare(c.isrc));
  }
  buckets.sort((a, b) => b.sortDate.localeCompare(a.sortDate) || a.key.localeCompare(b.key));
  const resets = tracks.filter(t => Number(t.reset_drop ?? 0) < 0).map(t => ({ track: t, drop: Number(t.reset_drop), dataDate: t.reset_run_date ? dataDateFromRunDate(t.reset_run_date) : null }));
  return { buckets, resets };
}

export type CompetitorSummaryRow = { label_key: string; release_date: string | null; tracks: number; prev_streams: number; cur_streams: number };
export type CompetitorBucketLabel = { labelKey: string; tracks: number; prev: number; cur: number; change: number; pct: number | null };
export type CompetitorBucket = { labels: CompetitorBucketLabel[]; medianPct: number | null; withPct: number };

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/**
 * Competitor rows (label x release date) grouped into the same buckets as our tracks.
 * medianPct = median of each competitor's own % change (competitors with last-week streams only),
 * so one big competitor doesn't dominate. Labels inside a bucket: biggest % drop first.
 */
export function groupCompetitorReleaseWeeks(rows: CompetitorSummaryRow[], dataDate: string): Map<string, CompetitorBucket> {
  const bucketFor = releaseBucketer(dataDate);
  const acc = new Map<string, Map<string, CompetitorBucketLabel>>();
  for (const r of rows) {
    const { key } = bucketFor(r.release_date);
    let labels = acc.get(key);
    if (!labels) { labels = new Map(); acc.set(key, labels); }
    let l = labels.get(r.label_key);
    if (!l) { l = { labelKey: r.label_key, tracks: 0, prev: 0, cur: 0, change: 0, pct: null }; labels.set(r.label_key, l); }
    l.tracks += Number(r.tracks ?? 0); l.prev += Number(r.prev_streams ?? 0); l.cur += Number(r.cur_streams ?? 0);
  }
  const out = new Map<string, CompetitorBucket>();
  for (const [key, labels] of acc) {
    const list = [...labels.values()];
    for (const l of list) { l.change = l.cur - l.prev; l.pct = l.prev > 0 ? l.change / l.prev : null; }
    list.sort((a, b) => (a.pct ?? Infinity) - (b.pct ?? Infinity) || a.change - b.change || a.labelKey.localeCompare(b.labelKey));
    const pcts = list.flatMap((l) => (l.pct == null ? [] : [l.pct]));
    out.set(key, { labels: list, medianPct: median(pcts), withPct: pcts.length });
  }
  return out;
}
