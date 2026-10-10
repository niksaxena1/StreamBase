import type { Grain, UrlState } from "../app/useUrlState";
import { DAY_MS, dateKey, formatUtcDate, monthLabel, utcDate } from "./format";
import type { Gap, TimePoint } from "../components/charts/data";
export type Row = Record<string, unknown>;
export type SeriesRow = {
  bucket: string;
  [key: string]: string | number | boolean | null;
};
export type Meta = {
  datasets: { key: string; first_day: string; last_day: string }[];
  followers: { first_day: string; last_day: string; groups: string[] };
  scopes: { key: string; label: string; playlist_ids: string[] }[];
  playlists: Row[];
  build: Row;
};
export type Paged = { rows: Row[]; total: number };
export function scopeOptions(meta?: Meta): Meta["scopes"] {
  if (!meta) return [];
  const known = new Set(meta.scopes.map((s) => s.key));
  return [
    ...meta.scopes,
    ...meta.playlists
      .filter((p) => !known.has(String(p.playlist_id)))
      .map((p) => ({
        key: String(p.playlist_id),
        label: `${textValue(p.name ?? p.playlist_id)}${p.name == null ? " (name unknown)" : ""}`,
        playlist_ids: [String(p.playlist_id)],
      })),
  ];
}
export type Overview = {
  series: SeriesRow[];
  kpis: Row;
  method: string;
  notes?: string[];
};
export type Quality = {
  coverage: Row[];
  calendar_gaps: { from: string; to: string; days: number }[];
  resets: Row[];
  low_confidence: Row[];
  linked_id_disagreements: { count: number; top: Row[] };
  verification: Row;
  notes: string[];
};
export function readableNote(value: string): string {
  return value.replace(/non-null/gi, "known").replace(/\bnull\b/gi, "missing");
}
export function textValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(textValue).join(", ");
  if (typeof value === "object")
    return Object.entries(value as Row)
      .map(([k, v]) => `${k}: ${textValue(v)}`)
      .join("; ");
  return readableNote(String(value));
}
export const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
export function queryParams(state: UrlState) {
  const params = { ...state.params };
  for (const key of ["tab", "compare", "mode", "metric"]) delete params[key];
  if (!["tracks", "artists", "milestones", "followers"].includes(state.page))
    delete params.offset;
  return {
    ...params,
    dataset: state.dataset === "followers" ? "stats2" : state.dataset,
    from: state.from || undefined,
    to: state.to || undefined,
    grain: { daily: "day", weekly: "week", monthly: "month" }[state.grain],
  };
}
export function bucketLabel(day: string, grain: Grain): string {
  return grain === "monthly"
    ? monthLabel(day)
    : grain === "weekly"
      ? `Week of ${formatUtcDate(day)}`
      : formatUtcDate(day);
}
// Densified API buckets carry NULL counters for missing observations. Never mask
// known weekly/monthly counters just because another day in that bucket is missing.
export function gapBands(rows: SeriesRow[], counter: string): Gap[] {
  const gaps: Gap[] = [];
  for (const row of rows) {
    if (row[counter] != null) continue;
    const day = dateKey(row.bucket),
      last = gaps.at(-1);
    if (last && utcDate(day).getTime() - utcDate(last.to).getTime() === DAY_MS)
      last.to = day;
    else gaps.push({ from: day, to: day, label: "No counter observation" });
  }
  return gaps;
}
export function chartPoints(rows: SeriesRow[]): TimePoint[] {
  return rows.map(({ bucket, ...values }) => ({
    date: bucket,
    ...Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        typeof v === "boolean" ? (v ? 1 : 0) : v,
      ]),
    ),
  }));
}
export function readingsExplanation(rows: Row[]): string[] {
  const ids = [...new Set(rows.map((r) => textValue(r.spotify_track_id)))];
  return ids.map((id) => {
    const group = rows.filter((r) => r.spotify_track_id === id),
      first = group[0];
    const distinct = new Set(
      group.filter((r) => r.play_count != null).map((r) => r.play_count),
    ).size;
    const chosen = group.filter(
      (r) => r.play_count != null && r.play_count === r.mode,
    ).length;
    return `${id}: ${textValue(first.observation_count ?? group.length)} readings, ${distinct} distinct values, chosen value occurred ${textValue(first.mode_frequency ?? chosen)} times`;
  });
}
export function mergeSeries(
  items: { key: string; series: SeriesRow[] }[],
  counter: string,
): TimePoint[] {
  const map = new Map<string, TimePoint>();
  for (const item of items)
    for (const row of item.series) {
      const point = map.get(row.bucket) ?? { date: row.bucket };
      point[item.key] = numberValue(row[counter]);
      map.set(row.bucket, point);
    }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function humanBytes(value: unknown): string {
  const n = numberValue(value);
  if (n === null) return "—";
  const i = Math.min(4, Math.floor(Math.log(Math.max(1, n)) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][i]}`;
}
