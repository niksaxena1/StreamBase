"use client";

import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent, MouseEvent } from "react";
import { formatCompactMoney, formatInt, formatUsd } from "@/lib/format";
import { formatKmbTick } from "@/components/charts/chartUtils";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import { useCurrencyDisplay } from "@/components/currency/CurrencyDisplayContext";
import { useLongPress } from "@/components/charts/useLongPress";
import { formatMilestoneCompact, generateAutoMilestonesFromMax } from "@/lib/milestones";

type TrackPoint = {
  isrc: string;
  total_streams_cumulative: number;
  artist_ids?: string[] | null;
};

type MilestoneDataPoint = {
  milestone: number;
  milestoneLabel: string;
  unique_tracks: number;
  unique_artists: number;
};

type MilestoneTooltipProps = {
  active?: boolean;
  payload?: Array<{ value?: unknown; payload?: MilestoneDataPoint }>;
  label?: string | number;
  totalCount: number;
  countLabel: "Tracks" | "Artists";
  mode: "streams" | "revenue";
  accentColor?: string;
  onActivePayload?: (p: MilestoneDataPoint | null) => void;
};

function MilestoneTooltip({
  active,
  payload,
  label,
  totalCount,
  countLabel,
  mode,
  accentColor,
  onActivePayload,
}: MilestoneTooltipProps) {
  const p = payload?.[0]?.payload ?? null;

  // Notify parent of the currently active payload (for long-press action).
  useEffect(() => {
    onActivePayload?.(active ? p : null);
  }, [active, p, onActivePayload]);

  if (!active || !payload?.length) return null;

  const raw = payload[0]?.value;
  const n = typeof raw === "number" ? raw : Number(raw);
  const count = Number.isFinite(n) ? n : 0;
  const color = accentColor ?? (mode === "revenue" ? "var(--sb-revenue)" : "var(--sb-positive)");
  const pct =
    totalCount > 0 ? Math.max(0, Math.min(100, (count / totalCount) * 100)) : 0;
  const pctLabel = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);

  return (
    <ViewportAwareTooltip>
      <div
        className="rounded-lg border px-3 py-2 text-xs shadow-lg backdrop-blur"
        style={{
          backgroundColor: "var(--sb-card)",
          borderColor: "var(--sb-border)",
          color: "var(--sb-text)",
          boxShadow: "var(--sb-shadow-compact)",
        }}
      >
        <div className="mb-1 font-medium">
          {mode === "revenue" ? "Revenue milestone" : "Milestone"}: {label ?? "—"}
        </div>
        <div>
          {countLabel}:{" "}
          <span style={{ color, fontWeight: 700 }}>
            {formatInt(count)}
          </span>
          <span className="ml-1 opacity-70" style={{ color: "var(--sb-muted)" }}>
            ({pctLabel}%)
          </span>
        </div>
      </div>
    </ViewportAwareTooltip>
  );
}

const formatMilestoneLabel = (n: number) => formatMilestoneCompact(n, { case: "upper" });

function formatRevenueMilestoneLabel(streamsMilestone: number, payoutPerStreamUsd: number): string {
  const usd = Math.max(0, Number(streamsMilestone) * Math.max(0, payoutPerStreamUsd));
  return formatCompactMoney(usd, formatUsd);
}

/**
 * Compute how many tracks have reached each milestone threshold.
 * A track "reaches" a milestone if its total streams >= milestone.
 */
