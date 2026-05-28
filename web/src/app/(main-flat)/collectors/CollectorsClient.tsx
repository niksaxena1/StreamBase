"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Search, X } from "lucide-react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { MonthlyBarChart } from "@/components/charts/MonthlyBarChart";
import { Sparkline } from "@/components/charts/Sparkline";
import { StatCard } from "@/components/StatCard";
import { fetchApiJson } from "@/lib/api";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";
import dynamic from "next/dynamic";

import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import {
  COLLECTOR_COLORS,
  type CollectorDailyData,
  type ComparisonMode,
} from "@/components/charts/CollectorComparisonChart";

const CollectorComparisonChart = dynamic(
  () =>
    import("@/components/charts/CollectorComparisonChart").then((m) => ({
      default: m.CollectorComparisonChart,
    })),
  { loading: () => <ChartSkeleton height={260} />, ssr: false },
);
import { CollectorMultiSelect } from "@/components/ui/CollectorMultiSelect";
import { granularityLabel, type Granularity } from "@/components/ui/GranularitySelect";
import { aggregateCumulativeSeries, aggregateDailySeries } from "@/lib/granularity";
import { MenuSelect, type MenuSelectOption } from "@/components/ui/MenuSelect";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { IconButton } from "@/components/ui/Button";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { useMetric } from "@/components/metrics/MetricContext";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { useChartStartDate } from "@/components/charts/ChartStartDateContext";
import { filterDailySeriesFromIsoDate } from "@/components/charts/chartUtils";
import { computeDailyRollingAvg7, computeRollingAvg7 } from "@/components/charts/chartUtils";
import { useLongPress } from "@/components/charts/useLongPress";
import {
  readStoredBool,
  writeStoredBool,
  readStoredString,
  writeStoredString,
} from "@/lib/storage";

import {
  COLLECTOR_ORDER,
  GRANULARITIES,
  COLLECTORS_DETAILS_STORAGE,
  COLLECTORS_COMPARISON_STORAGE,
  COLLECTORS_MONTHLY_ACTUAL_REVENUE_STORAGE,
  DRILL_PAGE_SIZE,
  isCollectorKey,
  type Metric,
  type DrillKind,
  type DrillPlaylistItem,
  type DrillArtistItem,
  type DrillTrackItem,
  type DateBreakdownCollector,
} from "./collectorsTypes";

// Track sort types and options
export type TrackSort =
  | "delta_desc"
  | "delta_asc"
  | "total_desc"
  | "total_asc"
  | "release_desc"
  | "release_asc"
  | "name_asc"
  | "name_desc"
  | "distro_desc"
  | "distro_asc";

const SORTS: MenuSelectOption[] = [
  { value: "delta_desc", label: "Daily ↓" },
  { value: "delta_asc", label: "Daily ↑" },
  { value: "total_desc", label: "Total ↓" },
  { value: "total_asc", label: "Total ↑" },
  { value: "release_desc", label: "Release ↓" },
  { value: "release_asc", label: "Release ↑" },
  { value: "name_asc", label: "Name ↑" },
  { value: "name_desc", label: "Name ↓" },
  { value: "distro_desc", label: "Distro ↓" },
  { value: "distro_asc", label: "Distro ↑" },
];

export type {
  CollectorSummaryRow,
  CollectorSeriesPoint,
  TopPlaylistRow,
  CollectorTrackRow,
} from "./collectorsTypes";

import type {
  CollectorOverlapArtistCell,
  CollectorOverlapCell,
  CollectorSummaryRow,
  CollectorSeriesPoint,
  TopPlaylistRow,
  CollectorTrackRow,
} from "./collectorsTypes";

import {
  parseDrillPlaylistItem,
  parseDrillArtistItem,
  parseDrillTrackItem,
  aggregateByGranularity,
  aggregateMonthlyDelta,
} from "./collectorsUtils";

import { CollectorDrilldownModal } from "./CollectorDrilldownModal";
import { CollectorForecastModal } from "./CollectorForecastModal";
import { CollectorDateBreakdownModal } from "./CollectorDateBreakdownModal";
import { TableSkeleton } from "@/components/ui/Skeleton";

