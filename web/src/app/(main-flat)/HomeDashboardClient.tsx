"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { fetchUserSettingsBundle, invalidateUserSettingsBundle } from "@/lib/userSettingsBundleFetch";
import { fetchApiJson } from "@/lib/api";
import {
  buildHomeScatterApiUrl,
  buildHomeScatterScopeKey,
  normalizeHomeScatterApiPayload,
} from "@/lib/home/homeScatterApi";
import {
  buildHomeDiagnosticsApiUrl,
  buildHomeDiagnosticsScopeKey,
  normalizeHomeDiagnosticsApiPayload,
} from "@/lib/home/homeDiagnosticsApi";
import { granularityLabel } from "@/components/ui/GranularitySelect";
import { aggregateCumulativeSeries, aggregateChartPoints } from "@/lib/granularity";
import { useSharedGranularity } from "@/lib/useSharedGranularity";

import { useMetric } from "@/components/metrics/MetricContext";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { LazyInteractiveChartSection } from "@/components/dashboard/LazyInteractiveChartSection";
import { formatDateISO, formatInt } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { Alert } from "@/components/ui/Alert";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { computeRollingAvg7 } from "@/components/charts/chartUtils";
import { useCurrencyDisplay } from "@/components/currency/CurrencyDisplayContext";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/Skeleton";

import type {
  ChartPoint,
  HomeDashboardServerProps,
} from "./home/homeTypes";
import { HomeScatterSection } from "./home/HomeScatterSection";
import { HomeMilestonesSection } from "./home/HomeMilestonesSection";
import { HomeDailyDistributionSection } from "./home/HomeDailyDistributionSection";
import { HomeNegativeStreamsSection } from "./home/HomeNegativeStreamsSection";

import { HomeWeekendDipsSection } from "./home/HomeWeekendDipsSection";
import { HomeHistorySection } from "./home/HomeHistorySection";
import { HomeFilterBuilderSection } from "./home/HomeFilterBuilderSection";

import {
  dailyStreamValuesForDataset,
  dailyStreamValuesForMixedOwnHistory,
  trailingDailyAverage,
} from "./home/homeUtils";

function DeferredSectionSkeleton() {
  return <div className="sb-panel rounded-xl border p-3 h-[42px]" style={{ borderColor: "var(--sb-border)" }}><Skeleton className="h-4 w-40" /></div>;
}

const HomeArtificialStreamsSection = dynamic(
  () => import("./home/HomeArtificialStreamsSection").then((m) => m.HomeArtificialStreamsSection),
  { loading: DeferredSectionSkeleton },
);
const HomeConcentrationSection = dynamic(
  () => import("./home/HomeConcentrationSection").then((m) => m.HomeConcentrationSection),
  { loading: DeferredSectionSkeleton },
);

// ============================================================================
// Helpers (header-only)
// ============================================================================

