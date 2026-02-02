"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Search, X } from "lucide-react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { MonthlyBarChart } from "@/components/charts/MonthlyBarChart";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { Sparkline } from "@/components/charts/Sparkline";
import { StatCard } from "@/components/StatCard";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";
import {
  CollectorComparisonChart,
  COLLECTOR_COLORS,
  type CollectorDailyData,
  type ComparisonMode,
} from "@/components/charts/CollectorComparisonChart";
import { CollectorMultiSelect } from "@/components/ui/CollectorMultiSelect";
import { GranularitySelect, type Granularity } from "@/components/ui/GranularitySelect";
import { TrackSortSelect, type TrackSort } from "@/components/ui/TrackSortSelect";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { IconButton } from "@/components/ui/Button";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";

const METRICS = ["streams", "revenue", "tracks"] as const;
type Metric = (typeof METRICS)[number];

const COLLECTOR_ORDER = ["A", "K", "N", "PL", "TG", "NL"] as const;

const GRANULARITIES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

const COLLECTORS_DETAILS_STORAGE = {
  playlistsOpen: "sb:collectors:details:playlists_open",
  tracksOpen: "sb:collectors:details:tracks_open",
} as const;

const COLLECTORS_COMPARISON_STORAGE = {
  collectors: "sb:collectors:comparison:collectors",
  mode: "sb:collectors:comparison:mode",
  granularity: "sb:collectors:comparison:granularity",
} as const;

function readStoredBool(key: string, fallback: boolean): boolean {
  // NOTE: Client components can still render on the server, so guard `window`.
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStoredBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore (private mode, disabled storage, etc.)
  }
}

function readStoredString(key: string): string | null {
  // NOTE: Client components can still render on the server, so guard `window`.
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore (private mode, disabled storage, etc.)
  }
}

// Helper to get ISO week number (weeks start Monday)
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

// Helper to get quarter from date
function getQuarter(date: Date): { year: number; quarter: number } {
  return { year: date.getFullYear(), quarter: Math.floor(date.getMonth() / 3) + 1 };
}

// Aggregate daily data into buckets based on granularity
function aggregateByGranularity(
  data: CollectorDailyData[],
  granularity: Granularity,
  selectedCollectors: string[],
  payoutPerStreamUsd: number,
): CollectorDailyData[] {
  if (granularity === "daily") return data;

  // Group by collector and bucket
  const buckets = new Map<string, Map<string, { streams: number; revenue: number; firstTrackCount: number; lastTrackCount: number; lastDate: string }>>();

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
        bucketKey = row.date.substring(0, 7); // yyyy-mm
        break;
      case "quarterly": {
        const { year, quarter } = getQuarter(date);
        bucketKey = `Q${quarter} ${year}`;
        break;
      }
      case "yearly":
        bucketKey = row.date.substring(0, 4); // yyyy
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
      // Update last track count if this date is later
      if (row.date > existing.lastDate) {
        existing.lastTrackCount = Number(row.track_count ?? 0);
        existing.lastDate = row.date;
      }
    }
  }

  // Convert buckets back to CollectorDailyData format
  const result: CollectorDailyData[] = [];

  for (const [collectorKey, bucketMap] of buckets) {
    const collector = collectorKey.split("|")[0];

    for (const [bucketKey, values] of bucketMap) {
      result.push({
        date: bucketKey, // Use bucket key as the "date" for display
        collector,
        daily_streams_net: values.streams,
        est_revenue_daily_net: values.revenue,
        track_count: values.lastTrackCount - values.firstTrackCount, // Net track change in bucket
      });
    }
  }

  // Sort by date/bucket key ascending
  result.sort((a, b) => a.date.localeCompare(b.date));

  return result;
}

function rollingAvg7(desc: Array<{ date: string; daily: number }>) {
  // Input: newest-first. Output: newest-first with ma7.
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; daily: number; ma7: number | null }> = [];

  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.daily ?? 0));
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, daily: asc[i].daily, ma7: avg });
  }

  return outAsc.reverse();
}

function ma7ForValueDesc(desc: Array<{ date: string; value: number }>) {
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; value: number; ma7: number | null }> = [];
  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.value ?? 0));
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, value: asc[i].value, ma7: avg });
  }
  return outAsc.reverse();
}

