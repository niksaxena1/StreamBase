"use client";

import { useCallback, useMemo, useState } from "react";

import {
  clampWindow,
  goToDateWindow,
  formatWindowLabel,
  planGoTo,
  type ChartGranularity,
  type GranularityMode,
  type ViewWindow,
} from "./aggregateSeries";

export type ZoomEntry = { label: string; window: ViewWindow; granularity?: ChartGranularity };

/** A go-to-date that needs older data than is loaded survives the URL change (and any remount it causes). */
const pendingGoTo = new Map<string, { date: string; fromStart: string | null; fromEnd: string | null }>();

/**
 * Asks the host to load older data (usually by changing the URL range). Return `false` when nothing more can be
 * loaded (already at the maximum range), so the viewport falls back to the earliest loaded data with a message.
 */
export type NeedMoreData = (dateIso: string) => boolean | void;

export type ChartViewport = {
  /** Identifies this chart for the pending go-to-date store. */
  id: string;
  mode: GranularityMode;
  setMode: (mode: GranularityMode) => void;
  stack: readonly ZoomEntry[];
  /** Current zoom window, or null for the whole loaded range. */
  window: ViewWindow | null;
  /** Day highlighted after "Go to date". */
  gotoDate: string | null;
  /** Short inline message about the last "Go to date" (no data, loading, clamped), or null. */
  notice: string | null;
  clearNotice: () => void;
  zoomTo: (window: ViewWindow, label?: string, granularity?: ChartGranularity) => void;
  back: () => void;
  reset: () => void;
  /**
   * Zoom to a date. When the date is older than the loaded data and `onNeedMoreData` is given, the request is
   * remembered and `onNeedMoreData(date)` should update the URL range so the server loads it.
   */
  goTo: (dateIso: string, bounds: ViewWindow | null, onNeedMoreData?: NeedMoreData) => void;
  /** Complete a remembered go-to-date once enough data has loaded. */
  applyPending: (bounds: ViewWindow | null) => void;
  /** "Compare: Previous year" overlay. Per-session choice, off by default. */
  compare: boolean;
  setCompare: (on: boolean) => void;
};

/** Client-only zoom / granularity state for one adaptive chart. Hosts call this and hand the result to the chart. */
export function useChartViewport(id: string): ChartViewport {
  const [mode, setMode] = useState<GranularityMode>("auto");
  const [stack, setStack] = useState<ZoomEntry[]>([]);
  const [gotoDate, setGotoDate] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);

  const clearNotice = useCallback(() => setNotice(null), []);
  const zoomTo = useCallback((window: ViewWindow, label?: string, granularity?: ChartGranularity) => {
    setGotoDate(null);
    setNotice(null);
    setStack((prev) => [...prev, { label: label ?? formatWindowLabel(window, granularity), window, granularity }]);
  }, []);
  const back = useCallback(() => {
    setGotoDate(null);
    setNotice(null);
    setStack((prev) => prev.slice(0, -1));
  }, []);
  const reset = useCallback(() => {
    setGotoDate(null);
    setNotice(null);
    setStack([]);
  }, []);

  const applyGoTo = useCallback((dateIso: string, bounds: ViewWindow | null, message: string | null) => {
    const window = goToDateWindow(dateIso, bounds);
    const shown = bounds ? clampWindow({ start: dateIso, end: dateIso }, bounds).start : dateIso;
    setStack([{ label: formatWindowLabel({ start: shown, end: shown }), window }]);
    setGotoDate(shown);
    setNotice(message);
    setMode((current) => (current === "weekly" || current === "monthly" ? "auto" : current));
  }, []);

  const goTo = useCallback(
    (dateIso: string, bounds: ViewWindow | null, onNeedMoreData?: NeedMoreData) => {
      pendingGoTo.delete(id);
      const plan = planGoTo(dateIso, bounds, Boolean(onNeedMoreData));
      if (plan.action === "reject") {
        setNotice(plan.message);
        return;
      }
      if (plan.action === "load" && onNeedMoreData && bounds) {
        pendingGoTo.set(id, { date: plan.target, fromStart: bounds.start, fromEnd: bounds.end });
        setNotice("Loading earlier history…");
        if (onNeedMoreData(plan.target) === false) {
          pendingGoTo.delete(id);
          applyGoTo(plan.target, bounds, `Earliest data here is ${formatWindowLabel({ start: bounds.start, end: bounds.start })}`);
        }
        return;
      }
      applyGoTo(plan.target, bounds, plan.action === "apply" ? plan.message : null);
    },
    [applyGoTo, id],
  );

  const applyPending = useCallback(
    (bounds: ViewWindow | null) => {
      const pending = pendingGoTo.get(id);
      if (!pending || !bounds) return;
      // Wait until the loaded extent actually changed (the server delivered the wider range).
      if (bounds.start === pending.fromStart && bounds.end === pending.fromEnd) return;
      pendingGoTo.delete(id);
      const plan = planGoTo(pending.date, bounds, false);
      if (plan.action === "reject") setNotice(plan.message);
      else applyGoTo(plan.target, bounds, plan.action === "apply" ? plan.message : null);
    },
    [applyGoTo, id],
  );

  const window = stack.length ? stack[stack.length - 1].window : null;

  return useMemo(
    () => ({ id, mode, setMode, stack, window, gotoDate, notice, clearNotice, zoomTo, back, reset, goTo, applyPending, compare, setCompare }),
    [id, mode, stack, window, gotoDate, notice, clearNotice, zoomTo, back, reset, goTo, applyPending, compare],
  );
}
