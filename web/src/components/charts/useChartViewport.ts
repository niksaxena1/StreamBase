"use client";

import { useCallback, useMemo, useState } from "react";

import {
  EARLIEST_HISTORY_DATE_ISO,
  clampWindow,
  goToDateWindow,
  formatWindowLabel,
  type ChartGranularity,
  type GranularityMode,
  type ViewWindow,
} from "./aggregateSeries";

export type ZoomEntry = { label: string; window: ViewWindow; granularity?: ChartGranularity };

/** A go-to-date that needs older data than is loaded survives the URL change (and any remount it causes). */
const pendingGoTo = new Map<string, string>();

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
  zoomTo: (window: ViewWindow, label?: string, granularity?: ChartGranularity) => void;
  back: () => void;
  reset: () => void;
  /**
   * Zoom to a date. When the date is older than the loaded data and `onNeedMoreData` is given, the request is
   * remembered and `onNeedMoreData(date)` should update the URL range so the server loads it.
   */
  goTo: (dateIso: string, bounds: ViewWindow | null, onNeedMoreData?: (dateIso: string) => void) => void;
  /** Complete a remembered go-to-date once enough data has loaded. */
  applyPending: (bounds: ViewWindow | null) => void;
};

/** Client-only zoom / granularity state for one adaptive chart. Hosts call this and hand the result to the chart. */
export function useChartViewport(id: string): ChartViewport {
  const [mode, setMode] = useState<GranularityMode>("auto");
  const [stack, setStack] = useState<ZoomEntry[]>([]);
  const [gotoDate, setGotoDate] = useState<string | null>(null);

  const zoomTo = useCallback((window: ViewWindow, label?: string, granularity?: ChartGranularity) => {
    setGotoDate(null);
    setStack((prev) => [...prev, { label: label ?? formatWindowLabel(window, granularity), window, granularity }]);
  }, []);
  const back = useCallback(() => {
    setGotoDate(null);
    setStack((prev) => prev.slice(0, -1));
  }, []);
  const reset = useCallback(() => {
    setGotoDate(null);
    setStack([]);
  }, []);

  const applyGoTo = useCallback((dateIso: string, bounds: ViewWindow | null) => {
    const window = goToDateWindow(dateIso, bounds);
    const shown = bounds ? clampWindow({ start: dateIso, end: dateIso }, bounds).start : dateIso;
    setStack([{ label: formatWindowLabel({ start: shown, end: shown }), window }]);
    setGotoDate(shown);
    setMode((current) => (current === "weekly" || current === "monthly" ? "auto" : current));
  }, []);

  const goTo = useCallback(
    (dateIso: string, bounds: ViewWindow | null, onNeedMoreData?: (dateIso: string) => void) => {
      const target = dateIso < EARLIEST_HISTORY_DATE_ISO ? EARLIEST_HISTORY_DATE_ISO : dateIso;
      if (bounds && onNeedMoreData && target < bounds.start) {
        pendingGoTo.set(id, target);
        onNeedMoreData(target);
        return;
      }
      pendingGoTo.delete(id);
      applyGoTo(target, bounds);
    },
    [applyGoTo, id],
  );

  const applyPending = useCallback(
    (bounds: ViewWindow | null) => {
      const date = pendingGoTo.get(id);
      if (!date || !bounds || date < bounds.start) return;
      pendingGoTo.delete(id);
      applyGoTo(date, bounds);
    },
    [applyGoTo, id],
  );

  const window = stack.length ? stack[stack.length - 1].window : null;

  return useMemo(
    () => ({ id, mode, setMode, stack, window, gotoDate, zoomTo, back, reset, goTo, applyPending }),
    [id, mode, stack, window, gotoDate, zoomTo, back, reset, goTo, applyPending],
  );
}
