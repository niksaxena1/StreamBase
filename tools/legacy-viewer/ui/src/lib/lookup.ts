import { DAY_MS, formatUtcDate, fullNumber, monthLabel, utcDate } from "./format";
import type { ChartMarker } from "../components/charts/data";

export type ArtistCredit = { name: string; art: string | null };
export type LookupTrack = {
  isrc: string;
  song_name: string;
  artist: string;
  first_day: string;
  last_day: string;
  latest_streams: number;
  /** Relative URL of the cached 64px cover, or null (initials tile). */
  art?: string | null;
  artists?: ArtistCredit[];
};
export type Reading = {
  requested: string;
  used_day: string;
  streams: number;
  substituted: boolean;
  before_tracking: boolean;
};
/** The counter source (selected Spotify ID) changed between two consecutive readings. */
export type SourceSwitch = {
  day: string;
  from_id: string;
  to_id: string;
  /** streams(day) − streams(previous reading) on the switch day. */
  jump: number;
};
export type Between = {
  track: Pick<LookupTrack, "isrc" | "song_name" | "artist">;
  from: Reading | null;
  to: Reading | null;
  difference: number | null;
  days: number;
  per_day: number | null;
  resets: string[];
  gap_days: number;
  empty: boolean;
  source_switches?: SourceSwitch[];
};
export type LookupMonth = {
  month: string;
  from: Reading;
  to: Reading;
  streams_in_month: number;
  end_total: number;
  partial_first_month: boolean;
  partial_last_month: boolean;
  resets: string[];
  gap_days: number;
  source_switches?: SourceSwitch[];
};
export type LookupDaily = {
  day: string;
  streams: number;
  delta: number | null;
  observations: number;
  confidence: number;
  is_reset: boolean;
  flags: string[];
};
export type Milestone = { day: string; milestone: string; play_count: number };
export type Monthly = {
  track: LookupTrack;
  rows: LookupMonth[];
  daily: LookupDaily[];
  milestones: Milestone[];
  empty: boolean;
  source_switches?: SourceSwitch[];
};
export type DaysResponse = {
  isrc: string;
  first_day: string | null;
  last_day: string | null;
  ranges: [string, string][];
};
export type ReportRow = Omit<Between, "track"> & {
  track: LookupTrack;
};
export type ArtistReport = {
  artist: string;
  from: string;
  to: string;
  art: string | null;
  rows: ReportRow[];
  total: number | null;
  counted_tracks: number;
  excluded_tracks: number;
};
export type Range = { from: string; to: string };
export type Preset =
  "Last 7 days" | "Last 30 days" | "Previous month" | "Whole history";
const dayKey = (date: Date) => date.toISOString().slice(0, 10);
export function monthRange(month: string): Range {
  const date = utcDate(month.slice(0, 7) + "-01");
  return {
    from: dayKey(date),
    to: dayKey(
      new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
    ),
  };
}
export function clampRange(range: Range, bounds: Range): Range {
  const clamp = (day: string) =>
    day < bounds.from ? bounds.from : day > bounds.to ? bounds.to : day;
  return { from: clamp(range.from), to: clamp(range.to) };
}
export function presetRange(preset: Preset, bounds: Range): Range {
  if (preset === "Whole history") return bounds;
  if (preset === "Previous month") {
    const last = utcDate(bounds.to);
    const previous = dayKey(
      new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 0)),
    );
    return clampRange(monthRange(previous), bounds);
  }
  const days = preset === "Last 7 days" ? 7 : 30;
  // Counter subtraction needs N elapsed days, rather than N inclusive readings.
  return clampRange(
    {
      from: dayKey(new Date(utcDate(bounds.to).getTime() - days * DAY_MS)),
      to: bounds.to,
    },
    bounds,
  );
}
/**
 * Two-click selection on the chart: the first click sets From (keeping To, or moving it up to
 * the same day), the second click sets To; an earlier second click swaps the two.
 */
