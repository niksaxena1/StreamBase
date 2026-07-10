"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  CheckCircle2,
} from "lucide-react";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { formatTooltipDateDaily } from "@/components/charts/chartUtils";
import { formatInt } from "@/lib/format";
import type { FollowerHistoryPoint } from "@/lib/playlistWatch/history";
import { fmtDelta, type PlaylistWatchRow } from "./playlistWatchClientModel";

export function TrendValue({ value }: { value: number | null }) {
  return value === null ? (
    <span
      title="Needs another daily snapshot for trend data"
      style={{ color: "var(--sb-muted)" }}
    >
      -
    </span>
  ) : (
    <>{fmtDelta(value)}</>
  );
}

export function PlaylistFollowerChart({
  history,
}: {
  history: FollowerHistoryPoint[];
}) {
  const [mode, setMode] = useState<"daily" | "total">("daily");
  const rows = useMemo(
    () =>
      [...history]
        .reverse()
        .map((point) => ({
          date: point.date,
          followers: point.followers,
          dailyDelta: point.dailyDelta ?? 0,
          isBaselineDay: point.dailyDelta === null,
        })),
    [history],
  );
  const totalData = useMemo(
    () =>
      rows.map((row) => ({
        date: row.date,
        value: row.followers,
        _followersTotal: row.followers,
        _followersDaily: row.dailyDelta,
        ...(row.isBaselineDay ? { _isBaselineDay: true as const } : {}),
      })),
    [rows],
  );
  const dailyData = useMemo(
    () =>
      rows.map((row) => ({
        date: row.date,
        value: row.dailyDelta,
        _followersTotal: row.followers,
        _followersDaily: row.dailyDelta,
        ...(row.isBaselineDay ? { _isBaselineDay: true as const } : {}),
      })),
    [rows],
  );
  const inactiveMode = mode === "daily" ? "total" : "daily";
  const latest = history.at(-1);
  const headline =
    mode === "daily"
      ? fmtDelta(latest?.dailyDelta ?? null)
      : formatInt(latest?.followers ?? null);
  const dateRange =
    history.length >= 2
      ? `${formatTooltipDateDaily(history[0]?.date ?? "")} to ${formatTooltipDateDaily(history.at(-1)?.date ?? "")}`
      : "At least two daily snapshots are needed before the trend becomes meaningful.";
  const label = (value: "daily" | "total") =>
    value === "daily" ? "Daily followers" : "Total followers";
  const chart = (value: "daily" | "total", ghost = false) =>
    value === "daily" ? (
      <DailyStreamsChart
        data={dailyData}
        valueLabel="Daily change"
        yTickFormat="int"
        heightPx={280}
        ghost={ghost}
      />
    ) : (
      <DailyStreamsChart
        data={totalData}
        valueLabel="Followers"
        yTickFormat="int"
        heightPx={280}
        isCumulative
        ghost={ghost}
      />
    );
  return (
    <div className="sb-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => setMode(inactiveMode)}
            className="inline-flex items-center gap-1.5 text-left transition-opacity hover:opacity-80"
            title={`Switch to ${label(inactiveMode)}`}
            aria-label={`Switch to ${label(inactiveMode)} view`}
          >
            <span className="font-display text-base font-semibold">
              {label(mode)}
            </span>
            <ArrowLeftRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
          </button>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            {dateRange}
          </div>
        </div>
        {history.length >= 2 ? (
          <span
            className="font-mono text-lg font-semibold"
            style={{ color: "var(--sb-accent)" }}
          >
            {headline}
          </span>
        ) : null}
      </div>
      {history.length >= 2 ? (
        <div className="relative min-h-[280px]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.24] saturate-[0.85]"
          >
            {chart(inactiveMode, true)}
          </div>
          <div className="relative z-[1]">{chart(mode)}</div>
        </div>
      ) : (
        <div
          className="grid h-[220px] place-items-center rounded-lg border border-dashed"
          style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
        >
          <div className="text-center text-sm">
            <div className="font-medium">Not enough history yet</div>
            <div className="mt-1 text-xs">
              The next successful daily check will start the chart.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function FollowerSparkline({
  history,
}: {
  history: FollowerHistoryPoint[];
}) {
  const points = history.slice(-14);
  if (points.length < 2)
    return (
      <span
        className="text-[11px]"
        style={{ color: "var(--sb-muted)" }}
        title="Needs at least two snapshots"
      >
        -
      </span>
    );
  const values = points.map((point) => point.followers),
    min = Math.min(...values),
    max = Math.max(...values),
    width = 92,
    height = 28;
  const path = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y =
        max === min
          ? height / 2
          : height - ((value - min) / (max - min)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const delta = values.at(-1)! - values[0]!;
  const color = delta >= 0 ? "var(--sb-positive)" : "rgb(239 68 68)";
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mx-auto h-7 w-[92px]"
      role="img"
      aria-label={`14 day follower trend ${fmtDelta(delta)}`}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={width}
        cy={path.split("L").at(-1)?.split(",").at(1) ?? height / 2}
        r="2.5"
        fill={color}
      />
    </svg>
  );
}

export function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="min-w-0 rounded-lg border p-2 sm:p-3"
      style={{
        borderColor: "var(--sb-border)",
        background: "var(--sb-surface)",
      }}
    >
      <div
        className="truncate text-[9px] uppercase tracking-wide sm:text-[11px]"
        style={{ color: "var(--sb-muted)" }}
      >
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold leading-tight sm:mt-1 sm:text-lg">
        {value}
      </div>
    </div>
  );
}
export function StatusIcon({ playlist }: { playlist: PlaylistWatchRow }) {
  if (playlist.watchStatus === "archived")
    return (
      <Archive className="h-3.5 w-3.5 text-red-500" aria-label="Archived">
        <title>Archived - not tracked until unarchived</title>
      </Archive>
    );
  if (playlist.lastCheckStatus === "ok")
    return (
      <CheckCircle2
        className="h-3.5 w-3.5 text-emerald-500"
        aria-label="Latest check ok"
      >
        <title>{`Latest check ok${playlist.latestSnapshotDate ? ` - ${playlist.latestSnapshotDate}` : ""}`}</title>
      </CheckCircle2>
    );
  return (
    <AlertTriangle
      className="h-3.5 w-3.5 text-amber-500"
      aria-label="Latest check warning"
    >
      <title>{`${playlist.lastCheckStatus ?? "pending"}${playlist.lastCheckMessage ? ` - ${playlist.lastCheckMessage}` : ""}`}</title>
    </AlertTriangle>
  );
}
