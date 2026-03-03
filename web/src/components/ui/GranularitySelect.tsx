"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shared chip-dropdown primitive
// ---------------------------------------------------------------------------

const chipActive =
  "bg-black text-white shadow-sm dark:bg-white dark:text-black";
const chipDefault =
  "text-black/70 dark:text-white/70";
const chipInactive =
  "text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10";

type ChipDropdownOption<V extends string | number> = {
  readonly value: V;
  readonly label: string;
};

function ChipDropdown<V extends string | number>({
  options,
  value,
  defaultValue,
  onChange,
  title,
  minWidth = "5rem",
  customOption,
  customActive = false,
}: {
  options: readonly ChipDropdownOption<V>[];
  value: V;
  defaultValue: V;
  onChange: (v: V) => void;
  title: string;
  minWidth?: string;
  /** If provided, appended at the bottom of the list as a special "Custom" row. */
  customOption?: { label: string; icon?: ReactNode; onSelect: () => void };
  /** When true, the chip shows the custom option label instead of the current value. */
  customActive?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [flipUp, setFlipUp] = useState(false);

  const totalItems = options.length + (customOption ? 1 : 0);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reset focus index when dropdown opens/closes; detect edge clipping
  useEffect(() => {
    if (isOpen) {
      const baseIdx = options.findIndex((o) => o.value === value);
      setFocusIdx(customActive && customOption ? options.length : baseIdx);
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const menuHeight = totalItems * 28 + 12;
        setFlipUp(rect.bottom + menuHeight + 8 > window.innerHeight);
      }
    } else {
      setFocusIdx(-1);
    }
  }, [isOpen, options, value, customActive, customOption, totalItems]);

  const select = useCallback(
    (v: V) => {
      onChange(v);
      setIsOpen(false);
    },
    [onChange],
  );

  const selectCustom = useCallback(() => {
    customOption?.onSelect();
    setIsOpen(false);
  }, [customOption]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        return;
      }

      if (!isOpen) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusIdx((i) => Math.min(i + 1, totalItems - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIdx((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusIdx >= 0 && focusIdx < options.length) {
            select(options[focusIdx].value);
          } else if (customOption && focusIdx === options.length) {
            selectCustom();
          }
          break;
      }
    },
    [isOpen, focusIdx, options, select, totalItems, customOption, selectCustom],
  );

  const selectedLabel = customActive
    ? (customOption?.label ?? "Custom")
    : (options.find((o) => o.value === value)?.label ?? String(value));
  const isDefaultVal = !customActive && value === defaultValue;

  return (
    <div
      className="relative"
      ref={containerRef}
      title={title}
      onKeyDown={handleKeyDown}
    >
      <div className="sb-ring inline-flex items-center gap-0 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={[
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
            isDefaultVal ? chipDefault : chipActive,
          ].join(" ")}
        >
          <span>{selectedLabel}</span>
          <svg
            className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div
          role="listbox"
          className={[
            "absolute left-0 z-50 rounded-xl border p-1 shadow-lg",
            flipUp ? "bottom-full mb-1.5" : "top-full mt-1.5",
          ].join(" ")}
          style={{
            minWidth,
            backgroundColor: "var(--sb-card)",
            borderColor: "var(--sb-border-2)",
            backdropFilter: "blur(var(--sb-blur))",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
          }}
        >
          {options.map((opt, idx) => {
            const isSelected = !customActive && value === opt.value;
            const isFocused = focusIdx === idx;

            return (
              <button
                key={String(opt.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => select(opt.value)}
                className={[
                  "flex w-full items-center rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition",
                  isSelected ? chipActive : chipInactive,
                  isFocused && !isSelected ? "ring-1 ring-inset ring-black/20 dark:ring-white/20" : "",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}

          {customOption && (
            <>
              <div className="mx-1 my-1 border-t" style={{ borderColor: "var(--sb-border-2)" }} />
              <button
                type="button"
                role="option"
                aria-selected={customActive}
                onClick={selectCustom}
                className={[
                  "flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition",
                  customActive ? chipActive : chipInactive,
                  focusIdx === options.length && !customActive ? "ring-1 ring-inset ring-black/20 dark:ring-white/20" : "",
                ].join(" ")}
              >
                {customOption.icon}
                {customOption.label}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Granularity select
// ---------------------------------------------------------------------------

const GRANULARITIES = [
  { value: "daily" as const, label: "Daily" },
  { value: "weekly" as const, label: "Weekly" },
  { value: "monthly" as const, label: "Monthly" },
  { value: "quarterly" as const, label: "Quarterly" },
  { value: "yearly" as const, label: "Yearly" },
];

export type Granularity = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export function GranularitySelect({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (granularity: Granularity) => void;
}) {
  return (
    <ChipDropdown
      options={GRANULARITIES}
      value={value}
      defaultValue="daily"
      onChange={onChange}
      title="Chart granularity"
      minWidth="7rem"
    />
  );
}

// ---------------------------------------------------------------------------
// Range select
// ---------------------------------------------------------------------------

const RANGES = [
  { value: 30 as const, label: "30d" },
  { value: 90 as const, label: "90d" },
  { value: 365 as const, label: "365d" },
];

export function RangeSelect({
  value,
  onChange,
  onCustom,
  customActive = false,
}: {
  value: number;
  onChange: (range: number) => void;
  /** When provided, a "Custom" option is appended that calls this instead of onChange. */
  onCustom?: () => void;
  /** When true, the chip shows "Custom" as the selected value. */
  customActive?: boolean;
}) {
  return (
    <ChipDropdown
      options={RANGES}
      value={value}
      defaultValue={30}
      onChange={onChange}
      title="Chart display range"
      minWidth="5rem"
      customOption={onCustom ? { label: "Custom", onSelect: onCustom } : undefined}
      customActive={customActive}
    />
  );
}

// ---------------------------------------------------------------------------
// Minimum range look-up for non-daily granularities.
// Used by pages to auto-expand the server-side data fetch so non-daily
// charts have enough data points.
// ---------------------------------------------------------------------------

const MIN_RANGE_BY_GRANULARITY: Record<Granularity, number> = {
  daily: 30,
  weekly: 90,
  monthly: 365,
  quarterly: 365,
  yearly: 365,
};

export function effectiveRangeDays(rangeDays: number, granularity: Granularity): number {
  return Math.max(rangeDays, MIN_RANGE_BY_GRANULARITY[granularity]);
}

// ---------------------------------------------------------------------------
// Granularity display label for chart titles.
// Replaces "Daily" with the appropriate period word.
// ---------------------------------------------------------------------------

const GRANULARITY_LABELS: Record<Granularity, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export function granularityLabel(g: Granularity): string {
  return GRANULARITY_LABELS[g];
}

// ---------------------------------------------------------------------------
// Range restore helper.
// When auto-expanding for non-daily, we save the user's original range so
// switching back to Daily can restore it.
// ---------------------------------------------------------------------------

const RANGE_STORE_PREFIX = "sb:pre-expand-range:";

export function handleGranularityWithRangeRestore(
  g: Granularity,
  currentRange: number,
  pageKey: string,
  setGranularity: (g: Granularity) => void,
  pushRange: (range: number) => void,
) {
  setGranularity(g);

  if (g === "daily") {
    try {
      const saved = sessionStorage.getItem(RANGE_STORE_PREFIX + pageKey);
      if (saved) {
        sessionStorage.removeItem(RANGE_STORE_PREFIX + pageKey);
        const restored = Number(saved);
        if (restored > 0 && restored !== currentRange) {
          pushRange(restored);
        }
      }
    } catch {}
  } else {
    const min = effectiveRangeDays(currentRange, g);
    if (min > currentRange) {
      try { sessionStorage.setItem(RANGE_STORE_PREFIX + pageKey, String(currentRange)); } catch {}
      pushRange(min);
    }
  }
}