export function pickPoint(
  first: string | null,
  day: string,
  current: Range,
): { first: string | null; range: Range } {
  if (first === null)
    return {
      first: day,
      range: { from: day, to: day > current.to ? day : current.to },
    };
  return { first: null, range: selectPoints(first, day) };
}
export function selectPoints(first: string, second: string): Range {
  return first <= second
    ? { from: first, to: second }
    : { from: second, to: first };
}
export function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${fullNumber(Math.abs(value))}`;
}
export function copyResult(result: Between): string {
  if (!result.from || !result.to || result.difference === null) return "";
  const endpoint = (r: Reading) =>
    `${fullNumber(r.streams)} on ${formatUtcDate(r.used_day)}${r.substituted ? ` (requested ${formatUtcDate(r.requested)}${r.before_tracking ? "; before tracking" : ""})` : ""}`;
  return `${result.track.artist} – ${result.track.song_name} (${result.track.isrc}): ${endpoint(result.from)} → ${endpoint(result.to)} = ${signed(result.difference)} streams`;
}
export function lookupWarnings(result: Between): string[] {
  const warnings = new Set<string>();
  for (const r of [result.from, result.to]) {
    if (!r) continue;
    if (r.before_tracking)
      warnings.add(
        `Not tracked yet on ${formatUtcDate(r.requested)} — using the first reading on ${formatUtcDate(r.used_day)}.`,
      );
    else if (r.substituted)
      warnings.add(
        `No reading on ${formatUtcDate(r.requested)} — using ${formatUtcDate(r.used_day)}.`,
      );
  }
  for (const day of result.resets)
    warnings.add(
      `Counter reset on ${formatUtcDate(day)} inside this range. The difference includes this reset.`,
    );
  if (result.gap_days)
    warnings.add(
      `${fullNumber(result.gap_days)} ${result.gap_days === 1 ? "day" : "days"} without readings inside this range (doesn't change the difference).`,
    );
  if (result.days === 0 && !result.empty)
    warnings.add(
      "Both dates use the same reading; per day is unavailable because 0 days elapsed.",
    );
  return [...warnings];
}
export const MONTH_DEFINITION =
  "Streams in month = the month-end reading minus the previous month-end reading. Missing dates use the latest earlier reading. The first tracked month starts at its first reading; the last month ends at its last reading. No interpolation.";
export function monthFlags(
  row: LookupMonth,
): { label: string; explanation: string }[] {
  const flags = [];
  if (row.partial_first_month)
    flags.push({
      label: "First month · partial",
      explanation: `Starts at the first reading on ${formatUtcDate(row.from.used_day)}.`,
    });
  if (row.partial_last_month)
    flags.push({
      label: "Last month · partial",
      explanation: `Ends at the last reading on ${formatUtcDate(row.to.used_day)}.`,
    });
  for (const side of ["from", "to"] as const)
    if (row[side].substituted)
      flags.push({
        label: `${side === "from" ? "Start" : "End"} substituted`,
        explanation: `No reading on ${formatUtcDate(row[side].requested)}; using ${formatUtcDate(row[side].used_day)}.`,
      });
  if (row.resets.length)
    flags.push({
      label: `${row.resets.length} reset${row.resets.length === 1 ? "" : "s"}`,
      explanation: row.resets.map(formatUtcDate).join(", "),
    });
  if (row.gap_days)
    flags.push({
      label: `${row.gap_days} gap days`,
      explanation: "Calendar days without readings between the used dates.",
    });
  const { notable } = switchWarnings(row.source_switches);
  if (notable.length)
    flags.push({
      label: "Counter source switch",
      explanation: notable.map(describeSwitch).join(" "),
    });
  return flags;
}
export type RecentTrack = Pick<LookupTrack, "isrc" | "song_name" | "artist"> & {
  dataset: "stats2" | "stats";
};
const RECENT_KEY = "streambase-legacy-lookup-recent";
export function readRecent(): RecentTrack[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (r): r is RecentTrack =>
              !!r &&
              typeof r.isrc === "string" &&
              typeof r.song_name === "string" &&
              typeof r.artist === "string" &&
              ["stats2", "stats"].includes(r.dataset),
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}
export function saveRecent(track: RecentTrack): RecentTrack[] {
  const recent = [
    track,
    ...readRecent().filter(
      (r) => !(r.isrc === track.isrc && r.dataset === track.dataset),
    ),
  ].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    /* Private/read-only browser storage is optional. */
  }
  return recent;
}

