"use client";

import { useMemo } from "react";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import type { Metric } from "./CatalogMetricSelector";

const STREAM_PAYOUT_USD = 0.002;

function computeRollingAvg7(desc: Array<{ date: string; daily: number }>) {
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

type ChartDataPoint = {
  date: string;
  value: number;
};

type DailyDataPoint = {
  date: string;
  daily: number;
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
  metric: Metric;
  setMetric: (metric: Metric) => void;
}) {

  const cumulativeSeries = useMemo(() => {
    if (props.metric === "revenue") {
      return props.cumSeriesAsc.map((p) => ({
        date: p.date,
        value: p.value * STREAM_PAYOUT_USD,
      }));
    } else if (props.metric === "tracks") {
      // For tracks, we don't have historical track count per artist
      // So we'll just show a flat line or return empty
      return props.cumSeriesAsc.map((p) => ({
        date: p.date,
        value: props.trackCount,
      }));
    } else {
      return props.cumSeriesAsc;
    }
  }, [props.metric, props.cumSeriesAsc, props.trackCount]);

  const dailyDesc = useMemo(() => {
    if (props.metric === "revenue") {
      return props.dailyArtistDesc.map((p) => ({
        date: p.date,
        daily: p.daily * STREAM_PAYOUT_USD,
      }));
    } else if (props.metric === "tracks") {
      // Track count doesn't change daily for an artist's catalog
      return props.dailyArtistDesc.map((p) => ({
        date: p.date,
        daily: 0,
      }));
    } else {
      return props.dailyArtistDesc;
    }
  }, [props.metric, props.dailyArtistDesc]);

  const dailyWithMaDesc = useMemo(() => computeRollingAvg7(dailyDesc), [dailyDesc]);

  const metricLabel = props.metric === "revenue" ? "Est. revenue" : props.metric === "streams" ? "Streams" : "Tracks";
  const cumulativeLabel = props.metric === "revenue" ? "Est. revenue (cumulative)" : props.metric === "streams" ? "Total streams" : "Track count";
  const dailyLabel = props.metric === "revenue" ? "Est. revenue (daily)" : props.metric === "streams" ? "Daily streams" : "Track change (daily)";
  
  const valueFormat = props.metric === "revenue" ? "usd" : "int";
  const yTickFormat = props.metric === "revenue" ? "usd_compact" : props.metric === "streams" ? "k" : "int";

  const latestValue = props.metric === "revenue" 
    ? props.latestCum * STREAM_PAYOUT_USD
    : props.metric === "tracks"
    ? props.trackCount
    : props.latestCum;

  const latestDaily = props.metric === "revenue"
    ? props.artist24h * STREAM_PAYOUT_USD
    : props.metric === "tracks"
    ? 0
    : props.artist24h;

  const stat24h = props.metric === "revenue" ? props.artist24h * STREAM_PAYOUT_USD : props.artist24h;
  const stat7d = props.metric === "revenue" ? props.artist7d * STREAM_PAYOUT_USD : props.artist7d;
  const stat28d = props.metric === "revenue" ? props.artist28d * STREAM_PAYOUT_USD : props.artist28d;
  const stat30d = props.metric === "revenue" ? props.artist30d * STREAM_PAYOUT_USD : props.artist30d;

  // Use different colors based on metric: blue for tracks, emerald for revenue, lime for streams
  const chartColor = props.metric === "tracks" ? "#3b82f6" : props.metric === "revenue" ? "#10b981" : "#c7f33c";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <SpotlightCard className="lg:col-span-6 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Artist {cumulativeLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latestValue} format={valueFormat} />
              </div>
            </div>
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
            />
          </div>
        </SpotlightCard>

        <SpotlightCard className="lg:col-span-6 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                Artist {dailyLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latestDaily} format={valueFormat} />
              </div>
            </div>
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsWithMAChart
              data={dailyWithMaDesc}
              valueLabel={dailyLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
              heightPx={220}
              dailyColor={chartColor}
            />
          </div>
        </SpotlightCard>
      </div>
    </div>
  );
}
