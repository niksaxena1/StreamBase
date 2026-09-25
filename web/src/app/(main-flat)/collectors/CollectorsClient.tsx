"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { fetchApiJson } from "@/lib/api";
import { formatInt, formatUsd2 } from "@/lib/format";
import dynamic from "next/dynamic";

import type { CollectorDailyData, ComparisonMode } from "@/components/charts/CollectorComparisonChart";
import { granularityLabel, type Granularity } from "@/components/ui/GranularitySelect";
import { aggregateCumulativeSeries, aggregateDailySeries } from "@/lib/granularity";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { useMetric } from "@/components/metrics/MetricContext";
import { useChartStartDate } from "@/components/charts/ChartStartDateContext";
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
  type DrillKind,
  type DateBreakdownCollector,
} from "./collectorsTypes";

export type {
  CollectorSummaryRow,
  CollectorSeriesPoint,
  TopPlaylistRow,
  CollectorTrackRow,
  TrackSort,
} from "./collectorsTypes";

import type {
  CollectorOverlapArtistCell,
  CollectorOverlapCell,
  CollectorSummaryRow,
  CollectorSeriesPoint,
  TopPlaylistRow,
  CollectorTrackRow,
  TrackSort,
} from "./collectorsTypes";

import {
  aggregateByGranularity,
  aggregateMonthlyDelta,
  buildCollectorMetricSeries,
  buildCollectorSparklines,
  computeTopTrackCards,
  filterSortCollectorTracks,
  filterSortDrillItems,
} from "./collectorsUtils";

import { CollectorDrilldownModal } from "./CollectorDrilldownModal";
import { CollectorForecastModal } from "./CollectorForecastModal";
import { CollectorDateBreakdownModal } from "./CollectorDateBreakdownModal";
import { CollectorComparisonChartCard, CollectorComparisonTable } from "./CollectorComparisonSection";
import { CollectorMetricCharts } from "./CollectorMetricCharts";
import { CollectorPlaylistsDetails } from "./CollectorPlaylistsDetails";
import { CollectorTracksDetails } from "./CollectorTracksDetails";
import { TableSkeleton } from "@/components/ui/Skeleton";

const CollectorsOverlapMatrix = dynamic(
  () => import("./CollectorsOverlapMatrix").then((m) => ({ default: m.CollectorsOverlapMatrix })),
  {
    loading: () => <TableSkeleton rows={4} cols={6} />,
    ssr: false,
  },
);

