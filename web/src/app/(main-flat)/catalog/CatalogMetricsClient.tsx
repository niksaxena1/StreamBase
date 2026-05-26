"use client";

import { useMemo } from "react";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { computeDailyRollingAvg7 } from "@/components/charts/chartUtils";
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
}) {
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const { metric } = useMetric();

  const cumulativeSeriesRaw = useMemo(() => {
    if (metric === "revenue") {
      return props.cumSeriesAsc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        value: p.value * streamPayoutPerStreamUsd,
      }));
    } else if (metric === "tracks") {
      return props.cumSeriesAsc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        value: props.trackCount,
      }));
    } else {
      return props.cumSeriesAsc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        value: p.value,
      }));
    }
  }, [metric, props.cumSeriesAsc, props.trackCount, streamPayoutPerStreamUsd]);

  const cumulativeSeries = useMemo(
    () => aggregateCumulativeSeries(cumulativeSeriesRaw, props.granularity),
    [cumulativeSeriesRaw, props.granularity],
  );

  const dailyDescRaw = useMemo(() => {
    if (metric === "revenue") {
      return props.dailyArtistDesc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        daily: p.daily == null ? null : p.daily * streamPayoutPerStreamUsd,
      }));
    } else if (metric === "tracks") {
      return props.dailyArtistDesc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        daily: 0,
      }));
    } else {
      return props.dailyArtistDesc.map((p) => ({
        date: dataDateFromRunDate(p.date),
        daily: p.daily,
      }));
    }
  }, [metric, props.dailyArtistDesc, streamPayoutPerStreamUsd]);

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
    return props.dailyArtistDesc.map((p) => ({
      date: dataDateFromRunDate(p.date),
      daily: p.daily == null ? null : p.daily * (metric === "revenue" ? rev : 1),
      ma7:
        p.ma7 == null || p.ma7 === undefined
          ? null
          : p.ma7 * (metric === "revenue" ? rev : 1),
    }));
  }, [dailyDescRaw, props.granularity, props.dailyArtistDesc, metric, streamPayoutPerStreamUsd]);

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
              rows={cumulativeSeries as unknown as Array<Record<string, unknown>>}
              filename={`catalog-artist-${slugifyForFilename(cumulativeLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsChart
              data={[...cumulativeSeries].reverse()}
              valueLabel={cumulativeLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
              heightPx={220}
              isCumulative={true}
              color={chartColor}
              annotations={chartAnnotations}
            />
          </div>
        </SpotlightCard>

        <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Artist {dailyLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latestDaily} format={valueFormat} />
              </div>
            </div>
            <ChartCsvDownloadButton
              rows={dailyWithMaDesc as unknown as Array<Record<string, unknown>>}
              filename={`catalog-artist-${slugifyForFilename(dailyLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsWithMAChart
              data={dailyWithMaDesc}
              valueLabel={dailyLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
              heightPx={220}
              dailyColor={chartColor}
              annotations={chartAnnotations}
            />
          </div>
        </SpotlightCard>
      </div>
    </div>
  );
}