function aggregateMonthlyDelta(
  seriesDesc: CollectorSeriesPoint[],
  metric: "revenue" | "streams" | "tracks",
  payoutPerStreamUsd: number,
): Array<{ month: string; value: number }> {
  // seriesDesc is newest-first, so reverse to get oldest-first for easier aggregation
  const asc = [...seriesDesc].reverse();

  const monthlyMap = new Map<string, number>();

  for (let i = 0; i < asc.length; i++) {
    const cur = asc[i];
    const curDataDate = dataDateFromRunDate(cur.date);
    const curMonth = curDataDate.substring(0, 7); // yyyy-mm from data date

    const prev = i > 0 ? asc[i - 1] : null;
    const prevDataDate = prev ? dataDateFromRunDate(prev.date) : null;
    const prevMonth = prevDataDate?.substring(0, 7);

    // Get the delta for this day
    let delta = 0;
    if (metric === "revenue") {
      delta = Number(cur.daily_streams_net ?? 0) * payoutPerStreamUsd;
    } else if (metric === "streams") {
      delta = Number(cur.daily_streams_net ?? 0);
    } else if (metric === "tracks") {
      // For tracks, calculate the delta from previous day
      const curTracks = Number(cur.track_count ?? 0);
      const prevTracks = prev ? Number(prev.track_count ?? 0) : 0;
      delta = curTracks - prevTracks;
    }

    // Add to the month's total
    const current = monthlyMap.get(curMonth) ?? 0;
    monthlyMap.set(curMonth, current + delta);
  }

  // Convert to array and sort by month
  const result = Array.from(monthlyMap.entries())
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return result;
}

export type CollectorSummaryRow = {
  collector: string;
  playlists: number;
  track_count: number;
  total_streams_cumulative: number;
  daily_streams_net: number;
  est_revenue_total: number;
  est_revenue_daily_net: number;
  // comparison deltas for ranking view
  daily_streams_delta_yday: number | null;
  daily_streams_delta_ma7: number | null;
  est_revenue_daily_delta_yday: number | null;
  est_revenue_daily_delta_ma7: number | null;
  track_count_delta_yday: number | null;
  track_count_delta_ma7: number | null;
  // sparkline data (newest-first)
  spark_rev_daily?: number[];
  spark_streams_daily?: number[];
  spark_tracks?: number[];
};

export type CollectorSeriesPoint = {
  date: string; // ISO yyyy-mm-dd
  track_count: number;
  total_streams_cumulative: number;
  daily_streams_net: number;
  est_revenue_total: number;
  est_revenue_daily_net: number;
};

export type TopPlaylistRow = {
  playlist_key: string;
  display_name: string;
  est_revenue_daily_net: number | null;
  daily_streams_net: number | null;
  missing_streams_track_count: number | null;
};

export type CollectorTrackRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  playlist_keys: string[] | null;
  playlist_names: string[] | null;
  distro_playlist_keys: string[] | null;
  distro_playlist_names: string[] | null;
  total_streams_cumulative: number | null;
  daily_streams_delta: number | null;
};

