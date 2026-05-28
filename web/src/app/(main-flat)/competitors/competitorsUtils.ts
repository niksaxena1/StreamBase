import type { CSSProperties } from "react";

import { formatInt } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";

import {
  FALLBACK_LABEL_COLORS,
  sanitizeAccentHex,
} from "@/lib/competitorLabelAccents";
import { isOwnCatalogLabelKey, OWN_CATALOG_PLAYLIST_KEY } from "@/lib/competitors/ownCatalog";

import type {
  ChurnRow,
  LabelComparisonRow,
  LabelDailyPoint,
  LabelRow,
  OverlapArtistCell,
  OverlapCell,
  PlaylistRow,
} from "./competitorsTypes";

export { FALLBACK_LABEL_COLORS, sanitizeAccentHex };

export type PlaylistStatSnapshot = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  missing_streams_track_count: number | null;
  daily_streams_net: number | null;
};

export type AnchoredStatRow = {
  playlist_key: string;
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  missing_streams_track_count: number | null;
  daily_streams_net: number | null;
};

export type StatsAsOfRow = AnchoredStatRow;

export function labelColor(label: LabelRow, index: number): string {
  if (isOwnCatalogLabelKey(label.label_key)) {
    return sanitizeAccentHex(label.accent_hex) ?? "var(--sb-accent)";
  }
  return sanitizeAccentHex(label.accent_hex) ?? FALLBACK_LABEL_COLORS[index % FALLBACK_LABEL_COLORS.length];
}

