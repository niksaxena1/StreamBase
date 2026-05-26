"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { Modal } from "@/components/ui/Modal";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { getChartColor, getChartTooltipStyle, useThemeColors } from "@/components/charts/useThemeColors";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { todayIsoDate } from "@/lib/csv";
import type { TrackFilterResult } from "./filterTypes";

type ViewMode = "total" | "daily";

const HEADER_PILL_ACTIVE = "bg-black text-white dark:bg-white dark:text-black";
const HEADER_PILL_IDLE = "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20";

function headerPill(active: boolean): string {
  return [
    "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
    active ? HEADER_PILL_ACTIVE : HEADER_PILL_IDLE,
  ].join(" ");
}

function buildLorenzCurve(
  sorted: TrackFilterResult[],
  grandTotal: number,
  getValue: (t: TrackFilterResult) => number,
) {
  if (!grandTotal || !sorted.length) return [];
  const points: Array<{ cumPct: number; trackCount: number; name: string | null }> = [
    { cumPct: 0, trackCount: 0, name: null },
  ];
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += Math.max(0, getValue(sorted[i]));
    points.push({
      cumPct: Math.round(((cum / grandTotal) * 100) * 10) / 10,
      trackCount: i + 1,
      name: sorted[i].name,
    });
  }
  return points;
}

