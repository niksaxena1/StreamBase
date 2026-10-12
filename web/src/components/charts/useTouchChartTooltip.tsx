"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type ChartPoint = { index: number; x: number; y: number };

export function hitTestChartPoint(points: readonly ChartPoint[], x: number, y: number): ChartPoint | null {
  let closest: ChartPoint | null = null;
  let distance = 24;
  for (const point of points) {
    const next = Math.hypot(point.x - x, point.y - y);
    if (next <= distance) { closest = point; distance = next; }
  }
  return closest;
}

/** Coordinates come from the rendered dots, including clipped points and MA. */
export function TouchChartPoint({ cx, cy, index, children }: {
  cx?: number; cy?: number; index?: number; children: ReactNode;
}) {
  return <g data-sb-point={index} data-x={cx} data-y={cy}>{children}</g>;
}

export function useTouchChartTooltip(dataKey: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const setContainer = useCallback((node: HTMLDivElement | null) => { ref.current = node; }, []);
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  const [touch, setTouch] = useState(false);
  const [selection, setSelection] = useState<{ dataKey: unknown; point: ChartPoint } | null>(null);
  // Data/range changes invalidate a pinned position rather than showing a different date.
  const pinned = selection && selection.dataKey === dataKey ? selection.point : null;

  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setSelection(null);
    };
    document.addEventListener("pointerdown", dismiss);
    const dismissPosition = () => setSelection(null);
    window.addEventListener("resize", dismissPosition);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", dismissPosition);
    };
  }, []);

  return {
    setContainer, pinned, touch,
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      const isTouch = event.pointerType === "touch" || event.pointerType === "pen";
      setTouch(isTouch);
      if (!isTouch) setSelection(null);
      // Keep the release on the stable container while Recharts replaces dots.
      if (isTouch) event.currentTarget.setPointerCapture(event.pointerId);
      start.current = isTouch ? { x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
    },
    onPointerCancelCapture() { start.current = null; },
    onPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
      if (event.pointerType === "mouse" && touch) { setTouch(false); setSelection(null); }
    },
    onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
      const down = start.current;
      start.current = null;
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10 || event.timeStamp - down.time > 500) return;
      const svg = ref.current?.querySelector<SVGSVGElement>("svg.recharts-surface");
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix) return;
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const points = Array.from(svg.querySelectorAll<SVGGElement>("[data-sb-point]")).map(node => ({
        index: Number(node.dataset.sbPoint), x: Number(node.dataset.x), y: Number(node.dataset.y),
      })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
      const point = hitTestChartPoint(points, local.x, local.y);
      const screen = point ? new DOMPoint(point.x, point.y).matrixTransform(matrix) : null;
      const bounds = ref.current!.getBoundingClientRect();
      setSelection(point && screen ? { dataKey, point: { ...point, x: screen.x - bounds.left, y: screen.y - bounds.top } } : null);
    },
  };
}