function computeMilestoneData(
  tracks: TrackPoint[],
  milestones: number[],
  mode: "streams" | "revenue",
  payoutPerStreamUsd: number,
  countMode: "tracks" | "artists",
  bucketMode: "cumulative" | "exclusive",
): MilestoneDataPoint[] {
  // Sort milestones ascending (lowest first for display, left to right)
  const sortedAsc = [...milestones].sort((a, b) => a - b);

  const makeMilestoneLabel = (milestone: number) =>
    mode === "revenue"
      ? formatRevenueMilestoneLabel(milestone, payoutPerStreamUsd)
      : formatMilestoneLabel(milestone);

  // ── Artist mode: aggregate total streams per artist, then bucket by aggregate ──
  if (countMode === "artists") {
    const artistStreams = new Map<string, number>();
    for (const t of tracks) {
      const total = Number(t?.total_streams_cumulative ?? 0);
      if (!Number.isFinite(total) || total <= 0) continue;
      const ids = t.artist_ids ?? [];
      for (const id of ids) {
        if (!id) continue;
        artistStreams.set(id, (artistStreams.get(id) ?? 0) + total);
      }
    }

    if (bucketMode === "exclusive") {
      const sortedDesc = [...sortedAsc].sort((a, b) => b - a);
      const artistCounts = new Map<number, number>();
      for (const m of sortedAsc) artistCounts.set(m, 0);

      for (const [, aggTotal] of artistStreams) {
        for (const m of sortedDesc) {
          if (aggTotal >= m) {
            artistCounts.set(m, (artistCounts.get(m) ?? 0) + 1);
            break;
          }
        }
      }

      return sortedAsc.map((milestone) => ({
        milestone,
        milestoneLabel: makeMilestoneLabel(milestone),
        unique_tracks: 0,
        unique_artists: artistCounts.get(milestone) ?? 0,
      }));
    }

    // Cumulative artist mode
    return sortedAsc.map((milestone) => {
      let count = 0;
      for (const [, aggTotal] of artistStreams) {
        if (aggTotal >= milestone) count++;
      }
      return {
        milestone,
        milestoneLabel: makeMilestoneLabel(milestone),
        unique_tracks: 0,
        unique_artists: count,
      };
    });
  }

  // ── Track mode ──
  if (bucketMode === "exclusive") {
    // Bucket each track into the highest milestone it reaches.
    // IMPORTANT: to find the highest reached threshold, iterate milestones DESC.
    const sortedDesc = [...sortedAsc].sort((a, b) => b - a);

    const trackCounts = new Map<number, number>();

    for (const t of tracks) {
      const total = Number(t?.total_streams_cumulative ?? 0);
      if (!Number.isFinite(total) || total <= 0) continue;

      for (const m of sortedDesc) {
        if (total >= m) {
          trackCounts.set(m, (trackCounts.get(m) ?? 0) + 1);
          break;
        }
      }
    }

    return sortedAsc.map((milestone) => ({
      milestone,
      milestoneLabel: makeMilestoneLabel(milestone),
      unique_tracks: trackCounts.get(milestone) ?? 0,
      unique_artists: 0,
    }));
  }

  // Default: cumulative / inclusive (≥ milestone)
  return sortedAsc.map((milestone) => {
    const qualifying = tracks.filter((t) => (t.total_streams_cumulative ?? 0) >= milestone);
    return {
      milestone,
      milestoneLabel: makeMilestoneLabel(milestone),
      unique_tracks: qualifying.length,
      unique_artists: 0,
    };
  });
}


export type TracksPerMilestoneChartProps = {
  /** Track data with total_streams_cumulative */
  tracks: TrackPoint[];
  /** Optional custom milestones (if not provided, auto-generated) */
  customMilestones?: number[];
  /** Display mode */
  mode?: "streams" | "revenue";
  /** Count mode */
  countMode?: "tracks" | "artists";
  /** Bucket mode */
  bucketMode?: "cumulative" | "exclusive";
  /** USD payout per stream (required for revenue mode) */
  payoutPerStreamUsd?: number;
  /** Chart height in pixels */
  heightPx?: number;
  /** Highlight a specific milestone */
  highlightMilestone?: number | null;
  /** Callback when a bar is clicked */
  onMilestoneClick?: (milestone: number, trackCount: number) => void;
};

