"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";

import {
  DAILY_MAX_SPAN_DAYS,
  FIRST_LIVE_SNAPSHOT_DATE_ISO,
  archivedShadeKeys,
  buildAdaptiveSeries,
  formatAdaptiveTick,
  formatAdaptiveTooltipDate,
  formatWindowLabel,
  windowForBucket,
  windowForBucketKeys,
  type AdaptiveMeta,
  type ChartGranularity,
  type ViewWindow,
} from "./aggregateSeries";
import type { ChartViewport } from "./useChartViewport";
import { previousYearAvailable, withPreviousYear, type YoYMeta } from "./yoyCompare";

type CategoricalState = { activeLabel?: string | number | undefined };

/** Weekly/monthly points that are hollow (partial) or archived are styled from these row fields. */
export type AdaptiveRow = { date: string } & Partial<AdaptiveMeta>;

/**
 * Everything a shared daily chart needs to support zoom, granularity, drill-down and the archived boundary.
 * With no `view` (or already bucketed input) it is inert: `active` is false and `rowsDesc` is the input.
 */
export function useAdaptiveChart<R extends { date: string }>(args: {
  view?: ChartViewport;
  rows: R[];
  valueKey: "value" | "daily";
  isCumulative: boolean;
  firstLiveDateIso?: string | null;
  phone: boolean;
  /** Last pointer was touch/pen: drag selection is disabled so it never fights scrolling. */
  touch: boolean;
  onNeedMoreData?: (dateIso: string) => boolean | void;
}) {
  const { view, rows, valueKey, isCumulative, phone, touch } = args;
  const firstLiveIso = args.firstLiveDateIso || FIRST_LIVE_SNAPSHOT_DATE_ISO;
  const mode = view?.mode ?? "auto";
  const window = view?.window ?? null;

  const series = useMemo(
    () => (view ? buildAdaptiveSeries({ rowsDesc: rows, valueKey, isCumulative, window, mode, firstLiveIso }) : null),
    // `view` identity changes with every zoom; mode/window are what the derivation reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(view), rows, valueKey, isCumulative, window, mode, firstLiveIso],
  );
  const active = Boolean(view && series && !series.preBucketed && series.bounds);
  const granularity: ChartGranularity = active && series ? series.granularity : "daily";
  const forcedDaily = active && series ? series.forcedDaily : false;
  const bounds = series?.bounds ?? null;
  const visibleWindow = series?.window ?? null;
  const spanDays = series?.spanDays ?? 0;
  // Weekend shading, weekend-dip labels and per-point % only make sense for a short daily view.
  const dailyDetail = !active || (granularity === "daily" && spanDays <= DAILY_MAX_SPAN_DAYS);
  const baseRowsDesc = (active && series ? series.rowsDesc : rows) as Array<R & Partial<AdaptiveMeta>>;

  // "Compare: Previous year": offered only when the shifted window has data in the loaded rows.
  const compareAvailable = useMemo(
    () => active && previousYearAvailable(rows, valueKey, visibleWindow),
    [active, rows, valueKey, visibleWindow],
  );
  const compareOn = compareAvailable && Boolean(view?.compare);
  const rowsDesc = useMemo(
    () =>
      compareOn
        ? (withPreviousYear({
            displayRows: baseRowsDesc as Array<R & { _bucketEnd?: string }>,
            allRows: rows,
            valueKey,
            isCumulative,
            granularity,
          }) as Array<R & Partial<AdaptiveMeta> & Partial<YoYMeta>>)
        : baseRowsDesc,
    [compareOn, baseRowsDesc, rows, valueKey, isCumulative, granularity],
  );

  // A go-to-date that needed older data completes once the server delivers it.
  const applyPending = view?.applyPending;
  useEffect(() => {
    if (active) applyPending?.(bounds);
  }, [active, applyPending, bounds]);

  const tickFormatter = useCallback(
    (value: string) => formatAdaptiveTick(String(value), granularity, visibleWindow),
    [granularity, visibleWindow],
  );
  const formatDate = useCallback(
    (label: string) => formatAdaptiveTooltipDate(String(label), granularity),
    [granularity],
  );

  const archiveShade = useMemo(() => {
    if (!active) return null;
    const keysAsc = rowsDesc.map((r) => r.date).reverse();
    return archivedShadeKeys(keysAsc, firstLiveIso);
  }, [active, rowsDesc, firstLiveIso]);

  const gotoDate = useMemo(() => {
    const date = view?.gotoDate;
    return active && date && rowsDesc.some((r) => r.date === date) ? date : null;
  }, [active, view?.gotoDate, rowsDesc]);

  // --- Drag-to-zoom (desktop mouse only) and click-to-drill ---------------------------------------------------
  const [drag, setDrag] = useState<{ from: string; to: string } | null>(null);
  const dragRef = useRef<{ from: string; to: string } | null>(null);
  const suppressClick = useRef(false);
  const canDrag = active && !phone && !touch;

  const labelOf = (state: CategoricalState): string | null =>
    state?.activeLabel == null ? null : String(state.activeLabel);

  const onMouseDown = useCallback(
    (state: CategoricalState) => {
      if (!canDrag) return;
      const key = labelOf(state);
      if (!key) return;
      dragRef.current = { from: key, to: key };
    },
    [canDrag],
  );
  const onMouseMove = useCallback(
    (state: CategoricalState) => {
      const current = dragRef.current;
      if (!current) return;
      const key = labelOf(state);
      if (!key || key === current.to) return;
      dragRef.current = { from: current.from, to: key };
      setDrag(dragRef.current);
    },
    [],
  );
  const finishDrag = useCallback(() => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    return current;
  }, []);
  const onMouseUp = useCallback(
    (state: CategoricalState) => {
      const current = finishDrag();
      if (!current || !view) return;
      const key = labelOf(state) ?? current.to;
      if (current.from === key) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const zoomWindow = windowForBucketKeys(current.from, key, granularity, bounds);
      view.zoomTo(zoomWindow, formatWindowLabel(zoomWindow));
    },
    [bounds, finishDrag, granularity, view],
  );
  const onMouseLeave = useCallback(() => {
    if (dragRef.current) finishDrag();
  }, [finishDrag]);

  const drillInto = useCallback(
    (key: string) => {
      if (!view || granularity === "daily") return;
      const bucketWindow = windowForBucket(key, granularity, bounds);
      view.zoomTo(bucketWindow, formatWindowLabel(bucketWindow, granularity), granularity);
    },
    [bounds, granularity, view],
  );
  const onClick = useCallback(
    (state: CategoricalState, event?: SyntheticEvent) => {
      if (!active || granularity === "daily" || suppressClick.current || touch || phone) return;
      const modifiers = event as unknown as { ctrlKey?: boolean; metaKey?: boolean } | undefined;
      if (modifiers?.ctrlKey || modifiers?.metaKey) return; // keep ctrl/cmd-click for "copy value"
      const key = labelOf(state);
      if (key) drillInto(key);
    },
    [active, drillInto, granularity, phone, touch],
  );

  /** Wrap the copy-on-click handler so a drag or a drill never also copies a value. */
  const guardCopyClick = useCallback(
    (copy: (event: MouseEvent) => unknown) => (event: MouseEvent) => {
      if (!active) return copy(event);
      if (suppressClick.current) return undefined;
      if (granularity !== "daily" && !(event.ctrlKey || event.metaKey)) return undefined;
      return copy(event);
    },
    [active, granularity],
  );

  const dragArea = drag && canDrag ? { x1: drag.from, x2: drag.to } : null;

  return {
    active,
    rowsDesc,
    granularity,
    forcedDaily,
    compareAvailable,
    compareOn,
    bounds,
    visibleWindow: visibleWindow as ViewWindow | null,
    spanDays,
    dailyDetail,
    firstLiveIso,
    tickFormatter,
    formatDate,
    archiveShade,
    gotoDate,
    dragArea,
    drillInto,
    guardCopyClick,
    chartHandlers: active
      ? { onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onClick }
      : {},
  };
}
