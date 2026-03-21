"use client";

import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import {
  cohortStyleRanked,
  formatCohortWeekTitle,
  type CohortHitRegion,
  type ReleaseCohortGroup,
} from "@/components/charts/trackReleaseCohorts";

type Pixel = { x: number; y: number };

type Layout = {
  ol: number;
  ot: number;
  sw: number;
  sh: number;
  viewBoxStr: string;
  pl: number;
  pt: number;
  pw: number;
  ph: number;
};

function logToSvgX(v: number, d0: number, d1: number, plotLeft: number, plotW: number): number {
  const a = Math.log10(Math.max(v, 1e-12));
  const a0 = Math.log10(Math.max(d0, 1e-12));
  const a1 = Math.log10(Math.max(d1, 1e-12));
  if (!(a1 > a0) || !(plotW > 0)) return plotLeft;
  const t = (a - a0) / (a1 - a0);
  return plotLeft + t * plotW;
}

function logToSvgY(v: number, d0: number, d1: number, plotTop: number, plotH: number): number {
  const a = Math.log10(Math.max(v, 1e-12));
  const a0 = Math.log10(Math.max(d0, 1e-12));
  const a1 = Math.log10(Math.max(d1, 1e-12));
  if (!(a1 > a0) || !(plotH > 0)) return plotTop + plotH;
  const t = (a - a0) / (a1 - a0);
  return plotTop + plotH - t * plotH;
}

function convexHull(points: Pixel[]): Pixel[] {
  if (points.length <= 1) return points.slice();
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pixel, a: Pixel, b: Pixel) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pixel[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pixel[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function expandFromCentroid(hull: Pixel[], factor: number): Pixel[] {
  if (hull.length === 0) return hull;
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  return hull.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
  }));
}

function readViewBox(chartSvg: SVGSVGElement): string {
  const vb = chartSvg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
  }
  const w = chartSvg.clientWidth || chartSvg.getBoundingClientRect().width;
  const h = chartSvg.clientHeight || chartSvg.getBoundingClientRect().height;
  return `0 0 ${Math.max(1, w)} ${Math.max(1, h)}`;
}

const HULL_EXPAND = 1.08;
/** Slightly larger than the drawn hull so hovering the soft blob is forgiving. */
const HULL_EXPAND_HIT = 1.15;

/**
 * Soft cohort blobs: faint fills + Gaussian blur; hues differ by week (golden angle on calendar order).
 */
