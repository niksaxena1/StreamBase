"use client";

import { useMemo, useState } from "react";

import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { formatInt, formatDisplayDate } from "@/lib/format";
import {
  addedDateOf,
  buildChartData,
  computeStats,
  HISTORY_RANGES,
  isoDay,
  snapMarkerDate,
  trackingStartedNote,
  type HistoryRange,
  type TrackHistory,
} from "./trackHistoryModel";

export type HistoryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; history: TrackHistory };

const RANGE_LABEL: Record<HistoryRange, string> = { "7d": "7d", "28d": "28d", "90d": "90d", all: "All" };
const SHORT_HISTORY_MESSAGE = "Daily chart appears after the second daily snapshot (collected daily at 18:20 Abu Dhabi).";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
        {label}
      </div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="Loading stream history">
      <div className="h-6 w-48 rounded bg-black/10 dark:bg-white/10" />
      <div className="h-[220px] w-full rounded-lg bg-black/5 dark:bg-white/10" />
      <div className="h-4 w-64 max-w-full rounded bg-black/10 dark:bg-white/10" />
    </div>
  );
}

function ReadyPanel({ history, latestPlaycount }: { history: TrackHistory; latestPlaycount: number | null }) {
  const [mode, setMode] = useState<"daily" | "total">("daily");
  const [range, setRange] = useState<HistoryRange>("all");
  const { snapshots, membership } = history;

  const data = useMemo(() => buildChartData(snapshots, mode, range), [snapshots, mode, range]);
  const stats = useMemo(() => computeStats(snapshots, membership), [snapshots, membership]);
  const startedNote = useMemo(() => trackingStartedNote(snapshots, membership), [snapshots, membership]);

  const annotations = useMemo(() => {
    const dates = data.map((d) => d.date);
    const out: { date: string; title: string; note: string }[] = [];
    const added = addedDateOf(membership);
    const addedAt = snapMarkerDate(added, dates);
    if (added && addedAt) out.push({ date: addedAt, title: "Added", note: `Added to playlist on ${added}` });
    const removed = isoDay(membership?.removed_date);
    const removedAt = snapMarkerDate(removed, dates);
    if (removed && removedAt) out.push({ date: removedAt, title: "Removed", note: `Removed from playlist on ${removed}` });
    return out;
  }, [data, membership]);

  const current = snapshots.length > 0 ? snapshots[snapshots.length - 1].playcount : latestPlaycount;

  if (snapshots.length < 2) {
    return (
      <div className="space-y-1 text-sm">
        <p style={{ color: "var(--sb-muted)" }}>{SHORT_HISTORY_MESSAGE}</p>
        <p>
          <span style={{ color: "var(--sb-muted)" }}>Current total: </span>
          <span className="font-mono font-semibold">{current === null ? "-" : formatInt(current)}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChipGroup segmented aria-label="Chart metric">
          {(["daily", "total"] as const).map((m) => (
            <Chip key={m} segmented selected={mode === m} onClick={() => setMode(m)}>
              {m === "daily" ? "Daily streams" : "Total streams"}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup segmented aria-label="Date range">
          {HISTORY_RANGES.map((r) => (
            <Chip key={r} segmented selected={range === r} onClick={() => setRange(r)}>
              {RANGE_LABEL[r]}
            </Chip>
          ))}
        </ChipGroup>
      </div>

      <div className="w-full min-w-0">
        {data.length === 0 ? (
          <p className="py-8 text-center text-xs" style={{ color: "var(--sb-muted)" }}>
            No snapshots in this range.
          </p>
        ) : (
          <DailyStreamsChart
            data={data}
            valueLabel={mode === "daily" ? "Daily streams" : "Streams"}
            yTickFormat="int"
            heightPx={220}
            isCumulative={mode === "total"}
            annotations={annotations}
          />
        )}
      </div>

      {annotations.length > 0 ? (
        <p className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
          Dashed lines: {annotations.map((a) => `${a.title} ${formatDisplayDate(a.date)}`).join(", ")}.
        </p>
      ) : null}

      {stats ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Stat label="Streams since added" value={formatInt(stats.streamsSinceAdded)} />
          <Stat label="Avg / day since added" value={stats.avgPerDay === null ? "-" : formatInt(Math.round(stats.avgPerDay))} />
          <Stat label="Best day" value={stats.bestDay ? `${formatInt(stats.bestDay.value)} (${stats.bestDay.date})` : "-"} />
          <Stat label="Days tracked" value={formatInt(stats.daysTracked)} />
        </div>
      ) : null}

      {startedNote ? (
        <p className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
          History starts {startedNote}, when tracking began.
        </p>
      ) : null}
    </div>
  );
}

export function TrackHistoryPanel({ state, latestPlaycount }: { state: HistoryState | undefined; latestPlaycount: number | null }) {
  if (!state || state.status === "loading") return <Skeleton />;
  if (state.status === "error") {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Could not load stream history ({state.message}).
      </p>
    );
  }
  return <ReadyPanel history={state.history} latestPlaycount={latestPlaycount} />;
}
