"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker, type DateRange } from "react-day-picker";
import { DateInput } from "@/components/ui/DateInput";
import { parseYmd, formatYmd, formatDisplay } from "@/lib/date";

function utcMsFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function clampDaysInclusive(startYmd: string, endYmd: string): number {
  const days = Math.round((utcMsFromYmd(endYmd) - utcMsFromYmd(startYmd)) / 86400000) + 1;
  return Math.max(1, Math.min(365, days));
}

/**
 * Compact date-range label for chips.
 * Examples: "1 Mar"  |  "1–28 Feb"  |  "23 Feb – 1 Mar"  |  "31 Dec 2025 – 1 Jan 2026"
 */
export function formatDateRangeShort(startYmd: string, endYmd: string): string {
  const s = parseYmd(startYmd);
  const e = parseYmd(endYmd);
  const sd = s.getDate();
  const ed = e.getDate();
  const sm = s.toLocaleString("en-US", { month: "short" });
  const em = e.toLocaleString("en-US", { month: "short" });
  const sy = s.getFullYear();
  const ey = e.getFullYear();
  if (startYmd === endYmd) return `${sd} ${sm}`;
  if (sy !== ey) return `${sd} ${sm} ${sy} – ${ed} ${em} ${ey}`;
  if (s.getMonth() === e.getMonth()) return `${sd}–${ed} ${em}`;
  return `${sd} ${sm} – ${ed} ${em}`;
}

/** Presets that map 1:1 to the standard 30d/90d/365d chips. */
const STANDARD_RANGE_PRESETS: Record<string, number> = {
  last30: 30,
  last90: 90,
  last365: 365,
};

type Preset = { name: string; label: string };
type ConcreteRange = { from: Date; to: Date };

const PRESETS: Preset[] = [
  { name: "last7", label: "Last 7 days" },
  { name: "last14", label: "Last 14 days" },
  { name: "last30", label: "Last 30 days" },
  { name: "last90", label: "Last 90 days" },
  { name: "last365", label: "Last 365 days" },
  { name: "thisMonth", label: "This month" },
  { name: "lastMonth", label: "Last month" },
];

export type DateRangePickerHandle = { open: () => void };

export const DateRangePicker = forwardRef<DateRangePickerHandle, {
  latestDate: string | null;
  currentRangeDays: number;
  tone?: "default" | "opaque";
  headless?: boolean;
}>(function DateRangePicker({ latestDate, currentRangeDays, tone = "default", headless = false }, ref) {
  if (!latestDate) return null;
  return <DateRangePickerInner ref={ref} latestDate={latestDate} currentRangeDays={currentRangeDays} tone={tone} headless={headless} />;
});

