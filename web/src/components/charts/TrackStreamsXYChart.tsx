"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

import { formatInt, formatUsd, formatUsd2 } from "@/lib/format";
import { formatKmbTick, formatUsdCompact } from "@/components/charts/chartUtils";

export type TrackStreamsXYPoint = {
  isrc: string;
  name: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_image_url: string | null;
  total_streams_cumulative: number;
  daily_streams_delta: number;
  has_prev_day: boolean;
};

type Mode = "streams" | "revenue";

type ChartDatum = TrackStreamsXYPoint & {
  x_value: number;
  y_value: number;
};

function hexToRgba(hex: string, alpha: number): string {
  const h = (hex ?? "").trim().replace("#", "");
  if (h.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function CustomTooltip({
  point,
  mode,
  payoutPerStreamUsd,
  accentColor,
  frozen,
}: {
  point: ChartDatum;
  mode: Mode;
  payoutPerStreamUsd: number;
  accentColor: string;
  frozen: boolean;
}) {
  const p = point;

  const title = (p.name ?? "").trim() || p.isrc;
  const artistNames = p.artist_names ?? [];
  const artistIds = p.artist_ids ?? [];

  const dailyStreams = p.daily_streams_delta;
  const totalStreams = p.total_streams_cumulative;
  const dailyValue =
    mode === "revenue" ? dailyStreams * payoutPerStreamUsd : dailyStreams;
  const totalValue =
    mode === "revenue" ? totalStreams * payoutPerStreamUsd : totalStreams;

  const dailyLabel = p.has_prev_day
    ? mode === "revenue"
      ? `+${formatUsd2(dailyValue)}`
      : `+${formatInt(dailyValue)}`
    : "—";

  // Build artist links with comma separators
  const artistElements: ReactNode[] = [];
  artistNames.forEach((name, idx) => {
    const id = artistIds[idx] ?? null;
    const label = String(name ?? "").trim();
    if (!label) return;
    if (artistElements.length > 0) {
      artistElements.push(
        <span key={`sep-${idx}`} style={{ color: "var(--sb-muted)" }}>, </span>
      );
    }
    artistElements.push(
      id ? (
        <Link
          key={`${id}-${idx}`}
          href={`/catalog?artist_id=${encodeURIComponent(id)}`}
          className="hover:underline"
          style={{ color: "var(--sb-muted)" }}
          title={id}
        >
          {label}
        </Link>
      ) : (
        <span key={`${label}-${idx}`}>{label}</span>
      )
    );
  });

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        backgroundColor: "var(--sb-card)",
        backgroundImage: frozen
          ? `radial-gradient(80% 70% at 25% 20%, ${hexToRgba(accentColor, 0.18)} 0%, transparent 55%), radial-gradient(70% 60% at 85% 85%, ${hexToRgba(accentColor, 0.12)} 0%, transparent 60%)`
          : undefined,
        borderColor: frozen ? hexToRgba(accentColor, 0.7) : "var(--sb-border)",
        boxShadow: frozen
          ? `0 0 0 1px ${hexToRgba(accentColor, 0.7)}, 0 10px 30px ${hexToRgba(accentColor, 0.18)}, var(--sb-shadow-compact)`
          : "var(--sb-shadow-compact)",
        color: "var(--sb-text)",
      }}
    >
      <div className="flex items-start gap-3">
        {p.album_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.album_image_url} alt="" className="h-12 w-12 rounded-md object-cover sb-ring" />
        ) : (
          <div className="h-12 w-12 rounded-md sb-ring bg-white/60 dark:bg-white/10" />
        )}
        <div className="min-w-0">
          <Link
            href={`/catalog?isrc=${encodeURIComponent(p.isrc)}`}
            className="block truncate text-xs font-semibold hover:underline"
            style={{ color: "#fff" }}
            title={p.isrc}
          >
            {title}
          </Link>
          {artistElements.length > 0 ? (
            <div className="mt-0.5 text-xs" style={{ color: "var(--sb-muted)" }}>
              {artistElements}
            </div>
          ) : null}
          <div className="mt-2 space-y-0.5 text-[11px]">
            <div>
              Δ1d {mode === "revenue" ? "revenue" : "streams"}:{" "}
              <span className="font-mono font-semibold" style={{ color: accentColor }}>
                {dailyLabel}
              </span>
            </div>
            <div>
              Total {mode === "revenue" ? "revenue" : "streams"}:{" "}
              <span className="font-mono font-semibold" style={{ color: accentColor }}>
                {mode === "revenue" ? formatUsd(totalValue) : formatInt(totalValue)}
              </span>
            </div>
            <div className="opacity-60">
              ISRC: <span className="font-mono">{p.isrc}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrackStreamsXYChart({
  points,
  mode = "streams",
  payoutPerStreamUsd = 0,
  color,
  heightPx = 380,
  topNDelta = 100,
  topNCumulative = 100,
  sampleN = 80,
  focusIsrc = null,
}: {
  points: TrackStreamsXYPoint[];
  mode?: Mode;
  payoutPerStreamUsd?: number;
  color?: string;
  heightPx?: number;
  topNDelta?: number;
  topNCumulative?: number;
  sampleN?: number;
  focusIsrc?: string | null;
}) {
  const [hovered, setHovered] = useState<{ point: ChartDatum; x: number; y: number } | null>(null);
  const [frozen, setFrozen] = useState(false);

  // For mobile long-press detection
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTouchRef = useRef<{ point: ChartDatum; x: number; y: number } | null>(null);
  const pointerTypeRef = useRef<"mouse" | "touch" | "pen" | "unknown">("unknown");
  const suppressNextClickRef = useRef(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearLongPress = useCallback(() => {
    clearLongPressTimer();
    pendingTouchRef.current = null;
  }, [clearLongPressTimer]);

  // Clean up on unmount
  useEffect(() => {
    return () => clearLongPress();
  }, [clearLongPress]);

  const { allData, topData, sampledData, hiddenCount } = useMemo(() => {
    // Filter out obviously bad points (keeps chart stable)
    const base = (points ?? []).filter(
      (p) =>
        p &&
        typeof p.total_streams_cumulative === "number" &&
        isFinite(p.total_streams_cumulative) &&
        typeof p.daily_streams_delta === "number" &&
        isFinite(p.daily_streams_delta),
    );

    const all: ChartDatum[] = base.map((p) => {
      const x =
        mode === "revenue" ? p.total_streams_cumulative * payoutPerStreamUsd : p.total_streams_cumulative;
      const y = mode === "revenue" ? p.daily_streams_delta * payoutPerStreamUsd : p.daily_streams_delta;
      return { ...p, x_value: x, y_value: y };
    });

    // Top N by daily delta (y_value)
    const sortedByDelta = [...all].sort((a, b) => b.y_value - a.y_value);
    const topByDelta = sortedByDelta.slice(0, topNDelta);
    const topByDeltaIsrcs = new Set(topByDelta.map((d) => d.isrc));

    // Top N by cumulative (x_value)
    const sortedByCumulative = [...all].sort((a, b) => b.x_value - a.x_value);
    const topByCumulative = sortedByCumulative.slice(0, topNCumulative);
    const topByCumulativeIsrcs = new Set(topByCumulative.map((d) => d.isrc));

    // Merge (union) the two sets
    const topIsrcs = new Set([...topByDeltaIsrcs, ...topByCumulativeIsrcs]);
    const top = all.filter((d) => topIsrcs.has(d.isrc));
    const rest = all.filter((d) => !topIsrcs.has(d.isrc));

    // Sample from the rest for the faded background dots.
    let sampled: ChartDatum[] = [];
    if (rest.length > 0 && sampleN > 0) {
      if (rest.length <= sampleN) {
        sampled = rest;
      } else {
        // Deterministic sampling: pick evenly spaced indices.
        const step = rest.length / sampleN;
        for (let i = 0; i < sampleN; i++) {
          const idx = Math.floor(i * step);
          sampled.push(rest[idx]);
        }
      }
    }

    return { allData: all, topData: top, sampledData: sampled, hiddenCount: rest.length };
  }, [mode, payoutPerStreamUsd, points, topNDelta, topNCumulative, sampleN]);

  const dotColor = color ?? (mode === "revenue" ? "#10b981" : "#c7f33c");
  const mutedDotColor = "rgba(148, 163, 184, 0.7)"; // slate-ish
  const fmtAxisTick = (n: number) => {
    if (mode === "revenue") return formatUsdCompact(n, formatUsd);
    return formatKmbTick(n);
  };

  const focusPoint = useMemo(() => {
    const isrc = (focusIsrc ?? "").trim();
    if (!isrc) return null;
    return allData.find((d) => d.isrc === isrc) ?? null;
  }, [allData, focusIsrc]);
  const isFocusMode = Boolean(focusPoint);

  // Handle touch start for long-press detection
  const handleTouchStart = useCallback(
    (o: any) => {
      if (isFocusMode) return;
      if (frozen) return;
      const p = (o?.payload ?? null) as ChartDatum | null;
      const x = Number(o?.cx ?? NaN);
      const y = Number(o?.cy ?? NaN);
      if (!p || !isFinite(x) || !isFinite(y)) return;

      // Cancel any in-flight long-press from a previous touch.
      clearLongPressTimer();

      // Show tooltip immediately on tap (hover equivalent)
      setHovered({ point: p, x, y });
      pendingTouchRef.current = { point: p, x, y };

      // Start long-press timer (500ms)
      longPressTimerRef.current = setTimeout(() => {
        if (pendingTouchRef.current) {
          setFrozen(true);
          // Prevent the synthetic click after long-press from toggling/unpinning.
          suppressNextClickRef.current = true;
        }
        longPressTimerRef.current = null;
      }, 500);
    },
    [frozen, clearLongPressTimer, isFocusMode]
  );

  const handleTouchEnd = useCallback(() => {
    // Always stop the timer; keep the hovered tooltip visible.
    clearLongPressTimer();
    pendingTouchRef.current = null;
  }, [clearLongPressTimer]);

  return (
    <div
      className="relative w-full outline-none"
      style={{ outline: "none" }}
      onMouseDown={(e) => {
        // Prevent the chart wrapper/SVG from receiving focus outline on click.
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        pointerTypeRef.current = (e.pointerType as any) || "unknown";
      }}
      onClick={() => {
        if (isFocusMode) return;
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }

        const pt = pointerTypeRef.current;

        // Touch: tap = hover only (handled by onTouchStart on the point).
        // If frozen, allow tap anywhere to unpin.
        if (pt === "touch") {
          if (frozen) {
            setFrozen(false);
            setHovered(null);
          }
          return;
        }

        // Mouse/pen: click anywhere pins the currently-open tooltip, click again unpins.
        if (frozen) {
          setFrozen(false);
          setHovered(null);
          return;
        }
        if (hovered) setFrozen(true);
      }}
    >
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0}>
        <ScatterChart
          margin={{ top: 8, right: 14, left: 4, bottom: 12 }}
          style={{ outline: "none" }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--sb-border)" />
          <XAxis
            type="number"
            dataKey="x_value"
            name={mode === "revenue" ? "Total revenue" : "Total streams"}
            tickFormatter={(n) => fmtAxisTick(Number(n ?? 0))}
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <YAxis
            type="number"
            dataKey="y_value"
            name={mode === "revenue" ? "Δ1d revenue" : "Δ1d streams"}
            tickFormatter={(n) => fmtAxisTick(Number(n ?? 0))}
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          {/* Keep Recharts' hover hit-testing, but don't render its tooltip/cursor. */}
          <Tooltip cursor={false} content={() => null} />
          {/* Faded sampled background dots (non-interactive) */}
          {sampledData.length > 0 ? (
            <Scatter
              data={sampledData}
              fill={isFocusMode ? mutedDotColor : dotColor}
              stroke="none"
              strokeWidth={0}
              opacity={isFocusMode ? 0.18 : 0.25}
              isAnimationActive={false}
              shape={(props: any) => {
                const { cx, cy } = props;
                const c = isFocusMode ? mutedDotColor : dotColor;
                const o = isFocusMode ? 0.18 : 0.25;
                return <circle cx={cx} cy={cy} r={3} fill={c} fillOpacity={o} />;
              }}
            />
          ) : null}
          {/* In focus mode: also render the top set as muted (non-interactive). */}
          {isFocusMode && topData.length > 0 ? (
            <Scatter
              data={topData.filter((d) => d.isrc !== focusPoint?.isrc)}
              fill={mutedDotColor}
              stroke="none"
              strokeWidth={0}
              opacity={0.22}
              isAnimationActive={false}
              shape={(props: any) => {
                const { cx, cy } = props;
                return <circle cx={cx} cy={cy} r={4} fill={mutedDotColor} fillOpacity={0.22} />;
              }}
            />
          ) : null}
          {/* Top-N interactive dots */}
          {!isFocusMode ? (
            <Scatter
              data={topData}
              fill={dotColor}
              stroke="var(--sb-bg)"
              strokeWidth={1}
              opacity={0.85}
              onMouseEnter={(o: any) => {
                if (frozen) return;
                const p = (o?.payload ?? null) as ChartDatum | null;
                const x = Number(o?.cx ?? NaN);
                const y = Number(o?.cy ?? NaN);
                if (!p || !isFinite(x) || !isFinite(y)) return;
                setHovered({ point: p, x, y });
              }}
              onMouseLeave={() => {
                if (frozen) return;
                setHovered(null);
              }}
              // Mobile touch support
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            />
          ) : null}
          {/* Focus point (always rendered on top when present) */}
          {focusPoint ? (
            <Scatter
              data={[focusPoint]}
              fill={dotColor}
              stroke="var(--sb-bg)"
              strokeWidth={1}
              opacity={1}
              isAnimationActive={false}
              shape={(props: any) => {
                const { cx, cy } = props;
                // Premium-ish glow: a soft outer circle + crisp inner dot.
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={10} fill={dotColor} fillOpacity={0.18} />
                    <circle cx={cx} cy={cy} r={6} fill={dotColor} fillOpacity={0.95} />
                    <circle cx={cx} cy={cy} r={6} fill="none" stroke="var(--sb-bg)" strokeWidth={1} />
                  </g>
                );
              }}
            />
          ) : null}
        </ScatterChart>
      </ResponsiveContainer>

      {hiddenCount > 0 ? (
        <div
          className="absolute bottom-3 left-12 text-[10px] opacity-50"
          style={{ color: "var(--sb-muted)" }}
        >
          +{hiddenCount.toLocaleString()} more tracks (sampled)
        </div>
      ) : null}

      {/* Focus mode: keep the selected tooltip visible & clickable */}
      {focusPoint ? (
        <div
          className="absolute right-3 top-3 z-10 max-w-[320px]"
          style={{ pointerEvents: "auto" }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <CustomTooltip
            point={focusPoint}
            mode={mode}
            payoutPerStreamUsd={payoutPerStreamUsd}
            accentColor={dotColor}
            frozen={true}
          />
        </div>
      ) : null}

      {hovered && !focusPoint ? (
        <div
          className="absolute z-10"
          style={{
            left: Math.max(8, hovered.x + 12),
            top: Math.max(8, hovered.y + 12),
            pointerEvents: frozen ? "auto" : "none",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <CustomTooltip
            point={hovered.point}
            mode={mode}
            payoutPerStreamUsd={payoutPerStreamUsd}
            accentColor={dotColor}
            frozen={frozen}
          />
        </div>
      ) : null}
    </div>
  );
}
