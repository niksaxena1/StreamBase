"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Download, Music } from "lucide-react";
import { fetchUserSettingsBundle, invalidateUserSettingsBundle } from "@/lib/userSettingsBundleFetch";

import { useMetric } from "@/components/metrics/MetricContext";
import { LazyInteractiveChartSection } from "@/components/dashboard/LazyInteractiveChartSection";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { Alert } from "@/components/ui/Alert";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { computeRollingAvg7 } from "@/components/charts/chartUtils";
import { useCurrencyDisplay } from "@/components/currency/CurrencyDisplayContext";

import type { PlaylistDailyStatsRow, ManualOverrideAnnotation, ChartPoint } from "./home/homeTypes";
import { rollSum } from "./home/homeUtils";
import { HomeScatterSection } from "./home/HomeScatterSection";
import { HomeMilestonesSection } from "./home/HomeMilestonesSection";
import { HomeDailyDistributionSection } from "./home/HomeDailyDistributionSection";
import { HomeHistorySection } from "./home/HomeHistorySection";
import { HomeFilterBuilderSection } from "./home/HomeFilterBuilderSection";

// ============================================================================
// Helpers (header-only)
// ============================================================================

function hrefWith(
  existing: { scope?: string; range?: string; daily?: string; xy_date?: string },
  patch: { scope?: string; range?: string; daily?: string; xy_date?: string | null },
) {
  const scope = (patch.scope ?? existing.scope ?? "all_catalog").toString();
  const range = (patch.range ?? existing.range ?? "30").toString();
  const daily = (patch.daily ?? existing.daily ?? "").toString();
  const xy_date =
    patch.xy_date === null ? null : (patch.xy_date ?? existing.xy_date ?? null);
  return hrefWithPatchedSearchParams("", { scope, range, daily, xy_date }, { prefix: "/?" });
}

function ToggleLink(props: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={props.href}
      className={[
        "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
        props.active
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
      ].join(" ")}
    >
      {props.children}
    </Link>
  );
}

// ============================================================================
// Main orchestrator component
// ============================================================================

