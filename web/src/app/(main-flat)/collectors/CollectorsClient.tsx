"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Search, X } from "lucide-react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { MonthlyBarChart } from "@/components/charts/MonthlyBarChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { StatCard } from "@/components/StatCard";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
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
import { useMetric } from "@/components/metrics/MetricContext";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { Modal } from "@/components/ui/Modal";
import { useChartStartDate } from "@/components/charts/ChartStartDateContext";
import { filterDailySeriesFromIsoDate } from "@/components/charts/chartUtils";

type Metric = "streams" | "revenue" | "tracks";

const COLLECTOR_ORDER = ["A", "K", "N", "PL", "TG", "NL"] as const;

const GRANULARITIES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;

const COLLECTORS_DETAILS_STORAGE = {
  playlistsOpen: "sb:collectors:details:playlists_open",
  tracksOpen: "sb:collectors:details:tracks_open",
} as const;

type DrillPlaylistItem = {
  playlist_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
  playlist_type: string | null;
  track_count: number;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total: number | null;
  est_revenue_daily_net: number | null;
};
type DrillArtistItem = {
  artist_id: string;
  name: string | null;
  image_url: string | null;
  track_count: number;
  total_streams_cumulative: number;
  daily_streams_delta: number;
};
type DrillTrackItem = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  total_streams_cumulative: number | null;
  daily_streams_delta: number | null;
};

function parseDrillPlaylistItem(x: unknown): DrillPlaylistItem | null {
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
    total_streams_cumulative: o.total_streams_cumulative == null ? null : Number(o.total_streams_cumulative),
    daily_streams_net: o.daily_streams_net == null ? null : Number(o.daily_streams_net),
    est_revenue_total: o.est_revenue_total == null ? null : Number(o.est_revenue_total),
    est_revenue_daily_net: o.est_revenue_daily_net == null ? null : Number(o.est_revenue_daily_net),
  };
}

function parseDrillArtistItem(x: unknown): DrillArtistItem | null {
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

function parseDrillTrackItem(x: unknown): DrillTrackItem | null {
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
    total_streams_cumulative: o.total_streams_cumulative == null ? null : Number(o.total_streams_cumulative),
    daily_streams_delta: o.daily_streams_delta == null ? null : Number(o.daily_streams_delta),
  };
}

const COLLECTORS_COMPARISON_STORAGE = {
  collectors: "sb:collectors:comparison:collectors",
  mode: "sb:collectors:comparison:mode",
  granularity: "sb:collectors:comparison:granularity",
} as const;

const COLLECTORS_MONTHLY_ACTUAL_REVENUE_STORAGE = {
  visible: "sb:collectors:monthly:actual_revenue_visible",
} as const;

import {
  readStoredBool,
  writeStoredBool,
  readStoredString,
  writeStoredString,
} from "@/lib/storage";

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

import { computeDailyRollingAvg7, computeRollingAvg7 } from "@/components/charts/chartUtils";

