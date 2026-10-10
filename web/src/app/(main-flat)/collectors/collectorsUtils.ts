import type { Granularity } from "@/components/ui/GranularitySelect";
import type { CollectorDailyData } from "@/components/charts/CollectorComparisonChart";
import {
  computeDailyRollingAvg7,
  computeRollingAvg7,
  filterDailySeriesFromIsoDate,
} from "@/components/charts/chartUtils";
import { COLLECTOR_ORDER } from "./collectorsTypes";
import type {
  CollectorOverlapArtistCell,
  CollectorOverlapCell,
  CollectorSeriesPoint,
  CollectorTrackRow,
  DrillKind,
  DrillPlaylistItem,
  DrillArtistItem,
  DrillTrackItem,
  Metric,
  TrackSort,
} from "./collectorsTypes";

export type CollectorPlaylistScopeRow = {
  playlist_key: string;
  display_name: string;
  collector: string | null;
  spotify_playlist_image_url: string | null;
};

const ENTITY_PLAYLIST_BY_COLLECTOR: Record<string, string> = {
  PL: "p_total",
  TG: "tg_total",
};

export function getEffectiveCollectorPlaylists(
  playlists: CollectorPlaylistScopeRow[],
  collector: string,
  useEntityPlaylistsForTotals: boolean,
): CollectorPlaylistScopeRow[] {
  const normalizedCollector = collector.trim().toUpperCase();
  const entityPlaylistKey = ENTITY_PLAYLIST_BY_COLLECTOR[normalizedCollector];

  if (useEntityPlaylistsForTotals && entityPlaylistKey) {
    const entityPlaylist = playlists.find((p) => p.playlist_key === entityPlaylistKey);
    if (entityPlaylist) {
      return [{
        ...entityPlaylist,
        collector: normalizedCollector,
      }];
    }
  }

  return playlists.filter((p) => (p.collector ?? "").toUpperCase() === normalizedCollector);
}

export function parseDrillPlaylistItem(x: unknown): DrillPlaylistItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const key = String(o.playlist_key ?? "").trim();
  if (!key) return null;
  return {
    playlist_key: key,
    display_name: String(o.display_name ?? key),
    spotify_playlist_image_url: (o.spotify_playlist_image_url ?? null) as string | null,
    playlist_type: (o.playlist_type ?? null) as string | null,
    track_count: Number(o.track_count ?? 0) || 0,
    total_streams_cumulative:
      o.total_streams_cumulative == null ? null : Number(o.total_streams_cumulative),
    daily_streams_net: o.daily_streams_net == null ? null : Number(o.daily_streams_net),
    est_revenue_total: o.est_revenue_total == null ? null : Number(o.est_revenue_total),
    est_revenue_daily_net:
      o.est_revenue_daily_net == null ? null : Number(o.est_revenue_daily_net),
  };
}

export function parseDrillArtistItem(x: unknown): DrillArtistItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const id = String(o.artist_id ?? "").trim();
  if (!id) return null;
  return {
    artist_id: id,
    name: (o.name ?? null) as string | null,
    image_url: (o.image_url ?? null) as string | null,
    track_count: Number(o.track_count ?? 0) || 0,
    total_streams_cumulative: Number(o.total_streams_cumulative ?? 0) || 0,
    daily_streams_delta: Number(o.daily_streams_delta ?? 0) || 0,
  };
}

export function parseDrillTrackItem(x: unknown): DrillTrackItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const isrc = String(o.isrc ?? "").trim();
  if (!isrc) return null;
  return {
    isrc,
    name: (o.name ?? null) as string | null,
    album_image_url: (o.album_image_url ?? null) as string | null,
    artist_names: (o.artist_names ?? null) as string[] | null,
    artist_ids: (o.artist_ids ?? null) as string[] | null,
    total_streams_cumulative:
      o.total_streams_cumulative == null ? null : Number(o.total_streams_cumulative),
    daily_streams_delta:
      o.daily_streams_delta == null ? null : Number(o.daily_streams_delta),
  };
}

