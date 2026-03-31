"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import { computePaddedDomain, formatKmbTick, formatTooltipDateDaily, formatXAxisTick } from "@/components/charts/chartUtils";
import { getChartAxisStyle, getChartTooltipStyle, useThemeColors } from "@/components/charts/useThemeColors";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { formatDateRangeShort } from "@/components/ui/DateRangePicker";
import { Modal } from "@/components/ui/Modal";
import { fetchApiJson } from "@/lib/api";
import { todayIsoDate } from "@/lib/csv";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { formatDateOrdinalDMonYYYY, formatInt } from "@/lib/format";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import type { ArtificialStreamSpikeRow } from "./homeTypes";

const STORAGE_KEY_OPEN = "sb:home-artificial-streams-open";
const SPIKE_MIN = 1.1;
const SPIKE_MAX = 5;
const SLIDER_STEP = 0.05;
const DEBOUNCE_MS = 400;

type GroupedSpike = {
  isrc: string;
  name: string;
  album_image_url: string | null;
  artist_names: string[] | null;
  dateRows: ArtificialStreamSpikeRow[];
  maxSpike: number;
};

type SpikeHistoryPoint = {
  date: string;
  total_streams_cumulative: number | null;
  daily_streams_delta: number | null;
};

type ChartMode = "daily" | "total";

type SpikeHistoryChartRow = SpikeHistoryPoint & {
  value: number | null;
  flagged: boolean;
};

type SpikeTooltipPayloadEntry = {
  value?: unknown;
  payload?: SpikeHistoryChartRow;
};

function SpikeHistoryTooltip({
  active,
  label,
  payload,
  mode,
  accentColor,
  tooltipStyle,
}: {
  active?: boolean;
  label?: string;
  payload?: SpikeTooltipPayloadEntry[];
  mode: ChartMode;
  accentColor: string;
  tooltipStyle: CSSProperties;
}) {
  const point = payload?.[0]?.payload ?? null;
  if (!active || !point || !label) return null;

  const primaryValue = mode === "daily" ? point.daily_streams_delta : point.total_streams_cumulative;

  return (
    <ViewportAwareTooltip>
      <div
        className="max-w-[280px] rounded-lg border p-3"
        style={tooltipStyle}
      >
        <div className="mb-2 text-xs font-medium">{formatTooltipDateDaily(label)}</div>
        <div className="space-y-1.5 text-xs">
          <div>
            <span style={{ color: "var(--sb-muted)" }}>
              {mode === "daily" ? "Daily streams" : "Total streams"}:{" "}
            </span>
            <span className="font-semibold" style={{ color: accentColor }}>
              {primaryValue == null ? "—" : formatInt(primaryValue)}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--sb-muted)" }}>Daily streams: </span>
            <span className="font-medium">{point.daily_streams_delta == null ? "—" : formatInt(point.daily_streams_delta)}</span>
          </div>
          <div>
            <span style={{ color: "var(--sb-muted)" }}>Total streams: </span>
            <span className="font-medium">{point.total_streams_cumulative == null ? "—" : formatInt(point.total_streams_cumulative)}</span>
          </div>
          {point.flagged ? (
            <div
              className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "rgba(251,191,36,0.16)", color: "var(--sb-warning)" }}
            >
              Flagged spike day
            </div>
          ) : null}
        </div>
      </div>
    </ViewportAwareTooltip>
  );
}

