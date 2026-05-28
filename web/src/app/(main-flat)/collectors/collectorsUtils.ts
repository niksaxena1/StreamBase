import type { Granularity } from "@/components/ui/GranularitySelect";
import type { CollectorDailyData } from "@/components/charts/CollectorComparisonChart";
import type {
  CollectorOverlapArtistCell,
  CollectorOverlapCell,
  CollectorSeriesPoint,
  DrillPlaylistItem,
  DrillArtistItem,
  DrillTrackItem,
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