function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

function getQuarter(date: Date): { year: number; quarter: number } {
  return { year: date.getFullYear(), quarter: Math.floor(date.getMonth() / 3) + 1 };
}

export function aggregateByGranularity(
  data: CollectorDailyData[],
  granularity: Granularity,
  selectedCollectors: string[],
  payoutPerStreamUsd: number,
): CollectorDailyData[] {
  if (granularity === "daily") return data;

  const buckets = new Map<
    string,
    Map<
      string,
      {
        streams: number;
        revenue: number;
        firstTrackCount: number;
        lastTrackCount: number;
        lastDate: string;
      }
    >
  >();

  for (const row of data) {
    if (!selectedCollectors.includes(row.collector)) continue;

    const date = new Date(row.date);
    let bucketKey: string;

    switch (granularity) {
      case "weekly": {
        const { year, week } = getISOWeek(date);
        bucketKey = `${year}-W${String(week).padStart(2, "0")}`;
        break;
      }
      case "monthly":
        bucketKey = row.date.substring(0, 7);
        break;
      case "quarterly": {
        const { year, quarter } = getQuarter(date);
        bucketKey = `Q${quarter} ${year}`;
        break;
      }
      case "yearly":
        bucketKey = row.date.substring(0, 4);
        break;
      default:
        bucketKey = row.date;
    }

    const collectorKey = `${row.collector}|${bucketKey}`;

    if (!buckets.has(collectorKey)) {
      buckets.set(collectorKey, new Map());
    }

    const existing = buckets.get(collectorKey)!.get(bucketKey);
    if (!existing) {
      buckets.get(collectorKey)!.set(bucketKey, {
        streams: Number(row.daily_streams_net ?? 0),
        revenue: Number(row.daily_streams_net ?? 0) * payoutPerStreamUsd,
        firstTrackCount: Number(row.track_count ?? 0),
        lastTrackCount: Number(row.track_count ?? 0),
        lastDate: row.date,
      });
    } else {
      existing.streams += Number(row.daily_streams_net ?? 0);
      existing.revenue += Number(row.daily_streams_net ?? 0) * payoutPerStreamUsd;
      if (row.date > existing.lastDate) {
        existing.lastTrackCount = Number(row.track_count ?? 0);
        existing.lastDate = row.date;
      }
    }
  }

  const result: CollectorDailyData[] = [];

  for (const [collectorKey, bucketMap] of buckets) {
    const collector = collectorKey.split("|")[0];

    for (const [bucketKey, values] of bucketMap) {
      result.push({
        date: bucketKey,
        collector,
        daily_streams_net: values.streams,
        est_revenue_daily_net: values.revenue,
        track_count: values.lastTrackCount - values.firstTrackCount,
      });
    }
  }

  result.sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

export function aggregateMonthlyDelta(
  seriesDesc: CollectorSeriesPoint[],
  metric: "revenue" | "streams" | "tracks",
  payoutPerStreamUsd: number,
): Array<{
  month: string;
  value: number;
  projectedExtra?: number;
  projectedTotal?: number;
  daysWithData?: number;
  totalDaysInMonth?: number;
}> {
  const asc = [...seriesDesc].reverse();

  const monthlyMap = new Map<string, number>();
  const daysPerMonth = new Map<string, Set<string>>();

  for (let i = 0; i < asc.length; i++) {
    const cur = asc[i];
    const curDataDate = cur.date;
    const curMonth = curDataDate.substring(0, 7);

    if (!daysPerMonth.has(curMonth)) daysPerMonth.set(curMonth, new Set());
    daysPerMonth.get(curMonth)!.add(curDataDate);

    const prev = i > 0 ? asc[i - 1] : null;

    let delta = 0;
    if (metric === "revenue") {
      const curTotal = Number(cur.total_streams_cumulative ?? 0);
      const prevTotal = prev ? Number(prev.total_streams_cumulative ?? 0) : curTotal;
      const dailyStreams = i > 0 ? Math.max(0, curTotal - prevTotal) : 0;
      delta = dailyStreams * payoutPerStreamUsd;
    } else if (metric === "streams") {
      const curTotal = Number(cur.total_streams_cumulative ?? 0);
      const prevTotal = prev ? Number(prev.total_streams_cumulative ?? 0) : curTotal;
      delta = i > 0 ? Math.max(0, curTotal - prevTotal) : 0;
    } else if (metric === "tracks") {
      const curTracks = Number(cur.track_count ?? 0);
      const prevTracks = prev ? Number(prev.track_count ?? 0) : 0;
      delta = curTracks - prevTracks;
    }

    const current = monthlyMap.get(curMonth) ?? 0;
    monthlyMap.set(curMonth, current + delta);
  }

  const result: Array<{
    month: string;
    value: number;
    projectedExtra?: number;
    projectedTotal?: number;
    daysWithData?: number;
    totalDaysInMonth?: number;
  }> = Array.from(monthlyMap.entries())
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  if (metric !== "tracks" && result.length > 0) {
    const last = result[result.length - 1];
    const [yearStr, monthStr] = last.month.split("-");
    const totalDays = new Date(Number(yearStr), Number(monthStr), 0).getDate();
    const daysWithData = daysPerMonth.get(last.month)?.size ?? 0;

    if (daysWithData > 0 && daysWithData < totalDays && last.value > 0) {
      const projected = (last.value / daysWithData) * totalDays;
      last.projectedExtra = Math.max(0, projected - last.value);
      last.projectedTotal = projected;
      last.daysWithData = daysWithData;
      last.totalDaysInMonth = totalDays;
    }
  }

  return result;
}

export function formatMonthLong(monthKey: string): string {
  const d = new Date(`${monthKey}-01T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return monthKey;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function parseCollectorOverlapCells(raw: unknown): CollectorOverlapCell[] {
  return ((raw ?? []) as Record<string, unknown>[]).map((row) => ({
    collector_a: String(row.collector_a ?? "").trim().toUpperCase(),
    collector_b: String(row.collector_b ?? "").trim().toUpperCase(),
    shared_isrcs: Number(row.shared_isrcs ?? 0),
    collector_a_total: Number(row.collector_a_total ?? 0),
    collector_b_total: Number(row.collector_b_total ?? 0),
    jaccard: Number(row.jaccard ?? 0),
  }));
}

export function parseCollectorOverlapArtistCells(raw: unknown): CollectorOverlapArtistCell[] {
  return ((raw ?? []) as Record<string, unknown>[]).map((row) => ({
    collector_a: String(row.collector_a ?? "").trim().toUpperCase(),
    collector_b: String(row.collector_b ?? "").trim().toUpperCase(),
    shared_artists: Number(row.shared_artists ?? 0),
    collector_a_total: Number(row.collector_a_total ?? 0),
    collector_b_total: Number(row.collector_b_total ?? 0),
    jaccard: Number(row.jaccard ?? 0),
  }));
}

/** Per-collector daily sparklines (last 30 points) for the comparison table. */
export function buildCollectorSparklines(
  allCollectorsSeries: CollectorDailyData[],
  chartStartDateIso: string,
  streamPayoutPerStreamUsd: number,
) {
  const filtered = filterDailySeriesFromIsoDate(allCollectorsSeries ?? [], chartStartDateIso);
  const byCollector = new Map<string, CollectorDailyData[]>();
  for (const row of filtered) {
    const c = String(row.collector ?? "").trim();
    const d = String(row.date ?? "").trim();
    if (!c || !d) continue;
    const arr = byCollector.get(c) ?? [];
    arr.push(row);
    byCollector.set(c, arr);
  }
  for (const [c, arr] of byCollector) {
    arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    byCollector.set(c, arr);
  }

  const build = (collector: string) => {
    const rows = byCollector.get(collector) ?? [];
    if (!rows.length) return { streams: null as number[] | null, revenue: null as number[] | null, tracks: null as number[] | null };

    const streams = rows.map((r) => Number(r.daily_streams_net ?? 0)).filter((n) => Number.isFinite(n));
    // Derived from the configured payout rate rather than the stored
    // est_revenue_* columns so a changed Settings rate applies here too.
    const revenue = rows
      .map((r) => {
        const n = Number(r.daily_streams_net ?? 0) * streamPayoutPerStreamUsd;
        return Number.isFinite(n) ? n : null;
      })
      .filter((n): n is number => n !== null);

    const tracksDelta: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const cur = Number(rows[i].track_count ?? 0);
      const prev = Number(rows[i - 1].track_count ?? 0);
      const d = Number.isFinite(cur) && Number.isFinite(prev) ? cur - prev : 0;
      tracksDelta.push(d);
    }

    const takeLast = (arr: number[]) => (arr.length > 30 ? arr.slice(arr.length - 30) : arr);
    return {
      streams: takeLast(streams),
      revenue: takeLast(revenue),
      tracks: takeLast(tracksDelta),
    };
  };

  const out = new Map<string, { streams: number[] | null; revenue: number[] | null; tracks: number[] | null }>();
  for (const c of COLLECTOR_ORDER) {
    out.set(c, build(c));
  }
  for (const c of byCollector.keys()) {
    if (!out.has(c)) out.set(c, build(c));
  }
  return out;
}

/** Selected-collector revenue / streams / tracks series (cumulative + daily, with MA7), newest first. */
export function buildCollectorMetricSeries(seriesDesc: CollectorSeriesPoint[], streamPayoutPerStreamUsd: number) {
  const datesDesc = seriesDesc.map((p) => p.date);

  const revenueTotalDesc = datesDesc.map((d, i) => ({
    date: d,
    value: Number(seriesDesc[i]?.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd,
  }));
  const revenueDailyDesc = datesDesc.map((d, i) => {
    const curTotal = Number(seriesDesc[i]?.total_streams_cumulative ?? 0);
    const prevTotal =
      i + 1 < seriesDesc.length
        ? Number(seriesDesc[i + 1]?.total_streams_cumulative ?? 0)
        : curTotal;
    if (i + 1 >= seriesDesc.length) return { date: d, daily: null };
    const dailyStreams = Math.max(0, curTotal - prevTotal);
    return { date: d, daily: dailyStreams * streamPayoutPerStreamUsd };
  });

  const streamsTotalDesc = datesDesc.map((d, i) => ({ date: d, value: Number(seriesDesc[i]?.total_streams_cumulative ?? 0) }));
  const streamsDailyDesc = datesDesc.map((d, i) => {
    const curTotal = Number(seriesDesc[i]?.total_streams_cumulative ?? 0);
    const prevTotal =
      i + 1 < seriesDesc.length
        ? Number(seriesDesc[i + 1]?.total_streams_cumulative ?? 0)
        : curTotal;
    if (i + 1 >= seriesDesc.length) return { date: d, daily: null };
    const daily = Math.max(0, curTotal - prevTotal);
    return { date: d, daily };
  });

  const tracksTotalDesc = datesDesc.map((d, i) => ({ date: d, value: Number(seriesDesc[i]?.track_count ?? 0) }));
  const tracksDailyDeltaDesc = datesDesc.map((d, i) => {
    const cur = Number(seriesDesc[i]?.track_count ?? 0);
    const prev = Number(seriesDesc[i + 1]?.track_count ?? 0);
    return { date: d, daily: i + 1 < seriesDesc.length ? cur - prev : 0 };
  });

  return {
    revenue: {
      cumulative: computeRollingAvg7(revenueTotalDesc),
      daily: computeDailyRollingAvg7(revenueDailyDesc),
    },
    streams: {
      cumulative: computeRollingAvg7(streamsTotalDesc),
      daily: computeDailyRollingAvg7(streamsDailyDesc),
    },
    tracks: {
      cumulative: computeRollingAvg7(tracksTotalDesc),
      daily: computeDailyRollingAvg7(tracksDailyDeltaDesc),
    },
  };
}

/** Drilldown modal rows: parse, filter by query, and sort by the effective metric. */
export function filterSortDrillItems(
  drillItems: unknown[],
  drillKind: DrillKind,
  debouncedDrillQuery: string,
  metric: Metric,
) {
  const q = debouncedDrillQuery.trim().toLowerCase();
  const effectiveMetric: Metric = drillKind === "tracks" && metric === "tracks" ? "streams" : metric;

  if (drillKind === "playlists") {
    let items = drillItems.map(parseDrillPlaylistItem).filter(Boolean) as DrillPlaylistItem[];
    if (q) {
      items = items.filter((p) => {
        const name = (p.display_name ?? "").toLowerCase();
        const key = (p.playlist_key ?? "").toLowerCase();
        return name.includes(q) || key.includes(q);
      });
    }
    items = [...items].sort((a, b) => {
      const cmpNum = (x: number | null, y: number | null) => (y ?? -Infinity) - (x ?? -Infinity);
      if (effectiveMetric === "tracks") return (b.track_count ?? 0) - (a.track_count ?? 0) || a.playlist_key.localeCompare(b.playlist_key);
      if (effectiveMetric === "revenue") return cmpNum(a.est_revenue_daily_net, b.est_revenue_daily_net) || cmpNum(a.est_revenue_total, b.est_revenue_total) || a.playlist_key.localeCompare(b.playlist_key);
      return cmpNum(a.daily_streams_net, b.daily_streams_net) || cmpNum(a.total_streams_cumulative, b.total_streams_cumulative) || a.playlist_key.localeCompare(b.playlist_key);
    });
    return items;
  }

  if (drillKind === "artists") {
    let items = drillItems.map(parseDrillArtistItem).filter(Boolean) as DrillArtistItem[];
    if (q) {
      items = items.filter((a) => {
        const name = String(a.name ?? "").toLowerCase();
        const id = String(a.artist_id ?? "").toLowerCase();
        return name.includes(q) || id.includes(q);
      });
    }
    items = [...items].sort((a, b) => {
      if (effectiveMetric === "tracks") return (b.track_count ?? 0) - (a.track_count ?? 0) || a.artist_id.localeCompare(b.artist_id);
      const daily = (b.daily_streams_delta ?? 0) - (a.daily_streams_delta ?? 0);
      return daily || (b.total_streams_cumulative ?? 0) - (a.total_streams_cumulative ?? 0) || a.artist_id.localeCompare(b.artist_id);
    });
    return items;
  }

  let items = drillItems.map(parseDrillTrackItem).filter(Boolean) as DrillTrackItem[];
  if (q) {
    items = items.filter((t) => {
      const name = String(t.name ?? "").toLowerCase();
      const isrc = String(t.isrc ?? "").toLowerCase();
      const artists = (t.artist_names ?? []).join(", ").toLowerCase();
      return name.includes(q) || isrc.includes(q) || artists.includes(q);
    });
  }
  return items;
}

/** Collector tracks table rows: filter by query, then sort by the selected column. */
export function filterSortCollectorTracks(
  collectorTracks: CollectorTrackRow[],
  debouncedTrackQuery: string,
  trackSort: TrackSort,
  tracksTableMetric: "streams" | "revenue",
  payoutPerStreamUsd: number,
) {
  const q = debouncedTrackQuery.trim().toLowerCase();
  let rows = collectorTracks ?? [];

  if (q) {
    rows = rows.filter((t) => {
      const name = (t.name ?? "").toLowerCase();
      const isrc = (t.isrc ?? "").toLowerCase();
      const artists = (t.artist_names ?? []).join(", ").toLowerCase();
      return name.includes(q) || isrc.includes(q) || artists.includes(q);
    });
  }

  const safeNum = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? null : Number(n));
  const safeDateMs = (iso: string | null | undefined) => {
    const s = String(iso ?? "").trim();
    if (!s) return null;
    const ms = new Date(`${s}T00:00:00Z`).getTime();
    return Number.isFinite(ms) ? ms : null;
  };

  rows = [...rows].sort((a, b) => {
    const aDeltaStreams = safeNum(a.daily_streams_delta);
    const bDeltaStreams = safeNum(b.daily_streams_delta);
    const aTotalStreams = safeNum(a.total_streams_cumulative);
    const bTotalStreams = safeNum(b.total_streams_cumulative);
    const aRelease = safeDateMs(a.release_date);
    const bRelease = safeDateMs(b.release_date);
    const aDistroCount = (a.distro_playlist_keys ?? []).length;
    const bDistroCount = (b.distro_playlist_keys ?? []).length;

    const toValue = (n: number | null) =>
      n == null ? null : tracksTableMetric === "revenue" ? n * payoutPerStreamUsd : n;

    const aDelta = toValue(aDeltaStreams);
    const bDelta = toValue(bDeltaStreams);
    const aTotal = toValue(aTotalStreams);
    const bTotal = toValue(bTotalStreams);
    const aName = (a.name ?? a.isrc ?? "").toLowerCase();
    const bName = (b.name ?? b.isrc ?? "").toLowerCase();

    const cmpNum = (x: number | null, y: number | null, dir: "asc" | "desc") => {
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return dir === "asc" ? x - y : y - x;
    };

    switch (trackSort) {
      case "delta_desc":
        return cmpNum(aDelta, bDelta, "desc") || cmpNum(aTotal, bTotal, "desc") || aName.localeCompare(bName);
      case "delta_asc":
        return cmpNum(aDelta, bDelta, "asc") || cmpNum(aTotal, bTotal, "desc") || aName.localeCompare(bName);
      case "total_desc":
        return cmpNum(aTotal, bTotal, "desc") || cmpNum(aDelta, bDelta, "desc") || aName.localeCompare(bName);
      case "total_asc":
        return cmpNum(aTotal, bTotal, "asc") || cmpNum(aDelta, bDelta, "desc") || aName.localeCompare(bName);
      case "release_desc":
        return cmpNum(aRelease, bRelease, "desc") || cmpNum(aTotal, bTotal, "desc") || aName.localeCompare(bName);
      case "release_asc":
        return cmpNum(aRelease, bRelease, "asc") || cmpNum(aTotal, bTotal, "desc") || aName.localeCompare(bName);
      case "name_asc":
        return aName.localeCompare(bName) || cmpNum(aTotal, bTotal, "desc");
      case "name_desc":
        return bName.localeCompare(aName) || cmpNum(aTotal, bTotal, "desc");
      case "distro_desc":
        return (bDistroCount - aDistroCount) || cmpNum(aTotal, bTotal, "desc") || aName.localeCompare(bName);
      case "distro_asc":
        return (aDistroCount - bDistroCount) || cmpNum(aTotal, bTotal, "desc") || aName.localeCompare(bName);
      default:
        return 0;
    }
  });

  return rows;
}

/** Summary cards above the collector tracks table. */
export function computeTopTrackCards(collectorTracks: CollectorTrackRow[]) {
  const rows = collectorTracks ?? [];

  const bestDelta = rows
    .filter((t) => t.daily_streams_delta != null)
    .reduce<typeof rows[number] | null>((best, cur) => {
      if (!best) return cur;
      return (cur.daily_streams_delta ?? -Infinity) > (best.daily_streams_delta ?? -Infinity) ? cur : best;
    }, null);

  const bestTotal = rows
    .filter((t) => t.total_streams_cumulative != null)
    .reduce<typeof rows[number] | null>((best, cur) => {
      if (!best) return cur;
      return (cur.total_streams_cumulative ?? -Infinity) > (best.total_streams_cumulative ?? -Infinity) ? cur : best;
    }, null);

  const distroCount = rows.filter((t) => (t.distro_playlist_keys ?? []).length > 0).length;

  return { bestDelta, bestTotal, distroCount, totalCount: rows.length };
}
