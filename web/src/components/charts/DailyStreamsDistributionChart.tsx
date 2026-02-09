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
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import type { PointerEvent, MouseEvent } from "react";
import { formatInt, formatUsd } from "@/lib/format";
import { formatKmbTick, formatUsdCompact } from "@/components/charts/chartUtils";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";
import { useCurrencyDisplay } from "@/components/currency/CurrencyDisplayContext";
import { useLongPress } from "@/components/charts/useLongPress";

type TrackPoint = {
  isrc: string;
  daily_streams: number;
  artist_ids?: string[] | null;
};

type BucketDataPoint = {
  bucketMin: number;
  bucketMax: number | null; // null means "and above"
  bucketLabel: string;
  unique_tracks: number;
  unique_artists: number;
};

type DistributionTooltipProps = {
  active?: boolean;
  payload?: Array<{ value?: unknown; payload?: BucketDataPoint }>;
  totalCount: number;
  countLabel: "Tracks" | "Artists";
  mode: "streams" | "revenue";
  payoutPerStreamUsd: number;
  accentColor?: string;
  onActivePayload?: (p: BucketDataPoint | null) => void;
};

function formatBucketRangeLabel(
  min: number,
  max: number | null,
  mode: "streams" | "revenue",
  payoutPerStreamUsd: number,
): string {
  if (mode === "revenue") {
    const minUsd = min * payoutPerStreamUsd;
    const maxUsd = max !== null ? max * payoutPerStreamUsd : null;
    if (maxUsd === null) {
      return `${formatUsdCompact(minUsd, formatUsd)}+`;
    }
    return `${formatUsdCompact(minUsd, formatUsd)} – ${formatUsdCompact(maxUsd, formatUsd)}`;
  }
  // Streams mode
  if (max === null) {
    return `${formatCompact(min)}+`;
  }
  return `${formatCompact(min)} – ${formatCompact(max)}`;
}

function DistributionTooltip({
  active,
  payload,
  totalCount,
  countLabel,
  mode,
  payoutPerStreamUsd,
  accentColor,
  onActivePayload,
}: DistributionTooltipProps) {
  const p = payload?.[0]?.payload ?? null;

  // Notify parent of the currently active payload (for long-press action).
  useEffect(() => {
    onActivePayload?.(active ? p : null);
  }, [active, p, onActivePayload]);

  if (!active || !payload?.length) return null;

  if (!p) return null;

  const raw = payload[0]?.value;
  const n = typeof raw === "number" ? raw : Number(raw);
  const count = Number.isFinite(n) ? n : 0;
  const color = accentColor ?? (mode === "revenue" ? "var(--sb-revenue)" : "var(--sb-accent)");
  const pct =
    totalCount > 0 ? Math.max(0, Math.min(100, (count / totalCount) * 100)) : 0;
  const pctLabel = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1);

  const rangeLabel = formatBucketRangeLabel(p.bucketMin, p.bucketMax, mode, payoutPerStreamUsd);
  const metricLabel = mode === "revenue" ? "Daily revenue" : "Daily streams";

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
          {metricLabel}: {rangeLabel}
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

/**
 * Default bucket thresholds for daily streams distribution.
 * These are designed to show the "long tail" of catalog performance.
 */
export const DEFAULT_DAILY_BUCKETS: Array<{ min: number; max: number | null; label: string }> = [
  { min: 0, max: 100, label: "0-100" },
  { min: 100, max: 500, label: "100-500" },
  { min: 500, max: 1000, label: "500-1K" },
  { min: 1000, max: 2500, label: "1K-2.5K" },
  { min: 2500, max: 5000, label: "2.5K-5K" },
  { min: 5000, max: 10000, label: "5K-10K" },
  { min: 10000, max: 25000, label: "10K-25K" },
  { min: 25000, max: 50000, label: "25K-50K" },
  { min: 50000, max: 100000, label: "50K-100K" },
  { min: 100000, max: null, label: "100K+" },
];