export function labelSummaryCardStyle(accentHex: string | null): CSSProperties {
  const clean = sanitizeAccentHex(accentHex)?.replace(/^#/, "");
  if (!clean) {
    return { borderLeft: "3px solid var(--sb-border)" };
  }
  return {
    borderLeft: `3px solid #${clean}`,
    background: `color-mix(in srgb, #${clean} 10%, transparent)`,
  };
}

export function parseCount(value: number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export function buildStatsByDataDate(
  rows: AnchoredStatRow[],
): Map<string, Map<string, PlaylistStatSnapshot>> {
  const byDataDate = new Map<string, Map<string, PlaylistStatSnapshot>>();
  for (const row of rows) {
    const dataDate = dataDateFromRunDate(row.date.slice(0, 10));
    const byPlaylist = byDataDate.get(dataDate) ?? new Map<string, PlaylistStatSnapshot>();
    byPlaylist.set(row.playlist_key, {
      date: dataDate,
      track_count: row.track_count,
      total_streams_cumulative: row.total_streams_cumulative,
      missing_streams_track_count: row.missing_streams_track_count,
      daily_streams_net: row.daily_streams_net,
    });
    byDataDate.set(dataDate, byPlaylist);
  }
  return byDataDate;
}

export function sumLabelAtDataDate(
  playlistKeys: string[],
  dataDate: string | null,
  statsByDataDate: Map<string, Map<string, PlaylistStatSnapshot>>,
  field: "track_count" | "daily_streams_net" | "total_streams_cumulative",
): number | null {
  if (!dataDate) return null;
  const byPlaylist = statsByDataDate.get(dataDate);
  if (!byPlaylist) return null;
  let sum = 0;
  let found = false;
  for (const key of playlistKeys) {
    const snap = byPlaylist.get(key);
    if (!snap) continue;
    found = true;
    const raw = snap[field];
    if (typeof raw === "number" && Number.isFinite(raw)) sum += raw;
  }
  return found ? sum : null;
}

export function formatDelta(delta: number | null): string | null {
  if (delta == null || delta === 0) return null;
  return `${delta > 0 ? "+" : ""}${formatInt(delta)}`;
}

export function deltaColor(delta: number | null): string {
  if (delta == null || delta === 0) return "var(--sb-muted)";
  if (delta > 0) return "var(--sb-positive)";
  return "var(--sb-negative, #ef4444)";
}

export function aggregateSeriesByLabel(
  rows: Array<{
    date: string;
    playlist_key: string;
    daily_streams_net: number | null;
    total_streams_cumulative: number | null;
    track_count: number | null;
  }>,
  playlistToLabel: Map<string, string>,
): LabelDailyPoint[] {
  const acc = new Map<string, LabelDailyPoint>();
  for (const row of rows) {
    const labelKey = playlistToLabel.get(row.playlist_key);
    if (!labelKey) continue;
    const dataDate = dataDateFromRunDate(row.date.slice(0, 10));
    const k = `${dataDate}|${labelKey}`;
    const prev =
      acc.get(k) ??
      ({
        date: dataDate,
        label_key: labelKey,
        daily_streams_net: 0,
        total_streams_cumulative: 0,
        track_count: 0,
      } satisfies LabelDailyPoint);
    prev.daily_streams_net += Number(row.daily_streams_net ?? 0);
    prev.total_streams_cumulative += Number(row.total_streams_cumulative ?? 0);
    prev.track_count += Number(row.track_count ?? 0);
    acc.set(k, prev);
  }
  return [...acc.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function dailySeriesForLabel(labelSeries: LabelDailyPoint[], labelKey: string): LabelDailyPoint[] {
  return labelSeries.filter((p) => p.label_key === labelKey).sort((a, b) => a.date.localeCompare(b.date));
}

function rollingAvg7(values: number[]): number | null {
  if (values.length === 0) return null;
  const window = values.slice(-7);
  const sum = window.reduce((s, v) => s + v, 0);
  return sum / window.length;
}

export function buildLabelComparisonRows(args: {
  labels: LabelRow[];
  playlistsByLabel: Map<string, PlaylistRow[]>;
  labelSeries: LabelDailyPoint[];
  latestDataDate: string | null;
  previousDataDate: string | null;
  weekAgoDataDate: string | null;
  statsByDataDate: Map<string, Map<string, PlaylistStatSnapshot>>;
  artistCountByLabel: Map<string, number>;
  previousArtistCountByLabel: Map<string, number>;
  weekAgoArtistCountByLabel: Map<string, number>;
}): LabelComparisonRow[] {
  const {
    labels,
    playlistsByLabel,
    labelSeries,
    latestDataDate,
    previousDataDate,
    weekAgoDataDate,
    statsByDataDate,
    artistCountByLabel,
    previousArtistCountByLabel,
    weekAgoArtistCountByLabel,
  } = args;

  return labels.map((label) => {
    const labelPlaylists = playlistsByLabel.get(label.label_key) ?? [];
    const keys = labelPlaylists.map((p) => p.playlist_key);
    const trackCount = sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "track_count") ?? 0;
    const previousTrackCount = sumLabelAtDataDate(keys, previousDataDate, statsByDataDate, "track_count");
    const totalStreams =
      sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "total_streams_cumulative") ?? 0;
    const dailyStreams = sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "daily_streams_net") ?? 0;
    const previousDailyStreams = sumLabelAtDataDate(keys, previousDataDate, statsByDataDate, "daily_streams_net");
    const weekAgoTrackCount = sumLabelAtDataDate(keys, weekAgoDataDate, statsByDataDate, "track_count");
    const artistCount = artistCountByLabel.get(label.label_key) ?? 0;
    const previousArtistCount = previousArtistCountByLabel.get(label.label_key) ?? 0;
    const weekAgoArtistCount = weekAgoArtistCountByLabel.get(label.label_key) ?? 0;

    const series = dailySeriesForLabel(labelSeries, label.label_key);
    const dailyValues = series.map((p) => p.daily_streams_net);
    const sparkline = dailyValues.slice(-30);

    const latestPoint = latestDataDate ? series.find((p) => p.date === latestDataDate) : undefined;
    const previousPoint = previousDataDate ? series.find((p) => p.date === previousDataDate) : undefined;

    const dailyYesterday =
      latestPoint && previousPoint != null ? previousPoint.daily_streams_net : null;

    const valuesBeforeLatest = latestDataDate
      ? series.filter((p) => p.date < latestDataDate).map((p) => p.daily_streams_net)
      : [];
    const dailyMa7 = rollingAvg7(valuesBeforeLatest);

    const hasPreviousSnapshots = previousTrackCount != null;
    const labelHasWeekAgoSnapshots = weekAgoTrackCount != null;

    return {
      label,
      playlistCount: labelPlaylists.length,
      trackCount,
      artistCount,
      totalStreams,
      dailyStreams,
      dailyMa7,
      dailyYesterday,
      trackDelta: hasPreviousSnapshots ? trackCount - previousTrackCount! : null,
      trackWeeklyDelta: labelHasWeekAgoSnapshots ? trackCount - weekAgoTrackCount! : null,
      artistDelta: previousDataDate != null ? artistCount - previousArtistCount : null,
      artistWeeklyDelta: labelHasWeekAgoSnapshots ? artistCount - weekAgoArtistCount : null,
      dailyStreamDelta: previousDailyStreams != null ? dailyStreams - previousDailyStreams : null,
      sparkline,
    };
  });
}

export function canonicalOverlapKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildOverlapLookup(cells: OverlapCell[]): Map<string, OverlapCell> {
  const map = new Map<string, OverlapCell>();
  for (const cell of cells) {
    map.set(canonicalOverlapKey(cell.label_a, cell.label_b), cell);
  }
  return map;
}

export function lookupOverlap(
  lookup: Map<string, OverlapCell>,
  labelA: string,
  labelB: string,
): OverlapCell | null {
  if (labelA === labelB) return null;
  return lookup.get(canonicalOverlapKey(labelA, labelB)) ?? null;
}

export function buildOverlapArtistLookup(cells: OverlapArtistCell[]): Map<string, OverlapArtistCell> {
  const map = new Map<string, OverlapArtistCell>();
  for (const cell of cells) {
    map.set(canonicalOverlapKey(cell.label_a, cell.label_b), cell);
  }
  return map;
}

export function lookupOverlapArtist(
  lookup: Map<string, OverlapArtistCell>,
  labelA: string,
  labelB: string,
): OverlapArtistCell | null {
  if (labelA === labelB) return null;
  return lookup.get(canonicalOverlapKey(labelA, labelB)) ?? null;
}

export function enrichChurnRows(
  rows: Array<{ label_key: string; added_count: number; removed_count: number; net: number }>,
  playlistsByLabel: Map<string, PlaylistRow[]>,
  statsByDataDate: ReturnType<typeof buildStatsByDataDate>,
  latestDataDate: string | null,
  weekAgoDataDate: string | null,
): ChurnRow[] {
  return rows.map((row) => {
    const keys = isOwnCatalogLabelKey(row.label_key)
      ? [OWN_CATALOG_PLAYLIST_KEY]
      : (playlistsByLabel.get(row.label_key) ?? []).map((p) => p.playlist_key);
    const latest = sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "track_count");
    const weekAgo = sumLabelAtDataDate(keys, weekAgoDataDate, statsByDataDate, "track_count");
    const track_count_delta_7d =
      latest != null && weekAgo != null ? latest - weekAgo : null;
    return { ...row, track_count_delta_7d };
  });
}