/** "250K" → 250000, "1.5M" → 1500000 (unknown shapes sort first). */
export function milestoneValue(label: string): number {
  const match = /^([\d.]+)\s*([KMB]?)$/i.exec(label.trim());
  if (!match) return 0;
  const scale = { "": 1, K: 1e3, M: 1e6, B: 1e9 }[match[2].toUpperCase() as "" | "K" | "M" | "B"];
  return Number(match[1]) * scale;
}
/**
 * One flag per milestone date. Same-day milestones share a flag labelled with the largest one
 * ("250K +2"); the tooltip lists each milestone, its date and the recorded count. The flag sits on
 * the cumulative curve at the reading used for that date.
 */
export function milestoneMarkers(
  milestones: Milestone[],
  daily: { day: string; streams: number }[],
  firstDay: string,
): ChartMarker[] {
  const byDay = new Map<string, Milestone[]>();
  for (const milestone of milestones)
    byDay.set(milestone.day, [...(byDay.get(milestone.day) ?? []), milestone]);
  const reading = (day: string): number | null => {
    if (!daily.length) return null;
    let low = 0,
      high = daily.length - 1,
      found = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (daily[mid].day <= day) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    return daily[found].streams;
  };
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, group]) => {
      const ranked = [...group].sort(
        (a, b) => milestoneValue(b.milestone) - milestoneValue(a.milestone),
      );
      return {
        date: day,
        label:
          ranked[0].milestone + (group.length > 1 ? ` +${group.length - 1}` : ""),
        text: [...group]
          .sort((a, b) => milestoneValue(a.milestone) - milestoneValue(b.milestone))
          .map(
            (m) =>
              `Milestone ${m.milestone} · ${formatUtcDate(day)} · ${fullNumber(m.play_count)} streams${day === firstDay ? " (logged on the first tracked day)" : ""}`,
          ),
        value: reading(day),
      };
    });
}
/** Daily net of the trailing `days` UTC days ending at the last reading; gaps stay null. */
export function sparklineSeries(
  daily: { day: string; delta: number | null }[],
  days = 30,
): (number | null)[] {
  if (!daily.length) return [];
  const last = utcDate(daily[daily.length - 1].day).getTime();
  const byDay = new Map(daily.map((r) => [r.day, r.delta]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(last - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    return byDay.get(day) ?? null;
  });
}
export type MonthBar = {
  month: string;
  label: string;
  value: number;
  flagged: boolean;
  flags: string[];
  selected: boolean;
};
/** Bars for the monthly chart, flagged months marked, months overlapping `range` selected. */
export function monthBars(rows: LookupMonth[], range: Range): MonthBar[] {
  return rows.map((row) => {
    const { from, to } = monthRange(row.month);
    const flags = monthFlags(row).map((f) => f.label);
    return {
      month: row.month,
      label: monthLabel(row.month),
      value: row.streams_in_month,
      flagged: flags.length > 0,
      flags,
      selected: range.from <= to && range.to >= from,
    };
  });
}

/**
 * Counter-source switches. The API lists every switch (a track's several Spotify IDs trade places
 * constantly, usually by a few hundred streams). The UI warns about those with |jump| at or above
 * this size and only mentions the rest as "minor".
 */
export const NOTABLE_SWITCH_JUMP = 1000;
export const isNotableSwitch = (s: SourceSwitch) =>
  Math.abs(s.jump) >= NOTABLE_SWITCH_JUMP;
export function describeSwitch(s: SourceSwitch): string {
  const higher = s.jump >= 0;
  return `On ${formatUtcDate(s.day)} this ISRC's counter switched to another Spotify release with a ${higher ? "higher" : "lower"} count (${signed(s.jump)} in one day) — this difference includes that jump, not just streams earned.`;
}
/**
 * Warning text for the switches inside a compared range: one sentence per notable switch (up to two),
 * otherwise a summary naming the largest. Minor switches are counted in `minor`, never silenced.
 */
export function switchWarnings(switches: readonly SourceSwitch[] | undefined): {
  notable: SourceSwitch[];
  minor: number;
  lines: string[];
} {
  const all = switches ?? [];
  const notable = all.filter(isNotableSwitch);
  const minor = all.length - notable.length;
  if (notable.length === 0) return { notable, minor, lines: [] };
  if (notable.length <= 2)
    return { notable, minor, lines: notable.map(describeSwitch) };
  const largest = notable.reduce((a, b) =>
    Math.abs(b.jump) > Math.abs(a.jump) ? b : a,
  );
  const net = notable.reduce((sum, s) => sum + s.jump, 0);
  return {
    notable,
    minor,
    lines: [
      `${notable.length} counter-source switches between Spotify releases inside this range (largest ${signed(largest.jump)} on ${formatUtcDate(largest.day)}; ${signed(net)} together) — this difference includes those jumps, not just streams earned.`,
    ],
  };
}
/** Chart markers for notable switches: a dashed vertical line with the day's jump in the tooltip. */
export function switchLines(
  switches: readonly SourceSwitch[] | undefined,
  max = 12,
): { date: string; text: string }[] {
  return [...(switches ?? [])]
    .filter(isNotableSwitch)
    .sort((a, b) => Math.abs(b.jump) - Math.abs(a.jump))
    .slice(0, max)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((s) => ({
      date: s.day,
      text: `Counter source switched on ${formatUtcDate(s.day)} (${signed(s.jump)} in one day)`,
    }));
}

const BASE_THRESHOLDS = [
  1e5, 1.5e5, 2e5, 2.5e5, 3e5, 4e5, 5e5, 6e5, 7e5, 7.5e5, 8e5, 9e5, 1e6, 1.5e6,
  2e6, 2.5e6, 3e6, 4e6, 5e6, 6e6, 7e6, 8e6, 9e6, 1e7,
];
/** 100K … 10M as listed by the owner, then every further 5M up to `max`. */
export function milestoneThresholds(max: number): number[] {
  const out = BASE_THRESHOLDS.filter((t) => t <= max);
  for (let t = 1.5e7; t <= max; t += 5e6) out.push(t);
  return out;
}
export function thresholdLabel(value: number): string {
  if (value >= 1e6) return `${Number((value / 1e6).toFixed(2))}M`;
  return `${Number((value / 1e3).toFixed(0))}K`;
}
/**
 * Milestones derived from the track's OWN cumulative series: for each threshold the first reading with
 * streams >= threshold. Thresholds already exceeded on the first tracked day are not flagged; they are
 * listed in `alreadyPast`. The flag value is that day's reading, so flags sit on the line.
 * Same-day thresholds share one flag ("250K +1").
 */
export function ownMilestones(daily: { day: string; streams: number }[]): {
  markers: ChartMarker[];
  alreadyPast: string[];
} {
  if (!daily.length) return { markers: [], alreadyPast: [] };
  const first = daily[0].streams;
  const top = daily.reduce((m, r) => Math.max(m, r.streams), 0);
  const alreadyPast: string[] = [];
  const byDay = new Map<string, { label: string; value: number; streams: number }[]>();
  for (const threshold of milestoneThresholds(top)) {
    const label = thresholdLabel(threshold);
    if (first >= threshold) {
      alreadyPast.push(label);
      continue;
    }
    const hit = daily.find((r) => r.streams >= threshold);
    if (!hit) continue;
    byDay.set(hit.day, [
      ...(byDay.get(hit.day) ?? []),
      { label, value: threshold, streams: hit.streams },
    ]);
  }
  const markers = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, group]) => ({
      date: day,
      label:
        group[group.length - 1].label +
        (group.length > 1 ? ` +${group.length - 1}` : ""),
      text: group.map(
        (m) =>
          `${m.label} · first reading at or above ${fullNumber(m.value)} · ${formatUtcDate(day)} (${fullNumber(m.streams)})`,
      ),
      value: group[0].streams,
    }));
  return { markers, alreadyPast };
}