function aggregateMonthlyDelta(
  seriesDesc: CollectorSeriesPoint[],
  metric: "revenue" | "streams" | "tracks",
  payoutPerStreamUsd: number,
): Array<{ month: string; value: number; projectedExtra?: number; projectedTotal?: number; daysWithData?: number; totalDaysInMonth?: number }> {
  // seriesDesc is newest-first, so reverse to get oldest-first for easier aggregation
  const asc = [...seriesDesc].reverse();

  const monthlyMap = new Map<string, number>();
  const daysPerMonth = new Map<string, Set<string>>();

  for (let i = 0; i < asc.length; i++) {
    const cur = asc[i];
    // `CollectorsPage` already shifts DB run dates → data dates before passing into this client.
    // So `cur.date` here is the *data date* (YYYY-MM-DD).
    const curDataDate = cur.date;
    const curMonth = curDataDate.substring(0, 7); // yyyy-mm from data date

    // Track unique dates per month for projection calculation
    if (!daysPerMonth.has(curMonth)) daysPerMonth.set(curMonth, new Set());
    daysPerMonth.get(curMonth)!.add(curDataDate);

    const prev = i > 0 ? asc[i - 1] : null;

    // Get the delta for this day
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
  const result: Array<{ month: string; value: number; projectedExtra?: number; projectedTotal?: number; daysWithData?: number; totalDaysInMonth?: number }> = Array.from(monthlyMap.entries())
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Compute projection for the latest (current/incomplete) month via linear extrapolation
  // Skip projection for tracks metric (only show for revenue/streams)
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

export type CollectorSummaryRow = {
  collector: string;
  playlists: number;
  artist_count: number;
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
  release_date: string | null;
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
  latestRunDate: string;
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
  const { metric } = useMetric();
  const { chartStartDateIso } = useChartStartDate();

  const [openPlaylists, setOpenPlaylists] = useState(true);
  const [openTracks, setOpenTracks] = useState(true);
  const [comparisonBaseline, setComparisonBaseline] = useState<"ma7" | "yday">("ma7");

  const [showActualRevenue, setShowActualRevenue] = useState<boolean>(() =>
    readStoredBool(COLLECTORS_MONTHLY_ACTUAL_REVENUE_STORAGE.visible, true),
  );
  useEffect(() => {
    writeStoredBool(COLLECTORS_MONTHLY_ACTUAL_REVENUE_STORAGE.visible, showActualRevenue);
  }, [showActualRevenue]);

  const [actualRevenueByMonth, setActualRevenueByMonth] = useState<Record<string, number>>({});
  const [forecastOpen, setForecastOpen] = useState(false);
  const [forecastMonth, setForecastMonth] = useState<string | null>(null);
  const [forecastValue, setForecastValue] = useState<string>("");
  const [forecastSaving, setForecastSaving] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Metric is global now (top bar toggle); legacy `metric` query param is ignored.
  
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
  
  // Update URL when comparison settings change.
  // NOTE: searchParams and router are intentionally omitted from deps to avoid a
  // self-triggering loop (router.replace updates searchParams which re-fires this effect).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("collectors", comparisonCollectors.join(","));
    params.set("mode", comparisonMode);
    params.set("granularity", granularity);

    const newUrl = `?${params.toString()}`;
    if (newUrl !== `?${new URLSearchParams(window.location.search).toString()}`) {
      router.replace(newUrl, { scroll: false });
    }
    writeStoredString(COLLECTORS_COMPARISON_STORAGE.collectors, comparisonCollectors.join(","));
    writeStoredString(COLLECTORS_COMPARISON_STORAGE.mode, comparisonMode);
    writeStoredString(COLLECTORS_COMPARISON_STORAGE.granularity, granularity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonCollectors, comparisonMode, granularity]);

  // Actual monthly revenue (overlay markers + editable values).
  useEffect(() => {
    if (metric !== "revenue") return;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/collectors/monthly-revenue-forecast?collector=${encodeURIComponent(props.selectedCollector)}`,
          { method: "GET" },
        );
        const json: unknown = await res.json().catch(() => null);
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        if (!res.ok || obj?.ok !== true) return;

        const items = Array.isArray(obj?.items) ? (obj?.items as any[]) : [];
        const next: Record<string, number> = {};
        for (const it of items) {
          const month = String(it?.month ?? "").trim();
          const amount = Number(it?.amount_usd);
          if (!/^\d{4}-\d{2}$/.test(month)) continue;
          if (!Number.isFinite(amount)) continue;
          next[month] = amount;
        }
        if (!cancelled) setActualRevenueByMonth(next);
      } catch {
        // ignore (best-effort overlay)
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [metric, props.selectedCollector]);

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

  const sparkByCollector = useMemo(() => {
    const filtered = filterDailySeriesFromIsoDate(props.allCollectorsSeries ?? [], chartStartDateIso);
    const byCollector = new Map<string, CollectorDailyData[]>();
    for (const row of filtered) {
      const c = String((row as any)?.collector ?? "").trim();
      const d = String((row as any)?.date ?? "").trim();
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

      const streams = rows.map((r) => Number((r as any)?.daily_streams_net ?? 0)).filter((n) => Number.isFinite(n));
      const revenue = rows
        .map((r) => {
          const v = (r as any)?.est_revenue_daily_net;
          const n = v == null ? Number((r as any)?.daily_streams_net ?? 0) * streamPayoutPerStreamUsd : Number(v);
          return Number.isFinite(n) ? n : null;
        })
        .filter((n): n is number => n !== null);

      // Daily track change (delta) from track_count totals
      const tracksDelta: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        const cur = Number((rows[i] as any)?.track_count ?? 0);
        const prev = Number((rows[i - 1] as any)?.track_count ?? 0);
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
    // Also include any non-standard collector keys present.
    for (const c of byCollector.keys()) {
      if (!out.has(c)) out.set(c, build(c));
    }
    return out;
  }, [props.allCollectorsSeries, chartStartDateIso, streamPayoutPerStreamUsd]);

  const latest = props.seriesDesc[0] ?? null;

  const series = useMemo(() => {
    const datesDesc = props.seriesDesc.map((p) => p.date);

    const revenueTotalDesc = datesDesc.map((d, i) => ({
      date: d,
      value: Number(props.seriesDesc[i]?.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd,
    }));
    const revenueDailyDesc = datesDesc.map((d, i) => {
      const curTotal = Number(props.seriesDesc[i]?.total_streams_cumulative ?? 0);
      const prevTotal =
        i + 1 < props.seriesDesc.length
          ? Number(props.seriesDesc[i + 1]?.total_streams_cumulative ?? 0)
          : curTotal;
      if (i + 1 >= props.seriesDesc.length) return { date: d, daily: null };
      const dailyStreams = Math.max(0, curTotal - prevTotal);
      return { date: d, daily: dailyStreams * streamPayoutPerStreamUsd };
    });

    const streamsTotalDesc = datesDesc.map((d, i) => ({ date: d, value: Number(props.seriesDesc[i]?.total_streams_cumulative ?? 0) }));
    const streamsDailyDesc = datesDesc.map((d, i) => {
      const curTotal = Number(props.seriesDesc[i]?.total_streams_cumulative ?? 0);
      const prevTotal =
        i + 1 < props.seriesDesc.length
          ? Number(props.seriesDesc[i + 1]?.total_streams_cumulative ?? 0)
          : curTotal;
      if (i + 1 >= props.seriesDesc.length) return { date: d, daily: null };
      const daily = Math.max(0, curTotal - prevTotal);
      return { date: d, daily };
    });

    const tracksTotalDesc = datesDesc.map((d, i) => ({ date: d, value: Number(props.seriesDesc[i]?.track_count ?? 0) }));
    const tracksDailyDeltaDesc = datesDesc.map((d, i) => {
      const cur = Number(props.seriesDesc[i]?.track_count ?? 0);
      const prev = Number(props.seriesDesc[i + 1]?.track_count ?? 0);
      // oldest->newest diff is more intuitive, but we keep newest-first: compare to next older day
      return { date: d, daily: i + 1 < props.seriesDesc.length ? cur - prev : 0 };
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

  const monthlyChartDataForMetric = useMemo(() => {
    const base = monthlyData[metric];
    if (metric !== "revenue") return base;
    return base.map((d) => ({
      ...d,
      actualRevenueUsd: actualRevenueByMonth[String(d.month ?? "")] ?? null,
    }));
  }, [monthlyData, metric, actualRevenueByMonth]);

  const metricLabel = metric === "revenue" ? "Est. revenue" : metric === "streams" ? "Streams" : "Tracks";
  const dailyLabel =
    metric === "revenue" ? "Est. revenue (daily)" : metric === "streams" ? "Streams (daily)" : "Track change (daily)";
  const cumulativeLabel =
    metric === "revenue" ? "Est. revenue (cumulative)" : metric === "streams" ? "Streams (total)" : "Tracks";

  const valueFormat = metric === "revenue" ? "usd" : "int";
  const yTickFormat = metric === "revenue" ? "usd_compact" : metric === "streams" ? "k" : "int";
  const chartColor = metric === "tracks" ? "#3b82f6" : metric === "revenue" ? "#10b981" : "var(--sb-accent)";
  const valueCellColor =
    metric === "revenue" ? "#10b981" : metric === "streams" ? "var(--sb-accent)" : "var(--sb-text)";

  const payoutPerStreamUsd = streamPayoutPerStreamUsd;

  const computeComparisonRow = useCallback(
    (r: CollectorSummaryRow) => {
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

      const sparkFromDailySeries = sparkByCollector.get(r.collector);
      const spark =
        metric === "revenue"
          ? (sparkFromDailySeries?.revenue ?? null)
          : metric === "streams"
            ? (sparkFromDailySeries?.streams ?? null)
            : (sparkFromDailySeries?.tracks ?? null);

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
    },
    [metric, payoutPerStreamUsd, sparkByCollector, props.rangeDays, props.selectedCollector],
  );

  const [trackQuery, setTrackQuery] = useState("");
  const [trackSort, setTrackSort] = useState<TrackSort>("delta_desc");

  // Tracks table (in the collector details section) is stream-based data. When the global
  // metric is "tracks", we still show streams here (values + colors), matching other drilldowns.
  const tracksTableMetric: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";
  const tracksTableIsRevenue = tracksTableMetric === "revenue";
  const tracksTableTotalLabel = tracksTableIsRevenue ? "Est. revenue (total)" : "Streams (total)";
  const tracksTableDailyLabel = tracksTableIsRevenue ? "Est. revenue (daily)" : "Streams (daily)";

  type DrillKind = "playlists" | "artists" | "tracks";
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillKind, setDrillKind] = useState<DrillKind>("tracks");
  const [drillCollector, setDrillCollector] = useState<string | null>(null);
  const [drillQuery, setDrillQuery] = useState("");
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillDone, setDrillDone] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillItems, setDrillItems] = useState<unknown[]>([]);

  const DRILL_PAGE_SIZE = 200;

  // Effective metric for drilldowns:
  // - For Tracks drilldown, global "tracks" behaves like "streams" (values + colors).
  // - For Playlists/Artists drilldowns, global "tracks" shows track counts.
  const drillEffectiveMetric: Metric = drillKind === "tracks" && metric === "tracks" ? "streams" : metric;
  const drillIsTracksMetric = drillEffectiveMetric === "tracks";
  const drillIsRevenueMetric = drillEffectiveMetric === "revenue";
  const drillIsStreamsMetric = drillEffectiveMetric === "streams";
  const drillTracksColorClass = "text-blue-600 dark:text-blue-400 font-medium";
  const drillStreamsNumberClass = "sb-positive font-medium";
  const drillRevenueNumberClass = "font-medium";
  const drillMetricNumberClass = drillIsRevenueMetric
    ? drillRevenueNumberClass
    : drillIsStreamsMetric
      ? drillStreamsNumberClass
      : drillTracksColorClass;

  function openDrill(collector: string, kind: DrillKind) {
    setDrillCollector(collector);
    setDrillKind(kind);
    setDrillQuery("");
    setDrillError(null);
    setDrillItems([]);
    setDrillOffset(0);
    setDrillDone(false);
    setDrillOpen(true);
  }

  function formatMonthLong(monthKey: string): string {
    // monthKey: YYYY-MM
    const d = new Date(`${monthKey}-01T00:00:00Z`);
    if (!Number.isFinite(d.getTime())) return monthKey;
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }

  function openRevenueForecast(monthKey: string) {
    if (metric !== "revenue") return;
    const m = String(monthKey ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    setForecastError(null);
    setForecastMonth(m);
    const existing = actualRevenueByMonth[m];
    setForecastValue(existing == null ? "" : String(existing));
    setForecastOpen(true);
  }

  async function saveRevenueForecast(monthKey: string, amountUsd: number | null) {
    setForecastSaving(true);
    setForecastError(null);
    try {
      const res = await fetch("/api/collectors/monthly-revenue-forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collector: props.selectedCollector,
          month: monthKey,
          amount_usd: amountUsd,
        }),
      });
      const json: unknown = await res.json().catch(() => null);
      const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      if (!res.ok || obj?.ok !== true) {
        const err = obj?.error;
        throw new Error(typeof err === "string" ? err : `Request failed (${res.status})`);
      }

      setActualRevenueByMonth((prev) => {
        const next = { ...prev };
        if (amountUsd == null) {
          delete next[monthKey];
        } else {
          next[monthKey] = amountUsd;
        }
        return next;
      });

      setForecastOpen(false);
    } catch (e) {
      setForecastError(e instanceof Error ? e.message : String(e));
    } finally {
      setForecastSaving(false);
    }
  }

  useEffect(() => {
    if (!drillOpen) return;
    if (!drillCollector) return;

    let cancelled = false;

    async function run() {
      setDrillLoading(true);
      setDrillError(null);
      try {
        const res = await fetch("/api/collectors/comparison-drilldown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: drillKind,
            collector: drillCollector,
            run_date: props.latestRunDate,
            offset: drillOffset,
            limit: DRILL_PAGE_SIZE,
          }),
        });
        const json: unknown = await res.json().catch(() => null);
        const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
        if (!res.ok || obj?.ok !== true) {
          const err = obj?.error;
          throw new Error(typeof err === "string" ? err : `Request failed (${res.status})`);
        }
        const newItems = Array.isArray(obj?.items) ? (obj?.items as unknown[]) : [];
        if (!cancelled) {
          setDrillItems((prev) => (drillOffset === 0 ? newItems : [...prev, ...newItems]));
          setDrillDone(Boolean(obj?.done) || newItems.length < DRILL_PAGE_SIZE);
        }
      } catch (e) {
        if (!cancelled) setDrillError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [drillOpen, drillCollector, drillKind, drillOffset, props.latestRunDate]);

  const filteredSortedDrillItems = useMemo(() => {
    const q = drillQuery.trim().toLowerCase();
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
      // Sort by metric value (desc) while keeping deterministic ties.
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

    // tracks
    let items = drillItems.map(parseDrillTrackItem).filter(Boolean) as DrillTrackItem[];
    if (q) {
      items = items.filter((t) => {
        const name = String(t.name ?? "").toLowerCase();
        const isrc = String(t.isrc ?? "").toLowerCase();
        const artists = (t.artist_names ?? []).join(", ").toLowerCase();
        return name.includes(q) || isrc.includes(q) || artists.includes(q);
      });
    }
    // When the global metric is "tracks", we still treat this drilldown as streams,
    // so keep the API-provided ordering (daily delta desc) instead of name sorting.
    return items;
  }, [drillItems, drillKind, drillQuery, metric]);

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
  }, [props.collectorTracks, trackQuery, trackSort, tracksTableMetric, payoutPerStreamUsd]);

  const trackHeaderButton = useCallback(
    (args: {
      label: string;
      asc: TrackSort;
      desc: TrackSort;
      defaultDir: "asc" | "desc";
      align?: "left" | "right";
      title?: string;
    }) => {
      const isActiveAsc = trackSort === args.asc;
      const isActiveDesc = trackSort === args.desc;
      const arrow = isActiveAsc ? "↑" : isActiveDesc ? "↓" : "";
      const labelUpper = String(args.label ?? "").toUpperCase();

      return {
        label: (
          <button
            type="button"
            className={[
              "w-full whitespace-nowrap",
              args.align === "right" ? "text-right" : "text-left",
              "transition sb-link-hover",
            ].join(" ")}
            title={args.title ?? `Sort by ${labelUpper}`}
            onClick={() => {
              if (isActiveAsc) setTrackSort(args.desc);
              else if (isActiveDesc) setTrackSort(args.asc);
              else setTrackSort(args.defaultDir === "asc" ? args.asc : args.desc);
            }}
          >
            {labelUpper}
            {arrow ? <span className="ml-1 opacity-80">{arrow}</span> : null}
          </button>
        ),
        align: args.align,
      } as const;
    },
    [trackSort],
  );

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
        <SpotlightCard className="relative p-3 overflow-visible">
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
                { label: "Artists", className: "w-[84px] text-right" },
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
                          "sb-link-hover",
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
                    <TableCell numeric>
                      <button
                        type="button"
                        className="w-full text-right font-medium transition-colors sb-link-hover"
                        onClick={() => openDrill(r.collector, "playlists")}
                        title={`Show playlists for ${r.collector}`}
                      >
                        {formatInt(r.playlists)}
                      </button>
                    </TableCell>
                    <TableCell numeric>
                      <button
                        type="button"
                        className="w-full text-right font-medium transition-colors sb-link-hover"
                        onClick={() => openDrill(r.collector, "artists")}
                        title={`Show artists for ${r.collector}`}
                      >
                        {formatInt(r.artist_count)}
                      </button>
                    </TableCell>
                    <TableCell numeric>
                      <button
                        type="button"
                        className="w-full text-right font-medium transition-colors sb-link-hover"
                        onClick={() => openDrill(r.collector, "tracks")}
                        title={`Show tracks for ${r.collector}`}
                      >
                        {formatInt(r.track_count)}
                      </button>
                    </TableCell>
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
                        <Sparkline
                          data={row.spark ?? undefined}
                          trend="neutral"
                          upColor={metric === "revenue" ? valueCellColor : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </GlassTable>
        </div>
      </div>

      <Modal
        open={drillOpen}
        onClose={() => {
          setDrillOpen(false);
          setDrillQuery("");
          setDrillError(null);
          setDrillItems([]);
          setDrillOffset(0);
          setDrillDone(false);
        }}
        title={
          drillCollector ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{drillCollector}</span>
              <span className="opacity-60" style={{ color: "var(--sb-muted)" }}>
                •
              </span>
              <span className="font-medium">
                {drillKind === "playlists" ? "Playlists" : drillKind === "artists" ? "Artists" : "Tracks"}
              </span>
            </div>
          ) : (
            "Drilldown"
          )
        }
        subtitle={
          props.latestDate ? (
            <span>
              Data date {formatDateISO(props.latestDate)}{" "}
              <span className="opacity-60" style={{ color: "var(--sb-muted)" }}>
                •
              </span>{" "}
              Run date <span className="font-mono">{props.latestRunDate}</span>
            </span>
          ) : (
            <span>
              Run date <span className="font-mono">{props.latestRunDate}</span>
            </span>
          )
        }
        maxWidthClassName="max-w-6xl"
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-[240px] flex-1 items-center gap-2">
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
                <Input
                  type="text"
                  value={drillQuery}
                  onChange={(e) => setDrillQuery(e.target.value)}
                  placeholder={
                    drillKind === "playlists"
                      ? "Filter playlists…"
                      : drillKind === "artists"
                        ? "Filter artists…"
                        : "Filter tracks / artists / ISRC…"
                  }
                  className="pl-10 pr-9 py-2 text-sm"
                />
                {drillQuery.trim() ? (
                  <IconButton
                    type="button"
                    aria-label="Clear filter"
                    title="Clear filter"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md"
                    onClick={() => setDrillQuery("")}
                  >
                    <X className="h-4 w-4" style={{ color: "var(--sb-muted)" }} />
                  </IconButton>
                ) : null}
              </div>
            </div>

            <div className="text-xs whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
              {formatInt(filteredSortedDrillItems.length)} shown{drillQuery.trim() ? ` (filtered from ${formatInt(drillItems.length)})` : ""}
            </div>
          </div>

          {drillError ? (
            <div className="text-xs text-red-600 dark:text-red-400">{drillError}</div>
          ) : null}

          {drillKind === "playlists" ? (
            <GlassTable
              headers={
                drillIsTracksMetric
                  ? ["Playlist", "Type", { label: "Tracks", align: "right" }]
                  : [
                      "Playlist",
                      "Type",
                      { label: drillIsRevenueMetric ? "Total Revenue" : "Total Streams", align: "right" },
                      { label: drillIsRevenueMetric ? "Daily Revenue" : "Daily Streams", align: "right" },
                    ]
              }
              maxBodyHeightClassName="max-h-[520px]"
            >
              {(filteredSortedDrillItems as DrillPlaylistItem[]).map((p) => {
                const totalStreams = Number(p.total_streams_cumulative ?? 0);
                const dailyStreams = Number(p.daily_streams_net ?? 0);
                const totalValue = drillIsRevenueMetric
                  ? Number(p.est_revenue_total ?? totalStreams * payoutPerStreamUsd)
                  : totalStreams;
                const dailyValue = drillIsRevenueMetric
                  ? Number(p.est_revenue_daily_net ?? dailyStreams * payoutPerStreamUsd)
                  : dailyStreams;

                return (
                <TableRow key={String(p.playlist_key)}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {p.spotify_playlist_image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={String(p.spotify_playlist_image_url)}
                          alt={String(p.display_name ?? p.playlist_key)}
                          className="h-7 w-7 rounded-full object-cover sb-ring flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="h-7 w-7 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                          style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
                        >
                          {String(p.display_name ?? p.playlist_key).trim().slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/playlists?playlist_key=${encodeURIComponent(String(p.playlist_key))}`}
                          className="font-medium transition-colors sb-link-hover block truncate"
                        >
                          {String(p.display_name ?? p.playlist_key)}
                        </Link>
                        <div className="font-mono text-[11px] opacity-50">{String(p.playlist_key)}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{p.playlist_type ? String(p.playlist_type) : <span className="opacity-30">—</span>}</TableCell>
                  {drillIsTracksMetric ? (
                    <TableCell numeric className={drillTracksColorClass}>{formatInt(Number(p.track_count ?? 0))}</TableCell>
                  ) : (
                    <>
                      <TableCell numeric className={drillMetricNumberClass} style={drillIsRevenueMetric ? { color: "#10b981" } : undefined}>
                        {drillIsRevenueMetric ? formatUsd2(totalValue) : formatInt(totalValue)}
                      </TableCell>
                      <TableCell numeric className={drillMetricNumberClass} style={drillIsRevenueMetric ? { color: "#10b981" } : undefined}>
                        {drillIsRevenueMetric ? formatUsd2(dailyValue) : formatInt(dailyValue)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
                );
              })}
              {!(filteredSortedDrillItems as DrillPlaylistItem[]).length && !drillLoading ? (
                <TableRow>
                  <TableCell className="py-10 text-center opacity-50" colSpan={drillIsTracksMetric ? 3 : 4}>
                    No playlists found.
                  </TableCell>
                </TableRow>
              ) : null}
            </GlassTable>
          ) : drillKind === "artists" ? (
            <GlassTable
              headers={
                drillIsTracksMetric
                  ? [{ label: "Artist" }, { label: "Tracks", align: "right" }]
                  : [
                      { label: "Artist" },
                      { label: "Tracks", align: "right" },
                      { label: drillIsRevenueMetric ? "Total Revenue" : "Total Streams", align: "right" },
                      { label: drillIsRevenueMetric ? "Daily Revenue" : "Daily Streams", align: "right" },
                    ]
              }
              maxBodyHeightClassName="max-h-[520px]"
            >
              {(filteredSortedDrillItems as DrillArtistItem[]).map((a) => {
                const totalStreams = Number(a.total_streams_cumulative ?? 0);
                const dailyStreams = Number(a.daily_streams_delta ?? 0);
                const totalValue = drillIsRevenueMetric ? totalStreams * payoutPerStreamUsd : totalStreams;
                const dailyValue = drillIsRevenueMetric ? dailyStreams * payoutPerStreamUsd : dailyStreams;

                return (
                <TableRow key={String(a.artist_id)}>
                  <TableCell>
                    <div className="flex items-center gap-2 min-w-0">
                      {a.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={String(a.image_url)}
                          alt={String(a.name ?? a.artist_id)}
                          className="h-7 w-7 rounded-full object-cover sb-ring flex-shrink-0"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/catalog?artist_id=${encodeURIComponent(String(a.artist_id))}`}
                          className="font-medium transition-colors sb-link-hover block truncate"
                        >
                          {String(a.name ?? a.artist_id)}
                        </Link>
                        <div className="font-mono text-[11px] opacity-50">{String(a.artist_id)}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell numeric className={drillIsTracksMetric ? drillTracksColorClass : "font-medium"}>
                    {formatInt(Number(a.track_count ?? 0))}
                  </TableCell>
                  {drillIsTracksMetric ? null : (
                    <>
                      <TableCell numeric className={drillMetricNumberClass} style={drillIsRevenueMetric ? { color: "#10b981" } : undefined}>
                        {drillIsRevenueMetric ? formatUsd2(totalValue) : formatInt(totalValue)}
                      </TableCell>
                      <TableCell numeric className={drillMetricNumberClass} style={drillIsRevenueMetric ? { color: "#10b981" } : undefined}>
                        {drillIsRevenueMetric ? formatUsd2(dailyValue) : formatInt(dailyValue)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
                );
              })}
              {!(filteredSortedDrillItems as DrillArtistItem[]).length && !drillLoading ? (
                <TableRow>
                  <TableCell className="py-10 text-center opacity-50" colSpan={drillIsTracksMetric ? 2 : 4}>
                    No artists found.
                  </TableCell>
                </TableRow>
              ) : null}
            </GlassTable>
          ) : (
            <GlassTable
              headers={[
                "",
                "Track",
                "Artists",
                ...(drillIsTracksMetric
                  ? []
                  : [
                      { label: drillIsRevenueMetric ? "Total Revenue" : "Total Streams", align: "right" as const },
                      (
                        <span key="d1" title="Today minus yesterday (based on cumulative streams).">
                          {drillIsRevenueMetric ? "Daily Revenue" : "Daily Streams"}
                        </span>
                      ),
                    ]),
              ]}
              maxBodyHeightClassName="max-h-[520px]"
            >
              {(filteredSortedDrillItems as DrillTrackItem[]).map((t) => {
                const totalStreams = Number(t.total_streams_cumulative ?? 0);
                const dailyStreams = Number(t.daily_streams_delta ?? 0);
                const totalValue = drillIsRevenueMetric ? totalStreams * payoutPerStreamUsd : totalStreams;
                const dailyValue = drillIsRevenueMetric ? dailyStreams * payoutPerStreamUsd : dailyStreams;

                return (
                <TableRow key={String(t.isrc)}>
                  <TableCell>
                    {t.album_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={String(t.album_image_url)}
                        alt="Album cover"
                        className="h-8 w-8 rounded-lg object-cover sb-ring"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/tracks/${encodeURIComponent(String(t.isrc))}`}
                      className="font-medium transition-colors sb-link-hover"
                    >
                      {String(t.name ?? t.isrc)}
                    </Link>
                  </TableCell>
                  <TableCell className="min-w-[220px]">
                    {Array.isArray(t.artist_names) && t.artist_names.length ? (
                      <div className="truncate text-xs opacity-70" style={{ color: "var(--sb-text)" }}>
                        <ArtistLinks artistNames={t.artist_names} artistIds={Array.isArray(t.artist_ids) ? t.artist_ids : null} />
                      </div>
                    ) : (
                      <span className="opacity-30">—</span>
                    )}
                    <div className="font-mono text-[11px] opacity-40" style={{ color: "var(--sb-muted)" }}>
                      {String(t.isrc)}
                    </div>
                  </TableCell>
                  {drillIsTracksMetric ? null : (
                    <>
                      <TableCell numeric className={drillMetricNumberClass} style={drillIsRevenueMetric ? { color: "#10b981" } : undefined}>
                        {drillIsRevenueMetric ? formatUsd2(totalValue) : formatInt(totalValue)}
                      </TableCell>
                      <TableCell
                        numeric
                        className={
                          drillIsRevenueMetric
                            ? drillMetricNumberClass
                            : Number(t.daily_streams_delta ?? 0) < 0
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : drillStreamsNumberClass
                        }
                        style={drillIsRevenueMetric ? { color: "#10b981" } : undefined}
                      >
                        {drillIsRevenueMetric
                          ? formatUsd2(dailyValue)
                          : `${formatInt(dailyStreams)}`}
                      </TableCell>
                    </>
                  )}
                </TableRow>
                );
              })}
              {!(filteredSortedDrillItems as DrillTrackItem[]).length && !drillLoading ? (
                <TableRow>
                  <TableCell className="py-10 text-center opacity-50" colSpan={drillIsTracksMetric ? 3 : 5}>
                    No tracks found.
                  </TableCell>
                </TableRow>
              ) : null}
            </GlassTable>
          )}

          {!drillDone && !drillLoading ? (
            <div className="flex items-center justify-center pt-2">
              <button
                type="button"
                className="sb-ring rounded-full bg-white/70 px-4 py-2 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
                style={{ color: "var(--sb-text)" }}
                onClick={() => setDrillOffset((n) => n + DRILL_PAGE_SIZE)}
              >
                Load more
              </button>
            </div>
          ) : null}

          {drillLoading ? (
            <div className="text-center text-xs opacity-60" style={{ color: "var(--sb-muted)" }}>
              Loading…
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={forecastOpen}
        onClose={() => {
          setForecastOpen(false);
          setForecastError(null);
        }}
        title="Actual revenue"
        subtitle={
          forecastMonth ? (
            <span>
              {props.selectedCollector} • {formatMonthLong(forecastMonth)}
            </span>
          ) : (
            <span>{props.selectedCollector}</span>
          )
        }
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-3">
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            Set the actual revenue for this month (USD). This is shown as a diamond marker on the chart (when enabled).
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
              Amount (USD)
            </div>
            <Input
              type="text"
              inputMode="decimal"
              value={forecastValue}
              onChange={(e) => setForecastValue(e.target.value)}
              placeholder="e.g. 1234.56"
              className="text-sm"
            />
          </div>

          {forecastError ? (
            <div className="text-xs text-red-600 dark:text-red-400">{forecastError}</div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              className="sb-ring rounded-full bg-white/60 px-3 py-2 text-xs font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
              style={{ color: "var(--sb-text)" }}
              disabled={forecastSaving || !forecastMonth}
              onClick={() => {
                if (!forecastMonth) return;
                void saveRevenueForecast(forecastMonth, null);
              }}
              title="Clear actual revenue for this month"
            >
              Clear
            </button>
            <button
              type="button"
              className="sb-ring rounded-full bg-black px-4 py-2 text-xs font-medium text-white hover:bg-black/90 disabled:opacity-60 disabled:hover:bg-black dark:bg-white dark:text-black dark:hover:bg-white/90"
              disabled={forecastSaving || !forecastMonth}
              onClick={() => {
                if (!forecastMonth) return;
                const raw = forecastValue.trim();
                const cleaned = raw.replace(/[$,]/g, "");
                const n = Number(cleaned);
                if (!cleaned) {
                  setForecastError("Enter a USD amount, or click Clear to remove.");
                  return;
                }
                if (!Number.isFinite(n) || n < 0) {
                  setForecastError("Amount must be a number (>= 0).");
                  return;
                }
                void saveRevenueForecast(forecastMonth, n);
              }}
              title="Save actual revenue"
            >
              {forecastSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

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
          <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
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

          <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
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

        <SpotlightCard className="p-3 overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Monthly {metric === "revenue" ? "Est. Revenue" : metric === "streams" ? "Streams" : "Track"}
            </div>
            <div className="flex items-center gap-2">
              {metric === "revenue" ? (
                <Chip
                  selected={showActualRevenue}
                  onClick={() => setShowActualRevenue((v) => !v)}
                  title="Toggle actual revenue markers"
                >
                  Show actual
                </Chip>
              ) : null}
              <ChartCsvDownloadButton
                rows={(metric === "revenue" ? (monthlyChartDataForMetric as any) : (monthlyData[metric] as any)) as Array<Record<string, unknown>>}
                filename={`collectors-${slugifyForFilename(`monthly-${metric}`)}-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            All-time monthly aggregation (not affected by date range)
          </p>
          <div className="mt-3 min-h-[220px]">
            <MonthlyBarChart
              data={monthlyChartDataForMetric as any}
              valueLabel={metricLabel}
              valueFormat={valueFormat as any}
              yTickFormat={yTickFormat as any}
              heightPx={220}
              color={chartColor}
              showActualRevenue={metric === "revenue" && showActualRevenue}
              onMonthClick={metric === "revenue" ? openRevenueForecast : undefined}
            />
          </div>
        </SpotlightCard>

        {/* Top playlists (collapsible) */}
        <details
          open={openPlaylists}
          onToggle={(ev) => setOpenPlaylists(ev.currentTarget.open)}
          className="rounded-xl border sb-panel p-3"
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
                        href={`/playlists?playlist_key=${encodeURIComponent(String(p.playlist_key))}`}
                        className="font-medium transition-colors sb-link-hover"
                      >
                        {p.display_name}
                      </Link>
                    </div>
                    <div className="font-mono text-[11px] opacity-50">{p.playlist_key}</div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatUsd2(Number(p.daily_streams_net ?? 0) * payoutPerStreamUsd)}
                  </TableCell>
                  <TableCell className="sb-positive font-medium">
                    {formatInt(p.daily_streams_net)}
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
          className="rounded-xl border sb-panel p-3"
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
              Cumulative streams are totals from the DB on the data date. “Daily” is today minus yesterday (based on cumulative streams). Revenue is estimated from payout rate.
            </div>
            {/* Quick summary */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StatCard
              title="Top daily track"
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
                        className="block truncate transition-colors sb-link-hover font-medium text-xs"
                      >
                        {topTrackCards.bestDelta.name ?? topTrackCards.bestDelta.isrc}
                      </Link>
                      {topTrackCards.bestDelta.artist_names?.length ? (
                        <div className="text-xs opacity-60">
                          <ArtistLinks
                            artistNames={topTrackCards.bestDelta.artist_names}
                            artistIds={topTrackCards.bestDelta.artist_ids}
                          />
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
                        className="block truncate transition-colors sb-link-hover font-medium text-xs"
                      >
                        {topTrackCards.bestTotal.name ?? topTrackCards.bestTotal.isrc}
                      </Link>
                      {topTrackCards.bestTotal.artist_names?.length ? (
                        <div className="text-xs opacity-60">
                          <ArtistLinks
                            artistNames={topTrackCards.bestTotal.artist_names}
                            artistIds={topTrackCards.bestTotal.artist_ids}
                          />
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
                  trackHeaderButton({ label: "TRACK", asc: "name_asc", desc: "name_desc", defaultDir: "asc" }),
                  "ISRC",
                  trackHeaderButton({ label: "RELEASE DATE", asc: "release_asc", desc: "release_desc", defaultDir: "desc" }),
                  trackHeaderButton({ label: tracksTableTotalLabel.toUpperCase(), asc: "total_asc", desc: "total_desc", defaultDir: "desc", align: "right" }),
                  trackHeaderButton({
                    label: tracksTableDailyLabel.toUpperCase(),
                    asc: "delta_asc",
                    desc: "delta_desc",
                    defaultDir: "desc",
                    align: "right",
                    title: "Today minus yesterday (based on cumulative streams). Click to sort.",
                  }),
                  trackHeaderButton({ label: "DISTRO", asc: "distro_asc", desc: "distro_desc", defaultDir: "desc" }),
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
                        className="font-medium transition-colors sb-link-hover"
                      >
                        {t.name ?? t.isrc}
                      </Link>
                      {t.artist_names?.length ? (
                        <div className="mt-0.5 text-xs opacity-60">
                          <ArtistLinks
                            artistNames={t.artist_names}
                            artistIds={t.artist_ids}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                      {t.isrc}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {t.release_date ? (
                        <span className="font-mono text-[11px] opacity-70" style={{ color: "var(--sb-text)" }}>
                          {formatDateISO(t.release_date)}
                        </span>
                      ) : (
                        <span className="opacity-30">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={tracksTableIsRevenue ? "font-medium" : "sb-positive font-medium"}
                      style={tracksTableIsRevenue ? { color: "#10b981" } : undefined}
                    >
                      {t.total_streams_cumulative == null
                        ? "—"
                        : tracksTableIsRevenue
                          ? formatUsd2(t.total_streams_cumulative * payoutPerStreamUsd)
                          : formatInt(t.total_streams_cumulative)}
                    </TableCell>
                    <TableCell
                      className={
                        t.daily_streams_delta != null && t.daily_streams_delta < 0
                          ? "text-red-600 dark:text-red-400 font-medium"
                          : tracksTableIsRevenue
                            ? "font-medium"
                            : "sb-positive font-medium"
                      }
                      style={
                        tracksTableIsRevenue && !(t.daily_streams_delta != null && t.daily_streams_delta < 0)
                          ? { color: "#10b981" }
                          : undefined
                      }
                    >
                      {t.daily_streams_delta == null
                        ? "—"
                        : tracksTableIsRevenue
                          ? formatUsd2(t.daily_streams_delta * payoutPerStreamUsd)
                          : `${formatInt(t.daily_streams_delta)}`}
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
                                {distroKeys.length - 4}
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
                  <TableCell className="py-8 text-center opacity-50" colSpan={7}>
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