export function TracksPerMilestoneChart({
  tracks,
  customMilestones,
  mode = "streams",
  countMode = "tracks",
  bucketMode = "cumulative",
  payoutPerStreamUsd = 0,
  heightPx = 280,
  highlightMilestone,
  onMilestoneClick,
}: TracksPerMilestoneChartProps) {
  const gid = useId();
  const themeColors = useThemeColors();
  const { currencyDisplay } = useCurrencyDisplay();

  const totalTracks = tracks.length;
  const totalArtists = useMemo(() => {
    const s = new Set<string>();
    for (const t of tracks) {
      const ids = t.artist_ids ?? [];
      for (const id of ids) {
        if (id) s.add(id);
      }
    }
    return s.size;
  }, [tracks]);
  const totalCount = countMode === "artists" ? totalArtists : totalTracks;
  const countLabel: "Tracks" | "Artists" = countMode === "artists" ? "Artists" : "Tracks";
  const accentColor = mode === "revenue" ? themeColors.revenue : themeColors.positive;

  // Track the currently hovered/active milestone from the tooltip
  const activePayloadRef = useRef<MilestoneDataPoint | null>(null);

  const handleActivePayload = useCallback((p: MilestoneDataPoint | null) => {
    activePayloadRef.current = p;
  }, []);

  const onLongPress = useCallback(() => {
    const p = activePayloadRef.current;
    if (!p || !onMilestoneClick) return;
    const count = countMode === "artists" ? p.unique_artists : p.unique_tracks;
    onMilestoneClick(p.milestone, count);
  }, [countMode, onMilestoneClick]);

  const {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    lastPointerTypeRef,
  } = useLongPress({
    enabled: Boolean(onMilestoneClick),
    onLongPress,
  });

  const chartData = useMemo(() => {
    if (!tracks.length) return [];

    const maxStreams = Math.max(
      ...tracks.map((t) => t.total_streams_cumulative ?? 0)
    );

    const milestones = customMilestones?.length
      ? customMilestones
      : generateAutoMilestonesFromMax(maxStreams);

    return computeMilestoneData(tracks, milestones, mode, payoutPerStreamUsd, countMode, bucketMode);
  }, [tracks, customMilestones, mode, payoutPerStreamUsd, countMode, bucketMode, currencyDisplay]);

  const maxMilestone = chartData.length
    ? Math.max(...chartData.map((d) => d.milestone))
    : 1;

  if (!chartData.length) {
    return (
      <div
        className="flex items-center justify-center py-10 text-xs"
        style={{ color: "var(--sb-muted)", height: heightPx }}
      >
        No track data available
      </div>
    );
  }

  // Container event handlers (same pattern as useChartCopyToClipboard)
  const handleMouseDown = (e: MouseEvent) => {
    // Prevent focus outline box on click
    e.preventDefault();
  };

  const handleClick = () => {
    // Touch/pen: taps only show tooltip (modal is via long-press)
    if (lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen") return;
    
    // Desktop click: open modal if we have an active bar
    const p = activePayloadRef.current;
    if (!p || !onMilestoneClick) return;
    const count = countMode === "artists" ? p.unique_artists : p.unique_tracks;
    onMilestoneClick(p.milestone, count);
  };

  return (
    <div
      className="w-full overflow-visible outline-none"
      style={{
        outline: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
      onMouseDown={handleMouseDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
    >
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0} style={{ overflow: "visible" }}>
        <BarChart
          data={chartData}
          margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
          style={{ outline: "none" }}
        >
          <defs>
            {chartData.map((d) => {
              const ratio = Math.log10(d.milestone) / Math.log10(Math.max(maxMilestone, 1));
              const opacity = 0.4 + 0.6 * ratio;
              return (
                <linearGradient
                  key={d.milestone}
                  id={`${gid}-${d.milestone}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  {/* Theme-aware color with dynamic opacity */}
                  <stop
                    offset="5%"
                    stopColor={accentColor}
                    stopOpacity={Math.min(opacity + 0.2, 0.95)}
                  />
                  <stop
                    offset="95%"
                    stopColor={accentColor}
                    stopOpacity={Math.max(opacity - 0.2, 0.3)}
                  />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--sb-border)"
          />
          <XAxis
            dataKey="milestoneLabel"
            stroke="var(--sb-muted)"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => formatKmbTick(Number(value ?? 0))}
          />
          <Tooltip
            content={
              <MilestoneTooltip
                totalCount={totalCount}
                countLabel={countLabel}
                mode={mode}
                accentColor={accentColor}
                onActivePayload={handleActivePayload}
              />
            }
            cursor={false}
          />
          {highlightMilestone && (
            <ReferenceLine
              x={
                mode === "revenue"
                  ? formatRevenueMilestoneLabel(highlightMilestone, payoutPerStreamUsd)
                  : formatMilestoneLabel(highlightMilestone)
              }
              stroke={accentColor}
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}
          <Bar
            dataKey={countMode === "artists" ? "unique_artists" : "unique_tracks"}
            radius={[4, 4, 0, 0]}
            activeBar={false}
            style={{ cursor: onMilestoneClick ? "pointer" : "default" }}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.milestone}
                fill={`url(#${gid}-${entry.milestone})`}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
