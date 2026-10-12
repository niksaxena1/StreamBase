import type { LibraryRow, LibraryStream, LibraryStreamPoint } from "./types";

type Raw = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Raw `track_streams()` row -> typed row (bigints arrive as numbers or strings). */
export function normalizeStream(raw: Raw): LibraryStream {
  return {
    catalog_id: String(raw.catalog_id ?? ""),
    isrc: str(raw.isrc),
    total_streams: num(raw.total_streams),
    streams_7d: num(raw.streams_7d),
    as_of: str(raw.as_of),
    album_image_url: str(raw.album_image_url),
    spotify_track_id: str(raw.spotify_track_id),
  };
}

/** Raw `track_stream_series()` row -> typed point; rows without a date or value are dropped. */
export function normalizeStreamPoint(raw: Raw): LibraryStreamPoint | null {
  const date = str(raw.date)?.slice(0, 10);
  const value = num(raw.streams_cumulative);
  return date && value !== null ? { date, streams_cumulative: value } : null;
}

/**
 * Puts stream figures on each row by catalog ID, but only when the stream row's ISRC is the row's
 * current ISRC (an ISRC edit must not keep the old track's figures). Other rows keep their fields unset.
 */
export function mergeStreams(rows: LibraryRow[], streams: LibraryStream[]): LibraryRow[] {
  if (streams.length === 0) return rows;
  const byId = new Map(streams.map((s) => [s.catalog_id, s]));
  return rows.map((row) => {
    const s = byId.get(row.catalog_id);
    if (!s || !s.isrc || s.isrc !== row.isrc) return row;
    return {
      ...row,
      total_streams: s.total_streams,
      streams_7d: s.streams_7d,
      album_image_url: s.album_image_url,
      spotify_track_id: s.spotify_track_id,
    };
  });
}

/** The data date shared by the stream rows (the newest one), or null when there are none. */
export function streamsAsOf(streams: LibraryStream[]): string | null {
  let latest: string | null = null;
  for (const s of streams) if (s.as_of && (latest === null || s.as_of > latest)) latest = s.as_of;
  return latest;
}

/** 1234567 -> "1.2M", 12345 -> "12.3K", 950 -> "950". */
export function formatCompactStreams(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  const units: Array<[number, string]> = [
    [1e3, "K"],
    [1e6, "M"],
    [1e9, "B"],
  ];
  let i = 0;
  while (i < units.length - 1 && abs >= units[i + 1][0]) i++;
  for (; ; i++) {
    const [size, suffix] = units[i];
    const scaled = n / size;
    // One decimal below 100, none above.
    const text = Math.abs(scaled) < 100 ? scaled.toFixed(1).replace(/\.0$/, "") : String(Math.round(scaled));
    // 999,999 would print as "1000K": move up to the next unit instead.
    if (Math.abs(Number(text)) >= 1000 && i < units.length - 1) continue;
    return `${text}${suffix}`;
  }
}

export function formatExactStreams(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "" : Math.round(n).toLocaleString("en-US");
}

const DAY_MS = 86_400_000;
const MAX_SPREAD_DAYS = 400;
const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type DailyStreamsPoint = { date: string; value: number; estimated?: boolean };

/**
 * Daily streams from a cumulative series (ascending by date): each day is the difference to the
 * previous value, negatives clamped to 0, and the first point is skipped (it has no previous value).
 * When consecutive points are more than a day apart, the increase is spread evenly over the missing
 * days, and those days are marked `estimated`.
 */
export function dailyFromCumulative(points: LibraryStreamPoint[]): DailyStreamsPoint[] {
  const out: DailyStreamsPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const increase = Math.max(cur.streams_cumulative - prev.streams_cumulative, 0);
    const gap = Math.round((dayMs(cur.date) - dayMs(prev.date)) / DAY_MS);
    if (!Number.isFinite(gap) || gap <= 1 || gap > MAX_SPREAD_DAYS) {
      out.push({ date: cur.date, value: increase });
      continue;
    }
    const each = increase / gap;
    for (let d = 1; d <= gap; d++) {
      out.push({ date: d === gap ? cur.date : isoDay(dayMs(prev.date) + d * DAY_MS), value: each, estimated: true });
    }
  }
  return out;
}

/** Chart ranges in days; the series is refetched when this changes. */
export const STREAM_RANGES = [30, 90, 365] as const;
export type StreamRange = (typeof STREAM_RANGES)[number];

export function isStreamRange(days: unknown): days is StreamRange {
  return STREAM_RANGES.some((d) => d === days);
}
