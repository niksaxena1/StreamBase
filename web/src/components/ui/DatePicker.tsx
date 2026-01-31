"use client";

import { useRouter } from "next/navigation";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DayPicker, type Matcher } from "react-day-picker";
import { createPortal } from "react-dom";

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((n) => Number(n));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Format as DD MMM YYYY (e.g., "31 Jan 2026")
function formatDisplay(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = date.toLocaleString("en-US", { month: "short" });
  const y = date.getFullYear();
  return `${d} ${m} ${y}`;
}

function DatePickerInner({
  value,
  min,
  max,
  label,
  path,
}: {
  value: string;
  min?: string;
  max?: string;
  label?: string;
  path: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const selected = useMemo(() => (value ? parseYmd(value) : undefined), [value]);
  const minDate = useMemo(() => (min ? parseYmd(min) : undefined), [min]);
  const maxDate = useMemo(() => (max ? parseYmd(max) : undefined), [max]);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [displayMonth, setDisplayMonth] = useState<Date | undefined>(undefined);
  const disabledDays: Matcher[] | undefined = useMemo(() => {
    const out: Matcher[] = [];
    if (minDate) out.push({ before: minDate });
    if (maxDate) out.push({ after: maxDate });
    return out.length ? out : undefined;
  }, [minDate, maxDate]);

  // Close on navigation (best-effort)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  // Set initial display month when opening
  useEffect(() => {
    if (isOpen && !displayMonth) {
      setDisplayMonth(selected ?? maxDate ?? new Date());
    }
  }, [isOpen, selected, maxDate, displayMonth]);

  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const el = buttonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = 280;
      const margin = 8;

      let left = rect.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

      const preferBelow = rect.bottom + 12 + 320 <= window.innerHeight;
      const top = preferBelow ? rect.bottom + 8 : Math.max(margin, rect.top - 8 - 320);

      setPopoverPos({ top, left });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen]);

  function handleSelect(d: Date | undefined) {
    if (!d) return;
    const newDate = formatYmd(d);

    const params = new URLSearchParams(window.location.search);
    params.set("date", newDate);
    router.push(`${path}?${params.toString()}`);
    setIsOpen(false);
  }

  // Navigation handlers
  function goToPrevMonth() {
    if (!displayMonth) return;
    const prev = new Date(displayMonth);
    prev.setMonth(prev.getMonth() - 1);
    if (!minDate || prev >= new Date(minDate.getFullYear(), minDate.getMonth(), 1)) {
      setDisplayMonth(prev);
    }
  }

  function goToNextMonth() {
    if (!displayMonth) return;
    const next = new Date(displayMonth);
    next.setMonth(next.getMonth() + 1);
    if (!maxDate || next <= new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1)) {
      setDisplayMonth(next);
    }
  }

  const canGoPrev = !minDate || (displayMonth && displayMonth > new Date(minDate.getFullYear(), minDate.getMonth(), 1));
  const canGoNext = !maxDate || (displayMonth && displayMonth < new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1));

  return (
    <div className="relative flex items-center gap-2">
      {label ? (
        <label className="text-sm font-medium" style={{ color: "var(--sb-muted)" }}>
          {label}:
        </label>
      ) : null}
      <button
        type="button"
        ref={buttonRef}
        onClick={() => {
          if (!isOpen) {
            setDisplayMonth(selected ?? maxDate ?? new Date());
          }
          setIsOpen((v) => !v);
        }}
        className="sb-ring flex items-center gap-2 rounded-2xl bg-white/70 px-3 py-2 text-sm outline-none transition hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
        style={{ color: "var(--sb-text)" }}
      >
        <Calendar className="h-4 w-4 opacity-60" />
        <span className="font-mono text-xs">{selected ? formatDisplay(selected) : value}</span>
      </button>

      {portalReady && isOpen && popoverPos
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-40"
                onMouseDown={() => setIsOpen(false)}
                onClick={() => setIsOpen(false)}
              />
              <div
                className="fixed z-50 w-[280px] sb-card shadow-lg overflow-hidden"
                style={{ top: popoverPos.top, left: popoverPos.left }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Navigation row */}
                <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--sb-border)" }}>
                  <button
                    type="button"
                    onClick={goToPrevMonth}
                    disabled={!canGoPrev}
                    className="sb-ring grid h-6 w-6 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ color: "var(--sb-text)" }}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
                    {displayMonth?.toLocaleString("en-US", { month: "long", year: "numeric" })}
                  </div>
                  <button
                    type="button"
                    onClick={goToNextMonth}
                    disabled={!canGoNext}
                    className="sb-ring grid h-6 w-6 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ color: "var(--sb-text)" }}
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                {/* Calendar */}
                <div className="p-2" style={{ color: "var(--sb-text)" }}>
                  <DayPicker
                    mode="single"
                    selected={selected}
                    onSelect={handleSelect}
                    disabled={disabledDays}
                    weekStartsOn={1}
                    showOutsideDays
                    month={displayMonth}
                    onMonthChange={setDisplayMonth}
                    hideNavigation
                    classNames={{
                      months: "flex",
                      month: "flex flex-col gap-1",
                      month_caption: "hidden",
                      month_grid: "border-collapse",
                      weekdays: "flex",
                      weekday: "w-8 h-6 text-center text-[10px] font-medium opacity-50",
                      week: "flex",
                      day: "w-8 h-8 p-0 text-center",
                      day_button: "w-full h-full rounded-md text-[11px] font-medium cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none",
                      today: "ring-1 ring-inset ring-[color:var(--sb-accent)]",
                      selected: "!bg-[color:var(--sb-accent)] !text-black hover:!bg-[color:var(--sb-accent)]",
                      outside: "opacity-30",
                      disabled: "opacity-20 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent",
                      hidden: "invisible",
                    }}
                  />
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

export function DatePicker({
  value,
  min,
  max,
  label,
  path,
}: {
  value: string;
  min?: string;
  max?: string;
  label?: string;
  path: string;
}) {
  return (
    <Suspense fallback={<div className="h-10 w-32 animate-pulse rounded-2xl bg-white/30 dark:bg-white/10" />}>
      <DatePickerInner value={value} min={min} max={max} label={label} path={path} />
    </Suspense>
  );
}
