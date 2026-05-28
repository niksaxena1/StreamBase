import type { LabelComparisonRow, LabelDailyPoint, LabelRow } from "@/app/(main-flat)/competitors/competitorsTypes";
import { dataDateFromRunDate } from "@/lib/sotDates";

import type { PlaylistStatSnapshot } from "@/app/(main-flat)/competitors/competitorsUtils";
import { parseCount, sumLabelAtDataDate } from "@/app/(main-flat)/competitors/competitorsUtils";

export const OWN_CATALOG_LABEL_KEY = "__own_catalog__";
export const OWN_CATALOG_PLAYLIST_KEY = "all_catalog";

export type OwnOverlapCell = {
  competitor_label_key: string;
  shared_count: number;
  own_catalog_total: number;
  competitor_total: number;
  jaccard: number;
};

export function ownCatalogLabelRow(): LabelRow {
  return {
    label_key: OWN_CATALOG_LABEL_KEY,
    display_name: "Own Catalog",
    is_active: true,
    accent_hex: "c7f33c",
  };
}

export function isOwnCatalogLabelKey(labelKey: string): boolean {
  return labelKey === OWN_CATALOG_LABEL_KEY;
}

type CatalogSeriesRow = {
  date: string;
  daily_streams_net: number | null;
  total_streams_cumulative: number | null;
  track_count: number | null;
};

export function mapOwnCatalogSeries(rows: CatalogSeriesRow[]): LabelDailyPoint[] {
  return rows
    .map((row) => ({
      date: dataDateFromRunDate(String(row.date).slice(0, 10)),
      label_key: OWN_CATALOG_LABEL_KEY,
      daily_streams_net: Number(row.daily_streams_net ?? 0),
      total_streams_cumulative: Number(row.total_streams_cumulative ?? 0),
      track_count: Number(row.track_count ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function rollingAvg7(values: number[]): number | null {
  if (values.length === 0) return null;
  const window = values.slice(-7);
  const sum = window.reduce((s, v) => s + v, 0);
  return sum / window.length;
}

export function buildOwnCatalogComparisonRow(args: {
  labelSeries: LabelDailyPoint[];
  latestDataDate: string | null;
  previousDataDate: string | null;
  weekAgoDataDate: string | null;
  statsByDataDate: Map<string, Map<string, PlaylistStatSnapshot>>;
  artistCountLatest: number;
  artistCountPrevious: number;
  artistCountWeekAgo: number;
}): LabelComparisonRow {
  const {
    labelSeries,
    latestDataDate,
    previousDataDate,
    weekAgoDataDate,
    statsByDataDate,
    artistCountLatest,
    artistCountPrevious,
    artistCountWeekAgo,
  } = args;

  const keys = [OWN_CATALOG_PLAYLIST_KEY];
  const trackCount = sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "track_count") ?? 0;
  const previousTrackCount = sumLabelAtDataDate(keys, previousDataDate, statsByDataDate, "track_count");
  const totalStreams =
    sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "total_streams_cumulative") ?? 0;
  const dailyStreams = sumLabelAtDataDate(keys, latestDataDate, statsByDataDate, "daily_streams_net") ?? 0;
  const previousDailyStreams = sumLabelAtDataDate(keys, previousDataDate, statsByDataDate, "daily_streams_net");
  const weekAgoTrackCount = sumLabelAtDataDate(keys, weekAgoDataDate, statsByDataDate, "track_count");

  const series = labelSeries
    .filter((p) => p.label_key === OWN_CATALOG_LABEL_KEY)
    .sort((a, b) => a.date.localeCompare(b.date));
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
    label: ownCatalogLabelRow(),
    playlistCount: 2,
    trackCount,
    artistCount: artistCountLatest,
    totalStreams,
    dailyStreams,
    dailyMa7,
    dailyYesterday,
    trackDelta: hasPreviousSnapshots ? trackCount - previousTrackCount! : null,
    trackWeeklyDelta: labelHasWeekAgoSnapshots ? trackCount - weekAgoTrackCount! : null,
    artistDelta: previousDataDate != null ? artistCountLatest - artistCountPrevious : null,
    artistWeeklyDelta: labelHasWeekAgoSnapshots ? artistCountLatest - artistCountWeekAgo : null,
    dailyStreamDelta: previousDailyStreams != null ? dailyStreams - previousDailyStreams : null,
    sparkline,
  };
}

export function buildOwnOverlapLookup(cells: OwnOverlapCell[]): Map<string, OwnOverlapCell> {
  const map = new Map<string, OwnOverlapCell>();
  for (const cell of cells) {
    map.set(cell.competitor_label_key, cell);
  }
  return map;
}

export function mergeCatalogStatsIntoByDataDate(
  statsByDataDate: Map<string, Map<string, PlaylistStatSnapshot>>,
  rows: Array<{
    playlist_key: string;
    date: string;
    track_count: number | null;
    total_streams_cumulative: number | null;
    missing_streams_track_count?: number | null;
    daily_streams_net: number | null;
  }>,
): void {
  for (const row of rows) {
    const dataDate = dataDateFromRunDate(row.date.slice(0, 10));
    const byPlaylist = statsByDataDate.get(dataDate) ?? new Map<string, PlaylistStatSnapshot>();
    byPlaylist.set(row.playlist_key, {
      date: dataDate,
      track_count: row.track_count,
      total_streams_cumulative: row.total_streams_cumulative,
      missing_streams_track_count: row.missing_streams_track_count ?? null,
      daily_streams_net: row.daily_streams_net,
    });
    statsByDataDate.set(dataDate, byPlaylist);
  }
}

export function lookupOwnOverlap(
  lookup: Map<string, OwnOverlapCell>,
  competitorLabelKey: string,
): OwnOverlapCell | null {
  return lookup.get(competitorLabelKey) ?? null;
}

export function parseOwnOverlapCells(raw: unknown): OwnOverlapCell[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      competitor_label_key: String(r.competitor_label_key ?? ""),
      shared_count: parseCount(r.shared_count as number | string | null | undefined),
      own_catalog_total: parseCount(r.own_catalog_total as number | string | null | undefined),
      competitor_total: parseCount(r.competitor_total as number | string | null | undefined),
      jaccard: Number(r.jaccard ?? 0),
    };
  });
}
