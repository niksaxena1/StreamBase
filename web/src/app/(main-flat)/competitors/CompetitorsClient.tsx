"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity } from "lucide-react";

import { ChartSkeleton } from "@/components/ui/Skeleton";

const CollectorComparisonChart = dynamic(
  () =>
    import("@/components/charts/CollectorComparisonChart").then((m) => ({
      default: m.CollectorComparisonChart,
    })),
  { loading: () => <ChartSkeleton height={260} />, ssr: false },
);
import { useChartStartDate } from "@/components/charts/ChartStartDateContext";
import { filterDailySeriesFromIsoDate } from "@/components/charts/chartUtils";
import { Sparkline } from "@/components/charts/Sparkline";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { fetchApiJson } from "@/lib/api";
import { dispatchCompetitorLabelChange } from "@/lib/competitorAccentEvents";
import { applyResolvedLabelAccents } from "@/lib/competitorLabelAccents";
import { CollectorDrilldownModal } from "@/app/(main-flat)/collectors/CollectorDrilldownModal";
import {
  DRILL_PAGE_SIZE,
  type DrillArtistItem,
  type DrillKind,
  type DrillPlaylistItem,
  type DrillTrackItem,
} from "@/app/(main-flat)/collectors/collectorsTypes";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";
import { readStoredString, writeStoredString } from "@/lib/storage";
import { CollectorDateBreakdownModal } from "@/app/(main-flat)/collectors/CollectorDateBreakdownModal";
import type { DateBreakdownCollector } from "@/app/(main-flat)/collectors/collectorsTypes";
import { scaleStreamsForDisplay } from "./competitorStreamMetric";

import { CompetitorLabelCards } from "./CompetitorLabelCards";
import {
  buildSeriesColorMap,
  buildSeriesLabelMap,
  buildSparkByLabel,
  labelSeriesToCollectorDailyData,
} from "./competitorComparisonAdapter";
import { LabelMultiSelect } from "./LabelMultiSelect";
import {
  COMPETITORS_COMPARISON_STORAGE,
  type ComparisonMode,
  type LabelComparisonRow,
  type LabelDailyPoint,
  type LabelRow,
} from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

// TODO(competitor-history-depth): once we have >=60 days of competitor history
// per label, add weekend-dip and spike callouts (parity with /home).

type ComparisonSortKey = "name" | "playlists" | "artists" | "tracks" | "metric" | "baseline";