const CollectorsOverlapMatrix = dynamic(
  () => import("./CollectorsOverlapMatrix").then((m) => ({ default: m.CollectorsOverlapMatrix })),
  {
    loading: () => <TableSkeleton rows={4} cols={6} />,
    ssr: false,
  },
);

export function CollectorsClient(props: {
  latestDate: string | null;
  latestRunDate: string;
  useEntityPlaylistsForTotals: boolean;
  overlapCells: CollectorOverlapCell[];
  overlapArtistCells: CollectorOverlapArtistCell[];
  selectedCollector: string;
  rangeDays: number;
  granularity?: Granularity;
  summary: CollectorSummaryRow[];
  seriesDesc: CollectorSeriesPoint[];
  seriesAllTime: CollectorSeriesPoint[];
  topPlaylists: TopPlaylistRow[];
  selectedPlaylistsMeta: Array<{
    playlist_key: string;
    display_name: string;
    spotify_playlist_image_url: string | null;
  }>;
  allCollectorsSeries: CollectorDailyData[];
  allCollectorsAllTime: CollectorDailyData[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const { metric } = useMetric();
  const { chartStartDateIso } = useChartStartDate();

  const [openPlaylists, setOpenPlaylists] = useState(true);
  const [openTracks, setOpenTracks] = useState(false);
  const [collectorTracks, setCollectorTracks] = useState<CollectorTrackRow[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [tracksLoaded, setTracksLoaded] = useState(false);
  const tracksLoadStarted = useRef(false);
  const [comparisonBaseline, setComparisonBaseline] = useState<"ma7" | "yday">("ma7");

  useEffect(() => {
    if (!openTracks || tracksLoaded || tracksLoadStarted.current) return;
    tracksLoadStarted.current = true;
    let cancelled = false;

    async function loadTracks() {
      setTracksLoading(true);
      setTracksError(null);
      try {
        const data = await fetchApiJson<{ tracks: CollectorTrackRow[] }>(
          `/api/collectors/tracks?collector=${encodeURIComponent(props.selectedCollector)}&run_date=${encodeURIComponent(props.latestRunDate)}`,
        );
        if (!cancelled) {
          setCollectorTracks(data.tracks ?? []);
          setTracksLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          setTracksError(e instanceof Error ? e.message : String(e));
          tracksLoadStarted.current = false;
        }
      } finally {
        if (!cancelled) setTracksLoading(false);
      }
    }

    void loadTracks();
    return () => {
      cancelled = true;
    };
  }, [openTracks, props.latestRunDate, props.selectedCollector, tracksLoaded]);

  useEffect(() => {
    tracksLoadStarted.current = false;
    setTracksLoaded(false);
    setCollectorTracks([]);
    setTracksError(null);
  }, [props.selectedCollector, props.latestRunDate]);

  const [showActualRevenue, setShowActualRevenue] = useState<boolean>(() =>
    readStoredBool(COLLECTORS_MONTHLY_ACTUAL_REVENUE_STORAGE.visible, true),
  );
  useEffect(() => {
    writeStoredBool(COLLECTORS_MONTHLY_ACTUAL_REVENUE_STORAGE.visible, showActualRevenue);
  }, [showActualRevenue]);

  // Distro/ISRC column toggle (default: show distro)
  const [showIsrcInDistroCol, setShowIsrcInDistroCol] = useState(false);

  const [actualRevenueByMonth, setActualRevenueByMonth] = useState<Record<string, number>>({});
  const [forecastOpen, setForecastOpen] = useState(false);
  const [forecastMonth, setForecastMonth] = useState<string | null>(null);
  const [forecastValue, setForecastValue] = useState<string>("");
  const [forecastSaving, setForecastSaving] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  const [comparisonCollectors, setComparisonCollectors] = useState<string[]>(() => {
    const urlCollectors = searchParams.get("collectors");
    if (urlCollectors) {
      const fromUrl = urlCollectors.split(",").filter(isCollectorKey);
      if (fromUrl.length) return fromUrl;
    }
    return ["PL", "TG"];
  });
  
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>(() => {
    const urlMode = searchParams.get("mode");
    if (urlMode === "combined" || urlMode === "individual" || urlMode === "percentage") {
      return urlMode;
    }
    return "individual";
  });

  // Granularity is now controlled from the page header via props
  const granularity = props.granularity ?? "daily";

  useEffect(() => {
    let changed = false;

    if (!searchParams.get("mode")) {
      const stored = readStoredString(COLLECTORS_COMPARISON_STORAGE.mode);
      if (stored === "combined" || stored === "individual" || stored === "percentage") {
        setComparisonMode(stored);
        changed = true;
      }
    }

    if (!searchParams.get("collectors")) {
      const stored = readStoredString(COLLECTORS_COMPARISON_STORAGE.collectors);
      if (stored) {
        const fromStored = stored.split(",").filter(isCollectorKey);
        if (fromStored.length) {
          setComparisonCollectors(fromStored);
          changed = true;
        }
      }
    }

    void changed;
    // Intentional: restore storage on mount; don't use setters as dependencies (would loop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setOpenPlaylists(readStoredBool(COLLECTORS_DETAILS_STORAGE.playlistsOpen, true));
    setOpenTracks(readStoredBool(COLLECTORS_DETAILS_STORAGE.tracksOpen, false));
  }, []);

  useEffect(() => {
    writeStoredBool(COLLECTORS_DETAILS_STORAGE.playlistsOpen, openPlaylists);
  }, [openPlaylists]);

  useEffect(() => {
    writeStoredBool(COLLECTORS_DETAILS_STORAGE.tracksOpen, openTracks);
  }, [openTracks]);
  
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparisonCollectors, comparisonMode, granularity]);

  useEffect(() => {
    if (metric !== "revenue") return;
    let cancelled = false;

    async function load() {
      try {
        const obj = await fetchApiJson<{
          ok?: boolean;
          items?: unknown[];
        }>(
          `/api/collectors/monthly-revenue-forecast?collector=${encodeURIComponent(props.selectedCollector)}`,
          { method: "GET" },
        );
        if (obj.ok !== true) return;

        const items = Array.isArray(obj.items) ? obj.items : [];
        const next: Record<string, number> = {};
        for (const it of items) {
          if (!it || typeof it !== "object") continue;
          const rec = it as Record<string, unknown>;
          const month = String(rec.month ?? "").trim();
          const amount = Number(rec.amount_usd);
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

  const comparisonChartData = useMemo(() => {
    const sourceData = granularity === "daily" ? props.allCollectorsSeries : props.allCollectorsAllTime;
    return aggregateByGranularity(sourceData, granularity, comparisonCollectors, streamPayoutPerStreamUsd);
  }, [granularity, props.allCollectorsSeries, props.allCollectorsAllTime, comparisonCollectors, streamPayoutPerStreamUsd]);

  useEffect(() => {
    try {
      localStorage.setItem("sb:last_collector", props.selectedCollector);
    } catch {
      // ignore
    }
  }, [props.selectedCollector]);

  const ranked = useMemo(() => {
    const rows = [...props.summary];
    rows.sort((a, b) => {
      const aIndex = (COLLECTOR_ORDER as readonly string[]).indexOf(a.collector);
      const bIndex = (COLLECTOR_ORDER as readonly string[]).indexOf(b.collector);
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
      const revenue = rows
        .map((r) => {
          const v = r.est_revenue_daily_net;
          const n = v == null ? Number(r.daily_streams_net ?? 0) * streamPayoutPerStreamUsd : Number(v);
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
    };
  }, [props.seriesDesc, streamPayoutPerStreamUsd]);

  const monthlyData = useMemo(() => {
    // Use seriesAllTime for monthly aggregation so it's not affected by date range selector
    return {
      revenue: aggregateMonthlyDelta(props.seriesAllTime, "revenue", streamPayoutPerStreamUsd),
      streams: aggregateMonthlyDelta(props.seriesAllTime, "streams", streamPayoutPerStreamUsd),
      tracks: aggregateMonthlyDelta(props.seriesAllTime, "tracks", streamPayoutPerStreamUsd),
    };
  }, [props.seriesAllTime, streamPayoutPerStreamUsd]);

  const monthlyChartDataForMetric = useMemo(() => {
    const base = monthlyData[metric];
    if (metric !== "revenue") return base;
    return base.map((d) => ({
      ...d,
      actualRevenueUsd: actualRevenueByMonth[String(d.month ?? "")] ?? null,
    }));
  }, [monthlyData, metric, actualRevenueByMonth]);

  const granCumulative = useMemo(
    () => aggregateCumulativeSeries(series[metric].cumulative, granularity),
    [series, metric, granularity],
  );
  const granDaily = useMemo(
    () => aggregateDailySeries(series[metric].daily, granularity),
    [series, metric, granularity],
  );

  const gLabel = granularityLabel(granularity);
  const metricLabel = metric === "revenue" ? "Est. revenue" : metric === "streams" ? "Streams" : "Tracks";
  const dailyLabel =
    metric === "revenue"
      ? `Est. revenue (${gLabel.toLowerCase()})`
      : metric === "streams"
        ? `${gLabel} Streams`
        : `Track change (${gLabel.toLowerCase()})`;
  const cumulativeLabel =
    metric === "revenue" ? "Est. revenue (cumulative)" : metric === "streams" ? "Streams (total)" : "Tracks";

  const valueFormat: "int" | "usd" = metric === "revenue" ? "usd" : "int";
  const yTickFormat: "k" | "int" | "usd_compact" = metric === "revenue" ? "usd_compact" : metric === "streams" ? "k" : "int";
  const chartColor = metric === "tracks" ? "#3b82f6" : metric === "revenue" ? "#10b981" : "var(--sb-positive)";

  const payoutPerStreamUsd = streamPayoutPerStreamUsd;

  const comparisonTableMetric: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";
  const comparisonTableMetricLabel = comparisonTableMetric === "revenue" ? "Est. revenue" : "Streams";
  const comparisonTableHeaderLabel = comparisonTableMetric === "revenue" ? "REVENUE" : "STREAMS";
  const comparisonTableValueCellColor = comparisonTableMetric === "revenue" ? "#10b981" : "var(--sb-positive)";

  const computeComparisonRow = useCallback(
    (r: CollectorSummaryRow) => {
      const value =
        comparisonTableMetric === "revenue"
          ? Number(r.daily_streams_net ?? 0) * payoutPerStreamUsd
          : Number(r.daily_streams_net ?? 0);

      const deltaYday =
        comparisonTableMetric === "revenue"
          ? (r.daily_streams_delta_yday == null ? null : Number(r.daily_streams_delta_yday) * payoutPerStreamUsd)
          : r.daily_streams_delta_yday;

      const deltaMa7 =
        comparisonTableMetric === "revenue"
          ? (r.daily_streams_delta_ma7 == null ? null : Number(r.daily_streams_delta_ma7) * payoutPerStreamUsd)
          : r.daily_streams_delta_ma7;

      const ydayValue = deltaYday != null ? value - deltaYday : null;
      const ma7Value = deltaMa7 != null ? value - deltaMa7 : null;

      const sparkFromDailySeries = sparkByCollector.get(r.collector);
      const spark =
        comparisonTableMetric === "revenue"
          ? (sparkFromDailySeries?.revenue ?? null)
          : (sparkFromDailySeries?.streams ?? null);

      const fmtValue = comparisonTableMetric === "revenue" ? formatUsd2(value) : formatInt(value);

      const fmtYdayOrMa7 =
        comparisonTableMetric === "revenue"
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
    [comparisonTableMetric, payoutPerStreamUsd, sparkByCollector, props.rangeDays, props.selectedCollector],
  );

  const [trackQuery, setTrackQuery] = useState("");
  // Debounce the filter/sort pipeline so it doesn't run on every keystroke.
  const [debouncedTrackQuery, setDebouncedTrackQuery] = useState("");
  const trackQueryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (trackQueryDebounceRef.current) clearTimeout(trackQueryDebounceRef.current);
    trackQueryDebounceRef.current = setTimeout(() => setDebouncedTrackQuery(trackQuery), 150);
    return () => {
      if (trackQueryDebounceRef.current) clearTimeout(trackQueryDebounceRef.current);
    };
  }, [trackQuery]);

  const [trackSort, setTrackSort] = useState<TrackSort>("delta_desc");

  const [showIsrcOnMobile, setShowIsrcOnMobile] = useState(false);
  const lpFiredRef = useRef(false);

  const toggleIsrcRelease = useCallback(() => {
    setShowIsrcOnMobile((prev) => !prev);
    lpFiredRef.current = true;
  }, []);

  const {
    onPointerDown: releaseLpDown,
    onPointerMove: releaseLpMove,
    onPointerUp: releaseLpUp,
    onPointerCancel: releaseLpCancel,
  } = useLongPress({ onLongPress: toggleIsrcRelease });

  const tracksTableMetric: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";
  const tracksTableIsRevenue = tracksTableMetric === "revenue";
  const tracksTableTotalLabel = tracksTableIsRevenue ? "Est. revenue (total)" : "Streams (total)";
  const tracksTableDailyLabel = tracksTableIsRevenue ? "Est. revenue (daily)" : "Streams (daily)";

  /* ── Date breakdown modal state ──────────────────────────────── */

  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownDate, setBreakdownDate] = useState<string | null>(null);
  const [breakdownData, setBreakdownData] = useState<Record<string, DateBreakdownCollector> | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

  const handleDateClick = useCallback((date: string) => {
    setBreakdownDate(date);
    setBreakdownData(null);
    setBreakdownError(null);
    setBreakdownOpen(true);
  }, []);

  useEffect(() => {
    if (!breakdownOpen || !breakdownDate) return;
    let cancelled = false;

    async function load() {
      setBreakdownLoading(true);
      setBreakdownError(null);
      try {
        const obj = await fetchApiJson<{
          ok?: boolean;
          collectors?: Record<string, DateBreakdownCollector>;
        }>("/api/collectors/date-breakdown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_date: breakdownDate,
            collectors: comparisonCollectors,
          }),
        });
        if (obj.ok !== true) {
          throw new Error("Request failed");
        }
        if (!cancelled) {
          setBreakdownData(obj.collectors ?? null);
        }
      } catch (e) {
        if (!cancelled) setBreakdownError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [breakdownOpen, breakdownDate, comparisonCollectors]);

  /* ── Drilldown modal state ───────────────────────────────────── */

  const [drillOpen, setDrillOpen] = useState(false);
  const [drillKind, setDrillKind] = useState<DrillKind>("tracks");
  const [drillCollector, setDrillCollector] = useState<string | null>(null);
  const [drillQuery, setDrillQuery] = useState("");
  const [debouncedDrillQuery, setDebouncedDrillQuery] = useState("");
  const drillQueryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (drillQueryDebounceRef.current) clearTimeout(drillQueryDebounceRef.current);
    drillQueryDebounceRef.current = setTimeout(() => setDebouncedDrillQuery(drillQuery), 150);
    return () => {
      if (drillQueryDebounceRef.current) clearTimeout(drillQueryDebounceRef.current);
    };
  }, [drillQuery]);

  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillDone, setDrillDone] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillItems, setDrillItems] = useState<unknown[]>([]);

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
      const obj = await fetchApiJson<{ ok?: boolean }>("/api/collectors/monthly-revenue-forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collector: props.selectedCollector,
          month: monthKey,
          amount_usd: amountUsd,
        }),
      });
      if (obj.ok !== true) {
        throw new Error("Request failed");
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
        const obj = await fetchApiJson<{
          ok?: boolean;
          items?: unknown[];
          done?: boolean;
        }>("/api/collectors/comparison-drilldown", {
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
        if (obj.ok !== true) {
          throw new Error("Request failed");
        }
        const newItems = Array.isArray(obj.items) ? obj.items : [];
        if (!cancelled) {
          setDrillItems((prev) => (drillOffset === 0 ? newItems : [...prev, ...newItems]));
          setDrillDone(Boolean(obj.done) || newItems.length < DRILL_PAGE_SIZE);
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
  }, [drillItems, drillKind, debouncedDrillQuery, metric]);

  const filteredSortedTracks = useMemo(() => {
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
  }, [collectorTracks, debouncedTrackQuery, trackSort, tracksTableMetric, payoutPerStreamUsd]);

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
  }, [collectorTracks]);

  return (
    <div className="space-y-6">
      {/* Comparison chart + table */}
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
                <ChipGroup segmented>
                  {(["combined", "individual", "percentage"] as const).map((m) => (
                    <Chip key={m} segmented selected={comparisonMode === m} onClick={() => setComparisonMode(m)}>
                      {m === "combined" ? "Combined" : m === "individual" ? "Individual" : "Percentage"}
                    </Chip>
                  ))}
                </ChipGroup>

                <div className="flex flex-wrap items-center" style={{ gap: "0.2rem" }}>
                  <CollectorMultiSelect selected={comparisonCollectors} onChange={setComparisonCollectors} />
                </div>
              </div>
            </div>

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

            <div className="mt-2 min-h-[260px]">
              <CollectorComparisonChart
                data={comparisonChartData}
                selectedCollectors={comparisonCollectors}
                mode={comparisonMode}
                metric={metric}
                heightPx={260}
                granularity={granularity}
                onDateClick={granularity === "daily" ? handleDateClick : undefined}
              />
            </div>
          </div>
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
                Showing {comparisonTableMetricLabel.toLowerCase()} on data date{" "}
                {props.latestDate ? formatDateISO(props.latestDate) : "—"}
              </div>
            </div>
          </div>

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
                { label: comparisonTableHeaderLabel, className: "w-[110px] text-right font-medium" },
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
                      style={{ color: comparisonTableValueCellColor }}
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
                          upColor={comparisonTableMetric === "revenue" ? comparisonTableValueCellColor : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </GlassTable>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}

      <CollectorDrilldownModal
        open={drillOpen}
        onClose={() => {
          setDrillOpen(false);
          setDrillQuery("");
          setDrillError(null);
          setDrillItems([]);
          setDrillOffset(0);
          setDrillDone(false);
        }}
        drillCollector={drillCollector}
        drillKind={drillKind}
        latestDate={props.latestDate}
        latestRunDate={props.latestRunDate}
        drillQuery={drillQuery}
        setDrillQuery={setDrillQuery}
        filteredSortedDrillItems={filteredSortedDrillItems}
        drillItemsCount={drillItems.length}
        drillError={drillError}
        drillLoading={drillLoading}
        drillDone={drillDone}
        onLoadMore={() => setDrillOffset((n) => n + DRILL_PAGE_SIZE)}
        metric={metric}
        payoutPerStreamUsd={payoutPerStreamUsd}
      />

      <CollectorForecastModal
        open={forecastOpen}
        onClose={() => {
          setForecastOpen(false);
          setForecastError(null);
        }}
        selectedCollector={props.selectedCollector}
        forecastMonth={forecastMonth}
        forecastValue={forecastValue}
        setForecastValue={setForecastValue}
        forecastError={forecastError}
        forecastSaving={forecastSaving}
        onSave={(month, amount) => void saveRevenueForecast(month, amount)}
        onClear={(month) => void saveRevenueForecast(month, null)}
      />

      <CollectorDateBreakdownModal
        open={breakdownOpen}
        onClose={() => {
          setBreakdownOpen(false);
          setBreakdownData(null);
          setBreakdownError(null);
        }}
        breakdownDate={breakdownDate}
        breakdownData={breakdownData}
        breakdownLoading={breakdownLoading}
        breakdownError={breakdownError}
        comparisonCollectors={comparisonCollectors}
        metric={metric}
        streamPayoutPerStreamUsd={streamPayoutPerStreamUsd}
      />

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
                rows={granCumulative as unknown as Array<Record<string, unknown>>}
                filename={`collectors-${slugifyForFilename(cumulativeLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
            <div className="mt-2 min-h-[220px]">
              <DailyStreamsChart
                data={granCumulative}
                valueLabel={metricLabel}
                valueFormat={valueFormat}
                yTickFormat={yTickFormat}
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
                rows={granDaily as unknown as Array<Record<string, unknown>>}
                filename={`collectors-${slugifyForFilename(dailyLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
            <div className="mt-2 min-h-[220px]">
              <DailyStreamsWithMAChart
                data={granDaily}
                valueLabel={metric === "tracks" ? "Tracks" : metricLabel}
                valueFormat={valueFormat}
                yTickFormat={yTickFormat}
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
                rows={(monthlyChartDataForMetric) as unknown as Array<Record<string, unknown>>}
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
              data={monthlyChartDataForMetric}
              valueLabel={metricLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
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
                          <PreviewableArtwork
                            src={imgUrl}
                            alt={label}
                            width={24}
                            height={24}
                            className="h-6 w-6 rounded-full object-cover sb-ring flex-shrink-0"
                            label={label}
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
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                    Tracks
                  </div>
                  {!openTracks && !tracksLoaded ? (
                    <div className="mt-0.5 text-[10px] font-normal normal-case opacity-50">
                      Expand to load the full track list
                    </div>
                  ) : null}
                </div>
              </div>
              <div
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
              >
                <ChartCsvDownloadButton
                  rows={collectorTracks as unknown as Array<Record<string, unknown>>}
                  filename={`collectors-${slugifyForFilename(props.selectedCollector)}-tracks-${todayIsoDate()}.csv`}
                  title="Download CSV"
                />
              </div>
            </div>
          </summary>

          <div className="mt-3 space-y-4">
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Cumulative streams are totals from the DB on the data date. &quot;Daily&quot; is today minus yesterday (based on cumulative streams). Revenue is estimated from payout rate.
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
                      <PreviewableArtwork
                        src={topTrackCards.bestDelta.album_image_url}
                        alt="Album cover"
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded object-cover"
                        label={topTrackCards.bestDelta.name ?? topTrackCards.bestDelta.isrc}
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
              distroName={
                topTrackCards.bestDelta?.distro_playlist_names?.[0]
              }
              distroImageUrl={
                topTrackCards.bestDelta?.distro_playlist_image_urls?.[0]
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
                      <PreviewableArtwork
                        src={topTrackCards.bestTotal.album_image_url}
                        alt="Album cover"
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded object-cover"
                        label={topTrackCards.bestTotal.name ?? topTrackCards.bestTotal.isrc}
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
              distroName={
                topTrackCards.bestTotal?.distro_playlist_names?.[0]
              }
              distroImageUrl={
                topTrackCards.bestTotal?.distro_playlist_image_urls?.[0]
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

            <MenuSelect value={trackSort} options={SORTS} onChange={(v) => setTrackSort(v as TrackSort)} align="right" ariaLabel="Sort tracks" />

            <div className="text-xs whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
              {formatInt(filteredSortedTracks.length)} / {formatInt(collectorTracks.length)}
            </div>
            </div>

            {tracksError ? (
              <div className="mt-3 text-xs text-red-500">{tracksError}</div>
            ) : null}
            {tracksLoading ? (
              <div className="mt-3 text-xs" style={{ color: "var(--sb-muted)" }}>
                Loading tracks…
              </div>
            ) : null}

            <div className="mt-4">
              <GlassTable
                headers={[
                  "",
                  trackHeaderButton({ label: "TRACK", asc: "name_asc", desc: "name_desc", defaultDir: "asc" }),
                  {
                    label: (
                      <button
                        type="button"
                        onClick={() => setShowIsrcInDistroCol((v) => !v)}
                        className="flex items-center gap-1 uppercase tracking-wider text-[11px] font-medium opacity-60 hover:opacity-100 transition-opacity"
                        title={showIsrcInDistroCol ? "Show distro playlist" : "Show ISRC"}
                      >
                        {showIsrcInDistroCol ? "ISRC" : "DISTRO"}
                        <span className="opacity-50 text-[9px]">⇄</span>
                      </button>
                    ),
                    className: "hidden sm:table-cell",
                  },
                  {
                    label: (
                      <div
                        onPointerDown={releaseLpDown}
                        onPointerMove={releaseLpMove}
                        onPointerUp={releaseLpUp}
                        onPointerCancel={releaseLpCancel}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (lpFiredRef.current) { lpFiredRef.current = false; return; }
                            setTrackSort(trackSort === "release_asc" ? "release_desc" : "release_asc");
                          }}
                          className="w-full text-left select-none cursor-default uppercase"
                          style={{ color: "inherit" }}
                        >
                          <span className="sm:hidden">{showIsrcOnMobile ? "ISRC" : "RELEASE DATE"}</span>
                          <span className="hidden sm:inline">RELEASE DATE</span>
                        </button>
                      </div>
                    ),
                  },
                  trackHeaderButton({ label: tracksTableTotalLabel.toUpperCase(), asc: "total_asc", desc: "total_desc", defaultDir: "desc", align: "right" }),
                  trackHeaderButton({
                    label: tracksTableDailyLabel.toUpperCase(),
                    asc: "delta_asc",
                    desc: "delta_desc",
                    defaultDir: "desc",
                    align: "right",
                    title: "Today minus yesterday (based on cumulative streams). Click to sort.",
                  }),
                ]}
                maxBodyHeightClassName="max-h-[520px]"
              >
              {filteredSortedTracks.map((t) => {
                const distroKeys = (t.distro_playlist_keys ?? []).filter(Boolean);
                const distroNames = (t.distro_playlist_names ?? []).filter(Boolean);
                const distroImages = (t.distro_playlist_image_urls ?? []).filter(Boolean);
                const distroTitle = distroNames.length ? distroNames.join(", ") : distroKeys.join(", ");

                return (
                  <TableRow key={t.isrc}>
                    <TableCell>
                      {t.album_image_url ? (
                        <PreviewableArtwork
                          src={t.album_image_url}
                          alt="Album cover"
                          width={32}
                          height={32}
                          className="h-8 w-8 rounded-lg object-cover sb-ring"
                          label={t.name ?? t.isrc}
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
                    <TableCell className="hidden sm:table-cell">
                      {showIsrcInDistroCol ? (
                        <CopyableIsrc
                          isrc={t.isrc}
                          className="font-mono text-xs opacity-40"
                          style={{ color: "var(--sb-muted)" }}
                        />
                      ) : distroNames.length ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          {distroImages[0] ? (
                            <PreviewableArtwork
                              src={distroImages[0]}
                              alt={distroNames[0]}
                              width={20}
                              height={20}
                              className="h-5 w-5 rounded flex-shrink-0 object-cover"
                              label={distroNames[0]}
                            />
                          ) : (
                            <div className="h-5 w-5 rounded flex-shrink-0 bg-orange-400/20" />
                          )}
                          <span className="truncate text-xs" style={{ color: "var(--sb-muted)" }}>{distroNames[0]}</span>
                        </div>
                      ) : (
                        <span className="text-xs opacity-30" style={{ color: "var(--sb-muted)" }}>—</span>
                      )}
                    </TableCell>
                    <TableCell
                      mono
                      className="whitespace-nowrap text-xs opacity-40"
                      style={{ color: "var(--sb-muted)" }}
                    >
                      {showIsrcOnMobile ? (
                        <CopyableIsrc isrc={t.isrc} className="text-xs opacity-100" style={{ color: "var(--sb-muted)" }} />
                      ) : t.release_date ? (
                        formatDateISO(t.release_date)
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
                                <PreviewableArtwork
                                  key={k}
                                  src={imgUrl}
                                  alt={label}
                                  width={20}
                                  height={20}
                                  className="h-5 w-5 rounded-full object-cover sb-ring"
                                  label={label}
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

      <CollectorsOverlapMatrix
        overlapCells={props.overlapCells}
        overlapArtistCells={props.overlapArtistCells}
        latestRunDate={props.latestRunDate}
        useEntityPlaylistsForTotals={props.useEntityPlaylistsForTotals}
      />
    </div>
  );
}