export function ScatterCohortOverlay({
  containerRef,
  cohorts,
  logDomainX,
  logDomainY,
  enabled,
  isDark,
  onHitRegionsChange,
}: {
  containerRef: RefObject<HTMLElement | null>;
  cohorts: ReleaseCohortGroup<{ x_value: number; y_value: number }>[];
  logDomainX: [number, number];
  logDomainY: [number, number];
  enabled: boolean;
  isDark: boolean;
  /** SVG user-space polygons for point-in-polygon hit tests (e.g. parent `mousemove`). */
  onHitRegionsChange?: (regions: CohortHitRegion[]) => void;
}) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const reactId = useId();
  const blurFilterId = `sb-cohort-blur-${reactId.replace(/[^a-zA-Z0-9_-]/g, "") || "f"}`;

  const rankByWeek = useMemo(() => {
    const sorted = [...cohorts].sort((a, b) => a.weekStartMs - b.weekStartMs);
    const m = new Map<string, number>();
    sorted.forEach((c, i) => m.set(c.weekKey, i));
    return m;
  }, [cohorts]);

  const measure = useCallback(() => {
    const root = containerRef.current;
    if (!root || !enabled) {
      setLayout(null);
      return;
    }
    const chartSvg = root.querySelector("svg.recharts-surface") as SVGSVGElement | null;
    const gridG = chartSvg?.querySelector("g.recharts-cartesian-grid") as SVGGElement | null;
    if (!chartSvg || !gridG) {
      setLayout(null);
      return;
    }
    let bb: DOMRect;
    try {
      bb = gridG.getBBox();
    } catch {
      setLayout(null);
      return;
    }
    if (!(bb.width > 2) || !(bb.height > 2)) {
      setLayout(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const s = chartSvg.getBoundingClientRect();
    const sw = s.width;
    const sh = s.height;
    if (sw < 8 || sh < 8) {
      setLayout(null);
      return;
    }
    setLayout({
      ol: s.left - rootRect.left,
      ot: s.top - rootRect.top,
      sw,
      sh,
      viewBoxStr: readViewBox(chartSvg),
      pl: bb.x,
      pt: bb.y,
      pw: bb.width,
      ph: bb.height,
    });
  }, [containerRef, enabled]);

  useLayoutEffect(() => {
    measure();
    if (!enabled) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(measure);
    });
    const t = window.setTimeout(measure, 120);
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
      window.clearTimeout(t);
    };
  }, [measure, enabled, cohorts, logDomainX, logDomainY]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const root = containerRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => ro.disconnect();
  }, [enabled, measure, containerRef]);

  const [x0, x1] = logDomainX;
  const [y0, y1] = logDomainY;

  const { items, hitRegions } = useMemo(() => {
    const outItems: ReactNode[] = [];
    const outHit: CohortHitRegion[] = [];
    if (!layout || !enabled || cohorts.length === 0) {
      return { items: outItems, hitRegions: outHit };
    }

    const ts = cohorts.map((c) => c.weekStartMs).filter((n) => Number.isFinite(n));
    const minMs = ts.length === 0 ? 0 : Math.min(...ts);
    const maxMs = ts.length === 0 ? 0 : Math.max(...ts);

    for (const { weekKey, weekStartMs, points: group } of cohorts) {
      const pixels: Pixel[] = [];
      for (const p of group) {
        const x = logToSvgX(p.x_value, x0, x1, layout.pl, layout.pw);
        const y = logToSvgY(p.y_value, y0, y1, layout.pt, layout.ph);
        if (Number.isFinite(x) && Number.isFinite(y)) pixels.push({ x, y });
      }
      if (pixels.length < 2) continue;

      const rank = rankByWeek.get(weekKey) ?? 0;
      const { fill, stroke } = cohortStyleRanked(rank, weekStartMs, minMs, maxMs, isDark);
      const weekTitle = formatCohortWeekTitle(weekKey, weekStartMs);
      const count = group.length;

      if (pixels.length === 2) {
        const a = pixels[0]!;
        const b = pixels[1]!;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        const w = Math.max(maxX - minX, 12) + 14;
        const h = Math.max(maxY - minY, 12) + 14;
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const wHit = w + 22;
        const hHit = h + 22;
        const halfW = wHit / 2;
        const halfH = hHit / 2;
        outHit.push({
          weekKey,
          weekStartMs,
          weekTitle,
          count,
          polygon: [
            { x: cx - halfW, y: cy - halfH },
            { x: cx + halfW, y: cy - halfH },
            { x: cx + halfW, y: cy + halfH },
            { x: cx - halfW, y: cy + halfH },
          ],
        });
        outItems.push(
          <g key={`${weekKey}-2`} filter={`url(#${blurFilterId})`}>
            <rect
              x={cx - w / 2}
              y={cy - h / 2}
              width={w}
              height={h}
              rx={18}
              ry={18}
              fill={fill}
              stroke={stroke}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>,
        );
        continue;
      }

      const rawHull = convexHull(pixels);
      const hullVis = expandFromCentroid(rawHull, HULL_EXPAND);
      const hullHit = expandFromCentroid(rawHull, HULL_EXPAND_HIT);
      outHit.push({
        weekKey,
        weekStartMs,
        weekTitle,
        count,
        polygon: hullHit.map((p) => ({ x: p.x, y: p.y })),
      });
      const d = hullVis.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ") + " Z";
      outItems.push(
        <g key={weekKey} filter={`url(#${blurFilterId})`}>
          <path
            d={d}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>,
      );
    }

    return { items: outItems, hitRegions: outHit };
  }, [
    blurFilterId,
    cohorts,
    enabled,
    isDark,
    layout,
    logDomainX,
    logDomainY,
    rankByWeek,
    x0,
    x1,
    y0,
    y1,
  ]);

  useLayoutEffect(() => {
    if (!onHitRegionsChange) return;
    if (!enabled || !layout) {
      onHitRegionsChange([]);
      return;
    }
    onHitRegionsChange(hitRegions);
  }, [enabled, hitRegions, layout, onHitRegionsChange]);

  if (!enabled || !layout || cohorts.length === 0) return null;

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none"
      style={{
        position: "absolute",
        left: layout.ol,
        top: layout.ot,
        width: layout.sw,
        height: layout.sh,
        zIndex: 20,
      }}
      aria-hidden
    >
      <svg width={layout.sw} height={layout.sh} viewBox={layout.viewBoxStr} className="overflow-visible">
        <defs>
          <filter id={blurFilterId} x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" />
          </filter>
        </defs>
        {items}
      </svg>
    </div>
  );
}