export function FilterConcentrationView({
  results,
  distroByIsrc,
}: {
  results: TrackFilterResult[];
  distroByIsrc?: Map<string, { name: string; imageUrl: string | null }>;
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const colors = useThemeColors();
  const streamChartColor = getChartColor("streams", colors);
  const [viewMode, setViewMode] = useState<ViewMode>("total");
  const [threshold, setThreshold] = useState(50);
  const [showCurveModal, setShowCurveModal] = useState(false);
  const [showIsrc, setShowIsrc] = useState(false);

  const hasDistroData = distroByIsrc && distroByIsrc.size > 0;

  const getValue = useCallback(
    (t: TrackFilterResult) =>
      viewMode === "daily" ? (t.daily_streams ?? 0) : (t.total_streams ?? 0),
    [viewMode],
  );

  const { sorted, grandTotal, thresholdIdx, cumPcts } = useMemo(() => {
    const s = [...results].sort((a, b) => getValue(b) - getValue(a));
    const total = s.reduce((sum, t) => sum + Math.max(0, getValue(t)), 0);

    const cumPctsArr: number[] = new Array(s.length);
    let cum = 0;
    let tIdx = -1;
    for (let i = 0; i < s.length; i++) {
      cum += Math.max(0, getValue(s[i]));
      cumPctsArr[i] = total > 0 ? (cum / total) * 100 : 0;
      if (tIdx === -1 && total > 0 && cumPctsArr[i] >= threshold) {
        tIdx = i;
      }
    }

    return { sorted: s, grandTotal: total, thresholdIdx: tIdx, cumPcts: cumPctsArr };
  }, [results, getValue, threshold]);

  const tracksAboveThreshold = thresholdIdx >= 0 ? thresholdIdx + 1 : sorted.length;

  const lorenzData = useMemo(
    () => buildLorenzCurve(sorted, grandTotal, getValue),
    [sorted, grandTotal, getValue],
  );

  const thresholdPoint = useMemo(() => {
    if (thresholdIdx < 0 || !lorenzData.length) return null;
    return lorenzData[thresholdIdx + 1] ?? null;
  }, [lorenzData, thresholdIdx]);

  const isRevenue = metric === "revenue";
  const formatValue = (streams: number) =>
    isRevenue ? formatUsd(streams * streamPayoutPerStreamUsd) : formatInt(streams);
  const valueStyle = isRevenue ? ({ color: "#10b981" } as const) : ({ color: "var(--sb-positive)" } as const);
  const valueClass = "font-medium";

  const csvRows = useMemo(
    () =>
      sorted.map((t, i) => {
        const val = getValue(t);
        const distro = distroByIsrc?.get(t.isrc);
        return {
          track: t.name ?? t.isrc,
          isrc: t.isrc,
          artists: (t.spotify_artist_names ?? []).join(", "),
          release_date: t.release_date ?? "",
          distro_playlist: distro?.name ?? "",
          value: val,
          share_pct: grandTotal > 0 ? ((Math.max(0, val) / grandTotal) * 100).toFixed(2) : "0",
          cum_pct: (cumPcts[i] ?? 0).toFixed(2),
        };
      }),
    [sorted, getValue, grandTotal, cumPcts, distroByIsrc],
  );

  if (results.length === 0) {
    return (
      <GlassTable headers={[{ label: "Concentration" }]} maxBodyHeightClassName="max-h-[240px]">
        <EmptyState colSpan={1} message="No tracks to analyze" />
      </GlassTable>
    );
  }

  // Column count for threshold divider colSpan
  const colCount = 7;

  return (
    <>
      <div className="space-y-3">
        {/* Controls row */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {/* Total / Daily toggle */}
            <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
              <button type="button" onClick={() => setViewMode("total")} className={headerPill(viewMode === "total")}>
                TOTAL
              </button>
              <button type="button" onClick={() => setViewMode("daily")} className={headerPill(viewMode === "daily")}>
                DAILY
              </button>
            </div>

            <span className="text-[11px]" style={{ color: "var(--sb-muted)" }}>
              {sorted.length} tracks
            </span>
          </div>

          <div className="flex items-center gap-2">
            {thresholdIdx >= 0 && tracksAboveThreshold < sorted.length && (
              <button
                type="button"
                onClick={() => setShowCurveModal(true)}
                className="text-[11px] underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer"
                style={{ color: "var(--sb-muted)" }}
                title="View concentration curve"
              >
                top {tracksAboveThreshold} = {threshold}%
              </button>
            )}

            <ChartCsvDownloadButton
              filename={`filter-concentration-${viewMode}-${todayIsoDate()}.csv`}
              rows={csvRows}
              title="Download concentration CSV"
            />
          </div>
        </div>

        {/* Threshold slider */}
        <div className="flex items-center gap-2 px-1">
          <label className="text-[11px] font-medium whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
            Threshold
          </label>
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1 h-1 accent-current cursor-pointer"
            style={{ color: "var(--sb-positive)" }}
          />
          <span className="text-[11px] font-mono font-medium tabular-nums w-8 text-right" style={{ color: "var(--sb-muted)" }}>
            {threshold}%
          </span>
        </div>

        {/* Table */}
        <GlassTable
          headers={[
            "",
            "TRACK",
            { label: "RELEASE", className: "hidden sm:table-cell" },
            {
              label: (
                <button
                  type="button"
                  className="text-[11px] font-medium uppercase tracking-wider cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setShowIsrc((v) => !v)}
                  title={showIsrc ? "Show distro playlist" : "Show ISRC"}
                  style={{ color: "var(--sb-muted)" }}
                >
                  {showIsrc ? "ISRC" : "DISTRO"}
                </button>
              ),
              className: "hidden sm:table-cell",
            },
            { label: isRevenue ? (viewMode === "daily" ? "DAILY REV" : "TOTAL REV") : (viewMode === "daily" ? "DAILY" : "TOTAL"), align: "right" as const },
            { label: "SHARE", align: "right" as const },
            { label: "CUM %", align: "right" as const },
          ]}
          maxBodyHeightClassName="max-h-[440px]"
        >
          {sorted.map((t, i) => {
            const val = Math.max(0, getValue(t));
            const sharePct = grandTotal > 0 ? (val / grandTotal) * 100 : 0;
            const cumPct = cumPcts[i] ?? 0;
            const isThresholdRow = i === thresholdIdx;
            const isAboveThreshold = thresholdIdx >= 0 && i <= thresholdIdx && tracksAboveThreshold < sorted.length;
            const distro = distroByIsrc?.get(t.isrc);

            return (
              <React.Fragment key={t.isrc}>
                <TableRow style={isAboveThreshold ? { backgroundColor: "color-mix(in srgb, var(--sb-positive) 6%, transparent)" } : undefined}>
                  <TableCell>
                    {t.spotify_album_image_url ? (
                      <PreviewableArtwork
                        src={t.spotify_album_image_url}
                        alt={t.name ?? t.isrc}
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded-lg object-cover sb-ring flex-shrink-0"
                        label={t.name ?? t.isrc}
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <Link
                        href={`/catalog?isrc=${encodeURIComponent(t.isrc)}`}
                        className="font-medium transition-colors sb-link-hover block truncate"
                      >
                        {t.name ?? t.isrc}
                      </Link>
                      {t.spotify_artist_names?.length ? (
                        <div className="text-[10px] opacity-50 truncate">
                          <ArtistLinks
                            artistNames={t.spotify_artist_names}
                            artistIds={t.spotify_artist_ids}
                            className="inline"
                          />
                        </div>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell mono className="text-xs hidden sm:table-cell" style={{ color: "var(--sb-muted)" }}>
                    {formatDateISO(t.release_date)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {showIsrc ? (
                      <CopyableIsrc
                        isrc={t.isrc}
                        className="font-mono text-xs opacity-40"
                        style={{ color: "var(--sb-muted)" }}
                      />
                    ) : distro ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        {distro.imageUrl ? (
                          <PreviewableArtwork src={distro.imageUrl} alt={distro.name} width={20} height={20} className="h-5 w-5 rounded flex-shrink-0 object-cover" label={distro.name} />
                        ) : (
                          <div className="h-5 w-5 rounded flex-shrink-0 bg-orange-400/20" />
                        )}
                        <span className="truncate text-xs" style={{ color: "var(--sb-muted)" }}>{distro.name}</span>
                      </div>
                    ) : (
                      <span className="text-xs opacity-30" style={{ color: "var(--sb-muted)" }}>—</span>
                    )}
                  </TableCell>
                  <TableCell numeric className={valueClass} style={valueStyle}>
                    {viewMode === "daily" ? `+${formatValue(val)}` : formatValue(val)}
                  </TableCell>
                  <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)", opacity: 0.7 }}>
                    {sharePct.toFixed(1)}%
                  </TableCell>
                  <TableCell numeric className="text-xs font-mono" style={{ color: "var(--sb-muted)" }}>
                    {cumPct.toFixed(1)}%
                  </TableCell>
                </TableRow>
                {isThresholdRow && tracksAboveThreshold < sorted.length && (
                  <tr aria-hidden>
                    <td colSpan={colCount} className="px-2 py-0">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                        <span className="text-[10px] font-medium" style={{ color: "var(--sb-positive)", opacity: 0.7 }}>
                          {threshold}% of {viewMode === "daily" ? "daily" : "total"} streams above
                        </span>
                        <div className="flex-1 border-t" style={{ borderColor: "var(--sb-positive)", opacity: 0.4 }} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </GlassTable>
      </div>

      {/* Lorenz / concentration curve modal */}
      <Modal
        open={showCurveModal}
        onClose={() => setShowCurveModal(false)}
        title="Concentration curve"
        subtitle={`${sorted.length} filtered tracks`}
        headerCenter={
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
            <button type="button" onClick={() => setViewMode("total")} className={headerPill(viewMode === "total")}>
              TOTAL
            </button>
            <button type="button" onClick={() => setViewMode("daily")} className={headerPill(viewMode === "daily")}>
              DAILY
            </button>
          </div>
        }
        maxWidthClassName="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="text-center text-sm" style={{ color: "var(--sb-text)" }}>
            <span className="font-semibold" style={{ color: "var(--sb-positive)" }}>
              {tracksAboveThreshold}
            </span>
            {" "}of {sorted.length} tracks account for{" "}
            <span className="font-semibold" style={{ color: "var(--sb-positive)" }}>
              {threshold}%
            </span>
            {" "}of {viewMode === "daily" ? "daily" : "total"} streams
          </div>

          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={lorenzData}
                margin={{ top: 10, right: 10, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="filterLorenzFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={streamChartColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={streamChartColor} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border}
                  vertical={false}
                />
                <XAxis
                  dataKey="trackCount"
                  type="number"
                  domain={[0, sorted.length]}
                  stroke={colors.muted}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  dataKey="cumPct"
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  stroke={colors.muted}
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={getChartTooltipStyle(colors)}
                  formatter={((value: number | undefined, name: string | undefined) => {
                    if (name === "cumPct") return [`${value ?? 0}%`, "Streams"];
                    return [value ?? 0, name ?? ""];
                  }) as never}
                  labelFormatter={(label) => `${label} tracks`}
                />
                <Area
                  dataKey="cumPct"
                  stroke={streamChartColor}
                  strokeWidth={2}
                  fill="url(#filterLorenzFill)"
                  dot={false}
                  animationDuration={400}
                />
                {thresholdPoint && (
                  <>
                    <ReferenceLine
                      x={thresholdPoint.trackCount}
                      stroke={colors.positive}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <ReferenceLine
                      y={thresholdPoint.cumPct}
                      stroke={colors.positive}
                      strokeDasharray="4 4"
                      strokeOpacity={0.6}
                    />
                    <ReferenceDot
                      x={thresholdPoint.trackCount}
                      y={thresholdPoint.cumPct}
                      r={5}
                      fill={colors.positive}
                      stroke={colors.bg}
                      strokeWidth={2}
                    />
                  </>
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-3 px-1">
            <label className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
              Threshold
            </label>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="flex-1 h-1 accent-current cursor-pointer"
              style={{ color: "var(--sb-positive)" }}
            />
            <span className="text-xs font-mono font-medium tabular-nums w-8 text-right" style={{ color: "var(--sb-muted)" }}>
              {threshold}%
            </span>
          </div>

          <div className="text-[10px] text-center opacity-40" style={{ color: "var(--sb-muted)" }}>
            A steep initial rise means a few tracks dominate. A more linear shape means streams are evenly spread.
          </div>
        </div>
      </Modal>
    </>
  );
}
