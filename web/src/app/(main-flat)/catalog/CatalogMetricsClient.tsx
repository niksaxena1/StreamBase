"use client";

import { useMemo } from "react";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { DailyRangeToggle, useDailyRange } from "@/components/charts/DailyRangeControls";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { computeDailyRollingAvg7 } from "@/components/charts/chartUtils";
import { buildDailyExportRows, type ViewWindow } from "@/components/charts/aggregateSeries";
import { useChartViewport } from "@/components/charts/useChartViewport";
import { mergeOlderArtistSeries, useOlderArtistHistory, type OlderArtistHistoryTarget } from "./useOlderArtistHistory";
import { Loader2 } from "lucide-react";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { useMetric } from "@/components/metrics/MetricContext";
import { granularityLabel } from "@/components/ui/GranularitySelect";
import type { Granularity } from "@/components/ui/GranularitySelect";
import { aggregateCumulativeSeries, aggregateDailySeries } from "@/lib/granularity";

type ChartDataPoint = {
  date: string;
  value: number;
};

type DailyDataPoint = {
  date: string;
  daily: number | null;
  ma7?: number | null;
};

export function CatalogMetricsClient(props: {
  latestCum: number;
  latestDate: string | null;
  rangeDays: number;
  cumSeriesAsc: ChartDataPoint[];
  dailyArtistDesc: DailyDataPoint[];
  artist24h: number;
  artist7d: number;
  artist28d: number;
  artist30d: number;
  trackCount: number;
  overrideAnnotations: Array<{ date: string; note: string; title?: string; imageUrl?: string | null }>;
  granularity: Granularity;
  /** Own-catalog only: zoom, adaptive granularity and the archived boundary. Competitor mode leaves this off. */
  adaptive?: boolean;
  onNeedMoreData?: (dateIso: string) => boolean | void;
  /** Recent-first loading: older history for the artist series arrives after first render. */
  olderArtistHistory?: OlderArtistHistoryTarget | null;
}) {
  const older = useOlderArtistHistory(props.olderArtistHistory);
  const { cumAsc: cumSeriesAsc, dailyDesc: dailyArtistDesc } = useMemo(
    () =>
      props.olderArtistHistory
        ? mergeOlderArtistSeries({
            recentCumAsc: props.cumSeriesAsc,
            recentDailyDesc: props.dailyArtistDesc,
            olderRows: older.rows,
            startRunDate: props.olderArtistHistory.startRunDate,
          })
        : { cumAsc: props.cumSeriesAsc, dailyDesc: props.dailyArtistDesc },
    [props.olderArtistHistory, props.cumSeriesAsc, props.dailyArtistDesc, older.rows],
  );
  const adaptive = props.adaptive ?? false;
  const cumView = useChartViewport("catalog-artist-total");
  const dailyView = useChartViewport("catalog-artist-daily");
  const rootLabel = props.rangeDays > 365 ? "All time" : "Loaded range";
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const { metric } = useMetric();
  const dailyRange = useDailyRange("sb:chart-range:catalog-artist-daily-streams");

  const cumulativeSeriesRaw = useMemo(() => {
    if (metric === "revenue") {
      return cumSeriesAsc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        value: p.value * streamPayoutPerStreamUsd,
      }));
    } else if (metric === "tracks") {
      return cumSeriesAsc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        value: props.trackCount,
      }));
    } else {
      return cumSeriesAsc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        value: p.value,
      }));
    }
  }, [metric, cumSeriesAsc, props.trackCount, streamPayoutPerStreamUsd]);

  const cumulativeSeries = useMemo(
    () => aggregateCumulativeSeries(cumulativeSeriesRaw, props.granularity),
    [cumulativeSeriesRaw, props.granularity],
  );

  const dailyDescRaw = useMemo(() => {
    if (metric === "revenue") {
      return dailyArtistDesc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        daily: p.daily == null ? null : p.daily * streamPayoutPerStreamUsd,
      }));
    } else if (metric === "tracks") {
      return dailyArtistDesc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        daily: 0,
      }));
    } else {
      return dailyArtistDesc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        daily: p.daily,
      }));
    }
  }, [metric, dailyArtistDesc, streamPayoutPerStreamUsd]);

  const dailyWithMaDesc = useMemo(() => {
    if (props.granularity !== "daily") {
      return aggregateDailySeries(dailyDescRaw, props.granularity);
    }
    // "Tracks" metric: synthetic zeros — keep local MA7. Streams/revenue: server precomputes
    // MA7 using a 6-day lookback before the range (same idea as the home dashboard).
    if (metric === "tracks") {
      return computeDailyRollingAvg7(dailyDescRaw);
    }
    const rev = streamPayoutPerStreamUsd;
    return dailyArtistDesc.map((p) => ({
      date: dataDateFromRunDate(p.date),
      daily: p.daily == null ? null : p.daily * (metric === "revenue" ? rev : 1),
      ma7:
        p.ma7 == null || p.ma7 === undefined
          ? null
          : p.ma7 * (metric === "revenue" ? rev : 1),
    }));
  }, [dailyDescRaw, props.granularity, dailyArtistDesc, metric, streamPayoutPerStreamUsd]);

  const cumulativeChartData = useMemo(() => [...cumulativeSeries].reverse(), [cumulativeSeries]);

  // CSV exports the visible range at daily resolution (date, total, daily, archived) whatever the chart granularity.
  const exportRows = (window: ViewWindow | null) =>
    buildDailyExportRows({
      dailyRows: dailyDescRaw,
      dailyKey: "daily",
      totalRows: cumulativeSeriesRaw,
      totalKey: "value",
      window,
    });

  const gl = granularityLabel(props.granularity).toLowerCase();
  const cumulativeLabel = metric === "revenue" ? "Est. revenue (total)" : metric === "streams" ? "Total streams" : "Track count";
  const dailyLabel = metric === "revenue" ? `Est. revenue (${gl})` : metric === "streams" ? `${granularityLabel(props.granularity)} streams` : `Track change (${gl})`;
  
  const valueFormat = metric === "revenue" ? "usd" : "int";
  const yTickFormat = metric === "revenue" ? "usd_compact" : metric === "streams" ? "k" : "int";

  const latestValue = metric === "revenue" 
    ? props.latestCum * streamPayoutPerStreamUsd
    : metric === "tracks"
    ? props.trackCount
    : props.latestCum;

  const latestDaily = metric === "revenue"
    ? props.artist24h * streamPayoutPerStreamUsd
    : metric === "tracks"
    ? 0
    : props.artist24h;

  // Use different colors based on metric: blue for tracks, emerald for revenue, accent stroke for streams
  // Note: streams color is left undefined so DailyStreamsChart uses semantic stream green
  const chartColor = metric === "tracks" ? "#3b82f6" : metric === "revenue" ? "#10b981" : undefined;
  const chartAnnotations = metric === "tracks" ? [] : props.overrideAnnotations;

  return (
    <div className="space-y-4">
      {props.olderArtistHistory && (older.loading || older.failed) ? (
        <div
          role="status"
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs"
          style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)", color: "var(--sb-muted)" }}
        >
          {older.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {older.loading ? "Loading older history…" : "Older history could not be loaded"}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Artist {cumulativeLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latestValue} format={valueFormat} />
              </div>
            </div>
            <ChartCsvDownloadButton
              rows={(adaptive ? exportRows(cumView.window) : cumulativeSeries) as unknown as Array<Record<string, unknown>>}
              filename={`catalog-artist-${slugifyForFilename(cumulativeLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsChart
              data={cumulativeChartData}
              valueLabel={cumulativeLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
              heightPx={220}
              isCumulative={true}
              color={chartColor}
              annotations={chartAnnotations}
              adaptiveView={adaptive ? cumView : undefined}
              adaptiveRootLabel={rootLabel}
              onNeedMoreData={props.onNeedMoreData}
            />
          </div>
        </SpotlightCard>

        <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Artist {dailyLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latestDaily} format={valueFormat} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {metric === "streams" ? <DailyRangeToggle {...dailyRange} /> : null}
              <ChartCsvDownloadButton
                rows={(adaptive ? exportRows(dailyView.window) : dailyWithMaDesc) as unknown as Array<Record<string, unknown>>}
                filename={`catalog-artist-${slugifyForFilename(dailyLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsWithMAChart
              typicalRange={metric === "streams" && dailyRange.typical}
              data={dailyWithMaDesc}
              valueLabel={dailyLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
              heightPx={220}
              dailyColor={chartColor}
              annotations={chartAnnotations}
              adaptiveView={adaptive ? dailyView : undefined}
              adaptiveRootLabel={rootLabel}
              onNeedMoreData={props.onNeedMoreData}
            />
          </div>
        </SpotlightCard>
      </div>
    </div>
  );
}