function HomeDiagnosticsLoadingPanel() {
  return (
    <div className="rounded-xl border sb-panel p-3" style={{ borderColor: "var(--sb-border)" }}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-xs opacity-40">▸</span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
            TRACK DIAGNOSTICS
          </div>
          <Skeleton className="mt-3 h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main orchestrator component
// ============================================================================

function HomeDashboardInner(props: HomeDashboardServerProps) {
  const { metric } = useMetric();
  const themeColors = useThemeColors();
  useCurrencyDisplay();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [selectedChart, setSelectedChart] = useState<"daily" | "total">("daily");
  const [granularity] = useSharedGranularity("sb:home:granularity");

  // User setting: show/hide Filters section on Home
  const [homeFiltersEnabled, setHomeFiltersEnabled] = useState(true);
  const [homeFiltersConfigured, setHomeFiltersConfigured] = useState(true);
  const [homeSpikesSectionEnabled, setHomeSpikesSectionEnabled] = useState(true);
  const [homeSpikesSectionConfigured, setHomeSpikesSectionConfigured] = useState(true);
  const scatterFetchUrl = useMemo(() => buildHomeScatterApiUrl(props.sp), [props.sp]);
  const scatterScopeKey = useMemo(
    () => buildHomeScatterScopeKey(props.datasetMode, props.competitorLabelKey),
    [props.datasetMode, props.competitorLabelKey],
  );
  const diagnosticsFetchUrl = useMemo(() => buildHomeDiagnosticsApiUrl(props.sp), [props.sp]);
  const diagnosticsRequestKey = useMemo(
    () => `${buildHomeDiagnosticsScopeKey(props.datasetMode, props.competitorLabelKey)}:${diagnosticsFetchUrl}`,
    [props.datasetMode, props.competitorLabelKey, diagnosticsFetchUrl],
  );
  const [scatterRequested, setScatterRequested] = useState(
    () => !props.trackScatterDeferred || props.trackScatterPoints.length > 0,
  );
  const [scatterState, setScatterState] = useState<{
    points: TrackStreamsXYPoint[];
    errorMessage: string | null;
    dataDate: string | null;
    loading: boolean;
  }>(() => ({
    points: props.trackScatterPoints,
    errorMessage: props.trackScatterErrorMessage ?? null,
    dataDate: props.trackScatterDataDate,
    loading: false,
  }));
  const [diagnosticsState, setDiagnosticsState] = useState(() => ({
    artistWeekendDips: props.artistWeekendDips,
    trackWeekendDips: props.trackWeekendDips,
    negativeDailyStreams: props.negativeDailyStreams,
    artificialStreamSpikes: props.artificialStreamSpikes,
    errorMessage: props.homeDiagnosticsErrorMessage ?? null,
    loading: Boolean(props.homeDiagnosticsDeferred),
  }));
  const prevScatterScopeKeyRef = useRef<string | null>(null);
  const prevDiagnosticsRequestKeyRef = useRef<string | null>(null);

  const requestScatterData = useCallback(() => {
    if (!props.trackScatterDeferred) return;
    setScatterRequested(true);
    setScatterState((current) =>
      current.points.length || current.loading
        ? current
        : {
            ...current,
            errorMessage: null,
            loading: true,
          },
    );
  }, [props.trackScatterDeferred]);

  useEffect(() => {
    if (!props.trackScatterDeferred) return;
    if (!scatterRequested) return;

    const scopeChanged =
      prevScatterScopeKeyRef.current !== null && prevScatterScopeKeyRef.current !== scatterScopeKey;
    prevScatterScopeKeyRef.current = scatterScopeKey;

    if (scopeChanged) {
      setScatterState({
        points: [],
        errorMessage: null,
        dataDate: props.trackScatterDataDate,
        loading: true,
      });
    }

    const controller = new AbortController();
    fetchApiJson<unknown>(scatterFetchUrl, { signal: controller.signal })
      .then((raw) => {
        if (controller.signal.aborted) return;
        const payload = normalizeHomeScatterApiPayload(raw);
        setScatterState({
          points: payload.points,
          errorMessage: payload.errorMessage,
          dataDate: payload.dataDate ?? props.trackScatterDataDate,
          loading: false,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setScatterState({
          points: [],
          errorMessage: error instanceof Error ? error.message : "Failed to load Home scatter data",
          dataDate: props.trackScatterDataDate,
          loading: false,
        });
      });

    return () => controller.abort();
  }, [
    props.trackScatterDataDate,
    props.trackScatterDeferred,
    scatterRequested,
    scatterFetchUrl,
    scatterScopeKey,
  ]);
  const effectiveScatterState = props.trackScatterDeferred
    ? scatterState
    : {
        points: props.trackScatterPoints,
        errorMessage: props.trackScatterErrorMessage ?? null,
        dataDate: props.trackScatterDataDate,
        loading: false,
      };

  useEffect(() => {
    if (!props.homeDiagnosticsDeferred) return;

    const requestChanged =
      prevDiagnosticsRequestKeyRef.current !== null &&
      prevDiagnosticsRequestKeyRef.current !== diagnosticsRequestKey;
    prevDiagnosticsRequestKeyRef.current = diagnosticsRequestKey;

    if (requestChanged) {
      setDiagnosticsState({
        artistWeekendDips: [],
        trackWeekendDips: [],
        negativeDailyStreams: [],
        artificialStreamSpikes: [],
        errorMessage: null,
        loading: true,
      });
    }

    const controller = new AbortController();
    fetchApiJson<unknown>(diagnosticsFetchUrl, { signal: controller.signal })
      .then((raw) => {
        if (controller.signal.aborted) return;
        const payload = normalizeHomeDiagnosticsApiPayload(raw);
        setDiagnosticsState({
          artistWeekendDips: payload.artistWeekendDips,
          trackWeekendDips: payload.trackWeekendDips,
          negativeDailyStreams: payload.negativeDailyStreams,
          artificialStreamSpikes: payload.artificialStreamSpikes,
          errorMessage: payload.errorMessage,
          loading: false,
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setDiagnosticsState({
          artistWeekendDips: [],
          trackWeekendDips: [],
          negativeDailyStreams: [],
          artificialStreamSpikes: [],
          errorMessage: error instanceof Error ? error.message : "Failed to load Home diagnostics",
          loading: false,
        });
      });

    return () => controller.abort();
  }, [
    diagnosticsFetchUrl,
    diagnosticsRequestKey,
    props.homeDiagnosticsDeferred,
  ]);

  const effectiveDiagnosticsState = props.homeDiagnosticsDeferred
    ? diagnosticsState
    : {
        artistWeekendDips: props.artistWeekendDips,
        trackWeekendDips: props.trackWeekendDips,
        negativeDailyStreams: props.negativeDailyStreams,
        artificialStreamSpikes: props.artificialStreamSpikes,
        errorMessage: props.homeDiagnosticsErrorMessage ?? null,
        loading: false,
      };

  // Fetch Home Filters + spikes section visibility (shares request with other context providers).
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchUserSettingsBundle();
        if (cancelled) return;
        setHomeFiltersEnabled(data.home_filters_enabled ?? true);
        setHomeFiltersConfigured(data.configured !== false);
        setHomeSpikesSectionEnabled(data.home_artificial_spikes_section_enabled ?? true);
        setHomeSpikesSectionConfigured(data.configured !== false);
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
    window.addEventListener("sb:home-artificial-spikes-section-setting-updated", onUpdated as any);
    return () => {
      cancelled = true;
      window.removeEventListener("sb:home-filters-setting-updated", onUpdated as any);
      window.removeEventListener("sb:home-artificial-spikes-section-setting-updated", onUpdated as any);
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

    const dailyStreamValues = props.legacyHistoryEnabled
      ? dailyStreamValuesForMixedOwnHistory(desc)
      : dailyStreamValuesForDataset(desc, props.datasetMode);

    if (metric === "revenue") {
      const dailyDesc = desc.map((r, idx) => ({
        date: dataDateFromRunDate(r.date),
        value:
          dailyStreamValues[idx] == null
            ? null
            : dailyStreamValues[idx]! * streamPayoutPerStreamUsd,
      }));
      const totalDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: safeNum(r.total_streams_cumulative) * streamPayoutPerStreamUsd,
      }));
      const dailyValue = (dailyStreamValues[0] ?? 0) * streamPayoutPerStreamUsd;
      return {
        daily: computeRollingAvg7(dailyDesc).slice(0, props.rangeDays),
        total: totalDesc.slice(0, props.rangeDays),
        dailyValue,
        totalValue: safeNum(props.latest?.total_streams_cumulative) * streamPayoutPerStreamUsd,
        dailyTitle: `Revenue (${granularityLabel(granularity)})`,
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
        const crossesArchiveSeam =
          props.legacyHistoryEnabled && prev && r.history_source !== prev.history_source;
        const daily = prev && !crossesArchiveSeam
          ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0)
          : null;
        return { date: dataDateFromRunDate(r.date), value: daily };
      });
      const dailyValue =
        desc.length >= 2
          ? Number(desc[0]?.track_count ?? 0) - Number(desc[1]?.track_count ?? 0)
          : 0;
      return {
        daily: computeRollingAvg7(dailyDeltaDesc).slice(0, props.rangeDays),
        total: totalDesc.slice(0, props.rangeDays),
        dailyValue,
        totalValue: Number(props.latest?.track_count ?? 0),
        dailyTitle: `Track Change (${granularityLabel(granularity)})`,
        totalTitle: "Track Count",
        dailyValueLabel: "Tracks",
        totalValueLabel: "Tracks",
        valueFormat: "int" as const,
        yTickFormat: "int" as const,
        color: "#3b82f6",
      };
    }

    // streams (default)
    const dailyDesc = desc.map((r, idx) => ({
      date: dataDateFromRunDate(r.date),
      value: dailyStreamValues[idx],
    }));
    const totalDesc = desc.map((r) => ({
      date: dataDateFromRunDate(r.date),
      value: safeNum(r.total_streams_cumulative),
    }));
    const dailyValue = dailyStreamValues[0] ?? 0;
    return {
      daily: computeRollingAvg7(dailyDesc).slice(0, props.rangeDays),
      total: totalDesc.slice(0, props.rangeDays),
      dailyValue,
      totalValue: safeNum(props.latest?.total_streams_cumulative),
      dailyTitle: `${granularityLabel(granularity)} Streams`,
      totalTitle: "Total Streams",
      dailyValueLabel: "Streams",
      totalValueLabel: "Total Streams",
      valueFormat: "int" as const,
      yTickFormat: "k" as const,
      color: undefined,
    };
  }, [
    metric,
    granularity,
    props.datasetMode,
    props.legacyHistoryEnabled,
    props.history,
    props.latest,
    props.rangeDays,
    streamPayoutPerStreamUsd,
  ]);

  // Entity-playlist (TG Total / P Total) values per chart date, appended as extra
  // columns to the hero chart's CSV export. Keyed by data date to match chart rows.
  const heroCsvExtraByDate = useMemo(() => {
    const rows = props.entityHistory ?? [];
    if (!rows.length) return undefined;
    const out: Record<string, Record<string, number | null>> = {};
    for (const r of rows) {
      const dataDate = dataDateFromRunDate(r.date);
      const cols = (out[dataDate] ??= {});
      cols[`${r.name} Daily`] = r.daily_streams_net;
      cols[`${r.name} Total`] = r.total_streams_cumulative;
    }
    return out;
  }, [props.entityHistory]);

  const heroStatAccentColor = useMemo(() => {
    if (props.datasetMode !== "competitor" || metric !== "streams") return undefined;
    return themeColors.accent;
  }, [props.datasetMode, metric, themeColors.accent]);

  const competitorBackfillNotice = useMemo(() => {
    if (props.datasetMode !== "competitor" || props.history.length < 2) return null;
    const latestMissing = Number(props.history[0]?.missing_streams_track_count ?? 0);
    const previousMissing = Number(props.history[1]?.missing_streams_track_count ?? 0);
    const filledSinceLastSnapshot = previousMissing - latestMissing;
    if (filledSinceLastSnapshot <= 0) return null;
    return { filledSinceLastSnapshot, latestMissing };
  }, [props.datasetMode, props.history]);

  const chartDataDaily: ChartPoint[] = useMemo(
    () => aggregateChartPoints(series.daily, granularity) as ChartPoint[],
    [series.daily, granularity],
  );
  const chartDataTotal: ChartPoint[] = useMemo(
    () => aggregateCumulativeSeries(
      series.total.filter((p): p is { date: string; value: number } => p.value != null),
      granularity,
    ),
    [series.total, granularity],
  );

  const allCatalogMa7 = useMemo(() => {
    if (props.playlistKey !== "all_catalog") return null;
    const hist = props.history ?? [];
    if (hist.length < 2) return null;
    // Dataset-aware: diffing competitor cumulative totals would count backfilled
    // track lifetimes as one day of growth.
    return trailingDailyAverage(dailyStreamValuesForDataset(hist, props.datasetMode));
  }, [props.history, props.playlistKey, props.datasetMode]);

  const allCatalogAsOf = props.latest?.date
    ? formatDateISO(dataDateFromRunDate(props.latest.date))
    : null;
  const hasTrendHistory = (props.history ?? []).length >= 2;

  // A freshly onboarded competitor has only a few snapshots, so charts look
  // sparse and trend comparisons are not meaningful yet. Say so explicitly
  // rather than leaving the user to wonder whether data is missing.
  const shortHistoryNotice = useMemo(() => {
    if (props.datasetMode !== "competitor") return null;
    const hist = props.history ?? [];
    if (!hist.length || hist.length >= 7) return null;
    const earliestRunDate = hist[hist.length - 1]?.date;
    if (!earliestRunDate) return null;
    return {
      days: hist.length,
      since: formatDateISO(dataDateFromRunDate(earliestRunDate)),
    };
  }, [props.datasetMode, props.history]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="space-y-4">
      {/* Suppressed while history is too short to be a 7-day average — the
          short-history notice below explains the state instead. */}
      {props.playlistKey === "all_catalog" && allCatalogMa7 !== null && !shortHistoryNotice ? (
        <blockquote
          className="rounded-lg border-l-4 sb-blockquote-bg p-3 text-sm"
          style={{ borderColor: "var(--sb-accent)" }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
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

      {shortHistoryNotice ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
        >
          Tracking since {shortHistoryNotice.since} — {shortHistoryNotice.days}{" "}
          {shortHistoryNotice.days === 1 ? "daily snapshot" : "daily snapshots"} so far. Totals are accurate now;
          trends and comparisons fill in as more daily exports land.
        </div>
      ) : null}

      {props.legacyHistoryEnabled ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
        >
          Archived Grafana history is included
          {props.legacyHistoryFirstDate && props.legacyHistoryLastDate
            ? ` (${props.legacyHistoryFirstDate} to ${props.legacyHistoryLastDate})`
            : ""}
          . It is ISRC-normalized and kept separate from live snapshots; counter resets are excluded from archived daily totals.
        </div>
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
        statAccentColor={heroStatAccentColor}
        annotations={metric === "tracks" ? [] : (props.overrideAnnotations ?? [])}
        selectedChart={selectedChart}
        onSelectChart={setSelectedChart}
        csvExtraByDate={heroCsvExtraByDate}
      />

      {props.historyErrorMessage ? (
        <Alert variant="error" title="Query error">
          {props.historyErrorMessage}
        </Alert>
      ) : null}

      {props.datasetMode === "competitor" && !hasTrendHistory ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
        >
          Competitor tracking only has one daily snapshot so far. Total-based views are already useful; daily-change and trend panels will wake up once more history accumulates.
        </div>
      ) : null}

      {competitorBackfillNotice ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
        >
          Daily competitor values are still stabilizing: {formatInt(competitorBackfillNotice.filledSinceLastSnapshot)} previously missing track totals were filled since the prior snapshot, so today&apos;s apparent growth includes historical backfill
          {competitorBackfillNotice.latestMissing > 0
            ? ` (${formatInt(competitorBackfillNotice.latestMissing)} tracks still missing totals).`
            : "."}
        </div>
      ) : null}

      <HomeConcentrationSection
        trackScatterPoints={effectiveScatterState.points}
        trackScatterLoading={effectiveScatterState.loading}
        onRequestScatterData={requestScatterData}
        latestRunDate={props.latestRunDate}
        datasetMode={props.datasetMode}
        competitorLabelKey={props.competitorLabelKey}
        competitorPlaylists={props.competitorPlaylists}
      />

      <HomeScatterSection
        trackScatterPoints={effectiveScatterState.points}
        trackScatterErrorMessage={effectiveScatterState.errorMessage}
        trackScatterLoading={effectiveScatterState.loading}
        onRequestScatterData={requestScatterData}
        insufficientHistory={props.datasetMode === "competitor" && !hasTrendHistory}
        datasetMode={props.datasetMode}
      />

      <HomeMilestonesSection
        trackScatterPoints={effectiveScatterState.points}
        trackScatterLoading={effectiveScatterState.loading}
        onRequestScatterData={requestScatterData}
      />

      {props.datasetMode === "own" || hasTrendHistory ? (
        <HomeDailyDistributionSection
          trackScatterPoints={effectiveScatterState.points}
          trackScatterLoading={effectiveScatterState.loading}
          onRequestScatterData={requestScatterData}
        />
      ) : null}

      {effectiveDiagnosticsState.loading ? <HomeDiagnosticsLoadingPanel /> : null}

      {effectiveDiagnosticsState.errorMessage ? (
        <Alert variant="error" title="Diagnostics error">
          {effectiveDiagnosticsState.errorMessage}
        </Alert>
      ) : null}

      {!effectiveDiagnosticsState.loading && (props.datasetMode === "own" || props.datasetMode === "competitor") ? (
        <HomeNegativeStreamsSection negativeDailyStreams={effectiveDiagnosticsState.negativeDailyStreams} />
      ) : null}

      {!effectiveDiagnosticsState.loading &&
      (props.datasetMode === "own" || props.datasetMode === "competitor") &&
      homeSpikesSectionConfigured &&
      homeSpikesSectionEnabled ? (
          <HomeArtificialStreamsSection
            artificialStreamSpikes={effectiveDiagnosticsState.artificialStreamSpikes}
            artificialStreamSpikeRatio={props.artificialStreamSpikeRatio}
            artificialMinBaseline={props.artificialMinBaseline}
            artificialIncludeWeekends={props.artificialIncludeWeekends}
            artificialSpikeDateStart={props.artificialSpikeDateStart}
            artificialSpikeDateEnd={props.artificialSpikeDateEnd}
            datasetMode={props.datasetMode}
          />
        ) : null}

      {!effectiveDiagnosticsState.loading &&
      (props.datasetMode === "own" || (props.datasetMode === "competitor" && hasTrendHistory)) ? (
          <HomeWeekendDipsSection
            artistWeekendDips={effectiveDiagnosticsState.artistWeekendDips}
            trackWeekendDips={effectiveDiagnosticsState.trackWeekendDips}
            hasEnoughHistory={hasTrendHistory}
          />
        ) : null}

      <HomeHistorySection history={props.history.slice(0, props.rangeDays)} />

      {(props.datasetMode === "competitor" || (homeFiltersConfigured && homeFiltersEnabled)) ? (
        <HomeFilterBuilderSection
          trackScatterPoints={effectiveScatterState.points}
          trackScatterDataDate={effectiveScatterState.dataDate}
          trackScatterLoading={effectiveScatterState.loading}
          onRequestScatterData={requestScatterData}
          datasetMode={props.datasetMode}
        />
      ) : null}
    </div>
  );
}

export function HomeDashboardClient(props: HomeDashboardServerProps) {
  return <HomeDashboardInner {...props} />;
}
