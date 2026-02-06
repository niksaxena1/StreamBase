"use client";

import { History, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import { DayPicker, type Matcher } from "react-day-picker";
import { createPortal } from "react-dom";

import { useRollback } from "@/components/rollback/RollbackContext";

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplay(date: Date): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = date.toLocaleString("en-US", { month: "short" });
  const y = date.getFullYear();
  return `${d} ${m} ${y}`;
}

export function RollbackButton() {
  const { rollbackDate, setRollbackDate, isActive } = useRollback();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [displayMonth, setDisplayMonth] = useState<Date | undefined>(undefined);

  const selected = useMemo(
    () => (rollbackDate ? parseYmd(rollbackDate) : undefined),
    [rollbackDate],
  );

  const today = useMemo(() => new Date(), []);
  const maxDate = today;
  const disabledDays: Matcher[] = useMemo(() => [{ after: maxDate }], [maxDate]);

  // Escape closes popover
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Position popover relative to button
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

      const preferBelow = rect.bottom + 12 + 400 <= window.innerHeight;
      const top = preferBelow ? rect.bottom + 8 : Math.max(margin, rect.top - 8 - 400);

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
    setRollbackDate(formatYmd(d));
    setIsOpen(false);
  }

  function handleClear() {
    setRollbackDate(null);
    setIsOpen(false);
  }

  // Navigation handlers
  const canGoNext =
    !displayMonth ||
    displayMonth < new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);

  function goToPrevMonth() {
    if (!displayMonth) return;
    const prev = new Date(displayMonth);
    prev.setMonth(prev.getMonth() - 1);
    setDisplayMonth(prev);
  }

  function goToNextMonth() {
    if (!displayMonth || !canGoNext) return;
    const next = new Date(displayMonth);
    next.setMonth(next.getMonth() + 1);
    setDisplayMonth(next);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!isOpen) {
            setDisplayMonth(selected ?? today);
          }
          setIsOpen((v) => !v);
        }}
        className={[
          "sb-ring inline-flex items-center justify-center rounded-full transition h-8",
          isActive
            ? "gap-1.5 px-2.5 bg-[var(--sb-positive)]/10"
            : "w-8 bg-transparent text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10",
        ].join(" ")}
        style={isActive ? { color: "var(--sb-positive)" } : undefined}
        aria-label={
          isActive
            ? `Rollback active: viewing data as of ${rollbackDate}. Click to change.`
            : "Time rollback: view historical data"
        }
        title={
          isActive
            ? `Rollback: ${rollbackDate} (click to change)`
            : "Time rollback"
        }
      >
        <span className="inline-flex" suppressHydrationWarning>
          <History className="h-4 w-4" />
        </span>
        {isActive && rollbackDate ? (
          <span
            className="font-mono text-[11px] font-medium hidden sm:inline"
            suppressHydrationWarning
          >
            {formatDisplay(parseYmd(rollbackDate))}
          </span>
        ) : null}
      </button>

      {isOpen && popoverPos
        ? createPortal(
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onMouseDown={() => setIsOpen(false)}
                onClick={() => setIsOpen(false)}
              />
              {/* Popover */}
              <div
                className="fixed z-50 w-[280px] sb-card shadow-lg overflow-hidden"
                style={{ top: popoverPos.top, left: popoverPos.left }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div
                  className="flex items-center justify-between px-3 py-2 border-b"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--sb-text)" }}
                  >
                    Time Rollback
                  </span>
                  {isActive ? (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="sb-ring flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition hover:bg-black/5 dark:hover:bg-white/10"
                      style={{ color: "var(--sb-positive)" }}
                    >
                      <X className="h-3 w-3" />
                      Return to live
                    </button>
                  ) : (
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--sb-muted)" }}
                    >
                      Select a date
                    </span>
                  )}
                </div>

                {/* Month navigation */}
                <div
                  className="flex items-center justify-between px-3 py-2 border-b"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <button
                    type="button"
                    onClick={goToPrevMonth}
                    className="sb-ring grid h-6 w-6 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: "var(--sb-text)" }}
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div
                    className="text-xs font-medium"
                    style={{ color: "var(--sb-text)" }}
                  >
                    {displayMonth?.toLocaleString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
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
                      weekday:
                        "w-8 h-6 text-center text-[10px] font-medium opacity-50",
                      week: "flex",
                      day: "w-8 h-8 p-0 text-center",
                      day_button:
                        "w-full h-full rounded-md text-[11px] font-medium cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/10 focus:outline-none",
                      today:
                        "ring-1 ring-inset ring-[color:var(--sb-accent)]",
                      selected:
                        "!bg-[color:var(--sb-positive)] !text-white dark:!text-black hover:!bg-[color:var(--sb-positive)]",
                      outside: "opacity-30",
                      disabled:
                        "opacity-20 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent",
                      hidden: "invisible",
                    }}
                  />
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