export type LastLookup = {
  dataset: "stats2" | "stats";
  isrc: string;
  from: string;
  to: string;
};
const LAST_KEY = "streambase-legacy-lookup-last";
const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export function readLast(): LastLookup | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LAST_KEY) || "null");
    if (
      v &&
      typeof v === "object" &&
      "isrc" in v &&
      "dataset" in v &&
      "from" in v &&
      "to" in v &&
      typeof v.isrc === "string" &&
      v.isrc &&
      (v.dataset === "stats2" || v.dataset === "stats") &&
      isDay(v.from) &&
      isDay(v.to)
    )
      return { dataset: v.dataset, isrc: v.isrc, from: v.from, to: v.to };
  } catch {
    /* unreadable storage means "nothing remembered" */
  }
  return null;
}
export function saveLast(last: LastLookup): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(last));
  } catch {
    /* optional */
  }
}
/** Hash to open on launch when none is given, or null (no memory / hash already set). */
export function launchHash(hash: string, last: LastLookup | null): string | null {
  if (!last || !["", "#", "#/"].includes(hash)) return null;
  const query = new URLSearchParams({
    isrc: last.isrc,
    dataset: last.dataset,
    from: last.from,
    to: last.to,
  });
  return `#/lookup?${query}`;
}

/** Badge for a substituted reading (no reading that day / before tracking), or null when exact. */
export function readingFlag(
  r: Reading | null,
): { label: string; title: string } | null {
  if (!r?.substituted) return null;
  return r.before_tracking
    ? {
        label: "before tracking",
        title: `Not tracked yet on ${formatUtcDate(r.requested)}; using the first reading on ${formatUtcDate(r.used_day)}.`,
      }
    : {
        label: `used ${formatUtcDate(r.used_day)}`,
        title: `No reading on ${formatUtcDate(r.requested)}; using the latest earlier reading on ${formatUtcDate(r.used_day)}.`,
      };
}
/** Notes for one artist-report row: empty range, resets, gap days, counter-source switches. */
export function reportNotes(
  row: Pick<Between, "empty" | "resets" | "gap_days" | "source_switches">,
): { label: string; title: string }[] {
  const notes: { label: string; title: string }[] = [];
  if (row.empty)
    notes.push({
      label: "no reading in range",
      title:
        "This track has no reading inside these dates; it is left out of the total (never counted as zero).",
    });
  if (row.resets.length)
    notes.push({
      label: `${row.resets.length} reset${row.resets.length === 1 ? "" : "s"}`,
      title: `Counter reset on ${row.resets.map(formatUtcDate).join(", ")}; the difference includes it.`,
    });
  if (row.gap_days)
    notes.push({
      label: `${row.gap_days} gap days`,
      title: "Calendar days without readings between the used dates.",
    });
  const { notable, minor } = switchWarnings(row.source_switches);
  if (notable.length)
    notes.push({
      label: "source switch",
      title: notable.map(describeSwitch).join(" "),
    });
  else if (minor)
    notes.push({
      label: `${minor} minor switch${minor === 1 ? "" : "es"}`,
      title: "The counter moved between Spotify releases by under 1,000 streams.",
    });
  return notes;
}
export type ReportSortKey = "title" | "from" | "to" | "difference" | "per_day";
/** Client-side sort of report rows; missing values always last. */
export function sortReport(
  rows: ReportRow[],
  key: ReportSortKey,
  direction: "asc" | "desc",
): ReportRow[] {
  const value = (r: ReportRow): number | string | null =>
    key === "title"
      ? r.track.song_name.toLowerCase()
      : key === "from"
        ? (r.from?.streams ?? null)
        : key === "to"
          ? (r.to?.streams ?? null)
          : key === "difference"
            ? r.difference
            : r.per_day;
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a),
      y = value(b);
    if (x === null && y === null) return a.track.isrc.localeCompare(b.track.isrc);
    if (x === null) return 1;
    if (y === null) return -1;
    const order = x < y ? -1 : x > y ? 1 : 0;
    return order * sign || a.track.isrc.localeCompare(b.track.isrc);
  });
}
