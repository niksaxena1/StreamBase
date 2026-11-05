import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";

export type ReleaseWeekTrack = {
  isrc: string; name: string | null; artist_names: string[] | null; album_image_url?: string | null; release_date: string | null;
  prev_streams: number | null; cur_streams: number | null; reset_drop: number | null;
  reset_run_date: string | null; run_date: string;
};
export type ReleaseBucket = {
  key: string; label: string; kind: "week" | "month" | "year" | "unknown"; sortDate: string;
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
export function groupReleaseWeeks(tracks: ReleaseWeekTrack[], dataDate: string) {
  const weeklyFloor = addDaysISO(dataDate, -91);
  const floorDate = new Date(`${weeklyFloor.slice(0, 7)}-01T00:00:00Z`);
  floorDate.setUTCMonth(floorDate.getUTCMonth() - 12);
  const monthFloor = floorDate.toISOString().slice(0, 7);
  const groups = new Map<string, ReleaseBucket>();
  for (const track of tracks) {
    const date = track.release_date;
    const friday = date ? releaseWeekStart(date) : null;
    let kind: ReleaseBucket["kind"], key: string, label: string, sortDate: string;
    if (!date || !friday) { kind = "unknown"; key = "unknown"; label = "Unknown"; sortDate = ""; }
    else if (friday >= weeklyFloor) {
      kind = "week"; key = `week:${friday}`; sortDate = friday;
      label = `Week of ${prettyDate(friday, { weekday: true })}`;
    } else if (date.slice(0, 7) >= monthFloor) {
      kind = "month"; key = `month:${date.slice(0, 7)}`; sortDate = `${date.slice(0, 7)}-01`;
      label = `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
    } else { kind = "year"; key = `year:${date.slice(0, 4)}`; label = date.slice(0, 4); sortDate = `${label}-01-01`; }
    let bucket = groups.get(key);
    if (!bucket) { bucket = { key, label, kind, sortDate, trackCount: 0, prev: 0, cur: 0, change: 0, pct: null, tracks: [] }; groups.set(key, bucket); }
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