const DateRangePickerInner = forwardRef<DateRangePickerHandle, {
  latestDate: string;
  currentRangeDays: number;
  tone: "default" | "opaque";
  headless: boolean;
}>(function DateRangePickerInner({
  latestDate,
  currentRangeDays,
  tone,
  headless,
}, ref) {
  const router = useRouter();
  const sp = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const buttonRef = useRef<HTMLElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const openedRangeRef = useRef<DateRange | undefined>(undefined);
  const [selectedPreset, setSelectedPreset] = useState<string | undefined>(undefined);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [displayMonth, setDisplayMonth] = useState<Date | undefined>(undefined);

  useEffect(() => {
    if (!latestDate) return;
    const customStart = sp.get("start");
    const customEnd = sp.get("end");
    if (customStart && customEnd) {
      setRange({ from: parseYmd(customStart), to: parseYmd(customEnd) });
    } else {
      const end = latestDate;
      const start = (() => {
        const d = parseYmd(end);
        d.setDate(d.getDate() - (currentRangeDays - 1));
        return formatYmd(d);
      })();
      setRange({ from: parseYmd(start), to: parseYmd(end) });
    }
  }, [latestDate, currentRangeDays, sp]);

  function handleApply() {
    if (!range?.from || !range.to) return;
    const startYmd = formatYmd(range.from);
    const endYmd = formatYmd(range.to);
    const params = new URLSearchParams(sp.toString());

    // If the selection exactly matches a standard preset range, snap to the numeric chip.
    for (const [presetName, days] of Object.entries(STANDARD_RANGE_PRESETS)) {
      const r = getPresetRange(presetName);
      if (formatYmd(r.from) === startYmd && formatYmd(r.to) === endYmd) {
        params.set("range", String(days));
        params.delete("start");
        params.delete("end");
        router.push(`?${params.toString()}`);
        setIsOpen(false);
        return;
      }
    }

    params.set("range", String(clampDaysInclusive(startYmd, endYmd)));
    params.set("start", startYmd);
    params.set("end", endYmd);
    router.push(`?${params.toString()}`);
    setIsOpen(false);
  }

  /** Apply a preset immediately (no Apply button needed). */
  function applyPreset(name: string) {
    const params = new URLSearchParams(sp.toString());
    const standardDays = STANDARD_RANGE_PRESETS[name];
    if (standardDays !== undefined) {
      // Snap to the numeric chip — clear custom start/end.
      params.set("range", String(standardDays));
      params.delete("start");
      params.delete("end");
    } else {
      const r = getPresetRange(name);
      const startYmd = formatYmd(r.from);
      const endYmd = formatYmd(r.to);
      params.set("range", String(clampDaysInclusive(startYmd, endYmd)));
      params.set("start", startYmd);
      params.set("end", endYmd);
    }
    router.push(`?${params.toString()}`);
    setIsOpen(false);
  }

  function handleClear() {
    const params = new URLSearchParams(sp.toString());
    params.delete("start");
    params.delete("end");
    router.push(`?${params.toString()}`);
    setIsOpen(false);
  }

  const hasCustomRange = Boolean(sp.get("start") && sp.get("end"));
  const customStart = sp.get("start");
  const customEnd = sp.get("end");

  const minDate = useMemo(() => {
    const d = parseYmd(latestDate);
    d.setDate(d.getDate() - 365);
    return d;
  }, [latestDate]);
  const maxDate = useMemo(() => parseYmd(latestDate), [latestDate]);

  useImperativeHandle(ref, () => ({
    open: () => {
      if (!isOpen) {
        openedRangeRef.current = range ? { ...range } : undefined;
        setDisplayMonth(new Date(maxDate.getFullYear(), maxDate.getMonth() - (isSmallScreen ? 0 : 1), 1));
      }
      setIsOpen(true);
    },
  // Intentional: useImperativeHandle doesn't use dependency arrays like useEffect (React.useMemo pattern)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isOpen, range, maxDate, isSmallScreen]);

  useEffect(() => {
    const handleResize = () => setIsSmallScreen(window.innerWidth < 640);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Set initial display month when opening
  useEffect(() => {
    if (isOpen && !displayMonth) {
      // Show the month containing maxDate (and previous month if 2-month view)
      setDisplayMonth(new Date(maxDate.getFullYear(), maxDate.getMonth() - (isSmallScreen ? 0 : 1), 1));
    }
  }, [isOpen, maxDate, isSmallScreen, displayMonth]);

  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const el = buttonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = isSmallScreen ? 320 : 580;
      const margin = 8;

      let left = rect.right - width;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

      const preferBelow = rect.bottom + 12 + 420 <= window.innerHeight;
      const top = preferBelow ? rect.bottom + 8 : Math.max(margin, rect.top - 8 - 420);

      setPopoverPos({ top, left });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, isSmallScreen]);

  function clampToBounds(d: Date): Date {
    if (d < minDate) return new Date(minDate);
    if (d > maxDate) return new Date(maxDate);
    return d;
  }

  function getPresetRange(name: string): ConcreteRange {
    const to = new Date(maxDate);
    to.setHours(0, 0, 0, 0);
    const from = new Date(to);

    switch (name) {
      case "last7":
        from.setDate(from.getDate() - 6);
        break;
      case "last14":
        from.setDate(from.getDate() - 13);
        break;
      case "last30":
        from.setDate(from.getDate() - 29);
        break;
      case "last90":
        from.setDate(from.getDate() - 89);
        break;
      case "last365":
        from.setDate(from.getDate() - 364);
        break;
      case "thisMonth":
        from.setDate(1);
        break;
      case "lastMonth": {
        const d = new Date(to);
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        from.setFullYear(d.getFullYear(), d.getMonth(), 1);
        break;
      }
      default:
        break;
    }

    const clampedFrom = clampToBounds(from);
    const clampedTo = clampToBounds(to);
    if (clampedFrom > clampedTo) return { from: clampedTo, to: clampedTo };
    return { from: clampedFrom, to: clampedTo };
  }

  function setPreset(name: string) {
    setSelectedPreset(name);
    const r = getPresetRange(name);
    setRange(r);
    // Navigate to show the range
    setDisplayMonth(new Date(r.from.getFullYear(), r.from.getMonth(), 1));
  }

  function checkPreset() {
    if (!range?.from || !range.to) {
      setSelectedPreset(undefined);
      return;
    }
    const aFrom = new Date(range.from);
    const aTo = new Date(range.to);
    aFrom.setHours(0, 0, 0, 0);
    aTo.setHours(0, 0, 0, 0);

    for (const p of PRESETS) {
      const r = getPresetRange(p.name);
      const bFrom = new Date(r.from);
      const bTo = new Date(r.to);
      bFrom.setHours(0, 0, 0, 0);
      bTo.setHours(0, 0, 0, 0);
      if (aFrom.getTime() === bFrom.getTime() && aTo.getTime() === bTo.getTime()) {
        setSelectedPreset(p.name);
        return;
      }
    }
    setSelectedPreset(undefined);
  }

  useEffect(() => {
    checkPreset();
    // Using .getTime() on optional dates as deps to avoid lint errors with object changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.from?.getTime?.(), range?.to?.getTime?.(), maxDate.getTime()]);

  // Navigation handlers
  function goToPrevMonth() {
    if (!displayMonth) return;
    const prev = new Date(displayMonth);
    prev.setMonth(prev.getMonth() - 1);
    if (prev >= new Date(minDate.getFullYear(), minDate.getMonth(), 1)) {
      setDisplayMonth(prev);
    }
  }

  function goToNextMonth() {
    if (!displayMonth) return;
    const next = new Date(displayMonth);
    next.setMonth(next.getMonth() + 1);
    // For 2-month view, the right month is displayMonth + 1
    const rightMonth = isSmallScreen ? next : new Date(next.getFullYear(), next.getMonth() + 1, 1);
    if (rightMonth <= new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1)) {
      setDisplayMonth(next);
    }
  }

  const canGoPrev = displayMonth && displayMonth > new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const canGoNext = (() => {
    if (!displayMonth) return false;
    const rightMonth = isSmallScreen ? displayMonth : new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1);
    return rightMonth < new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
  })();

  return (
    <div className="relative">
      {headless ? (
        <span ref={(el) => { buttonRef.current = el; }} style={{ display: "inline-block", width: 0, height: 0 }} />
      ) : (
        <button
          ref={(el) => { buttonRef.current = el; }}
          type="button"
          onClick={() => {
            if (!isOpen) {
              openedRangeRef.current = range ? { ...range } : undefined;
              setDisplayMonth(new Date(maxDate.getFullYear(), maxDate.getMonth() - (isSmallScreen ? 0 : 1), 1));
            }
            setIsOpen(!isOpen);
          }}
          className={[
            "sb-ring flex items-center gap-1.5 rounded-full px-2.5 py-2 text-[11px] font-medium transition",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
            isOpen || hasCustomRange
              ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
              : tone === "opaque"
                ? "bg-white/90 hover:bg-white/90 dark:bg-white/20 dark:hover:bg-white/20"
                : "bg-white/70 hover:bg-white/70 dark:bg-white/10 dark:hover:bg-white/10",
          ].join(" ")}
          style={isOpen || hasCustomRange ? undefined : { color: "var(--sb-muted)" }}
          title={hasCustomRange ? `${formatDisplay(parseYmd(customStart!))} to ${formatDisplay(parseYmd(customEnd!))}` : "Custom date range"}
        >
          <Calendar
            className={[
              "h-3 w-3",
              isOpen || hasCustomRange ? "text-white dark:text-black" : "",
            ].join(" ")}
          />
          <ChevronDown className={["h-3 w-3 opacity-70", isOpen ? "rotate-180 transition" : "transition"].join(" ")} />
          {hasCustomRange ? (
            <span className="font-mono text-[10px]">
              {formatDisplay(parseYmd(customStart!))}–{formatDisplay(parseYmd(customEnd!))}
            </span>
          ) : (
            "Range"
          )}
        </button>
      )}

      {isOpen && popoverPos
        ? createPortal(
            <>
              <div
                className={["fixed z-40", isSmallScreen ? "inset-0 bg-black/50" : "inset-0"].join(" ")}
                onMouseDown={() => {
                  setRange(openedRangeRef.current);
                  setIsOpen(false);
                }}
              />
              <div
                className={[
                  "fixed z-50 sb-card shadow-lg overflow-hidden",
                  isSmallScreen
                    ? "inset-0 flex flex-col"
                    : "w-[580px]",
                ].join(" ")}
                style={isSmallScreen ? { backgroundColor: "var(--sb-bg)" } : { top: popoverPos.top, left: popoverPos.left }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && range?.from && range.to) {
                    e.preventDefault();
                    handleApply();
                  }
                }}
              >
                {/* Header with inputs and close */}
                <div
                  className={[
                    "flex items-center justify-between gap-2 border-b px-3 flex-shrink-0",
                    isSmallScreen ? "pb-3" : "py-2",
                  ].join(" ")}
                  style={{
                    borderColor: "var(--sb-border)",
                    paddingTop: isSmallScreen
                      ? "max(0.75rem, env(safe-area-inset-top))"
                      : undefined,
                  }}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <DateInput
                      key={range?.from ? formatYmd(range.from) : "from-none"}
                      value={range?.from}
                      onChange={(d) => {
                        const from = clampToBounds(d);
                        const to = range?.to ? clampToBounds(range.to) : undefined;
                        const nextTo = !to || from > to ? from : to;
                        setRange({ from, to: nextTo });
                        setDisplayMonth(new Date(from.getFullYear(), from.getMonth(), 1));
                      }}
                    />
                    <span className="text-xs opacity-40">–</span>
                    <DateInput
                      key={range?.to ? formatYmd(range.to) : "to-none"}
                      value={range?.to}
                      onChange={(d) => {
                        const to = clampToBounds(d);
                        const from = range?.from ? clampToBounds(range.from) : to;
                        const nextFrom = to < from ? to : from;
                        setRange({ from: nextFrom, to });
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setRange(openedRangeRef.current);
                      setIsOpen(false);
                    }}
                    className={[
                      "sb-ring grid h-8 w-8 flex-shrink-0 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/10",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                    ].join(" ")}
                    style={{ color: "var(--sb-muted)" }}
                    aria-label="Close"
                  >
                    <X className={isSmallScreen ? "h-5 w-5" : "h-3.5 w-3.5"} />
                  </button>
                </div>

                {isSmallScreen ? (
                  /* Mobile: Full-screen layout with scrollable calendars */
                  <>
                    {/* Presets row */}
                    <div
                      className="flex gap-1.5 p-3 border-b overflow-x-auto flex-shrink-0"
                      style={{ borderColor: "var(--sb-border)" }}
                    >
                      {PRESETS.map((p) => {
                        const isSel = selectedPreset === p.name;
                        return (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => applyPreset(p.name)}
                            className={[
                              "sb-ring flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition whitespace-nowrap",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                              isSel
                                ? "text-black dark:text-black"
                                : "hover:bg-black/5 dark:hover:bg-white/10",
                            ].join(" ")}
                            style={isSel ? { backgroundColor: "var(--sb-accent)" } : { color: "var(--sb-text)", backgroundColor: "var(--sb-border)" }}
                          >
                            {isSel && <Check className="h-3.5 w-3.5" />}
                            <span>{p.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Scrollable calendar area showing all months */}
                    <div className="flex-1 overflow-y-auto p-4">
                      <div className="flex flex-col gap-6">
                        {(() => {
                          // Generate array of months from minDate to maxDate
                          const months: Date[] = [];
                          const current = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
                          const end = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
                          while (current <= end) {
                            months.push(new Date(current));
                            current.setMonth(current.getMonth() + 1);
                          }
                          return months.map((month) => (
                            <div key={`${month.getFullYear()}-${month.getMonth()}`} className="flex flex-col items-center">
                              <div className="text-sm font-semibold mb-3" style={{ color: "var(--sb-text)" }}>
                                {month.toLocaleString("en-US", { month: "long", year: "numeric" })}
                              </div>
                              <DayPicker
                                mode="range"
                                selected={range}
                                onSelect={(v) => {
                                  if (!v?.from) return;
                                  const from = clampToBounds(v.from);
                                  const to = v.to ? clampToBounds(v.to) : undefined;
                                  setRange({ from, to });
                                }}
                                disabled={[{ before: minDate }, { after: maxDate }]}
                                weekStartsOn={1}
                                showOutsideDays={false}
                                numberOfMonths={1}
                                month={month}
                                hideNavigation
                                classNames={{
                                  months: "flex",
                                  month: "flex flex-col gap-1",
                                  month_caption: "hidden",
                                  month_grid: "border-collapse",
                                  weekdays: "flex",
                                  weekday: "w-10 h-8 text-center text-xs font-medium opacity-50",
                                  week: "flex",
                                  day: "w-10 h-10 p-0 text-center",
                                  day_button: [
                                    "w-full h-full rounded-md text-sm font-medium cursor-pointer transition-colors",
                                    "hover:bg-black/5 dark:hover:bg-white/10",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--sb-bg)]",
                                  ].join(" "),
                                  today: "ring-1 ring-inset ring-[color:var(--sb-accent)]",
                                  selected: "!bg-[color:var(--sb-accent)] !text-black hover:!bg-[color:var(--sb-accent)]",
                                  range_start: "!bg-[color:var(--sb-accent)] !text-black !rounded-r-none hover:!bg-[color:var(--sb-accent)]",
                                  range_middle: "!bg-[color:var(--sb-accent)]/30 !rounded-none",
                                  range_end: "!bg-[color:var(--sb-accent)] !text-black !rounded-l-none hover:!bg-[color:var(--sb-accent)]",
                                  outside: "opacity-30",
                                  disabled: "opacity-20 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent",
                                  hidden: "invisible",
                                }}
                              />
                            </div>
                          ));
                        })()}
                      </div>
                    </div>

                    {/* Footer with selection summary and actions */}
                    <div
                      className="flex items-center justify-between gap-3 border-t px-4 pt-3 flex-shrink-0"
                      style={{
                        borderColor: "var(--sb-border)",
                        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
                      }}
                    >
                      <div className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
                        {range?.from && range.to
                          ? `${formatDisplay(range.from)} → ${formatDisplay(range.to)}`
                          : "Select a date range"}
                      </div>
                      <div className="flex items-center gap-2">
                        {hasCustomRange && (
                          <button
                            type="button"
                            onClick={handleClear}
                            className={[
                              "sb-ring rounded-full px-4 py-2 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                            ].join(" ")}
                            style={{ color: "var(--sb-text)" }}
                          >
                            Clear
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleApply}
                          disabled={!range?.from || !range.to}
                          className={[
                            "rounded-full px-5 py-2 text-xs font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                          ].join(" ")}
                          style={{ backgroundColor: "var(--sb-accent)" }}
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  /* Desktop: Original popover layout */
                  <>
                    <div className="flex flex-row">
                      {/* Presets sidebar */}
                      <div
                        className="flex gap-1 border-r p-2 flex-col w-[120px]"
                        style={{ borderColor: "var(--sb-border)" }}
                      >
                        {PRESETS.map((p) => {
                          const isSel = selectedPreset === p.name;
                          return (
                            <button
                              key={p.name}
                              type="button"
                              onClick={() => applyPreset(p.name)}
                              className={[
                                "sb-ring flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition whitespace-nowrap",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                                isSel
                                  ? "text-black dark:text-black"
                                  : "hover:bg-black/5 dark:hover:bg-white/10",
                              ].join(" ")}
                              style={isSel ? { backgroundColor: "var(--sb-accent)" } : { color: "var(--sb-text)" }}
                            >
                              {isSel && <Check className="h-3 w-3" />}
                              <span>{p.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Calendar area */}
                      <div className="flex-1 p-2">
                        {/* Navigation row */}
                        <div className="flex items-center justify-between mb-2">
                          <button
                            type="button"
                            onClick={goToPrevMonth}
                            disabled={!canGoPrev}
                            className={[
                              "sb-ring grid h-7 w-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                            ].join(" ")}
                            style={{ color: "var(--sb-text)" }}
                            aria-label="Previous month"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
                            {displayMonth?.toLocaleString("en-US", { month: "long", year: "numeric" })}
                            {displayMonth && (
                              <> – {new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })}</>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={goToNextMonth}
                            disabled={!canGoNext}
                            className={[
                              "sb-ring grid h-7 w-7 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                            ].join(" ")}
                            style={{ color: "var(--sb-text)" }}
                            aria-label="Next month"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>

                        {/* DayPicker */}
                        <DayPicker
                          mode="range"
                          selected={range}
                          onSelect={(v) => {
                            if (!v?.from) return;
                            const from = clampToBounds(v.from);
                            const to = v.to ? clampToBounds(v.to) : undefined;
                            setRange({ from, to });
                          }}
                          disabled={[{ before: minDate }, { after: maxDate }]}
                          weekStartsOn={1}
                          showOutsideDays
                          numberOfMonths={2}
                          month={displayMonth}
                          onMonthChange={setDisplayMonth}
                          hideNavigation
                          classNames={{
                            months: "flex gap-4",
                            month: "flex flex-col gap-1",
                            month_caption: "hidden",
                            month_grid: "border-collapse",
                            weekdays: "flex",
                            weekday: "w-8 h-6 text-center text-[10px] font-medium opacity-50",
                            week: "flex",
                            day: "w-8 h-8 p-0 text-center",
                            day_button: [
                              "w-full h-full rounded-md text-[11px] font-medium cursor-pointer transition-colors",
                              "hover:bg-black/5 dark:hover:bg-white/10",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--sb-bg)]",
                            ].join(" "),
                            today: "ring-1 ring-inset ring-[color:var(--sb-accent)]",
                            selected: "!bg-[color:var(--sb-accent)] !text-black hover:!bg-[color:var(--sb-accent)]",
                            range_start: "!bg-[color:var(--sb-accent)] !text-black !rounded-r-none hover:!bg-[color:var(--sb-accent)]",
                            range_middle: "!bg-[color:var(--sb-accent)]/30 !rounded-none",
                            range_end: "!bg-[color:var(--sb-accent)] !text-black !rounded-l-none hover:!bg-[color:var(--sb-accent)]",
                            outside: "opacity-30",
                            disabled: "opacity-20 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent",
                            hidden: "invisible",
                          }}
                        />
                      </div>
                    </div>

                    {/* Footer with actions */}
                    <div className="flex items-center justify-between gap-2 border-t px-3 py-2" style={{ borderColor: "var(--sb-border)" }}>
                      <div className="text-[10px] font-medium" style={{ color: "var(--sb-muted)" }}>
                        {range?.from && range.to
                          ? `${formatDisplay(range.from)} → ${formatDisplay(range.to)}`
                          : "Select a date range"}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRange(openedRangeRef.current);
                            setIsOpen(false);
                          }}
                          className={[
                            "sb-ring rounded-md px-2.5 py-1.5 text-[10px] font-medium transition hover:bg-black/5 dark:hover:bg-white/10",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                          ].join(" ")}
                          style={{ color: "var(--sb-text)" }}
                        >
                          Cancel
                        </button>
                        {hasCustomRange && (
                          <button
                            type="button"
                            onClick={handleClear}
                            className={[
                              "sb-ring rounded-md px-2.5 py-1.5 text-[10px] font-medium transition hover:bg-black/5 dark:hover:bg-white/10",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                            ].join(" ")}
                            style={{ color: "var(--sb-text)" }}
                          >
                            Clear
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleApply}
                          disabled={!range?.from || !range.to}
                          className={[
                            "rounded-md px-2.5 py-1.5 text-[10px] font-medium text-black transition disabled:cursor-not-allowed disabled:opacity-50",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
                          ].join(" ")}
                          style={{ backgroundColor: "var(--sb-accent)" }}
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
});