const DistroMovementSection = dynamic(
  () => import("./DistroMovementSection").then((m) => ({ default: m.DistroMovementSection })),
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
  const [showComparisonMA7, setShowComparisonMA7] = useState<boolean>(() =>
    readStoredBool(COLLECTORS_COMPARISON_STORAGE.ma7Visible, false),
  );

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

  useEffect(() => {
    writeStoredBool(COLLECTORS_COMPARISON_STORAGE.ma7Visible, showComparisonMA7);
  }, [showComparisonMA7]);
  
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

  const sparkByCollector = useMemo(
    () => buildCollectorSparklines(props.allCollectorsSeries, chartStartDateIso, streamPayoutPerStreamUsd),
    [props.allCollectorsSeries, chartStartDateIso, streamPayoutPerStreamUsd],
  );

  const latest = props.seriesDesc[0] ?? null;

  const series = useMemo(
    () => buildCollectorMetricSeries(props.seriesDesc, streamPayoutPerStreamUsd),
    [props.seriesDesc, streamPayoutPerStreamUsd],
  );

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

  const filteredSortedDrillItems = useMemo(
    () => filterSortDrillItems(drillItems, drillKind, debouncedDrillQuery, metric),
    [drillItems, drillKind, debouncedDrillQuery, metric],
  );

  const filteredSortedTracks = useMemo(
    () =>
      filterSortCollectorTracks(
        collectorTracks,
        debouncedTrackQuery,
        trackSort,
        tracksTableMetric,
        payoutPerStreamUsd,
      ),
    [collectorTracks, debouncedTrackQuery, trackSort, tracksTableMetric, payoutPerStreamUsd],
  );

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

  const topTrackCards = useMemo(() => computeTopTrackCards(collectorTracks), [collectorTracks]);

  return (
    <div className="space-y-6">
      {/* Comparison chart + table */}
      <div className="sb-card p-4 space-y-4">
        <CollectorComparisonChartCard
          granularity={granularity}
          comparisonMode={comparisonMode}
          setComparisonMode={setComparisonMode}
          showComparisonMA7={showComparisonMA7}
          setShowComparisonMA7={setShowComparisonMA7}
          comparisonCollectors={comparisonCollectors}
          setComparisonCollectors={setComparisonCollectors}
          comparisonChartData={comparisonChartData}
          metric={metric}
          handleDateClick={handleDateClick}
        />

        {/* Comparison table */}
        <CollectorComparisonTable
          latestDate={props.latestDate}
          selectedCollector={props.selectedCollector}
          ranked={ranked}
          computeComparisonRow={computeComparisonRow}
          comparisonTableMetric={comparisonTableMetric}
          comparisonTableMetricLabel={comparisonTableMetricLabel}
          comparisonTableHeaderLabel={comparisonTableHeaderLabel}
          comparisonTableValueCellColor={comparisonTableValueCellColor}
          comparisonBaseline={comparisonBaseline}
          setComparisonBaseline={setComparisonBaseline}
          openDrill={openDrill}
        />
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
        <CollectorMetricCharts
          selectedCollector={props.selectedCollector}
          rangeDays={props.rangeDays}
          metric={metric}
          metricLabel={metricLabel}
          cumulativeLabel={cumulativeLabel}
          dailyLabel={dailyLabel}
          valueFormat={valueFormat}
          yTickFormat={yTickFormat}
          chartColor={chartColor}
          granCumulative={granCumulative}
          granDaily={granDaily}
          monthlyChartDataForMetric={monthlyChartDataForMetric}
          showActualRevenue={showActualRevenue}
          setShowActualRevenue={setShowActualRevenue}
          openRevenueForecast={openRevenueForecast}
        />

        {/* Top playlists (collapsible) */}
        <CollectorPlaylistsDetails
          openPlaylists={openPlaylists}
          setOpenPlaylists={setOpenPlaylists}
          latestDate={props.latestDate}
          topPlaylists={props.topPlaylists}
          playlistMetaByKey={playlistMetaByKey}
          payoutPerStreamUsd={payoutPerStreamUsd}
        />

        {/* Tracks (collapsible) */}
        <CollectorTracksDetails
          openTracks={openTracks}
          setOpenTracks={setOpenTracks}
          tracksLoaded={tracksLoaded}
          tracksLoading={tracksLoading}
          tracksError={tracksError}
          selectedCollector={props.selectedCollector}
          collectorTracks={collectorTracks}
          filteredSortedTracks={filteredSortedTracks}
          topTrackCards={topTrackCards}
          metric={metric}
          payoutPerStreamUsd={payoutPerStreamUsd}
          playlistMetaByKey={playlistMetaByKey}
          trackQuery={trackQuery}
          setTrackQuery={setTrackQuery}
          trackSort={trackSort}
          setTrackSort={setTrackSort}
          trackHeaderButton={trackHeaderButton}
          showIsrcInDistroCol={showIsrcInDistroCol}
          setShowIsrcInDistroCol={setShowIsrcInDistroCol}
          showIsrcOnMobile={showIsrcOnMobile}
          lpFiredRef={lpFiredRef}
          releaseLpDown={releaseLpDown}
          releaseLpMove={releaseLpMove}
          releaseLpUp={releaseLpUp}
          releaseLpCancel={releaseLpCancel}
          tracksTableIsRevenue={tracksTableIsRevenue}
          tracksTableTotalLabel={tracksTableTotalLabel}
          tracksTableDailyLabel={tracksTableDailyLabel}
        />
        </div>
      </div>

      <CollectorsOverlapMatrix
        overlapCells={props.overlapCells}
        overlapArtistCells={props.overlapArtistCells}
        latestRunDate={props.latestRunDate}
        useEntityPlaylistsForTotals={props.useEntityPlaylistsForTotals}
      />

      <DistroMovementSection />
    </div>
  );
}
