"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, MouseEvent } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

import { formatCompactMoney, formatInt, formatUsd, formatUsd2 } from "@/lib/format";
import { formatKmbTick } from "@/components/charts/chartUtils";
import { useThemeColors } from "@/components/charts/useThemeColors";
import type { TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { ViewportAwareTooltip } from "@/components/charts/ViewportAwareTooltip";

export type ArtistStreamsXYPoint = {
  artist_id: string;
  artist_name: string;
  track_count: number;
  total_streams_cumulative: number;
  daily_streams_delta: number;
  has_prev_day: boolean;
  artist_image_url: string | null;
};

type Mode = "streams" | "revenue";

type ChartDatum = ArtistStreamsXYPoint & {
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

/** Aggregate track points into artist points */
export function aggregateTracksToArtists(
  tracks: TrackStreamsXYPoint[],
  artistImagesById?: Map<string, string | null> | null,
): ArtistStreamsXYPoint[] {
  const artistMap = new Map<string, {
    artist_id: string;
    artist_name: string;
    track_count: number;
    total_streams_cumulative: number;
    daily_streams_delta: number;
    has_prev_day: boolean;
    artist_image_url: string | null;
  }>();

  for (const t of tracks) {
    const ids = t.artist_ids ?? [];
    const names = t.artist_names ?? [];
    // Attribute full streams to each artist (standard industry practice)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const name = names[i] ?? "Unknown";
      if (!id) continue;
      const maybeImg = artistImagesById?.get(id) ?? null;

      const existing = artistMap.get(id);
      if (existing) {
        existing.track_count += 1;
        existing.total_streams_cumulative += t.total_streams_cumulative;
        existing.daily_streams_delta += t.daily_streams_delta;
        existing.has_prev_day = existing.has_prev_day || Boolean(t.has_prev_day);
        if (!existing.artist_image_url && maybeImg) existing.artist_image_url = maybeImg;
      } else {
        artistMap.set(id, {
          artist_id: id,
          artist_name: name,
          track_count: 1,
          total_streams_cumulative: t.total_streams_cumulative,
          daily_streams_delta: t.daily_streams_delta,
          has_prev_day: Boolean(t.has_prev_day),
          artist_image_url: maybeImg,
        });
      }
    }
  }

  return Array.from(artistMap.values());
}

const CustomTooltip = ({
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
}) => {
  const p = point;
  const title = (p.artist_name ?? "").trim() || p.artist_id;

  const dailyStreams = p.daily_streams_delta;
  const totalStreams = p.total_streams_cumulative;
  const dailyValue = mode === "revenue" ? dailyStreams * payoutPerStreamUsd : dailyStreams;
  const totalValue = mode === "revenue" ? totalStreams * payoutPerStreamUsd : totalStreams;

  const dailyLabel = p.has_prev_day
    ? mode === "revenue"
      ? formatUsd2(dailyValue)
      : formatInt(dailyValue)
    : "—";

  // Match track tooltip behavior: keep hover tooltip lighter,
  // only show thumbnail + clickable link + IDs when frozen.
  const showRich = frozen;

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
        {showRich ? (
          p.artist_image_url ? (
            <Image
              src={p.artist_image_url}
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-full object-cover sb-ring"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="h-12 w-12 rounded-full sb-ring bg-white/60 dark:bg-white/10" />
          )
        ) : null}

        <div className="min-w-0">
          {showRich ? (
            <Link
              href={`/catalog?artist_id=${encodeURIComponent(p.artist_id)}`}
              className="block truncate text-xs font-semibold hover:underline"
              style={{ color: "var(--sb-text)" }}
              title={p.artist_id}
            >
              {title}
            </Link>
          ) : (
            <div className="truncate text-xs font-semibold" style={{ color: "var(--sb-text)" }} title={p.artist_id}>
              {title}
            </div>
          )}

          <div className="mt-0.5 truncate text-xs" style={{ color: "var(--sb-muted)" }}>
            {p.track_count} track{p.track_count !== 1 ? "s" : ""}
          </div>

          <div className="mt-2 space-y-0.5 text-[11px]">
            <div>
              {mode === "revenue" ? "Daily revenue" : "Daily streams"}:{" "}
              <span className="font-mono font-semibold" style={{ color: accentColor }}>
                {dailyLabel}
              </span>
            </div>
            <div>
              {mode === "revenue" ? "Total revenue" : "Total streams"}:{" "}
              <span className="font-mono font-semibold" style={{ color: accentColor }}>
                {mode === "revenue" ? formatUsd(totalValue) : formatInt(totalValue)}
              </span>
            </div>
            {showRich ? (
              <div className="opacity-60">
                Artist ID: <span className="font-mono">{p.artist_id}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export function ArtistStreamsXYChart({
  points,
  mode = "streams",
  payoutPerStreamUsd = 0,
  color,
  heightPx = 380,
  topNDelta = 100,
  topNCumulative = 100,
  sampleN = 80,
  focusArtistId = null,
  logScale = false,
  onClearFocus,
}: {
  points: ArtistStreamsXYPoint[];
  mode?: Mode;
  payoutPerStreamUsd?: number;
  color?: string;
  heightPx?: number;
  topNDelta?: number;
  topNCumulative?: number;
  sampleN?: number;
  focusArtistId?: string | null;
  logScale?: boolean;
  onClearFocus?: () => void;
}) {
  const [hovered, setHovered] = useState<{ point: ChartDatum; x: number; y: number } | null>(null);
  const [frozen, setFrozen] = useState(false);
  const LONG_PRESS_MS = 550;

  // Pointer event based long-press detection (works reliably on Chrome/Firefox/Safari)
  const lastPointerTypeRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  const { allData, topData, sampledData, hiddenCount } = useMemo(() => {
    const base = (points ?? []).filter(
      (p) =>
        p &&
        typeof p.total_streams_cumulative === "number" &&
        isFinite(p.total_streams_cumulative) &&
        typeof p.daily_streams_delta === "number" &&
        isFinite(p.daily_streams_delta),
    );

    const all: ChartDatum[] = base.map((p) => {
      const x = mode === "revenue" ? p.total_streams_cumulative * payoutPerStreamUsd : p.total_streams_cumulative;
      const y = mode === "revenue" ? p.daily_streams_delta * payoutPerStreamUsd : p.daily_streams_delta;
      return { ...p, x_value: x, y_value: y };
    });

    const sortedByDelta = [...all].sort((a, b) => b.y_value - a.y_value);
    const topByDelta = sortedByDelta.slice(0, topNDelta);
    const topByDeltaIds = new Set(topByDelta.map((d) => d.artist_id));

    const sortedByCumulative = [...all].sort((a, b) => b.x_value - a.x_value);
    const topByCumulative = sortedByCumulative.slice(0, topNCumulative);
    const topByCumulativeIds = new Set(topByCumulative.map((d) => d.artist_id));

    const topIds = new Set([...topByDeltaIds, ...topByCumulativeIds]);
    const top = all.filter((d) => topIds.has(d.artist_id));
    const rest = all.filter((d) => !topIds.has(d.artist_id));

    let sampled: ChartDatum[] = [];
    if (rest.length > 0 && sampleN > 0) {
      if (rest.length <= sampleN) {
        sampled = rest;
      } else {
        const step = rest.length / sampleN;
        for (let i = 0; i < sampleN; i++) {
          const idx = Math.floor(i * step);
          sampled.push(rest[idx]);
        }
      }
    }

    return { allData: all, topData: top, sampledData: sampled, hiddenCount: rest.length };
  }, [mode, payoutPerStreamUsd, points, topNDelta, topNCumulative, sampleN]);

  const themeColors = useThemeColors();
  const dotColor = color ?? (mode === "revenue" ? themeColors.revenue : themeColors.accentStroke);
  const mutedDotColor = "rgba(148, 163, 184, 0.7)";

  const { logDomainX, logDomainY, logTicksX, logTicksY } = useMemo(() => {
    const displayedData = topData;

    if (!logScale || displayedData.length === 0) {
      return {
        logDomainX: [1, "auto"] as [number, "auto"],
        logDomainY: [1, "auto"] as [number, "auto"],
        logTicksX: undefined as number[] | undefined,
        logTicksY: undefined as number[] | undefined,
      };
    }

    const clampMin = (n: number) => (isFinite(n) && n > 0 ? n : 1);

    const buildLogTicks = (min: number, max: number) => {
      const mn = clampMin(min);
      const mx = clampMin(max);
      const minExp = Math.floor(Math.log10(mn));
      const maxExp = Math.ceil(Math.log10(mx));
      const ticks: number[] = [];
      const mults = [1, 2, 5];
      for (let e = minExp; e <= maxExp; e++) {
        const base = Math.pow(10, e);
        for (const m of mults) {
          const v = m * base;
          if (v >= mn && v <= mx) ticks.push(v);
        }
      }
      const uniq = Array.from(new Set(ticks)).sort((a, b) => a - b);
      if (uniq.length <= 10) return uniq;
      const p10: number[] = [];
      for (let e = minExp; e <= maxExp; e++) {
        const v = Math.pow(10, e);
        if (v >= mn && v <= mx) p10.push(v);
      }
      return p10.length ? p10 : undefined;
    };

    const xVals = displayedData.map((d) => d.x_value).filter((v) => v > 0);
    const yVals = displayedData.map((d) => d.y_value).filter((v) => v > 0);

    const minX = xVals.length > 0 ? Math.min(...xVals) : 1;
    const maxX = xVals.length > 0 ? Math.max(...xVals) : 100;
    const minY = yVals.length > 0 ? Math.min(...yVals) : 1;
    const maxY = yVals.length > 0 ? Math.max(...yVals) : 100;

    const domainXMin = clampMin(minX / 1.15);
    const domainXMax = clampMin(maxX * 1.05);
    const domainYMin = clampMin(minY / 1.15);
    const domainYMax = clampMin(maxY * 1.05);

    return {
      logDomainX: [Math.max(1, domainXMin), domainXMax] as [number, number],
      logDomainY: [Math.max(1, domainYMin), domainYMax] as [number, number],
      logTicksX: buildLogTicks(Math.max(1, domainXMin), domainXMax),
      logTicksY: buildLogTicks(Math.max(1, domainYMin), domainYMax),
    };
  }, [topData, logScale]);

  const fmtAxisTick = useCallback(
    (n: number) => {
      if (mode === "revenue") return formatCompactMoney(n, formatUsd);
      return formatKmbTick(n);
    },
    [mode],
  );

  const focusPoint = useMemo(() => {
    const id = (focusArtistId ?? "").trim();
    if (!id) return null;
    return allData.find((d) => d.artist_id === id) ?? null;
  }, [allData, focusArtistId]);
  const isFocusMode = Boolean(focusPoint);

  // Container event handlers using pointer events (same pattern as useChartCopyToClipboard)
  const handleMouseDown = (e: MouseEvent) => {
    // Prevent focus outline box on click
    e.preventDefault();
  };

  const handlePointerDown = (e: PointerEvent) => {
    lastPointerTypeRef.current = e.pointerType ?? null;
    const pt = e.pointerType ?? null;

    // Only start long-press timer for touch/pen
    if (pt !== "touch" && pt !== "pen") return;
    if (isFocusMode) return;
    if (frozen) return;

    clearLongPressTimer();
    longPressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      // Long-press completed: freeze the tooltip
      if (hovered) {
        setFrozen(true);
      }
      longPressTimerRef.current = null;
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
    const pt = lastPointerTypeRef.current;

    if (isFocusMode) {
      // Desktop: click anywhere to exit focus mode.
      if (pt !== "touch" && pt !== "pen") {
        setFrozen(false);
        setHovered(null);
        onClearFocus?.();
      }
      return;
    }

    // Touch/pen: taps only show tooltip (freeze is via long-press)
    if (pt === "touch" || pt === "pen") {
      // If already frozen, tap anywhere to unfreeze
      if (frozen) {
        setFrozen(false);
        setHovered(null);
      }
      return;
    }

    // Mouse: click pins the currently-open tooltip, click again unpins.
    if (frozen) {
      setFrozen(false);
      setHovered(null);
      return;
    }
    if (hovered) setFrozen(true);
  };

  const chartEl = useMemo(() => {
    return (
      <ResponsiveContainer width="100%" height={heightPx} minWidth={0}>
        <ScatterChart margin={{ top: 8, right: 14, left: 4, bottom: 12 }} style={{ outline: "none" }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--sb-border)" />
          <XAxis
            type="number"
            dataKey="x_value"
            name={mode === "revenue" ? "Total revenue" : "Total streams"}
            scale={logScale ? "log" : "auto"}
            domain={logScale ? logDomainX : ["auto", "auto"]}
            ticks={logScale ? logTicksX : undefined}
            tickFormatter={(n) => fmtAxisTick(Number(n ?? 0))}
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            allowDataOverflow={logScale}
          />
          <YAxis
            type="number"
            dataKey="y_value"
            name={mode === "revenue" ? "Daily revenue" : "Daily streams"}
            scale={logScale ? "log" : "auto"}
            domain={logScale ? logDomainY : ["auto", "auto"]}
            ticks={logScale ? logTicksY : undefined}
            tickFormatter={(n) => fmtAxisTick(Number(n ?? 0))}
            stroke="var(--sb-muted)"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            allowDataOverflow={logScale}
          />
          <Tooltip cursor={false} content={() => null} />

          {/* Faded sampled background dots */}
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

          {/* Top artists (interactive) */}
          {!isFocusMode && topData.length > 0 ? (
            <Scatter
              data={topData}
              fill={dotColor}
              stroke="none"
              strokeWidth={0}
              isAnimationActive={false}
              onMouseEnter={(o: any) => {
                if (frozen) return;
                // Don't show hover on touch (handled separately)
                if (lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen") return;
                const p = (o?.payload ?? null) as ChartDatum | null;
                const x = Number(o?.cx ?? NaN);
                const y = Number(o?.cy ?? NaN);
                if (p && isFinite(x) && isFinite(y)) setHovered({ point: p, x, y });
              }}
              onMouseLeave={() => {
                if (frozen) return;
                if (lastPointerTypeRef.current === "touch" || lastPointerTypeRef.current === "pen") return;
                setHovered(null);
              }}
              // For touch: use Recharts' built-in touch detection to show tooltip
              onMouseDown={(o: any) => {
                // This fires on touch too - show tooltip immediately
                const pt = lastPointerTypeRef.current;
                if (pt !== "touch" && pt !== "pen") return;
                if (frozen) return;
                const p = (o?.payload ?? null) as ChartDatum | null;
                const x = Number(o?.cx ?? NaN);
                const y = Number(o?.cy ?? NaN);
                if (!p || !isFinite(x) || !isFinite(y)) return;
                setHovered({ point: p, x, y });
              }}
              shape={(props: any) => {
                const { cx, cy, payload } = props;
                const isHov = hovered?.point?.artist_id === payload?.artist_id;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHov ? 6 : 4}
                    fill={dotColor}
                    fillOpacity={isHov ? 1 : 0.85}
                    stroke="var(--sb-bg)"
                    strokeWidth={1}
                    style={{ cursor: "pointer", transition: "r 0.1s" }}
                  />
                );
              }}
            />
          ) : null}

          {/* Focus point (highlighted) */}
          {focusPoint ? (
            <Scatter
              data={[focusPoint]}
              fill={dotColor}
              stroke="none"
              isAnimationActive={false}
              shape={(props: any) => {
                const { cx, cy } = props;
                return (
                  <g>
                    <circle cx={cx} cy={cy} r={14} fill={dotColor} fillOpacity={0.18} />
                    <circle cx={cx} cy={cy} r={8} fill={dotColor} fillOpacity={0.4} />
                    <circle cx={cx} cy={cy} r={5} fill={dotColor} fillOpacity={1} />
                    <circle cx={cx} cy={cy} r={6} fill="none" stroke="var(--sb-bg)" strokeWidth={1} />
                  </g>
                );
              }}
            />
          ) : null}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }, [
    dotColor,
    fmtAxisTick,
    focusPoint,
    frozen,
    heightPx,
    hovered?.point?.artist_id,
    isFocusMode,
    logDomainX,
    logDomainY,
    logScale,
    logTicksX,
    logTicksY,
    mode,
    mutedDotColor,
    sampledData,
    topData,
  ]);

  return (
    <div
      className="relative w-full outline-none"
      style={{
        outline: "none",
        touchAction: "pan-y",
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
      {chartEl}

      {hiddenCount > 0 ? (
        <div
          className="absolute bottom-3 left-12 text-[10px] opacity-50"
          style={{ color: "var(--sb-muted)" }}
        >
          +{hiddenCount.toLocaleString()} more artists (sampled)
        </div>
      ) : null}

      {/* Focus mode tooltip */}
      {focusPoint ? (
        <div
          className="absolute right-3 top-3 z-50 max-w-[320px]"
          style={{ pointerEvents: "auto" }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <ViewportAwareTooltip>
            <CustomTooltip
              point={focusPoint}
              mode={mode}
              payoutPerStreamUsd={payoutPerStreamUsd}
              accentColor={dotColor}
              frozen={true}
            />
          </ViewportAwareTooltip>
        </div>
      ) : null}

      {/* Hover tooltip */}
      {hovered && !focusPoint ? (
        <div
          className="absolute z-50"
          style={{
            left: 0,
            top: 0,
            transform: `translate3d(${Math.max(8, hovered.x + 12)}px, ${Math.max(8, hovered.y + 12)}px, 0)`,
            willChange: "transform",
            pointerEvents: frozen ? "auto" : "none",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <ViewportAwareTooltip>
            <CustomTooltip
              point={hovered.point}
              mode={mode}
              payoutPerStreamUsd={payoutPerStreamUsd}
              accentColor={dotColor}
              frozen={frozen}
            />
          </ViewportAwareTooltip>
        </div>
      ) : null}
    </div>
  );
}