export function CompetitorsClient(props: {
  labels: LabelRow[];
  comparisonRows: LabelComparisonRow[];
  labelSeries: LabelDailyPoint[];
  latestDataDate: string;
  latestRunDate: string;
  selectedCompetitorLabelKey: string | null;
  playlistsByLabel: Record<string, import("./competitorsTypes").PlaylistRow[]>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const { chartStartDateIso } = useChartStartDate();
  const labels = useMemo(() => applyResolvedLabelAccents(props.labels), [props.labels]);
  const activeLabels = useMemo(() => labels.filter((l) => l.is_active !== false), [labels]);
  const canCompare = activeLabels.length >= 2;

  const [selectedLabels, setSelectedLabels] = useState<string[]>(() => {
    const fromUrl = searchParams.get("labels");
    if (fromUrl) {
      const keys = fromUrl.split(",").filter((k) => activeLabels.some((l) => l.label_key === k));
      if (keys.length) return keys;
    }
    const stored = readStoredString(COMPETITORS_COMPARISON_STORAGE.labels);
    if (stored) {
      const keys = stored.split(",").filter((k) => activeLabels.some((l) => l.label_key === k));
      if (keys.length) return keys;
    }
    return activeLabels.map((l) => l.label_key);
  });

  const [mode, setMode] = useState<ComparisonMode>(() => {
    const urlMode = searchParams.get("mode");
    if (urlMode === "combined" || urlMode === "individual" || urlMode === "percentage") return urlMode;
    const stored = readStoredString(COMPETITORS_COMPARISON_STORAGE.mode);
    if (stored === "combined" || stored === "individual" || stored === "percentage") return stored;
    return "individual";
  });

  const [comparisonBaseline, setComparisonBaseline] = useState<"ma7" | "yday">("ma7");
  const [activeLabelKey, setActiveLabelKey] = useState<string | null>(props.selectedCompetitorLabelKey);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownDate, setBreakdownDate] = useState<string | null>(null);
  const [breakdownData, setBreakdownData] = useState<Record<string, DateBreakdownCollector> | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);
  const selectLabelInFlight = useRef(false);

  useEffect(() => {
    setActiveLabelKey(props.selectedCompetitorLabelKey);
  }, [props.selectedCompetitorLabelKey]);

  useEffect(() => {
    writeStoredString(COMPETITORS_COMPARISON_STORAGE.labels, selectedLabels.join(","));
    writeStoredString(COMPETITORS_COMPARISON_STORAGE.mode, mode);
  }, [mode, selectedLabels]);

  useEffect(() => {
    const labelsStr = selectedLabels.join(",");
    const t = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (params.get("labels") === labelsStr && params.get("mode") === mode) return;
      params.set("labels", labelsStr);
      params.set("mode", mode);
      router.replace(`?${params.toString()}`, { scroll: false });
    }, 300);
    return () => window.clearTimeout(t);
  }, [mode, router, searchParams, selectedLabels]);

  const effectiveMode: ComparisonMode =
    !canCompare && mode === "percentage" ? "individual" : mode;

  const seriesColors = useMemo(() => buildSeriesColorMap(labels), [labels]);
  const seriesLabels = useMemo(() => buildSeriesLabelMap(labels), [labels]);

  const comparisonChartData = useMemo(() => {
    const filtered = filterDailySeriesFromIsoDate(props.labelSeries, chartStartDateIso);
    return labelSeriesToCollectorDailyData(filtered);
  }, [chartStartDateIso, props.labelSeries]);

  const sparkByLabel = useMemo(
    () => buildSparkByLabel(props.labelSeries, chartStartDateIso, streamPayoutPerStreamUsd),
    [chartStartDateIso, props.labelSeries, streamPayoutPerStreamUsd],
  );

  const [sortKey, setSortKey] = useState<ComparisonSortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [drillOpen, setDrillOpen] = useState(false);
  const [drillKind, setDrillKind] = useState<DrillKind>("tracks");
  const [drillLabelKey, setDrillLabelKey] = useState<string | null>(null);
  const [drillQuery, setDrillQuery] = useState("");
  const [debouncedDrillQuery, setDebouncedDrillQuery] = useState("");
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillDone, setDrillDone] = useState(false);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillItems, setDrillItems] = useState<unknown[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedDrillQuery(drillQuery), 150);
    return () => clearTimeout(t);
  }, [drillQuery]);

  const toggleSort = useCallback((key: ComparisonSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "name" ? "asc" : "desc");
      return key;
    });
  }, []);

  const comparisonTableMetric: "streams" | "revenue" =
    metric === "revenue" ? "revenue" : "streams";
  const comparisonTableMetricLabel =
    comparisonTableMetric === "revenue" ? "est. revenue" : "streams";
  const comparisonTableHeaderLabel =
    comparisonTableMetric === "revenue" ? "REVENUE" : "STREAMS";
  const comparisonTableValueCellColor =
    comparisonTableMetric === "revenue" ? "#10b981" : "var(--sb-positive)";

  const ranked = useMemo(() => {
    const rows = [...props.comparisonRows];
    const dir = sortDir === "asc" ? 1 : -1;

    const metricValue = (row: LabelComparisonRow) =>
      comparisonTableMetric === "revenue"
        ? scaleStreamsForDisplay(row.dailyStreams, "revenue", streamPayoutPerStreamUsd)
        : row.dailyStreams;

    const baselineValue = (row: LabelComparisonRow) => {
      const raw =
        comparisonBaseline === "yday"
          ? row.dailyYesterday
          : row.dailyMa7;
      if (raw == null) return -Infinity;
      return comparisonTableMetric === "revenue"
        ? scaleStreamsForDisplay(raw, "revenue", streamPayoutPerStreamUsd)
        : raw;
    };

    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.label.display_name.localeCompare(b.label.display_name);
          break;
        case "playlists":
          cmp = a.playlistCount - b.playlistCount;
          break;
        case "artists":
          cmp = a.artistCount - b.artistCount;
          break;
        case "tracks":
          cmp = a.trackCount - b.trackCount;
          break;
        case "metric":
          cmp = metricValue(a) - metricValue(b);
          break;
        case "baseline":
          cmp = baselineValue(a) - baselineValue(b);
          break;
      }
      return cmp * dir;
    });
    return rows;
  }, [
    comparisonBaseline,
    comparisonTableMetric,
    props.comparisonRows,
    sortDir,
    sortKey,
    streamPayoutPerStreamUsd,
  ]);

  const drillLabelName = drillLabelKey ? (seriesLabels[drillLabelKey] ?? drillLabelKey) : null;
  const latestRunDate = props.latestRunDate;

  function openDrill(labelKey: string, kind: DrillKind) {
    setDrillLabelKey(labelKey);
    setDrillKind(kind);
    setDrillQuery("");
    setDrillError(null);
    setDrillItems([]);
    setDrillOffset(0);
    setDrillDone(false);
    setDrillOpen(true);
  }

  useEffect(() => {
    if (!drillOpen || !drillLabelKey || !latestRunDate) return;
    let cancelled = false;

    async function load() {
      setDrillLoading(true);
      setDrillError(null);
      try {
        const obj = await fetchApiJson<{
          ok?: boolean;
          items?: unknown[];
          done?: boolean;
        }>("/api/competitors/comparison-drilldown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: drillKind,
            label_key: drillLabelKey,
            run_date: latestRunDate,
            offset: drillOffset,
            limit: DRILL_PAGE_SIZE,
          }),
        });
        if (obj.ok !== true) throw new Error("Request failed");
        const newItems = obj.items ?? [];
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

    void load();
    return () => {
      cancelled = true;
    };
  }, [drillOpen, drillKind, drillLabelKey, drillOffset, latestRunDate]);

  const filteredSortedDrillItems = useMemo(() => {
    const q = debouncedDrillQuery.trim().toLowerCase();
    let items = [...drillItems] as (DrillPlaylistItem | DrillArtistItem | DrillTrackItem)[];

    if (q) {
      if (drillKind === "playlists") {
        items = (items as DrillPlaylistItem[]).filter((p) =>
          `${p.display_name} ${p.playlist_key}`.toLowerCase().includes(q),
        );
      } else if (drillKind === "artists") {
        items = (items as DrillArtistItem[]).filter((a) =>
          `${a.name ?? ""} ${a.artist_id}`.toLowerCase().includes(q),
        );
      } else {
        items = (items as DrillTrackItem[]).filter((t) =>
          `${t.name ?? ""} ${t.isrc} ${(t.artist_names ?? []).join(" ")}`.toLowerCase().includes(q),
        );
      }
    }

    if (drillKind === "playlists") {
      return [...(items as DrillPlaylistItem[])].sort((a, b) =>
        String(a.display_name ?? a.playlist_key).localeCompare(String(b.display_name ?? b.playlist_key)),
      );
    }
    if (drillKind === "artists") {
      return [...(items as DrillArtistItem[])].sort(
        (a, b) => Number(b.total_streams_cumulative ?? 0) - Number(a.total_streams_cumulative ?? 0),
      );
    }
    return [...(items as DrillTrackItem[])].sort(
      (a, b) => Number(b.total_streams_cumulative ?? 0) - Number(a.total_streams_cumulative ?? 0),
    );
  }, [debouncedDrillQuery, drillItems, drillKind]);

  const computeComparisonRow = useCallback(
    (row: LabelComparisonRow) => {
      const value =
        comparisonTableMetric === "revenue"
          ? scaleStreamsForDisplay(row.dailyStreams, "revenue", streamPayoutPerStreamUsd)
          : row.dailyStreams;

      const ydayValue =
        comparisonBaseline === "yday"
          ? row.dailyYesterday != null
            ? comparisonTableMetric === "revenue"
              ? scaleStreamsForDisplay(row.dailyYesterday, "revenue", streamPayoutPerStreamUsd)
              : row.dailyYesterday
            : null
          : row.dailyMa7 != null
            ? comparisonTableMetric === "revenue"
              ? scaleStreamsForDisplay(row.dailyMa7, "revenue", streamPayoutPerStreamUsd)
              : row.dailyMa7
            : null;

      const sparkFromSeries = sparkByLabel.get(row.label.label_key);
      const spark =
        metric === "revenue"
          ? (sparkFromSeries?.revenue ?? null)
          : metric === "tracks"
            ? (sparkFromSeries?.tracks ?? null)
            : (sparkFromSeries?.streams ?? null);

      const fmtValue =
        comparisonTableMetric === "revenue" ? formatUsd2(value) : formatInt(value);
      const fmtBaseline = (n: number | null | undefined) =>
        n == null
          ? "—"
          : comparisonTableMetric === "revenue"
            ? formatUsd2(n)
            : formatInt(Math.round(n));

      const playlistKey = props.playlistsByLabel[row.label.label_key]?.[0]?.playlist_key;
      const href = playlistKey
        ? `/playlists?playlist_key=${encodeURIComponent(playlistKey)}`
        : "/playlists";
      const isSelectedLabel = row.label.label_key === activeLabelKey;

      return {
        value,
        ydayValue: comparisonBaseline === "yday" ? ydayValue : null,
        ma7Value: comparisonBaseline === "ma7" ? ydayValue : null,
        spark,
        fmtValue,
        fmtBaseline: fmtBaseline(ydayValue),
        href,
        isSelectedLabel,
      } as const;
    },
    [
      comparisonBaseline,
      comparisonTableMetric,
      metric,
      props.playlistsByLabel,
      activeLabelKey,
      sparkByLabel,
      streamPayoutPerStreamUsd,
    ],
  );

  const chartMetric = metric === "tracks" ? "tracks" : metric === "revenue" ? "revenue" : "streams";

  const breakdownLabelKeys = useMemo(
    () => selectedLabels.filter((k) => activeLabels.some((l) => l.label_key === k)),
    [activeLabels, selectedLabels],
  );

  const handleDateClick = useCallback((date: string) => {
    setBreakdownDate(date);
    setBreakdownData(null);
    setBreakdownError(null);
    setBreakdownOpen(true);
  }, []);

  useEffect(() => {
    if (!breakdownOpen || !breakdownDate || breakdownLabelKeys.length === 0) return;
    let cancelled = false;

    async function load() {
      setBreakdownLoading(true);
      setBreakdownError(null);
      try {
        const obj = await fetchApiJson<{
          ok?: boolean;
          labels?: Record<string, DateBreakdownCollector>;
        }>("/api/competitors/date-breakdown", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_date: breakdownDate,
            label_keys: breakdownLabelKeys,
          }),
        });
        if (obj.ok !== true) throw new Error("Request failed");
        if (!cancelled) setBreakdownData(obj.labels ?? null);
      } catch (e) {
        if (!cancelled) setBreakdownError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [breakdownOpen, breakdownDate, breakdownLabelKeys]);

  const selectCompetitorLabel = useCallback(
    async (labelKey: string) => {
      if (!labelKey || labelKey === activeLabelKey || selectLabelInFlight.current) return;
      const label = labels.find((l) => l.label_key === labelKey);
      setActiveLabelKey(labelKey);
      dispatchCompetitorLabelChange({
        labelKey,
        accentHex: label?.accent_hex ?? null,
      });
      selectLabelInFlight.current = true;
      try {
        const res = await fetch("/api/user-settings/competitor-label", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ competitor_label_key: labelKey }),
        });
        if (!res.ok) {
          setActiveLabelKey(props.selectedCompetitorLabelKey);
          dispatchCompetitorLabelChange({
            labelKey: props.selectedCompetitorLabelKey,
            accentHex:
              labels.find((l) => l.label_key === props.selectedCompetitorLabelKey)?.accent_hex ?? null,
          });
        }
      } catch {
        setActiveLabelKey(props.selectedCompetitorLabelKey);
      } finally {
        selectLabelInFlight.current = false;
      }
    },
    [activeLabelKey, labels, props.selectedCompetitorLabelKey],
  );

  return (
    <div className="space-y-6">
      <CompetitorLabelCards rows={props.comparisonRows} playlistsByLabel={props.playlistsByLabel} />

      <div className="sb-card p-4 space-y-4">
        <SpotlightCard className="relative p-3 overflow-visible">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5 opacity-60" />
                  <div className="text-xs font-medium uppercase tracking-wide opacity-70">Competitor Comparison</div>
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                  Compare revenue, streams, and track change over time
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <ChipGroup segmented>
                  {(["combined", "individual", "percentage"] as const).map((m) => (
                    <Chip
                      key={m}
                      segmented
                      selected={effectiveMode === m}
                      onClick={() => setMode(m)}
                      disabled={m === "percentage" && !canCompare}
                    >
                      {m === "combined" ? "Combined" : m === "individual" ? "Individual" : "Percentage"}
                    </Chip>
                  ))}
                </ChipGroup>

                <div className="flex flex-wrap items-center" style={{ gap: "0.2rem" }}>
                  <LabelMultiSelect labels={labels} selected={selectedLabels} onChange={setSelectedLabels} />
                </div>
              </div>
            </div>

            {!canCompare ? (
              <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Add another competitor to enable percentage comparison and overlap analysis.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {effectiveMode !== "combined" && selectedLabels.length > 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  {activeLabels
                    .filter((l) => selectedLabels.includes(l.label_key))
                    .map((label, index) => (
                      <div key={label.label_key} className="flex items-center gap-1.5 text-xs">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: seriesColors[label.label_key] ?? labelColor(label, index) }}
                        />
                        <span style={{ color: "var(--sb-text)" }}>{label.display_name}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <div />
              )}
            </div>

            <div className="mt-2 min-h-[260px]">
              <CollectorComparisonChart
                data={comparisonChartData}
                selectedCollectors={selectedLabels}
                mode={effectiveMode}
                metric={chartMetric}
                heightPx={260}
                granularity="daily"
                seriesColors={seriesColors}
                seriesLabels={seriesLabels}
                emptyStateMessage="Select at least one competitor to view the chart"
                onDateClick={handleDateClick}
              />
            </div>
          </div>
          <div
            className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full opacity-15 blur-3xl"
            style={{ background: "var(--sb-accent)" }}
          />
        </SpotlightCard>

        <div className="space-y-2">
          <div className="flex items-end justify-between px-1">
            <div>
              <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
                Comparison Table
              </div>
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                Showing {comparisonTableMetricLabel} on data date{" "}
                {props.latestDataDate ? formatDateISO(props.latestDataDate) : "—"}
              </div>
            </div>
          </div>

          <GlassTable
            tableLayout="fixed"
            className="relative"
            bodyClassName="overflow-x-auto"
            headers={[
              {
                label: (
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="w-full text-left font-medium"
                    title="Sort by competitor name"
                  >
                    Competitor{sortKey === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ),
                className: "sticky left-0 z-20 min-w-[110px]",
              },
              {
                label: (
                  <button
                    type="button"
                    onClick={() => toggleSort("playlists")}
                    className="w-full text-right font-medium"
                    title="Sort by playlist count"
                  >
                    Pl{sortKey === "playlists" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ),
                className: "w-[70px] text-right",
              },
              {
                label: (
                  <button
                    type="button"
                    onClick={() => toggleSort("artists")}
                    className="w-full text-right font-medium"
                    title="Sort by artist count"
                  >
                    Artists{sortKey === "artists" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ),
                className: "w-[84px] text-right",
              },
              {
                label: (
                  <button
                    type="button"
                    onClick={() => toggleSort("tracks")}
                    className="w-full text-right font-medium"
                    title="Sort by track count"
                  >
                    Tracks{sortKey === "tracks" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ),
                className: "w-[84px] text-right",
              },
              {
                label: (
                  <button
                    type="button"
                    onClick={() => toggleSort("metric")}
                    className="w-full text-right font-medium"
                    title={`Sort by ${comparisonTableMetricLabel}`}
                  >
                    {comparisonTableHeaderLabel}
                    {sortKey === "metric" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                  </button>
                ),
                className: "w-[110px] text-right",
              },
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
            {ranked.map((row, index) => {
              const computed = computeComparisonRow(row);
              const stickyBg = computed.isSelectedLabel
                ? "color-mix(in srgb, var(--sb-accent) 28%, var(--sb-surface))"
                : "var(--sb-surface)";

              return (
                <TableRow
                  key={row.label.label_key}
                  className={[
                    "cursor-pointer",
                    computed.isSelectedLabel
                      ? "hover:bg-transparent dark:hover:bg-transparent odd:bg-transparent dark:odd:bg-transparent"
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={
                    computed.isSelectedLabel
                      ? {
                          background: "color-mix(in srgb, var(--sb-accent) 28%, var(--sb-surface))",
                        }
                      : undefined
                  }
                  onClick={() => void selectCompetitorLabel(row.label.label_key)}
                >
                  <TableCell className="sticky left-0 z-10 px-0 py-0" style={{ background: stickyBg }}>
                    <Link
                      href={computed.href}
                      onClick={(e) => e.stopPropagation()}
                      className={[
                        "flex h-full w-full items-center gap-2 px-3 py-2 font-medium transition-colors sb-link-hover",
                        computed.isSelectedLabel ? "opacity-100" : "opacity-70",
                      ].join(" ")}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor:
                            seriesColors[row.label.label_key] ?? labelColor(row.label, index),
                        }}
                        aria-hidden="true"
                      />
                      {row.label.display_name}
                    </Link>
                  </TableCell>
                  <TableCell numeric>
                    <button
                      type="button"
                      className="w-full text-right font-medium transition-colors sb-link-hover"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrill(row.label.label_key, "playlists");
                      }}
                      title={`Show playlists for ${row.label.display_name}`}
                    >
                      {formatInt(row.playlistCount)}
                    </button>
                  </TableCell>
                  <TableCell numeric>
                    <button
                      type="button"
                      className="w-full text-right font-medium transition-colors sb-link-hover"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrill(row.label.label_key, "artists");
                      }}
                      title={`Show artists for ${row.label.display_name}`}
                    >
                      {formatInt(row.artistCount)}
                    </button>
                  </TableCell>
                  <TableCell numeric>
                    <button
                      type="button"
                      className="w-full text-right font-medium transition-colors sb-link-hover"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrill(row.label.label_key, "tracks");
                      }}
                      title={`Show tracks for ${row.label.display_name}`}
                    >
                      {formatInt(row.trackCount)}
                    </button>
                  </TableCell>
                  <TableCell
                    numeric
                    className="font-medium"
                    style={{ color: comparisonTableValueCellColor }}
                  >
                    {computed.fmtValue}
                  </TableCell>
                  <TableCell numeric>{computed.fmtBaseline}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="h-5 w-20 opacity-60">
                      <Sparkline
                        data={computed.spark ?? undefined}
                        trend="neutral"
                        upColor={
                          comparisonTableMetric === "revenue" ? comparisonTableValueCellColor : undefined
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </GlassTable>
        </div>
      </div>

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
        drillCollector={drillLabelName}
        drillKind={drillKind}
        latestDate={props.latestDataDate}
        latestRunDate={latestRunDate ?? ""}
        drillQuery={drillQuery}
        setDrillQuery={setDrillQuery}
        filteredSortedDrillItems={filteredSortedDrillItems}
        drillItemsCount={drillItems.length}
        drillError={drillError}
        drillLoading={drillLoading}
        drillDone={drillDone}
        onLoadMore={() => setDrillOffset((n) => n + DRILL_PAGE_SIZE)}
        metric={metric}
        payoutPerStreamUsd={streamPayoutPerStreamUsd}
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
        comparisonCollectors={breakdownLabelKeys}
        metric={metric}
        streamPayoutPerStreamUsd={streamPayoutPerStreamUsd}
        seriesColors={seriesColors}
        seriesLabels={seriesLabels}
      />
    </div>
  );
}