/**
 * Format number compactly for labels
 */
function formatCompact(n: number): string {
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

/**
 * Compute bucket data from tracks
 */
function computeBucketData(
  tracks: TrackPoint[],
  buckets: Array<{ min: number; max: number | null; label: string }>,
  countMode: "tracks" | "artists",
  bucketMode: "cumulative" | "exclusive" = "cumulative",
): BucketDataPoint[] {
  // ── Artist mode: aggregate daily streams per artist, then bucket by aggregate ──
  if (countMode === "artists") {
    const artistDaily = new Map<string, number>();
    for (const t of tracks) {
      const daily = Number(t?.daily_streams ?? 0);
      if (!Number.isFinite(daily) || daily < 0) continue;
      const ids = t.artist_ids ?? [];
      for (const id of ids) {
        if (!id) continue;
        artistDaily.set(id, (artistDaily.get(id) ?? 0) + daily);
      }
    }

    if (bucketMode === "exclusive") {
      const artistCounts = new Map<string, number>();
      for (const b of buckets) artistCounts.set(b.label, 0);

      for (const [, aggDaily] of artistDaily) {
        for (const b of buckets) {
          const inBucket = b.max === null ? aggDaily >= b.min : aggDaily >= b.min && aggDaily < b.max;
          if (inBucket) {
            artistCounts.set(b.label, (artistCounts.get(b.label) ?? 0) + 1);
            break;
          }
        }
      }

      return buckets.map((b) => ({
        bucketMin: b.min,
        bucketMax: b.max,
        bucketLabel: b.label,
        unique_tracks: 0,
        unique_artists: artistCounts.get(b.label) ?? 0,
      }));
    }

    // Cumulative artist mode
    return buckets.map((b) => {
      let count = 0;
      for (const [, aggDaily] of artistDaily) {
        if (aggDaily >= b.min) count++;
      }
      return {
        bucketMin: b.min,
        bucketMax: b.max,
        bucketLabel: b.label,
        unique_tracks: 0,
        unique_artists: count,
      };
    });
  }

  // ── Track mode ──
  if (bucketMode === "exclusive") {
    // Bucket each track into its specific bucket only
    const trackCounts = new Map<string, number>();
    for (const bucket of buckets) trackCounts.set(bucket.label, 0);

    for (const t of tracks) {
      const daily = Number(t?.daily_streams ?? 0);
      if (!Number.isFinite(daily) || daily < 0) continue;

      for (const bucket of buckets) {
        const inBucket = bucket.max === null
          ? daily >= bucket.min
          : daily >= bucket.min && daily < bucket.max;

        if (inBucket) {
          trackCounts.set(bucket.label, (trackCounts.get(bucket.label) ?? 0) + 1);
          break;
        }
      }
    }

    return buckets.map((bucket) => ({
      bucketMin: bucket.min,
      bucketMax: bucket.max,
      bucketLabel: bucket.label,
      unique_tracks: trackCounts.get(bucket.label) ?? 0,
      unique_artists: 0,
    }));
  }

  // Cumulative track mode: count all tracks that meet or exceed the bucket minimum
  return buckets.map((bucket) => {
    const qualifying = tracks.filter((t) => {
      const daily = Number(t?.daily_streams ?? 0);
      return Number.isFinite(daily) && daily >= bucket.min;
    });
    return {
      bucketMin: bucket.min,
      bucketMax: bucket.max,
      bucketLabel: bucket.label,
      unique_tracks: qualifying.length,
      unique_artists: 0,
    };
  });
}

export type DailyStreamsDistributionChartProps = {
  /** Track data with daily_streams */
  tracks: TrackPoint[];
  /** Custom bucket definitions (if not provided, uses defaults) */
  customBuckets?: Array<{ min: number; max: number | null; label: string }>;
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
  /** Highlight a specific bucket */
  highlightBucketLabel?: string | null;
  /** Callback when a bar is clicked */
  onBucketClick?: (bucketMin: number, bucketMax: number | null, bucketLabel: string, count: number) => void;
};

export function DailyStreamsDistributionChart({
  tracks,
  customBuckets,
  mode = "streams",
  countMode = "tracks",
  bucketMode = "cumulative",
  payoutPerStreamUsd = 0,
  heightPx = 280,
  highlightBucketLabel,
  onBucketClick,
}: DailyStreamsDistributionChartProps) {
  const gid = useId();
  const themeColors = useThemeColors();
  // Subscribe so tooltips/labels can react to currency display changes.
  useCurrencyDisplay();

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
  const accentColor = mode === "revenue" ? themeColors.revenue : themeColors.accent;

  const buckets = customBuckets ?? DEFAULT_DAILY_BUCKETS;

  // Track the currently hovered/active bucket from the tooltip
  const activePayloadRef = useRef<BucketDataPoint | null>(null);

  const handleActivePayload = useCallback((p: BucketDataPoint | null) => {
    activePayloadRef.current = p;
  }, []);

  const onLongPress = useCallback(() => {
    const p = activePayloadRef.current;
    if (!p || !onBucketClick) return;
    const count = countMode === "artists" ? p.unique_artists : p.unique_tracks;
    onBucketClick(p.bucketMin, p.bucketMax, p.bucketLabel, count);
  }, [countMode, onBucketClick]);

  const {
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    lastPointerTypeRef,
  } = useLongPress({
    enabled: Boolean(onBucketClick),
    onLongPress,
  });

  const chartData = useMemo(() => {
    if (!tracks.length) return [];
    return computeBucketData(tracks, buckets, countMode, bucketMode);
  }, [tracks, buckets, countMode, bucketMode]);

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

  // Container event handlers (same pattern as TracksPerMilestoneChart)
  const handleMouseDown = (e: MouseEvent) => {
    // Prevent focus outline box on click
    e.preventDefault();
  };

  const handleClick = () => {
    // Touch/pen: taps only show tooltip (modal is via long-press)
    if (lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen") return;
    
    // Desktop click: open modal if we have an active bar
    const p = activePayloadRef.current;
    if (!p || !onBucketClick) return;
    const count = countMode === "artists" ? p.unique_artists : p.unique_tracks;
    onBucketClick(p.bucketMin, p.bucketMax, p.bucketLabel, count);
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
            {chartData.map((d, idx) => {
              // Gradient based on position (lower buckets = lighter)
              const ratio = idx / Math.max(1, chartData.length - 1);
              const opacity = 0.4 + 0.5 * ratio;
              return (
                <linearGradient
                  key={d.bucketLabel}
                  id={`${gid}-${idx}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor={accentColor}
                    stopOpacity={Math.min(opacity + 0.2, 0.95)}
                  />
                  <stop
                    offset="95%"
                    stopColor={accentColor}
                    stopOpacity={Math.max(opacity - 0.15, 0.3)}
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
            dataKey="bucketLabel"
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={50}
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
              <DistributionTooltip
                totalCount={totalCount}
                countLabel={countLabel}
                mode={mode}
                payoutPerStreamUsd={payoutPerStreamUsd}
                accentColor={accentColor}
                onActivePayload={handleActivePayload}
              />
            }
            cursor={false}
          />
          {highlightBucketLabel && (
            <ReferenceLine
              x={highlightBucketLabel}
              stroke={accentColor}
              strokeWidth={2}
              strokeDasharray="4 4"
            />
          )}
          <Bar
            dataKey={countMode === "artists" ? "unique_artists" : "unique_tracks"}
            radius={[4, 4, 0, 0]}
            activeBar={false}
            style={{ cursor: onBucketClick ? "pointer" : "default" }}
          >
            {chartData.map((entry, idx) => (
              <Cell
                key={entry.bucketLabel}
                fill={`url(#${gid}-${idx})`}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
