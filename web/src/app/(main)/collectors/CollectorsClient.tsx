"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { MonthlyBarChart } from "@/components/charts/MonthlyBarChart";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { Sparkline } from "@/components/charts/Sparkline";
import { StatCard } from "@/components/StatCard";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";

const METRICS = ["revenue", "streams", "tracks"] as const;
type Metric = (typeof METRICS)[number];

function rollingAvg7(desc: Array<{ date: string; daily: number }>) {
  // Input: newest-first. Output: newest-first with ma7.
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; daily: number; ma7: number | null }> = [];

  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.daily ?? 0));
    const has7 = window.length >= 7;
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, daily: asc[i].daily, ma7: has7 ? avg : null });
  }

  return outAsc.reverse();
}

function ma7ForValueDesc(desc: Array<{ date: string; value: number }>) {
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; value: number; ma7: number | null }> = [];
  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.value ?? 0));
    const has7 = window.length >= 7;
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, value: asc[i].value, ma7: has7 ? avg : null });
  }
  return outAsc.reverse();
}

function aggregateMonthlyDelta(
  seriesDesc: CollectorSeriesPoint[],
  metric: "revenue" | "streams" | "tracks"
): Array<{ month: string; value: number }> {
  // seriesDesc is newest-first, so reverse to get oldest-first for easier aggregation
  const asc = [...seriesDesc].reverse();

  const monthlyMap = new Map<string, number>();

  for (let i = 0; i < asc.length; i++) {
    const cur = asc[i];
    const curDataDate = dataDateFromRunDate(cur.date);
    const curMonth = curDataDate.substring(0, 7); // yyyy-mm from data date

    const prev = i > 0 ? asc[i - 1] : null;
    const prevDataDate = prev ? dataDateFromRunDate(prev.date) : null;
    const prevMonth = prevDataDate?.substring(0, 7);

    // Get the delta for this day
    let delta = 0;
    if (metric === "revenue") {
      delta = Number(cur.est_revenue_daily_net ?? 0);
    } else if (metric === "streams") {
      delta = Number(cur.daily_streams_net ?? 0);
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
  const result = Array.from(monthlyMap.entries())
    .map(([month, value]) => ({ month, value }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return result;
}

export type CollectorSummaryRow = {
  collector: string;
  playlists: number;
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

export function CollectorsClient(props: {
  latestDate: string | null;
  selectedCollector: string;
  rangeDays: number;
  summary: CollectorSummaryRow[];
  seriesDesc: CollectorSeriesPoint[]; // newest-first
  topPlaylists: TopPlaylistRow[]; // for latestDate
}) {
  const [metric, setMetric] = useState<Metric>("revenue");

  // Remember last collector (like playlist dashboard)
  useEffect(() => {
    try {
      localStorage.setItem("sb:last_collector", props.selectedCollector);
    } catch {
      // ignore
    }
  }, [props.selectedCollector]);

  const COLLECTOR_ORDER = ["A", "K", "N", "PL", "TG", "NL"] as const;

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

  const latest = props.seriesDesc[0] ?? null;

  const series = useMemo(() => {
    const datesDesc = props.seriesDesc.map((p) => p.date);

    const revenueTotalDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), value: Number(props.seriesDesc[i]?.est_revenue_total ?? 0) }));
    const revenueDailyDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), daily: Number(props.seriesDesc[i]?.est_revenue_daily_net ?? 0) }));

    const streamsTotalDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), value: Number(props.seriesDesc[i]?.total_streams_cumulative ?? 0) }));
    const streamsDailyDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), daily: Number(props.seriesDesc[i]?.daily_streams_net ?? 0) }));

    const tracksTotalDesc = datesDesc.map((d, i) => ({ date: dataDateFromRunDate(d), value: Number(props.seriesDesc[i]?.track_count ?? 0) }));
    const tracksDailyDeltaDesc = datesDesc.map((d, i) => {
      const cur = Number(props.seriesDesc[i]?.track_count ?? 0);
      const prev = Number(props.seriesDesc[i + 1]?.track_count ?? 0);
      // oldest->newest diff is more intuitive, but we keep newest-first: compare to next older day
      return { date: dataDateFromRunDate(d), daily: i + 1 < props.seriesDesc.length ? cur - prev : 0 };
    });

    return {
      revenue: {
        cumulative: ma7ForValueDesc(revenueTotalDesc),
        daily: rollingAvg7(revenueDailyDesc),
      },
      streams: {
        cumulative: ma7ForValueDesc(streamsTotalDesc),
        daily: rollingAvg7(streamsDailyDesc),
      },
      tracks: {
        cumulative: ma7ForValueDesc(tracksTotalDesc),
        daily: rollingAvg7(tracksDailyDeltaDesc),
      },
    } as const;
  }, [props.seriesDesc]);

  const monthlyData = useMemo(() => {
    // Get all available historical data (not limited by range selection)
    // This uses the full seriesDesc for unfiltered monthly aggregation
    return {
      revenue: aggregateMonthlyDelta(props.seriesDesc, "revenue"),
      streams: aggregateMonthlyDelta(props.seriesDesc, "streams"),
      tracks: aggregateMonthlyDelta(props.seriesDesc, "tracks"),
    };
  }, [props.seriesDesc]);

  const metricLabel = metric === "revenue" ? "Est. revenue" : metric === "streams" ? "Streams" : "Tracks";
  const dailyLabel =
    metric === "revenue" ? "Est. revenue (daily)" : metric === "streams" ? "Streams (daily)" : "Track change (daily)";
  const cumulativeLabel =
    metric === "revenue" ? "Est. revenue (cumulative)" : metric === "streams" ? "Streams (cumulative)" : "Tracks";

  const valueFormat = metric === "revenue" ? "usd" : "int";
  const yTickFormat = metric === "revenue" ? "usd_compact" : metric === "streams" ? "k" : "int";

  return (
    <div className="space-y-4">
      {/* Collector vs Collector mini view */}
      <div className="sb-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
              Comparison Table
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Showing {metricLabel.toLowerCase()} on data date{" "}
              {props.latestDate ? formatDateISO(props.latestDate) : "—"}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 dark:bg-white/10">
              {METRICS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetric(m)}
                  className={[
                    "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
                    metric === m
                      ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                      : "hover:bg-white/70 dark:hover:bg-white/10",
                  ].join(" ")}
                  style={metric === m ? undefined : { color: "var(--sb-muted)" }}
                >
                  {m === "revenue" ? "Revenue" : m === "streams" ? "Streams" : "Tracks"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <GlassTable
            headers={[
              "Collector",
              "Playlists",
              "Value",
              <span
                key="yday"
                title="Yesterday's value for this metric"
              >
                Yesterday
              </span>,
              <span
                key="ma7"
                title="7-day moving average of the previous 7 days (excluding today)"
              >
                7d avg
              </span>,
              "Trend (14d)",
            ]}
          >
            {ranked.map((r) => {
              const value =
                metric === "revenue" ? r.est_revenue_daily_net : metric === "streams" ? r.daily_streams_net : r.track_count;
              const deltaYday =
                metric === "revenue"
                  ? r.est_revenue_daily_delta_yday
                  : metric === "streams"
                    ? r.daily_streams_delta_yday
                    : r.track_count_delta_yday;
              const deltaMa7 =
                metric === "revenue"
                  ? r.est_revenue_daily_delta_ma7
                  : metric === "streams"
                    ? r.daily_streams_delta_ma7
                    : r.track_count_delta_ma7;

              // Calculate actual values from deltas
              const ydayValue = deltaYday != null ? value - deltaYday : null;
              const ma7Value = deltaMa7 != null ? value - deltaMa7 : null;

              const spark =
                metric === "revenue"
                  ? r.spark_rev_daily
                  : metric === "streams"
                    ? r.spark_streams_daily
                    : r.spark_tracks;

              const fmtValue =
                metric === "revenue"
                  ? formatUsd2(value)
                  : formatInt(value);

              const fmtYdayOrMa7 =
                metric === "revenue"
                  ? (n: number | null | undefined) => (n == null ? "—" : formatUsd2(n))
                  : (n: number | null | undefined) => (n == null ? "—" : formatInt(n));

              return (
                <TableRow key={r.collector}>
                  <TableCell>
                    <Link
                      href={`?collector=${encodeURIComponent(r.collector)}&range=${props.rangeDays}`}
                      className={[
                        "font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400",
                        r.collector === props.selectedCollector ? "opacity-100" : "opacity-70",
                      ].join(" ")}
                    >
                      {r.collector}
                    </Link>
                  </TableCell>
                  <TableCell>{formatInt(r.playlists)}</TableCell>
                  <TableCell className="font-medium">{fmtValue}</TableCell>
                  <TableCell>{fmtYdayOrMa7(ydayValue)}</TableCell>
                  <TableCell>{fmtYdayOrMa7(ma7Value)}</TableCell>
                  <TableCell>
                    <div className="h-5 w-20 opacity-60">
                      <Sparkline data={spark?.slice().reverse()} trend="neutral" />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </GlassTable>
        </div>
      </div>

      {/* Selected collector combined view */}
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold">{props.selectedCollector} (combined)</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              {props.rangeDays} day view
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <StatCard
            title="Est. revenue (daily)"
            value={
              <AnimatedCounter
                value={latest?.est_revenue_daily_net ?? 0}
                format="usd"
                usdMaximumFractionDigits={2}
                usdMinimumFractionDigits={2}
              />
            }
            subtitle={props.latestDate ? `Newest day: ${formatDateISO(props.latestDate)}` : undefined}
          />
          <StatCard
            title="Est. revenue (total)"
            value={
              <AnimatedCounter
                value={latest?.est_revenue_total ?? 0}
                format="usd"
                usdMaximumFractionDigits={2}
                usdMinimumFractionDigits={0}
              />
            }
            subtitle={`${props.rangeDays} day view`}
          />
          <StatCard
            title="Daily streams"
            value={<AnimatedCounter value={latest?.daily_streams_net ?? 0} />}
            subtitle={props.latestDate ? `Newest day: ${formatDateISO(props.latestDate)}` : undefined}
          />
          <StatCard
            title="Total streams"
            value={<AnimatedCounter value={latest?.total_streams_cumulative ?? 0} />}
            subtitle={`${props.rangeDays} day view`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <SpotlightCard className="lg:col-span-7 p-3">
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
                showMA7={true}
              />
            </div>
          </SpotlightCard>

          <SpotlightCard className="lg:col-span-5 p-3">
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
              />
            </div>
          </SpotlightCard>
        </div>

        <SpotlightCard className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Monthly {metric === "revenue" ? "Est. Revenue" : metric === "streams" ? "Streams" : "Track"}
            </div>
            <ChartCsvDownloadButton
              rows={monthlyData[metric] as unknown as Array<Record<string, unknown>>}
              filename={`collectors-${slugifyForFilename(`monthly-${metric}`)}-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            All-time monthly aggregation (not affected by date range)
          </p>
          <div className="mt-3 min-h-[220px]">
            <MonthlyBarChart
              data={monthlyData[metric]}
              valueLabel={metricLabel}
              valueFormat={valueFormat as any}
              yTickFormat={yTickFormat as any}
              heightPx={220}
            />
          </div>
        </SpotlightCard>

        {/* Top playlists breakdown */}
        <div className="space-y-2">
          <div className="flex items-end justify-between px-1">
            <div>
              <h3 className="text-sm font-semibold">Top playlists</h3>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Ranked by est. revenue (daily) on data date{" "}
                {props.latestDate ? formatDateISO(props.latestDate) : "—"}
              </div>
            </div>
          </div>

          <GlassTable
            headers={[
              "Playlist",
              "Est. Rev (Daily)",
              "Daily Streams",
              <span key="missing" title="Number of tracks in the playlist that don't have stream data in the catalog snapshot for this day. This may indicate tracks that were recently added, removed from the catalog, or have data processing issues.">
                Missing Streams
              </span>,
            ]}
          >
            {props.topPlaylists.map((p) => (
              <TableRow key={p.playlist_key}>
                <TableCell>
                  <Link
                    href={`/playlists/${p.playlist_key}`}
                    className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {p.display_name}
                  </Link>
                  <div className="font-mono text-[11px] opacity-50">{p.playlist_key}</div>
                </TableCell>
                <TableCell className="font-medium">{formatUsd2(p.est_revenue_daily_net)}</TableCell>
                <TableCell className="text-lime-700 dark:text-lime-400 font-medium">
                  +{formatInt(p.daily_streams_net)}
                </TableCell>
                <TableCell
                  title={
                    p.missing_streams_track_count
                      ? "Number of tracks in this playlist that don't have stream data in the catalog snapshot for this day. This may indicate tracks that were recently added, removed from the catalog, or have data processing issues."
                      : undefined
                  }
                >
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
      </div>
    </div>
  );
}