function HomeDashboardInner(props: {
  sp: { scope?: string; range?: string; daily?: string; xy_date?: string };
  playlistKey: "all_catalog" | "releases" | "ext";
  title: string;
  rangeDays: number;
  latest: PlaylistDailyStatsRow | null;
  history: PlaylistDailyStatsRow[];
  playlistImageUrl: string | null;
  historyErrorMessage?: string | null;
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterErrorMessage?: string | null;
  trackScatterDataDate: string | null;
  latestRunDate: string | null;
  latestDataDate: string | null;
  overrideAnnotations?: ManualOverrideAnnotation[];
}) {
  const { metric } = useMetric();
  // Subscribe so money values re-render when currency setting changes.
  useCurrencyDisplay();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [selectedChart, setSelectedChart] = useState<"daily" | "total">("daily");

  // User setting: show/hide Filters section on Home
  const [homeFiltersEnabled, setHomeFiltersEnabled] = useState(true);
  const [homeFiltersConfigured, setHomeFiltersConfigured] = useState(true);

  // Fetch Home Filters setting (shares request with other context providers).
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchUserSettingsBundle();
        if (cancelled) return;
        setHomeFiltersEnabled(data.home_filters_enabled ?? true);
        setHomeFiltersConfigured(data.configured !== false);
      } catch {
        // ignore
      }
    }

    void load();

    function onUpdated() {
      invalidateUserSettingsBundle();
      void load();
    }

    window.addEventListener("sb:home-filters-setting-updated", onUpdated as any);
    return () => {
      cancelled = true;
      window.removeEventListener("sb:home-filters-setting-updated", onUpdated as any);
    };
  }, []);

  // ============================================================================
  // Chart series computation
  // ============================================================================

  const series = useMemo(() => {
    const desc = props.history ?? [];

    const safeNum = (n: unknown) => {
      const v = Number(n ?? 0);
      return Number.isFinite(v) ? v : 0;
    };

    const dailyDeltaFromTotalsDesc = (rowsDesc: PlaylistDailyStatsRow[]) =>
      rowsDesc.map((r, idx) => {
        if (idx >= rowsDesc.length - 1) return null;
        const cur = safeNum(r?.total_streams_cumulative);
        const prev = safeNum(rowsDesc[idx + 1]?.total_streams_cumulative);
        return cur - prev;
      });

    if (metric === "revenue") {
      const dailyDeltas = dailyDeltaFromTotalsDesc(desc);
      const dailyDesc = desc.map((r, idx) => ({
        date: dataDateFromRunDate(r.date),
        value: dailyDeltas[idx] == null ? null : dailyDeltas[idx]! * streamPayoutPerStreamUsd,
      }));
      const totalDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: safeNum(r.total_streams_cumulative) * streamPayoutPerStreamUsd,
      }));
      const dailyValue =
        desc.length >= 2
          ? (safeNum(desc[0]?.total_streams_cumulative) - safeNum(desc[1]?.total_streams_cumulative)) *
            streamPayoutPerStreamUsd
          : 0;
      return {
        daily: computeRollingAvg7(dailyDesc),
        total: totalDesc,
        dailyValue,
        totalValue: safeNum(props.latest?.total_streams_cumulative) * streamPayoutPerStreamUsd,
        dailyTitle: "Revenue (Daily)",
        totalTitle: "Revenue (Total)",
        dailyValueLabel: "Revenue",
        totalValueLabel: "Revenue",
        valueFormat: "usd" as const,
        yTickFormat: "usd_compact" as const,
        color: "#10b981",
      };
    }

    if (metric === "tracks") {
      const totalDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: Number(r.track_count ?? 0),
      }));
      const dailyDeltaDesc = desc.map((r, idx) => {
        const prev = idx < desc.length - 1 ? desc[idx + 1] : null;
        const daily = prev ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0) : 0;
        return { date: dataDateFromRunDate(r.date), value: daily };
      });
      const dailyValue =
        desc.length >= 2
          ? Number(desc[0]?.track_count ?? 0) - Number(desc[1]?.track_count ?? 0)
          : 0;
      return {
        daily: computeRollingAvg7(dailyDeltaDesc),
        total: totalDesc,
        dailyValue,
        totalValue: Number(props.latest?.track_count ?? 0),
        dailyTitle: "Track Change (Daily)",
        totalTitle: "Track Count",
        dailyValueLabel: "Tracks",
        totalValueLabel: "Tracks",
        valueFormat: "int" as const,
        yTickFormat: "int" as const,
        color: "#3b82f6",
      };
    }

    // streams (default)
    const dailyDeltas = dailyDeltaFromTotalsDesc(desc);
    const dailyDesc = desc.map((r, idx) => ({
      date: dataDateFromRunDate(r.date),
      value: dailyDeltas[idx],
    }));
    const totalDesc = desc.map((r) => ({
      date: dataDateFromRunDate(r.date),
      value: safeNum(r.total_streams_cumulative),
    }));
    const dailyValue =
      desc.length >= 2
        ? safeNum(desc[0]?.total_streams_cumulative) - safeNum(desc[1]?.total_streams_cumulative)
        : 0;
    return {
      daily: computeRollingAvg7(dailyDesc),
      total: totalDesc,
      dailyValue,
      totalValue: safeNum(props.latest?.total_streams_cumulative),
      dailyTitle: "Daily Streams",
      totalTitle: "Total Streams",
      dailyValueLabel: "Streams",
      totalValueLabel: "Total Streams",
      valueFormat: "int" as const,
      yTickFormat: "k" as const,
      color: undefined,
    };
  }, [metric, props.history, props.latest, streamPayoutPerStreamUsd]);

  const chartDataDaily: ChartPoint[] = series.daily;
  const chartDataTotal: ChartPoint[] = series.total;

  const allCatalogMa7 = useMemo(() => {
    if (props.playlistKey !== "all_catalog") return null;
    const hist = props.history ?? [];
    if (hist.length < 2) return null;
    const deltas: number[] = [];
    for (let i = 0; i < Math.min(7, hist.length - 1); i++) {
      const cur = Number(hist[i]?.total_streams_cumulative ?? 0);
      const prev = Number(hist[i + 1]?.total_streams_cumulative ?? 0);
      if (!Number.isFinite(cur) || !Number.isFinite(prev)) continue;
      deltas.push(cur - prev);
    }
    if (!deltas.length) return null;
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
  }, [props.history, props.playlistKey]);

  const allCatalogAsOf = props.latest?.date
    ? formatDateISO(dataDateFromRunDate(props.latest.date))
    : null;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            {props.playlistKey === "all_catalog" ? (
              <div
                className="sb-ring flex h-10 w-10 items-center justify-center rounded-lg"
                style={{ background: "var(--sb-accent)" }}
              >
                <Music className="h-5 w-5" style={{ color: "black" }} />
              </div>
            ) : props.playlistImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.playlistImageUrl}
                alt="Playlist cover"
                className="h-10 w-10 rounded-lg object-cover sb-ring"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg sb-ring bg-white/60" />
            )}
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                {props.title}
              </h1>
              <a
                href="/api/reports/playlist-streams-7d"
                className={[
                  "inline-flex items-center justify-center rounded p-1 transition-colors",
                  "hover:bg-black/5 dark:hover:bg-white/10",
                  "opacity-30 hover:opacity-100",
                ].join(" ")}
                style={{ color: "var(--sb-muted)" }}
                title="Download 7-day playlist streams report (XLSX)"
                aria-label="Download 7-day playlist streams report (XLSX)"
              >
                <Download className="h-4 w-4" />
              </a>
              {props.latest?.track_count !== null && props.latest?.track_count !== undefined && (
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide"
                  style={{
                    borderColor: "var(--sb-border)",
                    backgroundColor: "var(--sb-surface)",
                    color: "var(--sb-muted)",
                  }}
                >
                  {formatInt(props.latest.track_count)} tracks
                </span>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Overview of your catalog performance across all playlists.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <ToggleLink active={props.playlistKey === "all_catalog"} href={hrefWith(props.sp, { scope: "all_catalog" })}>All</ToggleLink>
            <ToggleLink active={props.playlistKey === "releases"} href={hrefWith(props.sp, { scope: "releases" })}>Releases</ToggleLink>
            <ToggleLink active={props.playlistKey === "ext"} href={hrefWith(props.sp, { scope: "ext" })}>Ext</ToggleLink>
          </div>

          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <ToggleLink active={props.rangeDays === 30} href={hrefWith(props.sp, { range: "30" })}>30d</ToggleLink>
            <ToggleLink active={props.rangeDays === 90} href={hrefWith(props.sp, { range: "90" })}>90d</ToggleLink>
            <ToggleLink active={props.rangeDays === 365} href={hrefWith(props.sp, { range: "365" })}>365d</ToggleLink>
          </div>
        </div>
      </div>

      {props.playlistKey === "all_catalog" && allCatalogMa7 !== null ? (
        <blockquote
          className="rounded-lg border-l-4 sb-blockquote-bg p-3 text-sm"
          style={{ borderColor: "var(--sb-accent)" }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-semibold" style={{ color: "var(--sb-text)" }}></span>
            <span className="font-mono" style={{ color: "var(--sb-text)" }}>
              {formatInt(Math.round(allCatalogMa7))}
            </span>
            <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
              MA7 daily streams
              {allCatalogAsOf ? ` (as of ${allCatalogAsOf})` : ""}
            </span>
          </div>
        </blockquote>
      ) : null}

      <LazyInteractiveChartSection
        dailyStreamsData={chartDataDaily}
        totalStreamsData={chartDataTotal}
        dailyStreamsValue={series.dailyValue}
        totalStreamsValue={series.totalValue}
        rangeDays={props.rangeDays}
        dailyTitle={series.dailyTitle}
        totalTitle={series.totalTitle}
        dailyValueLabel={series.dailyValueLabel}
        totalValueLabel={series.totalValueLabel}
        valueFormat={series.valueFormat}
        yTickFormat={series.yTickFormat}
        color={series.color}
        accentColor={series.color}
        annotations={metric === "tracks" ? [] : (props.overrideAnnotations ?? [])}
        selectedChart={selectedChart}
        onSelectChart={setSelectedChart}
      />

      {props.historyErrorMessage ? (
        <Alert variant="error" title="Query error">
          {props.historyErrorMessage}
        </Alert>
      ) : null}

      {/* Extracted sections -- each manages its own state independently */}
      <HomeScatterSection
        trackScatterPoints={props.trackScatterPoints}
        trackScatterErrorMessage={props.trackScatterErrorMessage}
      />

      <HomeMilestonesSection trackScatterPoints={props.trackScatterPoints} />

      <HomeDailyDistributionSection trackScatterPoints={props.trackScatterPoints} />

      <HomeHistorySection history={props.history} />

      {homeFiltersConfigured && homeFiltersEnabled ? (
        <HomeFilterBuilderSection
          trackScatterPoints={props.trackScatterPoints}
          trackScatterDataDate={props.trackScatterDataDate}
        />
      ) : null}
    </div>
  );
}

export function HomeDashboardClient(props: {
  sp: { scope?: string; range?: string; daily?: string; xy_date?: string };
  playlistKey: "all_catalog" | "releases" | "ext";
  title: string;
  rangeDays: number;
  latest: PlaylistDailyStatsRow | null;
  history: PlaylistDailyStatsRow[];
  playlistImageUrl: string | null;
  historyErrorMessage?: string | null;
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterErrorMessage?: string | null;
  trackScatterDataDate: string | null;
  latestRunDate: string | null;
  latestDataDate: string | null;
  overrideAnnotations?: ManualOverrideAnnotation[];
}) {
  return <HomeDashboardInner {...props} />;
}
