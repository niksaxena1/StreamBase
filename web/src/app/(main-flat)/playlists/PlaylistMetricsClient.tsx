"use client";

import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { StatCard } from "@/components/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { Activity } from "lucide-react";
import { formatInt } from "@/lib/format";
import type { Metric } from "./PlaylistMetricSelector";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { computeDailyRollingAvg7 } from "@/components/charts/chartUtils";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total: number | null;
  est_revenue_daily_net: number | null;
};

export function PlaylistMetricsClient(props: {
  latest: PlaylistDailyStatsRow | null;
  latestDate: string | null;
  rangeDays: number;
  history: PlaylistDailyStatsRow[];
  removedTracksCount: number;
  playlistKey: string;
  overrideAnnotations: Array<{ date: string; note: string }>;
  metric: Metric;
}) {
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const safeNum = (n: unknown) => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };

  const cumulativeSeries = props.history.map((r) => {
    if (props.metric === "revenue") {
      return { date: dataDateFromRunDate(r.date), value: Number(r.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd };
    } else if (props.metric === "tracks") {
      return { date: dataDateFromRunDate(r.date), value: Number(r.track_count ?? 0) };
    } else {
      return { date: dataDateFromRunDate(r.date), value: Number(r.total_streams_cumulative ?? 0) };
    }
  });

  const dailyDesc = props.history.map((r) => {
    if (props.metric === "revenue") {
      const idx = props.history.findIndex((h) => h.date === r.date);
      const prev = idx < props.history.length - 1 ? props.history[idx + 1] : null;
      const curTotal = safeNum(r.total_streams_cumulative);
      if (!prev) return { date: dataDateFromRunDate(r.date), daily: null };
      const prevTotal = safeNum(prev.total_streams_cumulative);
      const dailyStreams = Math.max(0, curTotal - prevTotal);
      return { date: dataDateFromRunDate(r.date), daily: dailyStreams * streamPayoutPerStreamUsd };
    } else if (props.metric === "tracks") {
      // Track count doesn't have daily, so calculate delta (can be negative for removals)
      const idx = props.history.findIndex((h) => h.date === r.date);
      const prev = idx < props.history.length - 1 ? props.history[idx + 1] : null;
      const daily = prev ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0) : 0;
      return { date: dataDateFromRunDate(r.date), daily };
    } else {
      const idx = props.history.findIndex((h) => h.date === r.date);
      const prev = idx < props.history.length - 1 ? props.history[idx + 1] : null;
      const curTotal = safeNum(r.total_streams_cumulative);
      if (!prev) return { date: dataDateFromRunDate(r.date), daily: null };
      const prevTotal = safeNum(prev.total_streams_cumulative);
      const daily = Math.max(0, curTotal - prevTotal);
      return { date: dataDateFromRunDate(r.date), daily };
    }
  });
  const dailyWithMaDesc = computeDailyRollingAvg7(dailyDesc);

  const cumulativeLabel = props.metric === "revenue" ? "Est. revenue (cumulative)" : props.metric === "streams" ? "Total streams" : "Track count";
  const dailyLabel = props.metric === "revenue" ? "Est. revenue (daily)" : props.metric === "streams" ? "Daily streams" : "Track change (daily)";
  
  const valueFormat = props.metric === "revenue" ? "usd" : "int";
  const yTickFormat = props.metric === "revenue" ? "usd_compact" : props.metric === "streams" ? "k" : "int";

  // Use first item from history (newest-first) as latest, similar to collectors page
  // This ensures we have revenue fields even if the separate latest query is cached
  const latestFromHistory = props.history[0] ?? null;
  const effectiveLatest = latestFromHistory ?? props.latest;

  const latestValue = props.metric === "revenue" 
    ? Number(effectiveLatest?.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd
    : props.metric === "tracks"
    ? (effectiveLatest?.track_count ?? 0)
    : (effectiveLatest?.total_streams_cumulative ?? 0);

  const latestDaily = (() => {
    if (props.metric === "tracks") return 0; // shown via chart; daily is computed per-point above
    const cur = safeNum(props.history?.[0]?.total_streams_cumulative);
    const prev = safeNum(props.history?.[1]?.total_streams_cumulative);
    const dailyStreams = props.history?.length >= 2 ? Math.max(0, cur - prev) : 0;
    return props.metric === "revenue" ? dailyStreams * streamPayoutPerStreamUsd : dailyStreams;
  })();

  // Use different colors based on metric: blue for tracks, emerald for revenue, accent stroke for streams
  const chartColor = props.metric === "tracks" ? "#3b82f6" : props.metric === "revenue" ? "#10b981" : undefined;
  const chartAnnotations = props.metric === "tracks" ? [] : props.overrideAnnotations;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider opacity-60">
                <Activity className="h-3.5 w-3.5" />
                {cumulativeLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latestValue} format={valueFormat} />
              </div>
            </div>
            <ChartCsvDownloadButton
              rows={cumulativeSeries as unknown as Array<Record<string, unknown>>}
              filename={`playlist-${slugifyForFilename(cumulativeLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <div className="mt-2 min-h-[200px]">
            <DailyStreamsChart
              data={cumulativeSeries}
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
                {dailyLabel}
              </div>
              <div className="mt-1 font-display text-3xl font-bold tracking-tight">
                <AnimatedCounter value={latestDaily} format={valueFormat} />
              </div>
            </div>
            <ChartCsvDownloadButton
              rows={dailyWithMaDesc as unknown as Array<Record<string, unknown>>}
              filename={`playlist-${slugifyForFilename(dailyLabel)}-${props.rangeDays}d-${todayIsoDate()}.csv`}
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

        {props.metric === "tracks" && (
          <SpotlightCard className="lg:col-span-12 p-3 overflow-visible">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                  Track count over time
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                  Daily snapshots from ingestion.
                </div>
              </div>
              <ChartCsvDownloadButton
                rows={cumulativeSeries as unknown as Array<Record<string, unknown>>}
                filename={`playlist-${slugifyForFilename("track-count-over-time")}-${props.rangeDays}d-${todayIsoDate()}.csv`}
                title="Download CSV"
              />
            </div>
            <div className="mt-2 min-h-[180px]">
              <DailyStreamsChart
                data={cumulativeSeries}
                valueLabel="Tracks"
                valueFormat="int"
                yTickFormat="int"
                heightPx={200}
                color="#60a5fa"
              />
            </div>
          </SpotlightCard>
        )}
      </div>
    </div>
  );
}