function SpikeHistoryChart({
  points,
  flaggedDates,
  mode,
}: {
  points: SpikeHistoryPoint[];
  flaggedDates: Set<string>;
  mode: ChartMode;
}) {
  const gid = useId();
  const themeColors = useThemeColors();
  const axisStyle = getChartAxisStyle(themeColors);
  const tooltipStyle = getChartTooltipStyle(themeColors);

  const chartData: SpikeHistoryChartRow[] = points.map((p) => ({
    ...p,
    value: mode === "daily" ? p.daily_streams_delta : p.total_streams_cumulative,
    flagged: flaggedDates.has(p.date),
  }));

  const values = chartData
    .map((p) => p.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));

  if (values.length < 2) {
    return (
      <div
        className="rounded-xl border px-4 py-10 text-center text-sm"
        style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
      >
        Not enough stream history for a chart yet.
      </div>
    );
  }

  const yAxisDomain = computePaddedDomain(values, {
    clampMinToZero: mode === "total",
    padRatio: 0.1,
    minAbsPad: 1,
  });

  return (
    <div
      className="rounded-2xl border p-3"
      style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-[11px]">
        <div style={{ color: "var(--sb-muted)" }}>
          {mode === "daily" ? "Daily streams over time" : "Total streams over time"}
        </div>
        <div className="flex items-center gap-3" style={{ color: "var(--sb-muted)" }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--sb-accent)]" />
            Series
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            Flagged dates
          </span>
        </div>
      </div>
      <div className="w-full overflow-visible">
        <ResponsiveContainer width="100%" height={320} minWidth={0} style={{ overflow: "visible" }}>
          <AreaChart
            data={chartData}
            margin={{ top: 6, right: 10, left: 0, bottom: 0 }}
            style={{ outline: "none" }}
          >
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={themeColors.accentStroke} stopOpacity={0.28} />
                <stop offset="95%" stopColor={themeColors.accentStroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--sb-border)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxisTick}
              tickMargin={6}
              minTickGap={20}
              {...axisStyle}
            />
            <YAxis
              tickFormatter={(value) => formatKmbTick(Number(value ?? 0))}
              domain={yAxisDomain}
              width={52}
              {...axisStyle}
            />
            <Tooltip
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 10000 }}
              content={({ active, label, payload }) => (
                <SpikeHistoryTooltip
                  active={active}
                  label={label as string}
                  payload={payload as SpikeTooltipPayloadEntry[]}
                  mode={mode}
                  accentColor={themeColors.accentStroke}
                  tooltipStyle={tooltipStyle}
                />
              )}
              cursor={{
                stroke: themeColors.accentStroke,
                strokeWidth: 1.5,
                strokeDasharray: "5 5",
                opacity: 0.8,
              }}
            />
            {chartData.filter((p) => p.flagged).map((p) => (
              <ReferenceLine
                key={`flag-${p.date}`}
                x={p.date}
                stroke={themeColors.warning}
                strokeOpacity={0.45}
                strokeWidth={2}
                strokeDasharray="4 4"
                ifOverflow="hidden"
              />
            ))}
            <Area
              type="monotone"
              dataKey="value"
              stroke={themeColors.accentStroke}
              strokeWidth={2.25}
              fillOpacity={1}
              fill={`url(#${gid})`}
              connectNulls={false}
              isAnimationActive={false}
              dot={(props) => {
                const point = props?.payload as SpikeHistoryChartRow | undefined;
                const x = Number(props?.cx);
                const y = Number(props?.cy);
                if (!point?.flagged || !Number.isFinite(x) || !Number.isFinite(y)) return null;
                return (
                  <circle
                    cx={x}
                    cy={y}
                    r={4}
                    fill={themeColors.warning}
                    stroke={themeColors.bg}
                    strokeWidth={1.5}
                  />
                );
              }}
              activeDot={(props) => {
                const point = props?.payload as SpikeHistoryChartRow | undefined;
                const x = Number(props?.cx);
                const y = Number(props?.cy);
                if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
                return (
                  <circle
                    cx={x}
                    cy={y}
                    r={point?.flagged ? 5 : 4}
                    fill={point?.flagged ? themeColors.warning : themeColors.accentStroke}
                    stroke={themeColors.bg}
                    strokeWidth={1.5}
                  />
                );
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: "var(--sb-muted)" }}>
        <span className="font-mono">{points[0]?.date ?? "—"}</span>
        <span className="font-mono">{points[points.length - 1]?.date ?? "—"}</span>
      </div>
    </div>
  );
}