export function CollectorsClient(props: {
  latestDate: string | null;
  selectedCollector: string;
  rangeDays: number;
  summary: CollectorSummaryRow[];
  seriesDesc: CollectorSeriesPoint[]; // newest-first
  topPlaylists: TopPlaylistRow[]; // for latestDate
  selectedPlaylistsMeta: Array<{
    playlist_key: string;
    display_name: string;
    spotify_playlist_image_url: string | null;
  }>;
  collectorTracks: CollectorTrackRow[]; // for latestDate (all tracks for selected collector)
  allCollectorsSeries: CollectorDailyData[]; // for comparison chart (date-range filtered)
  allCollectorsAllTime: CollectorDailyData[]; // for comparison chart (all-time, for non-daily granularities)
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const [openPlaylists, setOpenPlaylists] = useState(true);
  const [openTracks, setOpenTracks] = useState(true);
  const [comparisonBaseline, setComparisonBaseline] = useState<"ma7" | "yday">("ma7");

  // Metric is controlled by the page header; read it from the URL so it updates immediately.
  const metric: Metric = (() => {
    const urlMetric = searchParams.get("metric");
    return urlMetric === "streams" || urlMetric === "revenue" || urlMetric === "tracks"
      ? (urlMetric as Metric)
      : "revenue";
  })();
  
  // Comparison chart state - initialize from URL or defaults
  const [comparisonCollectors, setComparisonCollectors] = useState<string[]>(() => {
    const urlCollectors = searchParams.get("collectors");
    if (urlCollectors) {
      const fromUrl = urlCollectors.split(",").filter((c) => COLLECTOR_ORDER.includes(c as any));
      if (fromUrl.length) return fromUrl;
    }
    const stored = readStoredString(COLLECTORS_COMPARISON_STORAGE.collectors);
    if (stored) {
      const fromStored = stored.split(",").filter((c) => COLLECTOR_ORDER.includes(c as any));
      if (fromStored.length) return fromStored;
    }
    return ["PL", "TG"]; // Default to PL and TG
  });
  
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>(() => {
    const urlMode = searchParams.get("mode");
    if (urlMode === "combined" || urlMode === "individual" || urlMode === "percentage") {
      return urlMode;
    }
    const storedMode = readStoredString(COLLECTORS_COMPARISON_STORAGE.mode);
    if (storedMode === "combined" || storedMode === "individual" || storedMode === "percentage") {
      return storedMode;
    }
    return "individual"; // Default to individual
  });

  const [granularity, setGranularity] = useState<Granularity>(() => {
    const urlGranularity = searchParams.get("granularity");
    if (GRANULARITIES.includes(urlGranularity as Granularity)) {
      return urlGranularity as Granularity;
    }
    const storedGranularity = readStoredString(COLLECTORS_COMPARISON_STORAGE.granularity);
    if (GRANULARITIES.includes(storedGranularity as Granularity)) {
      return storedGranularity as Granularity;
    }
    return "daily"; // Default to daily
  });

  // Restore collapsible state (best-effort).
  // This runs after mount, which avoids SSR accessing localStorage.
  useEffect(() => {
    setOpenPlaylists(readStoredBool(COLLECTORS_DETAILS_STORAGE.playlistsOpen, true));
    setOpenTracks(readStoredBool(COLLECTORS_DETAILS_STORAGE.tracksOpen, true));
  }, []);

  // Persist collapsible state.
  useEffect(() => {
    writeStoredBool(COLLECTORS_DETAILS_STORAGE.playlistsOpen, openPlaylists);
  }, [openPlaylists]);

  useEffect(() => {
    writeStoredBool(COLLECTORS_DETAILS_STORAGE.tracksOpen, openTracks);
  }, [openTracks]);
  
  // Update URL when comparison settings change
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("collectors", comparisonCollectors.join(","));
    params.set("mode", comparisonMode);
    params.set("granularity", granularity);
    
    // Use replace to avoid adding to history on every change
    const newUrl = `?${params.toString()}`;
    if (newUrl !== `?${searchParams.toString()}`) {
      router.replace(newUrl, { scroll: false });
    }
    writeStoredString(COLLECTORS_COMPARISON_STORAGE.collectors, comparisonCollectors.join(","));
    writeStoredString(COLLECTORS_COMPARISON_STORAGE.mode, comparisonMode);
    writeStoredString(COLLECTORS_COMPARISON_STORAGE.granularity, granularity);
  }, [comparisonCollectors, comparisonMode, granularity, searchParams, router]);

  // Compute aggregated data based on granularity
  const comparisonChartData = useMemo(() => {
    // For daily, use the date-range filtered data; for others, use all-time
    const sourceData = granularity === "daily" ? props.allCollectorsSeries : props.allCollectorsAllTime;
    return aggregateByGranularity(sourceData, granularity, comparisonCollectors, streamPayoutPerStreamUsd);
  }, [granularity, props.allCollectorsSeries, props.allCollectorsAllTime, comparisonCollectors, streamPayoutPerStreamUsd]);

  // Remember last collector (like playlist dashboard)
  useEffect(() => {
    try {
      localStorage.setItem("sb:last_collector", props.selectedCollector);
    } catch {
      // ignore
    }
  }, [props.selectedCollector]);

  const ranked = useMemo(() => {
    const rows = [...props.summary];
    // Sort by fixed collector order
    rows.sort((a, b) => {
      const aIndex = COLLECTOR_ORDER.indexOf(a.collector as any);
      const bIndex = COLLECTOR_ORDER.indexOf(b.collector as any);
      // If collector not in order list, put at end
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
    return rows;
  }, [props.summary]);

  function computeComparisonRow(r: CollectorSummaryRow) {
    const value =
      metric === "revenue"
        ? Number(r.daily_streams_net ?? 0) * payoutPerStreamUsd
        : metric === "streams"
          ? Number(r.daily_streams_net ?? 0)
          : Number(r.track_count ?? 0);

    const deltaYday =
      metric === "revenue"
        ? (r.daily_streams_delta_yday == null ? null : Number(r.daily_streams_delta_yday) * payoutPerStreamUsd)
        : metric === "streams"
          ? r.daily_streams_delta_yday
          : r.track_count_delta_yday;

    const deltaMa7 =
      metric === "revenue"
        ? (r.daily_streams_delta_ma7 == null ? null : Number(r.daily_streams_delta_ma7) * payoutPerStreamUsd)
        : metric === "streams"
          ? r.daily_streams_delta_ma7
          : r.track_count_delta_ma7;

    // Calculate actual values from deltas
    const ydayValue = deltaYday != null ? value - deltaYday : null;
    const ma7Value = deltaMa7 != null ? value - deltaMa7 : null;

    const spark =
      metric === "revenue"
        ? r.spark_streams_daily?.map((n) => Number(n ?? 0) * payoutPerStreamUsd)
        : metric === "streams"
          ? r.spark_streams_daily
          : r.spark_tracks;

    const fmtValue = metric === "revenue" ? formatUsd2(value) : formatInt(value);

    const fmtYdayOrMa7 =
      metric === "revenue"
        ? (n: number | null | undefined) => (n == null ? "—" : formatUsd2(n))
        : (n: number | null | undefined) => (n == null ? "—" : formatInt(n));

    const href = `?collector=${encodeURIComponent(r.collector)}&range=${props.rangeDays}`;
    const isSelectedCollector = r.collector === props.selectedCollector;

    return {
      value,
      ydayValue,
      ma7Value,
      spark,
      fmtValue,
      fmtYday: fmtYdayOrMa7(ydayValue),
      fmtMa7: fmtYdayOrMa7(ma7Value),
      href,
      isSelectedCollector,
    } as const;
  }

  const latest = props.seriesDesc[0] ?? null;

  const series = useMemo(() => {
    const datesDesc = props.seriesDesc.map((p) => p.date);

    const revenueTotalDesc = datesDesc.map((d, i) => ({
      date: dataDateFromRunDate(d),
      value: Number(props.seriesDesc[i]?.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd,
    }));
    const revenueDailyDesc = datesDesc.map((d, i) => ({
      date: dataDateFromRunDate(d),
      daily: Number(props.seriesDesc[i]?.daily_streams_net ?? 0) * streamPayoutPerStreamUsd,
    }));

    const streamsTotalDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), value: Number(props.seriesDesc[i]?.total_streams_cumulative ?? 0) }));
    const streamsDailyDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), daily: Number(props.seriesDesc[i]?.daily_streams_net ?? 0) }));

    const tracksTotalDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), value: Number(props.seriesDesc[i]?.track_count ?? 0) }));
    const tracksDailyDeltaDesc = datesDesc.map((d, i) => {
      const cur = Number(props.seriesDesc[i]?.track_count ?? 0);
      const prev = Number(props.seriesDesc[i + 1]?.track_count ?? 0);
      // oldest->newest diff is more intuitive, but we keep newest-first: compare to next older day
      return { date: dataDateFromRunDate(d), daily: i + 1 < props.seriesDesc.length ? cur - prev : 0 };
    });

    return {
      revenue: {
        cumulative: ma7ForValueDesc(revenueTotalDesc),
        daily: rollingAvg7(revenueDailyDesc),
      },
      streams: {
        cumulative: ma7ForValueDesc(streamsTotalDesc),
        daily: rollingAvg7(streamsDailyDesc),
      },
      tracks: {
        cumulative: ma7ForValueDesc(tracksTotalDesc),
        daily: rollingAvg7(tracksDailyDeltaDesc),
      },
    } as const;
  }, [props.seriesDesc, streamPayoutPerStreamUsd]);

  const monthlyData = useMemo(() => {
    // Get all available historical data (not limited by range selection)
    // This uses the full seriesDesc for unfiltered monthly aggregation
    return {
      revenue: aggregateMonthlyDelta(props.seriesDesc, "revenue", streamPayoutPerStreamUsd),
      streams: aggregateMonthlyDelta(props.seriesDesc, "streams", streamPayoutPerStreamUsd),
      tracks: aggregateMonthlyDelta(props.seriesDesc, "tracks", streamPayoutPerStreamUsd),
    };
  }, [props.seriesDesc, streamPayoutPerStreamUsd]);

  const metricLabel = metric === "revenue" ? "Est. revenue" : metric === "streams" ? "Streams" : "Tracks";
  const dailyLabel =
    metric === "revenue" ? "Est. revenue (daily)" : metric === "streams" ? "Streams (daily)" : "Track change (daily)";
  const cumulativeLabel =
    metric === "revenue" ? "Est. revenue (cumulative)" : metric === "streams" ? "Streams (cumulative)" : "Tracks";

  const valueFormat = metric === "revenue" ? "usd" : "int";
  const yTickFormat = metric === "revenue" ? "usd_compact" : metric === "streams" ? "k" : "int";
  const chartColor = metric === "tracks" ? "#3b82f6" : metric === "revenue" ? "#10b981" : "var(--sb-accent)";
  const valueCellColor =
    metric === "revenue" ? "#10b981" : metric === "streams" ? "var(--sb-accent)" : "var(--sb-text)";

  const payoutPerStreamUsd = streamPayoutPerStreamUsd;

  const [trackQuery, setTrackQuery] = useState("");
  const [trackSort, setTrackSort] = useState<TrackSort>("delta_desc");

  const filteredSortedTracks = useMemo(() => {
    const q = trackQuery.trim().toLowerCase();
    let rows = props.collectorTracks ?? [];

    if (q) {
      rows = rows.filter((t) => {
        const name = (t.name ?? "").toLowerCase();
        const isrc = (t.isrc ?? "").toLowerCase();
        const artists = (t.artist_names ?? []).join(", ").toLowerCase();
        return name.includes(q) || isrc.includes(q) || artists.includes(q);
      });
    }

    const safeNum = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? null : Number(n));

    rows = [...rows].sort((a, b) => {
      const aDelta = safeNum(a.daily_streams_delta);
      const bDelta = safeNum(b.daily_streams_delta);
      const aTotal = safeNum(a.total_streams_cumulative);
      const bTotal = safeNum(b.total_streams_cumulative);
      const aName = (a.name ?? a.isrc ?? "").toLowerCase();
      const bName = (b.name ?? b.isrc ?? "").toLowerCase();

      const cmpNum = (x: number | null, y: number | null, dir: "asc" | "desc") => {
        if (x == null && y == null) return 0;
        if (x == null) return 1; // nulls last
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
        case "name_asc":
          return aName.localeCompare(bName) || cmpNum(aTotal, bTotal, "desc");
        case "name_desc":
          return bName.localeCompare(aName) || cmpNum(aTotal, bTotal, "desc");
        default:
          return 0;
      }
    });

    return rows;
  }, [props.collectorTracks, trackQuery, trackSort]);

  const playlistMetaByKey = useMemo(() => {
    return new Map(props.selectedPlaylistsMeta.map((p) => [p.playlist_key, p]));
  }, [props.selectedPlaylistsMeta]);

  const topTrackCards = useMemo(() => {
    const rows = props.collectorTracks ?? [];

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
  }, [props.collectorTracks]);

  return (
    <div className="space-y-6">
      {/* Middle card: comparison chart + table */}
      <div className="sb-card p-4 space-y-4">
        <SpotlightCard className="relative p-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 opacity-60" />
                  <div className="text-xs font-medium uppercase tracking-wide opacity-70">
                    Collector Comparison
                  </div>
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                  Compare revenue, streams, and track change over time
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                {/* Mode toggle */}
                <ChipGroup segmented>
                  {(["combined", "individual", "percentage"] as const).map((m) => (
                    <Chip key={m} segmented selected={comparisonMode === m} onClick={() => setComparisonMode(m)}>
                      {m === "combined" ? "Combined" : m === "individual" ? "Individual" : "Percentage"}
                    </Chip>
                  ))}
                </ChipGroup>

                {/* Dropdowns */}
                <div className="flex flex-wrap items-center" style={{ gap: "0.2rem" }}>
                  <CollectorMultiSelect selected={comparisonCollectors} onChange={setComparisonCollectors} />
                  <GranularitySelect value={granularity} onChange={setGranularity} />
                </div>
              </div>
            </div>

            {/* Legend + note */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {comparisonMode !== "combined" && comparisonCollectors.length > 0 && (
                <div className="flex flex-wrap items-center gap-3">
                  {COLLECTOR_ORDER.filter((c) => comparisonCollectors.includes(c)).map((collector) => (
                    <div key={collector} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: COLLECTOR_COLORS[collector] }}
                      />
                      <span style={{ color: "var(--sb-text)" }}>{collector}</span>
                    </div>
                  ))}
                </div>
              )}
              {granularity !== "daily" && (
                <div className="text-[10px]" style={{ color: "var(--sb-muted)" }}>
                  {granularity === "weekly" ? "Weeks start Monday (ISO)" : "Showing all-time data"}
                </div>
              )}
            </div>

            {/* Chart */}
            <div className="mt-2 min-h-[260px]">
              <CollectorComparisonChart
                data={comparisonChartData}
                selectedCollectors={comparisonCollectors}
                mode={comparisonMode}
                metric={metric}
                heightPx={260}
                granularity={granularity}
              />
            </div>
          </div>
          {/* Decorative background glow (subtle) */}
          <div
            className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full opacity-15 blur-3xl"
            style={{ background: "var(--sb-accent)" }}
          />
        </SpotlightCard>

        {/* Comparison table */}
        <div className="space-y-2">
          <div className="flex items-end justify-between px-1">
            <div>
              <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
                Comparison Table
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                Showing {metricLabel.toLowerCase()} on data date{" "}
                {props.latestDate ? formatDateISO(props.latestDate) : "—"}
              </div>
            </div>
          </div>

          {/* Table (mobile-friendly): horizontal scroll + sticky first column */}
          <GlassTable
            tableLayout="fixed"
            className="relative"
            bodyClassName="overflow-x-auto"
              headers={[
                {
                  label: "Collector",
                  className: "sticky left-0 z-20 min-w-[110px]",
                },
                { label: "Pl", className: "w-[70px] text-right" },
                { label: "Tracks", className: "w-[84px] text-right" },
                { label: "Value", className: "w-[110px] text-right font-medium" },
                {
                  label: (
                    <button
                      type="button"
                      onClick={() => setComparisonBaseline((v) => (v === "ma7" ? "yday" : "ma7"))}
                      className="w-full text-right"
                      title={
                        comparisonBaseline === "ma7"
                          ? "Showing 7d avg (click to toggle to Yesterday)"
                          : "Showing Yesterday (click to toggle to 7d avg)"
                      }
                    >
                      {comparisonBaseline === "ma7" ? "7D AVG" : "YESTERDAY"}
                    </button>
                  ),
                  className: "w-[110px]",
                },
                { label: "Trend", className: "hidden md:table-cell w-[110px]" },
              ]}
            >
              {ranked.map((r) => {
                const row = computeComparisonRow(r);

                const stickyBg = row.isSelectedCollector
                  ? "color-mix(in srgb, var(--sb-accent) 28%, var(--sb-surface))"
                  : "var(--sb-surface)";

                return (
                  <TableRow
                    key={r.collector}
                    className={
                      row.isSelectedCollector
                        ? "hover:bg-transparent dark:hover:bg-transparent odd:bg-transparent dark:odd:bg-transparent"
                        : undefined
                    }
                    style={
                      row.isSelectedCollector
                        ? {
                            background: "color-mix(in srgb, var(--sb-accent) 28%, var(--sb-surface))",
                          }
                        : undefined
                    }
                  >
                    <TableCell
                      className="sticky left-0 z-10 px-0 py-0"
                      style={{ background: stickyBg }}
                    >
                      <Link
                        href={row.href}
                        className={[
                          "flex h-full w-full items-center gap-2 px-3 py-2 font-medium transition-colors",
                          "hover:text-lime-600 dark:hover:text-lime-400",
                          r.collector === props.selectedCollector ? "opacity-100" : "opacity-70",
                        ].join(" ")}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: COLLECTOR_COLORS[r.collector] ?? "var(--sb-muted)" }}
                          aria-hidden="true"
                        />
                        {r.collector}
                      </Link>
                    </TableCell>
                    <TableCell numeric>{formatInt(r.playlists)}</TableCell>
                    <TableCell numeric>{formatInt(r.track_count)}</TableCell>
                    <TableCell
                      numeric
                      className="font-medium"
                      style={metric === "tracks" ? undefined : { color: valueCellColor }}
                    >
                      {row.fmtValue}
                    </TableCell>
                    <TableCell numeric>
                      {comparisonBaseline === "ma7" ? row.fmtMa7 : row.fmtYday}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="h-5 w-20 opacity-60">
                        <Sparkline data={row.spark?.slice().reverse()} trend="neutral" />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </GlassTable>
        </div>
      </div>

      {/* Selected collector combined view */}
      <div className="sb-card p-4">
        <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: COLLECTOR_COLORS[props.selectedCollector] ?? "var(--sb-muted)",
                }}
                aria-hidden="true"
              />
              {props.selectedCollector}
            </h2>
            <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              {props.rangeDays} day view
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <SpotlightCard className="lg:col-span-6 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {cumulativeLabel}
              </div>
              <ChartCsvDownloadButton
                rows={series[metric].cumulative as unknown as Array<Record<string, unknown>>}
                filename={`collectors-${slugifyForFilename(cumulativeLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
            <div className="mt-2 min-h-[220px]">
              <DailyStreamsChart
                data={series[metric].cumulative as any}
                valueLabel={metricLabel}
                valueFormat={valueFormat as any}
                yTickFormat={yTickFormat as any}
                heightPx={220}
                isCumulative={metric !== "tracks"}
                showMA7={false}
                color={chartColor}
              />
            </div>
          </SpotlightCard>

          <SpotlightCard className="lg:col-span-6 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {dailyLabel}
              </div>
              <ChartCsvDownloadButton
                rows={series[metric].daily as unknown as Array<Record<string, unknown>>}
                filename={`collectors-${slugifyForFilename(dailyLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
            <div className="mt-2 min-h-[220px]">
              <DailyStreamsWithMAChart
                data={series[metric].daily as any}
                valueLabel={metric === "tracks" ? "Tracks" : metricLabel}
                valueFormat={valueFormat as any}
                yTickFormat={yTickFormat as any}
                heightPx={220}
                dailyColor={chartColor}
              />
            </div>
          </SpotlightCard>
        </div>

        <SpotlightCard className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Monthly {metric === "revenue" ? "Est. Revenue" : metric === "streams" ? "Streams" : "Track"}
            </div>
            <ChartCsvDownloadButton
              rows={monthlyData[metric] as unknown as Array<Record<string, unknown>>}
              filename={`collectors-${slugifyForFilename(`monthly-${metric}`)}-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            All-time monthly aggregation (not affected by date range)
          </p>
          <div className="mt-3 min-h-[220px]">
            <MonthlyBarChart
              data={monthlyData[metric]}
              valueLabel={metricLabel}
              valueFormat={valueFormat as any}
              yTickFormat={yTickFormat as any}
              heightPx={220}
              color={chartColor}
            />
          </div>
        </SpotlightCard>

        {/* Top playlists (collapsible) */}
        <details
          open={openPlaylists}
          onToggle={(ev) => setOpenPlaylists(ev.currentTarget.open)}
          className="rounded-xl border bg-white/50 p-3 dark:bg-white/[0.03]"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <summary className="cursor-pointer select-none">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 text-xs opacity-60 mt-0.5">▸</span>
                <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                  Playlists
                </div>
              </div>
            </div>
          </summary>

          <div className="mt-3">
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Ranked by est. revenue (daily) on data date{" "}
              {props.latestDate ? formatDateISO(props.latestDate) : "—"}
            </div>
            <GlassTable
              headers={[
                "Playlist",
                "Est. Rev (Daily)",
                "Daily Streams",
                <span
                  key="missing"
                  title="Number of tracks in the playlist that don't have stream data in the catalog snapshot for this day."
                >
                  Cat. Missing Tracks
                </span>,
              ]}
              maxBodyHeightClassName="max-h-[320px]"
            >
              {props.topPlaylists.map((p) => (
                <TableRow key={p.playlist_key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const meta = playlistMetaByKey.get(String(p.playlist_key));
                        const imgUrl = meta?.spotify_playlist_image_url ?? null;
                        const label = meta?.display_name ?? p.display_name ?? p.playlist_key;
                        return imgUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imgUrl}
                            alt={label}
                            className="h-6 w-6 rounded-full object-cover sb-ring flex-shrink-0"
                            title={label}
                          />
                        ) : (
                          <div
                            className="h-6 w-6 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                            style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
                            title={label}
                          >
                            {String(label).trim().slice(0, 1).toUpperCase()}
                          </div>
                        );
                      })()}
                      <Link
                        href={`/playlists/${p.playlist_key}`}
                        className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                      >
                        {p.display_name}
                      </Link>
                    </div>
                    <div className="font-mono text-[11px] opacity-50">{p.playlist_key}</div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatUsd2(Number(p.daily_streams_net ?? 0) * payoutPerStreamUsd)}
                  </TableCell>
                  <TableCell className="text-lime-700 dark:text-lime-400 font-medium">
                    +{formatInt(p.daily_streams_net)}
                  </TableCell>
                  <TableCell title={p.missing_streams_track_count ? "Missing catalog tracks for this date." : undefined}>
                    {p.missing_streams_track_count ? (
                      <span className="text-red-600 dark:text-red-400 font-medium">
                        {formatInt(p.missing_streams_track_count)}
                      </span>
                    ) : (
                      <span className="opacity-30">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!props.topPlaylists.length ? (
                <TableRow>
                  <TableCell className="py-8 text-center opacity-50" colSpan={4}>
                    No playlists found for this collector/date.
                  </TableCell>
                </TableRow>
              ) : null}
            </GlassTable>
          </div>
        </details>

        {/* Tracks (collapsible) */}
        <details
          open={openTracks}
          onToggle={(ev) => setOpenTracks(ev.currentTarget.open)}
          className="rounded-xl border bg-white/50 p-3 dark:bg-white/[0.03]"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <summary className="cursor-pointer select-none">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 text-xs opacity-60 mt-0.5">▸</span>
                <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                  Tracks
                </div>
              </div>
              <div
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
              >
                <ChartCsvDownloadButton
                  rows={props.collectorTracks as unknown as Array<Record<string, unknown>>}
                  filename={`collectors-${slugifyForFilename(props.selectedCollector)}-tracks-${todayIsoDate()}.csv`}
                  title="Download CSV"
                />
              </div>
            </div>
          </summary>

          <div className="mt-3 space-y-4">
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Cumulative streams are totals from the DB on the data date. “Δ1d” is today minus yesterday.
            </div>
            {/* Quick summary */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StatCard
              title="Top Δ1d track"
              value={
                topTrackCards.bestDelta?.daily_streams_delta == null
                  ? "—"
                  : metric === "revenue"
                    ? formatUsd2(topTrackCards.bestDelta.daily_streams_delta * payoutPerStreamUsd)
                    : `${topTrackCards.bestDelta.daily_streams_delta >= 0 ? "+" : ""}${formatInt(topTrackCards.bestDelta.daily_streams_delta)}`
              }
              subtitle={
                topTrackCards.bestDelta ? (
                  <div className="flex items-center gap-2">
                    {topTrackCards.bestDelta.album_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={topTrackCards.bestDelta.album_image_url}
                        alt="Album cover"
                        className="h-6 w-6 rounded object-cover"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded bg-white/60 dark:bg-white/10" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/tracks/${topTrackCards.bestDelta.isrc}`}
                        className="block truncate transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium text-xs"
                      >
                        {topTrackCards.bestDelta.name ?? topTrackCards.bestDelta.isrc}
                      </Link>
                      {topTrackCards.bestDelta.artist_names?.length ? (
                        <div className="truncate text-xs opacity-60">
                          {topTrackCards.bestDelta.artist_names.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  "—"
                )
              }
            />
            <StatCard
              title="Top total track"
              value={
                topTrackCards.bestTotal?.total_streams_cumulative == null
                  ? "—"
                  : metric === "revenue"
                    ? formatUsd2(topTrackCards.bestTotal.total_streams_cumulative * payoutPerStreamUsd)
                    : formatInt(topTrackCards.bestTotal.total_streams_cumulative)
              }
              subtitle={
                topTrackCards.bestTotal ? (
                  <div className="flex items-center gap-2">
                    {topTrackCards.bestTotal.album_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={topTrackCards.bestTotal.album_image_url}
                        alt="Album cover"
                        className="h-6 w-6 rounded object-cover"
                      />
                    ) : (
                      <div className="h-6 w-6 rounded bg-white/60 dark:bg-white/10" />
                    )}
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/tracks/${topTrackCards.bestTotal.isrc}`}
                        className="block truncate transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium text-xs"
                      >
                        {topTrackCards.bestTotal.name ?? topTrackCards.bestTotal.isrc}
                      </Link>
                      {topTrackCards.bestTotal.artist_names?.length ? (
                        <div className="truncate text-xs opacity-60">
                          {topTrackCards.bestTotal.artist_names.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  "—"
                )
              }
            />
            </div>

            {/* Controls */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search
                className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--sb-muted)" }}
              />
              <Input
                type="text"
                value={trackQuery}
                onChange={(e) => setTrackQuery(e.target.value)}
                placeholder="Search tracks / artists / ISRC…"
                className="pl-8 pr-8 py-1.5 text-xs"
              />
              {trackQuery && (
                <IconButton
                  type="button"
                  onClick={() => setTrackQuery("")}
                  aria-label="Clear search"
                  title="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md"
                >
                  <X className="h-3.5 w-3.5" style={{ color: "var(--sb-muted)" }} />
                </IconButton>
              )}
            </div>

            <TrackSortSelect value={trackSort} onChange={setTrackSort} />

            <div className="text-xs whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
              {formatInt(filteredSortedTracks.length)} / {formatInt(props.collectorTracks.length)}
            </div>
            </div>

            <div className="mt-4">
              <GlassTable
                headers={[
                  "",
                  "Track",
                  "ISRC",
                  "Streams (total)",
                  <span key="d1" title="Today minus yesterday (based on cumulative streams).">
                    Streams (Δ1d)
                  </span>,
                  "Distro",
                ]}
                maxBodyHeightClassName="max-h-[520px]"
              >
              {filteredSortedTracks.map((t) => {
                const distroKeys = (t.distro_playlist_keys ?? []).filter(Boolean);
                const distroNames = (t.distro_playlist_names ?? []).filter(Boolean);
                const distroTitle = distroNames.length ? distroNames.join(", ") : distroKeys.join(", ");

                return (
                  <TableRow key={t.isrc}>
                    <TableCell>
                      {t.album_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.album_image_url}
                          alt="Album cover"
                          className="h-8 w-8 rounded-lg object-cover sb-ring"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/tracks/${t.isrc}`}
                        className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                      >
                        {t.name ?? t.isrc}
                      </Link>
                      {t.artist_names?.length ? (
                        <div className="mt-0.5 text-xs opacity-60">
                          {t.artist_names.join(", ")}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                      {t.isrc}
                    </TableCell>
                    <TableCell className="font-medium">
                      {t.total_streams_cumulative == null ? "—" : formatInt(t.total_streams_cumulative)}
                    </TableCell>
                    <TableCell
                      className={
                        t.daily_streams_delta != null && t.daily_streams_delta < 0
                          ? "text-red-600 dark:text-red-400 font-medium"
                          : "text-lime-700 dark:text-lime-400 font-medium"
                      }
                    >
                      {t.daily_streams_delta == null
                        ? "—"
                        : `${t.daily_streams_delta >= 0 ? "+" : ""}${formatInt(t.daily_streams_delta)}`}
                    </TableCell>
                    <TableCell title={distroKeys.length ? distroTitle : undefined}>
                      {distroKeys.length ? (
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex -space-x-1">
                            {distroKeys.slice(0, 4).map((k) => {
                              const meta = playlistMetaByKey.get(String(k));
                              const imgUrl = meta?.spotify_playlist_image_url ?? null;
                              const label = meta?.display_name ?? String(k);
                              return imgUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={k}
                                  src={imgUrl}
                                  alt={label}
                                  className="h-5 w-5 rounded-full object-cover sb-ring"
                                  title={label}
                                />
                              ) : (
                                <div
                                  key={k}
                                  className="h-5 w-5 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold"
                                  style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
                                  title={label}
                                >
                                  {label.trim().slice(0, 1).toUpperCase()}
                                </div>
                              );
                            })}
                            {distroKeys.length > 4 ? (
                              <div
                                className="h-5 w-5 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold"
                                style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-text)" }}
                                title={distroTitle}
                              >
                                +{distroKeys.length - 4}
                              </div>
                            ) : null}
                          </div>
                          <span className="truncate text-xs opacity-70">
                            {distroNames.length ? distroNames.join(", ") : "Distro"}
                          </span>
                        </div>
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filteredSortedTracks.length ? (
                <TableRow>
                  <TableCell className="py-8 text-center opacity-50" colSpan={6}>
                    No matching tracks.
                  </TableCell>
                </TableRow>
              ) : null}
              </GlassTable>
            </div>
          </div>
        </details>
        </div>
      </div>
    </div>
  );
}
