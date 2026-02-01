"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Music } from "lucide-react";

import { MetricProvider, useMetric } from "@/components/metrics/MetricContext";
import { MetricSelector } from "@/components/metrics/MetricSelector";
import { LazyInteractiveChartSection } from "@/components/dashboard/LazyInteractiveChartSection";
import { StatCard } from "@/components/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";

type PlaylistDailyStatsRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  est_revenue_total?: number | null;
  est_revenue_daily_net?: number | null;
};

type ChartPoint = { date: string; value: number; ma7?: number | null };

function computeRollingAvg7(desc: Array<{ date: string; value: number }>) {
  const asc = [...desc].reverse();
  const outAsc: Array<{ date: string; value: number; ma7: number | null }> = [];
  for (let i = 0; i < asc.length; i++) {
    const start = Math.max(0, i - 6);
    const window = asc.slice(start, i + 1).map((p) => Number(p.value ?? 0));
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    outAsc.push({ date: asc[i].date, value: asc[i].value, ma7: avg });
  }
  return outAsc.reverse();
}

function hrefWith(
  existing: { scope?: string; range?: string; daily?: string },
  patch: { scope?: string; range?: string; daily?: string },
) {
  const params = new URLSearchParams();
  const scope = (patch.scope ?? existing.scope ?? "all_catalog").toString();
  const range = (patch.range ?? existing.range ?? "30").toString();
  params.set("scope", scope);
  params.set("range", range);
  return `/?${params.toString()}`;
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

function HomeDashboardInner(props: {
  sp: { scope?: string; range?: string; daily?: string };
  playlistKey: "all_catalog" | "releases" | "ext";
  title: string;
  rangeDays: number;
  latest: PlaylistDailyStatsRow | null;
  history: PlaylistDailyStatsRow[];
  playlistImageUrl: string | null;
  historyErrorMessage?: string | null;
}) {
  const { metric, setMetric } = useMetric();
  const [selectedChart, setSelectedChart] = useState<"daily" | "total">("daily");

  const series = useMemo(() => {
    const desc = props.history ?? [];

    if (metric === "revenue") {
      const dailyDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: Number(r.est_revenue_daily_net ?? 0),
      }));
      const totalDesc = desc.map((r) => ({
        date: dataDateFromRunDate(r.date),
        value: Number(r.est_revenue_total ?? 0),
      }));
      return {
        daily: computeRollingAvg7(dailyDesc),
        total: totalDesc,
        dailyValue: Number(props.latest?.est_revenue_daily_net ?? 0),
        totalValue: Number(props.latest?.est_revenue_total ?? 0),
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
    const dailyDesc = desc.map((r) => ({
      date: dataDateFromRunDate(r.date),
      value: Number(r.daily_streams_net ?? 0),
    }));
    const totalDesc = desc.map((r) => ({
      date: dataDateFromRunDate(r.date),
      value: Number(r.total_streams_cumulative ?? 0),
    }));
    return {
      daily: computeRollingAvg7(dailyDesc),
      total: totalDesc,
      dailyValue: Number(props.latest?.daily_streams_net ?? 0),
      totalValue: Number(props.latest?.total_streams_cumulative ?? 0),
      dailyTitle: "Daily Streams",
      totalTitle: "Total Streams",
      dailyValueLabel: "Streams",
      totalValueLabel: "Total Streams",
      valueFormat: "int" as const,
      yTickFormat: "k" as const,
      color: "#c7f33c",
    };
  }, [metric, props.history, props.latest]);

  const chartDataDaily: ChartPoint[] = series.daily;
  const chartDataTotal: ChartPoint[] = series.total;

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
            <ToggleLink
              active={props.playlistKey === "all_catalog"}
              href={hrefWith(props.sp, { scope: "all_catalog" })}
            >
              All
            </ToggleLink>
            <ToggleLink
              active={props.playlistKey === "releases"}
              href={hrefWith(props.sp, { scope: "releases" })}
            >
              Releases
            </ToggleLink>
            <ToggleLink
              active={props.playlistKey === "ext"}
              href={hrefWith(props.sp, { scope: "ext" })}
            >
              Ext
            </ToggleLink>
          </div>

          <MetricSelector metric={metric} setMetric={setMetric} />

          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <ToggleLink active={props.rangeDays === 30} href={hrefWith(props.sp, { range: "30" })}>
              30d
            </ToggleLink>
            <ToggleLink active={props.rangeDays === 90} href={hrefWith(props.sp, { range: "90" })}>
              90d
            </ToggleLink>
            <ToggleLink active={props.rangeDays === 365} href={hrefWith(props.sp, { range: "365" })}>
              365d
            </ToggleLink>
          </div>
        </div>
      </div>

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
        selectedChart={selectedChart}
        onSelectChart={setSelectedChart}
      />

      {/* Additional Stat Cards (keep existing ones) */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <StatCard
          title="Streams (7d)"
          value={<AnimatedCounter value={rollSum(props.history ?? [], 7, "streams")} />}
          subtitle={formatUsd(rollSum(props.history ?? [], 7, "revenue"))}
        />
        <StatCard
          title="Streams (30d)"
          value={<AnimatedCounter value={rollSum(props.history ?? [], 30, "streams")} />}
          subtitle={formatUsd(rollSum(props.history ?? [], 30, "revenue"))}
        />
      </div>

      {props.historyErrorMessage ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {props.historyErrorMessage}
        </div>
      ) : null}

      {/* Recent History Table */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold tracking-tight">Recent History</h2>
        <GlassTable 
          headers={["Date", "Tracks", "Total Streams", "Daily"]}
          // Constrain height so ~7 rows are visible; scroll for more.
          maxBodyHeightClassName="max-h-[228px] overflow-auto"
        >
          {(props.history ?? []).map((r) => (
            <TableRow key={r.date}>
              <TableCell mono>{formatDateISO(dataDateFromRunDate(r.date))}</TableCell>
              <TableCell>{formatInt(r.track_count)}</TableCell>
              <TableCell>{formatInt(r.total_streams_cumulative)}</TableCell>
              <TableCell className="text-lime-700 dark:text-lime-400 font-medium">
                +{formatInt(r.daily_streams_net)}
              </TableCell>
            </TableRow>
          ))}
          {!props.history?.length && <EmptyState colSpan={4} message="No stats found yet" />}
        </GlassTable>
      </div>
    </div>
  );
}

function rollSum(rowsDesc: PlaylistDailyStatsRow[], days: number, kind: "streams" | "revenue") {
  const slice = rowsDesc.slice(0, days);
  let sum = 0;
  for (const r of slice) {
    if (kind === "streams") sum += Number(r.daily_streams_net ?? 0);
    else sum += Number(r.est_revenue_daily_net ?? 0);
  }
  return sum;
}

export function HomeDashboardClient(props: {
  sp: { scope?: string; range?: string; daily?: string };
  playlistKey: "all_catalog" | "releases" | "ext";
  title: string;
  rangeDays: number;
  latest: PlaylistDailyStatsRow | null;
  history: PlaylistDailyStatsRow[];
  playlistImageUrl: string | null;
  historyErrorMessage?: string | null;
}) {
  return (
    <MetricProvider defaultMetric="streams">
      <HomeDashboardInner {...props} />
    </MetricProvider>
  );
}
