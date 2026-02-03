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
import { formatInt } from "@/lib/format";
import { formatKmbTick } from "@/components/charts/chartUtils";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";

type TrackPoint = {
  isrc: string;
  total_streams_cumulative: number;
};

type MilestoneDataPoint = {
  milestone: number;
  milestoneLabel: string;
  unique_tracks: number;
};

type MilestoneTooltipProps = {
  active?: boolean;
  payload?: Array<{ value?: unknown; payload?: MilestoneDataPoint }>;
  label?: string | number;
  totalTracks: number;
  mode: "streams" | "revenue";
  accentColor?: string;
  onActivePayload?: (p: MilestoneDataPoint | null) => void;
};

function MilestoneTooltip({
  active,
  payload,
  label,
  totalTracks,
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
  const color = accentColor ?? (mode === "revenue" ? "var(--sb-revenue)" : "var(--sb-accent)");
  const pct =
    totalTracks > 0 ? Math.max(0, Math.min(100, (count / totalTracks) * 100)) : 0;
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
          Tracks:{" "}
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

/**
 * Generate nice round milestone thresholds based on the data.
 * Returns milestones in descending order (highest first).
 */
function generateMilestones(maxStreams: number): number[] {
  if (maxStreams <= 0) return [];

  // Define possible milestone values (nice round numbers)
  // Minimum is 100K
  const possibleMilestones = [
    // Billions
    10_000_000_000, 5_000_000_000, 2_000_000_000, 1_000_000_000,
    // Hundreds of millions
    500_000_000, 400_000_000, 300_000_000, 200_000_000, 100_000_000,
    // Tens of millions
    50_000_000, 45_000_000, 40_000_000, 35_000_000, 30_000_000,
    25_000_000, 20_000_000, 19_000_000, 18_000_000, 17_000_000,
    16_000_000, 15_000_000, 14_000_000, 13_000_000, 12_000_000,
    11_000_000, 10_000_000, 9_000_000, 8_000_000, 7_000_000,
    6_000_000, 5_000_000, 4_500_000, 4_000_000, 3_500_000,
    3_000_000, 2_500_000, 2_000_000, 1_500_000, 1_000_000,
    // Hundreds of thousands
    900_000, 800_000, 750_000, 700_000, 600_000, 500_000,
    400_000, 300_000, 250_000, 200_000, 150_000, 100_000,
  ];

  // Filter to milestones that are at or below the max
  const relevantMilestones = possibleMilestones.filter((m) => m <= maxStreams);

  // If we have too many, thin them out to keep ~25-35 bars
  const targetCount = 30;
  if (relevantMilestones.length <= targetCount) {
    return relevantMilestones;
  }

  // Take every Nth milestone to get roughly targetCount
  const step = Math.ceil(relevantMilestones.length / targetCount);
  const thinned: number[] = [];
  for (let i = 0; i < relevantMilestones.length; i += step) {
    thinned.push(relevantMilestones[i]);
  }

  // Always include the smallest milestone if we have data
  const smallest = relevantMilestones[relevantMilestones.length - 1];
  if (smallest && !thinned.includes(smallest)) {
    thinned.push(smallest);
  }

  return thinned;
}

/**
 * Format milestone number as compact label (e.g., "50M", "100K")
 */
function formatMilestoneLabel(n: number): string {
  if (n >= 1_000_000_000) {
    const b = n / 1_000_000_000;
    return `${b % 1 === 0 ? b.toFixed(0) : b.toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return formatInt(n);
}

function formatUsdCompact(n: number): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: n < 1000 ? 0 : 1,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString("en-US")}`;
  }
}

function formatRevenueMilestoneLabel(streamsMilestone: number, payoutPerStreamUsd: number): string {
  const usd = Math.max(0, Number(streamsMilestone) * Math.max(0, payoutPerStreamUsd));
  return formatUsdCompact(usd);
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
): MilestoneDataPoint[] {
  // Sort milestones descending (highest first for display)
  const sorted = [...milestones].sort((a, b) => b - a);

  return sorted.map((milestone) => {
    const count = tracks.filter(
      (t) => (t.total_streams_cumulative ?? 0) >= milestone
    ).length;
    return {
      milestone,
      milestoneLabel:
        mode === "revenue"
          ? formatRevenueMilestoneLabel(milestone, payoutPerStreamUsd)
          : formatMilestoneLabel(milestone),
      unique_tracks: count,
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
  payoutPerStreamUsd = 0,
  heightPx = 280,
  highlightMilestone,
  onMilestoneClick,
}: TracksPerMilestoneChartProps) {
  const gid = useId();
  const themeColors = useThemeColors();

  const totalTracks = tracks.length;
  const accentColor = mode === "revenue" ? themeColors.revenue : themeColors.accent;

  // Track the currently hovered/active milestone from the tooltip
  const activePayloadRef = useRef<MilestoneDataPoint | null>(null);
  // Track pointer type to distinguish touch from mouse
  const lastPointerTypeRef = useRef<string | null>(null);
  // Long-press timer and start position
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const LONG_PRESS_MS = 550;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
    };
  }, [clearLongPressTimer]);

  const handleActivePayload = useCallback((p: MilestoneDataPoint | null) => {
    activePayloadRef.current = p;
  }, []);

  const chartData = useMemo(() => {
    if (!tracks.length) return [];

    const maxStreams = Math.max(
      ...tracks.map((t) => t.total_streams_cumulative ?? 0)
    );

    const milestones = customMilestones?.length
      ? customMilestones
      : generateMilestones(maxStreams);

    return computeMilestoneData(tracks, milestones, mode, payoutPerStreamUsd);
  }, [tracks, customMilestones, mode, payoutPerStreamUsd]);

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

  const handlePointerDown = (e: PointerEvent) => {
    lastPointerTypeRef.current = e.pointerType ?? null;
    const pt = e.pointerType ?? null;
    
    // Only start long-press timer for touch/pen
    if (pt !== "touch" && pt !== "pen") return;
    if (!onMilestoneClick) return;

    clearLongPressTimer();
    longPressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      const p = activePayloadRef.current;
      if (!p) return;
      onMilestoneClick(p.milestone, p.unique_tracks);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: PointerEvent) => {
    const pt = e.pointerType ?? null;
    if (pt !== "touch" && pt !== "pen") return;
    const start = longPressStartRef.current;
    if (!start) return;
    // Cancel long-press if finger moved too far (user is scrolling)
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 10) {
      clearLongPressTimer();
    }
  };

  const handlePointerUp = () => {
    clearLongPressTimer();
  };

  const handlePointerCancel = () => {
    clearLongPressTimer();
  };

  const handleClick = () => {
    // Touch/pen: taps only show tooltip (modal is via long-press)
    if (lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen") return;
    
    // Desktop click: open modal if we have an active bar
    const p = activePayloadRef.current;
    if (!p || !onMilestoneClick) return;
    onMilestoneClick(p.milestone, p.unique_tracks);
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
                totalTracks={totalTracks}
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
            dataKey="unique_tracks"
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
