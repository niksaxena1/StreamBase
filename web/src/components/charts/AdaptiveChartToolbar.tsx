"use client";

import { ChevronLeft } from "lucide-react";

import {
  EARLIEST_HISTORY_DATE_ISO,
  type ChartGranularity,
  type GranularityMode,
  type ViewWindow,
} from "./aggregateSeries";
import type { ChartViewport } from "./useChartViewport";

const MODES: ReadonlyArray<{ value: GranularityMode; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const COMPARE_OPTION = "__compare";

const stop = {
  onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
};

const controlStyle = { borderColor: "var(--sb-border)", background: "var(--sb-surface)", color: "var(--sb-text)" } as const;

function granularityHint(granularity: ChartGranularity, isCumulative: boolean, forcedDaily: boolean): string | null {
  if (granularity === "daily") return forcedDaily ? "7-day average, daily dots" : null;
  if (isCumulative) return `${granularity === "weekly" ? "Week" : "Month"}-end totals`;
  return `Average per day, by ${granularity === "weekly" ? "week" : "month"}`;
}

/** Granularity selector, go-to-date, zoom breadcrumb and reset chip shown above an adaptive chart. */
export function AdaptiveChartToolbar({
  view,
  granularity,
  forcedDaily,
  isCumulative,
  bounds,
  phone,
  rootLabel = "All time",
  onNeedMoreData,
  compareAvailable = false,
  compareOn = false,
  compareColor,
}: {
  view: ChartViewport;
  /** Granularity currently drawn (resolved from Auto). */
  granularity: ChartGranularity;
  forcedDaily: boolean;
  isCumulative: boolean;
  /** Loaded data extent. */
  bounds: ViewWindow | null;
  phone: boolean;
  rootLabel?: string;
  onNeedMoreData?: (dateIso: string) => boolean | void;
  /** Previous-year data exists for at least part of the visible window: show the Compare toggle. */
  compareAvailable?: boolean;
  /** Overlay is drawn (toggle on and available). */
  compareOn?: boolean;
  /** Colour of the current series, for the legend swatch. */
  compareColor?: string;
}) {
  const hint = granularityHint(granularity, isCumulative, forcedDaily);
  const zoomed = view.stack.length > 0;
  const maxDate = bounds?.end;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs" data-sb-chart-toolbar {...stop}>
      {phone ? (
        <select
          aria-label="Chart granularity"
          value={view.mode}
          onChange={(event) => {
            if (event.target.value === COMPARE_OPTION) view.setCompare(!view.compare);
            else view.setMode(event.target.value as GranularityMode);
          }}
          className="min-h-8 rounded-md border px-2 py-1 text-xs"
          style={controlStyle}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.value === "auto" ? `Auto (${granularity})` : m.label}
            </option>
          ))}
          {compareAvailable ? (
            <option value={COMPARE_OPTION}>{view.compare ? "Compare: Previous year (on)" : "Compare: Previous year"}</option>
          ) : null}
        </select>
      ) : (
        <div role="group" aria-label="Chart granularity" className="flex shrink-0 rounded-md border" style={controlStyle}>
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={view.mode === m.value}
              title={m.value === "auto" ? `Auto: ${granularity} for the visible range` : undefined}
              onClick={() => view.setMode(m.value)}
              className="min-h-8 rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-1"
              style={{ color: "var(--sb-text)", opacity: view.mode === m.value ? 1 : 0.55, fontWeight: view.mode === m.value ? 600 : 400 }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <label className="flex shrink-0 items-center gap-1.5" style={{ color: "var(--sb-muted)" }}>
        <span>Go to</span>
        <input
          type="date"
          aria-label="Go to date"
          min={EARLIEST_HISTORY_DATE_ISO}
          max={maxDate}
          aria-describedby={view.notice ? "chart-goto-notice" : undefined}
          onChange={(event) => {
            const value = event.target.value;
            if (!value) {
              view.clearNotice();
              return;
            }
            // Browsers fire change while the year is still being typed ("0002-07-19"); wait for a plausible year.
            if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1000) view.goTo(value, bounds, onNeedMoreData);
          }}
          className="min-h-8 rounded-md border px-1.5 py-1 text-xs"
          style={controlStyle}
        />
      </label>

      {compareAvailable && !phone ? (
        <button
          type="button"
          aria-pressed={view.compare}
          onClick={() => view.setCompare(!view.compare)}
          className="min-h-8 shrink-0 rounded-md border px-2 py-1"
          style={{ ...controlStyle, fontWeight: view.compare ? 600 : 400, opacity: view.compare ? 1 : 0.7 }}
        >
          Compare: Previous year
        </button>
      ) : null}

      {compareOn ? (
        <span className="flex shrink-0 items-center gap-3" style={{ color: "var(--sb-muted)" }} data-sb-yoy-legend>
          <span className="flex items-center gap-1">
            <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={compareColor ?? "var(--sb-text)"} strokeWidth="2.5" /></svg>
            Current
          </span>
          <span className="flex items-center gap-1">
            <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke="var(--sb-muted)" strokeWidth="2" strokeOpacity="0.8" /></svg>
            Previous year
          </span>
        </span>
      ) : null}

      {view.notice ? (
        <span id="chart-goto-notice" role="status" style={{ color: "var(--sb-muted)" }}>{view.notice}</span>
      ) : null}

      {zoomed ? (
        <nav aria-label="Chart zoom" className="flex min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={view.back}
            aria-label="Back"
            className="inline-flex min-h-8 items-center gap-0.5 rounded-md border px-1.5 py-1"
            style={controlStyle}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={view.reset}
            className="min-h-8 rounded-md px-1 py-1 underline-offset-2 hover:underline"
            style={{ color: "var(--sb-muted)" }}
          >
            {rootLabel}
          </button>
          {view.stack.map((entry, index) => (
            <span key={`${entry.label}-${index}`} className="flex items-center gap-1.5">
              <span aria-hidden style={{ color: "var(--sb-muted)" }}>&rsaquo;</span>
              <span style={{ color: "var(--sb-text)", fontWeight: index === view.stack.length - 1 ? 600 : 400 }}>{entry.label}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={view.reset}
            className="min-h-8 rounded-full border px-2.5 py-1 font-medium"
            style={controlStyle}
          >
            Reset zoom
          </button>
        </nav>
      ) : !phone ? (
        <span style={{ color: "var(--sb-muted)" }}>Drag across the chart to zoom</span>
      ) : null}

      {hint ? <span style={{ color: "var(--sb-muted)" }}>{hint}</span> : null}
    </div>
  );
}