function SpikeTrackModal({
  open,
  onClose,
  group,
  history,
  historyLoading,
  historyError,
  chartMode,
  onChartModeChange,
  spikeRangeStart,
  spikeRangeEnd,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupedSpike | null;
  history: SpikeHistoryPoint[] | null;
  historyLoading: boolean;
  historyError: string | null;
  chartMode: ChartMode;
  onChartModeChange: (next: ChartMode) => void;
  spikeRangeStart: string | null;
  spikeRangeEnd: string | null;
}) {
  const [chartLimitToRange, setChartLimitToRange] = useState(false);

  const flaggedDates = useMemo(
    () => new Set((group?.dateRows ?? []).map((row) => row.date)),
    [group],
  );

  const chartPoints = useMemo(() => {
    const h = history ?? [];
    if (!chartLimitToRange || !spikeRangeStart || !spikeRangeEnd) return h;
    return h.filter((p) => {
      const dataD = dataDateFromRunDate(p.date);
      return dataD >= spikeRangeStart && dataD <= spikeRangeEnd;
    });
  }, [history, chartLimitToRange, spikeRangeStart, spikeRangeEnd]);

  useEffect(() => {
    setChartLimitToRange(false);
  }, [group?.isrc]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group?.name ?? "Spike details"}
      subtitle={group ? `${(group.artist_names ?? []).join(", ")} · ${group.isrc}` : undefined}
      maxWidthClassName="max-w-5xl"
      headerActions={
        <div className="flex items-center gap-1 rounded-full bg-white/50 p-0.5 dark:bg-white/10">
          <button
            type="button"
            onClick={() => onChartModeChange("daily")}
            className={[
              "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
              chartMode === "daily"
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "opacity-70 hover:opacity-100",
            ].join(" ")}
          >
            Daily
          </button>
          <button
            type="button"
            onClick={() => onChartModeChange("total")}
            className={[
              "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
              chartMode === "total"
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "opacity-70 hover:opacity-100",
            ].join(" ")}
          >
            Total
          </button>
        </div>
      }
    >
      {!group ? null : (
        <div className="space-y-4">
          {spikeRangeStart && spikeRangeEnd ? (
            <label className="flex cursor-pointer items-center gap-2 select-none text-[11px]" style={{ color: "var(--sb-muted)" }}>
              <input
                type="checkbox"
                checked={chartLimitToRange}
                onChange={(e) => setChartLimitToRange(e.target.checked)}
                className="rounded border sb-ring"
              />
              <span>
                Only selected range ({formatDateRangeShort(spikeRangeStart, spikeRangeEnd)})
              </span>
            </label>
          ) : null}
          <div className="flex items-start gap-3">
            {group.album_image_url ? (
              <Image
                src={group.album_image_url}
                alt={group.name}
                width={64}
                height={64}
                className="h-16 w-16 rounded-xl object-cover sb-ring"
              />
            ) : (
              <div className="h-16 w-16 rounded-xl sb-ring bg-white/60 dark:bg-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <Link
                href={`/catalog?isrc=${encodeURIComponent(group.isrc)}`}
                className="sb-link-hover inline-block truncate text-base font-semibold"
              >
                {group.name}
              </Link>
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                {(group.artist_names ?? []).join(", ")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full px-2 py-1" style={{ background: "var(--sb-surface)", color: "var(--sb-muted)" }}>
                  ISRC {group.isrc}
                </span>
                <span className="rounded-full px-2 py-1" style={{ background: "var(--sb-surface)", color: "var(--sb-muted)" }}>
                  {group.dateRows.length} flagged day{group.dateRows.length !== 1 ? "s" : ""}
                </span>
                <span className="rounded-full px-2 py-1" style={{ background: "var(--sb-surface)", color: "var(--sb-muted)" }}>
                  Max {group.maxSpike.toFixed(2)}×
                </span>
              </div>
            </div>
          </div>

          {historyError ? (
            <div className="rounded-xl border px-4 py-3 text-sm text-red-600 dark:text-red-400" style={{ borderColor: "var(--sb-border)" }}>
              {historyError}
            </div>
          ) : historyLoading ? (
            <div className="rounded-xl border px-4 py-8 text-center text-sm" style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}>
              Loading track history…
            </div>
          ) : (
            <SpikeHistoryChart
              points={chartPoints}
              flaggedDates={flaggedDates}
              mode={chartMode}
            />
          )}

          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Flagged dates
            </div>
            <GlassTable headers={["Date", "Daily", "Same-DOW Avg", "Ratio", "Total"]}>
              {group.dateRows.map((row) => (
                <TableRow key={`${group.isrc}-${row.date}`}>
                  <TableCell className="text-xs">{formatDateOrdinalDMonYYYY(row.date)}</TableCell>
                  <TableCell align="right" numeric>{formatInt(row.daily_streams)}</TableCell>
                  <TableCell align="right" numeric>
                    {row.avg_same_dow != null ? row.avg_same_dow.toFixed(1) : "—"}
                  </TableCell>
                  <TableCell align="right" className="font-mono text-xs">
                    {row.spike_ratio != null ? `${row.spike_ratio.toFixed(2)}×` : "—"}
                  </TableCell>
                  <TableCell align="right" numeric>{formatInt(row.streams_cumulative)}</TableCell>
                </TableRow>
              ))}
            </GlassTable>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function HomeArtificialStreamsSection(props: {
  artificialStreamSpikes: ArtificialStreamSpikeRow[];
  artificialStreamSpikeRatio: number;
  artificialMinBaseline: number;
  artificialIncludeWeekends: boolean;
  artificialSpikeDateStart: string | null;
  artificialSpikeDateEnd: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [spikeRatio, setSpikeRatio] = useState(props.artificialStreamSpikeRatio);
  const [includeWeekends, setIncludeWeekends] = useState(props.artificialIncludeWeekends);
  const [rows, setRows] = useState(props.artificialStreamSpikes);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [activeIsrc, setActiveIsrc] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("daily");
  const [historyByIsrc, setHistoryByIsrc] = useState<Record<string, SpikeHistoryPoint[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const skipNextDebounce = useRef(true);

  useEffect(() => {
    setOpen(readStoredBool(STORAGE_KEY_OPEN, false));
  }, []);

  useEffect(() => {
    writeStoredBool(STORAGE_KEY_OPEN, open);
  }, [open]);

  useEffect(() => {
    setSpikeRatio(props.artificialStreamSpikeRatio);
    setIncludeWeekends(props.artificialIncludeWeekends);
    setRows(props.artificialStreamSpikes);
    skipNextDebounce.current = true;
  }, [
    props.artificialStreamSpikeRatio,
    props.artificialStreamSpikes,
    props.artificialIncludeWeekends,
    props.artificialSpikeDateStart,
    props.artificialSpikeDateEnd,
  ]);

  useEffect(() => {
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const t = window.setTimeout(async () => {
      const matchesSaved =
        Math.round(spikeRatio * 100) === Math.round(props.artificialStreamSpikeRatio * 100) &&
        includeWeekends === props.artificialIncludeWeekends;
      if (matchesSaved) {
        setRows(props.artificialStreamSpikes);
        setFetchErr(null);
        return;
      }
      setLoading(true);
      setFetchErr(null);
      try {
        const q = new URLSearchParams({
          spike_ratio: String(spikeRatio),
          min_baseline: String(props.artificialMinBaseline),
          include_weekends: includeWeekends ? "1" : "0",
        });
        if (props.artificialSpikeDateStart && props.artificialSpikeDateEnd) {
          q.set("start_date", props.artificialSpikeDateStart);
          q.set("end_date", props.artificialSpikeDateEnd);
        }
        const data = await fetchApiJson<{ rows: ArtificialStreamSpikeRow[] }>(
          `/api/artificial-stream-spikes?${q.toString()}`,
        );
        setRows(data.rows ?? []);
      } catch (e) {
        setFetchErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [
    spikeRatio,
    includeWeekends,
    props.artificialStreamSpikeRatio,
    props.artificialStreamSpikes,
    props.artificialMinBaseline,
    props.artificialIncludeWeekends,
    props.artificialSpikeDateStart,
    props.artificialSpikeDateEnd,
  ]);

  const groups = useMemo(() => {
    const m = new Map<string, ArtificialStreamSpikeRow[]>();
    for (const r of rows) {
      const key = (r.isrc ?? "").trim();
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    const out: GroupedSpike[] = [];
    for (const [isrc, dateRows] of m) {
      dateRows.sort((a, b) => (a.date < b.date ? 1 : -1));
      const maxSpike = Math.max(0, ...dateRows.map((d) => d.spike_ratio ?? 0));
      const head = dateRows[0];
      out.push({
        isrc,
        name: head?.name ?? isrc,
        album_image_url: head?.album_image_url ?? null,
        artist_names: head?.artist_names ?? null,
        dateRows,
        maxSpike,
      });
    }
    out.sort((a, b) => b.maxSpike - a.maxSpike);
    return out;
  }, [rows]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.isrc === activeIsrc) ?? null,
    [groups, activeIsrc],
  );

  useEffect(() => {
    if (activeIsrc && !groups.some((group) => group.isrc === activeIsrc)) {
      setActiveIsrc(null);
    }
  }, [groups, activeIsrc]);

  useEffect(() => {
    if (!activeGroup) {
      setHistoryLoading(false);
      return;
    }
    if (historyByIsrc[activeGroup.isrc]) {
      setHistoryLoading(false);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);

    void fetchApiJson<{ points: SpikeHistoryPoint[] }>(
      `/api/artificial-stream-spikes/history?isrc=${encodeURIComponent(activeGroup.isrc)}`,
      { cache: "no-store" },
    )
      .then((data) => {
        if (cancelled) return;
        setHistoryByIsrc((prev) => ({ ...prev, [activeGroup.isrc]: data.points ?? [] }));
      })
      .catch((e) => {
        if (cancelled) return;
        setHistoryError(e instanceof Error ? e.message : "Failed to load track history");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeGroup, historyByIsrc]);

  const flatForCsv = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const ra = a.spike_ratio ?? 0;
        const rb = b.spike_ratio ?? 0;
        if (rb !== ra) return rb - ra;
        return a.date < b.date ? 1 : -1;
      }),
    [rows],
  );

  const count = rows.length;

  return (
    <>
      <details
        open={open}
        onToggle={(ev) => setOpen(ev.currentTarget.open)}
        className="rounded-xl border sb-panel p-3"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <span
                className="mt-0.5 flex-shrink-0 text-xs opacity-60 transition-transform duration-150"
                style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▸
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                  TRACKS: SAME-WEEKDAY SPIKES
                </div>
                {open ? (
                  <div className="mt-0.5 text-[10px] opacity-40 space-y-0.5">
                    <div>
                      Daily streams vs average of prior same weekdays (min baseline{" "}
                      {formatInt(props.artificialMinBaseline)}
                      {includeWeekends ? "" : " · Sat/Sun excluded"}
                      {props.artificialSpikeDateStart && props.artificialSpikeDateEnd
                        ? ` · Range ${formatDateRangeShort(props.artificialSpikeDateStart, props.artificialSpikeDateEnd)}`
                        : ""}
                      {count > 0 ? ` · ${count} spike day${count !== 1 ? "s" : ""}` : ""}
                    </div>
                    {loading ? <div>Updating…</div> : null}
                    {fetchErr ? (
                      <div className="text-amber-700 dark:text-amber-300">{fetchErr}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            {open ? (
              <div
                className="flex-shrink-0"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
              >
                <ChartCsvDownloadButton
                  filename={`home-artificial-stream-spikes-${todayIsoDate()}.csv`}
                  rows={flatForCsv.map((r) => ({
                    name: r.name,
                    isrc: r.isrc,
                    artists: (r.artist_names ?? []).join(", "),
                    date: r.date,
                    daily_streams: r.daily_streams,
                    avg_same_dow: r.avg_same_dow,
                    spike_ratio: r.spike_ratio,
                    streams_cumulative: r.streams_cumulative,
                  }))}
                  title="Download spike rows CSV"
                />
              </div>
            ) : null}
          </div>
        </summary>

        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2 min-w-0">
              <span className="opacity-70 whitespace-nowrap">Spike threshold</span>
              <input
                type="range"
                min={SPIKE_MIN}
                max={SPIKE_MAX}
                step={SLIDER_STEP}
                value={Math.min(SPIKE_MAX, Math.max(SPIKE_MIN, spikeRatio))}
                onChange={(e) => setSpikeRatio(Number(e.target.value))}
                className="w-40 max-w-full"
              />
              <span className="font-mono tabular-nums">{spikeRatio.toFixed(2)}×</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={includeWeekends}
                onChange={(e) => setIncludeWeekends(e.target.checked)}
                className="rounded border sb-ring"
              />
              <span className="opacity-80">Include Sat/Sun</span>
            </label>
          </div>

          <GlassTable headers={["TRACK", "MAX ×", "DAYS", ""]} maxBodyHeightClassName="max-h-[600px]">
            {groups.length === 0 ? (
              <EmptyState colSpan={4} message="No same-weekday spikes at this threshold" />
            ) : (
              groups.map((group) => (
                <TableRow key={group.isrc}>
                  <TableCell>
                    <div className="flex items-center gap-2 min-w-0">
                      {group.album_image_url ? (
                        <Image
                          src={group.album_image_url}
                          alt={group.name}
                          width={28}
                          height={28}
                          className="h-7 w-7 rounded-lg object-cover sb-ring flex-shrink-0"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link
                          href={`/catalog?isrc=${encodeURIComponent(group.isrc)}`}
                          className="font-medium transition-colors sb-link-hover block truncate"
                        >
                          {group.name}
                        </Link>
                        <div className="text-[10px] opacity-50 truncate">
                          {(group.artist_names ?? []).join(", ")} · {group.isrc}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {group.maxSpike > 0 ? `${group.maxSpike.toFixed(2)}×` : "—"}
                  </TableCell>
                  <TableCell className="text-center text-xs tabular-nums">
                    {group.dateRows.length}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setChartMode("daily");
                        setHistoryError(null);
                        setActiveIsrc(group.isrc);
                      }}
                      className="text-[10px] sb-link-hover"
                    >
                      Dates
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </GlassTable>
        </div>
      </details>

      <SpikeTrackModal
        open={Boolean(activeGroup)}
        onClose={() => {
          setActiveIsrc(null);
          setHistoryError(null);
        }}
        group={activeGroup}
        history={activeGroup ? historyByIsrc[activeGroup.isrc] ?? null : null}
        historyLoading={historyLoading}
        historyError={historyError}
        chartMode={chartMode}
        onChartModeChange={setChartMode}
        spikeRangeStart={props.artificialSpikeDateStart}
        spikeRangeEnd={props.artificialSpikeDateEnd}
      />
    </>
  );
}
