"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type TrackSort =
  | "delta_desc"
  | "delta_asc"
  | "total_desc"
  | "total_asc"
  | "name_asc"
  | "name_desc";

const SORTS: Array<{ value: TrackSort; label: string }> = [
  { value: "delta_desc", label: "Δ1d ↓" },
  { value: "delta_asc", label: "Δ1d ↑" },
  { value: "total_desc", label: "Total ↓" },
  { value: "total_asc", label: "Total ↑" },
  { value: "name_asc", label: "Name ↑" },
  { value: "name_desc", label: "Name ↓" },
];

export function TrackSortSelect({
  value,
  onChange,
}: {
  value: TrackSort;
  onChange: (v: TrackSort) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const selectedLabel = useMemo(
    () => SORTS.find((s) => s.value === value)?.label ?? "Δ1d ↓",
    [value],
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center gap-2 rounded-[var(--sb-radius)] border px-3 py-1.5 text-[11px] font-medium transition"
        style={{
          backgroundColor: "var(--sb-surface)",
          borderColor: "var(--sb-border-2)",
          color: "var(--sb-text)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = isOpen ? "var(--sb-surface)" : "var(--sb-card)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "var(--sb-surface)";
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{selectedLabel}</span>
        <svg
          className={`h-3 w-3 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ color: "var(--sb-muted)" }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-2 min-w-[140px] rounded-[var(--sb-radius)] border p-1 shadow-lg"
          style={{
            backgroundColor: "var(--sb-card)",
            borderColor: "var(--sb-border-2)",
            backdropFilter: "blur(var(--sb-blur))",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
          }}
          role="listbox"
        >
          {SORTS.map((s) => {
            const isSelected = s.value === value;
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => {
                  onChange(s.value);
                  setIsOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-[calc(var(--sb-radius)-8px)] px-2 py-1.5 text-left text-xs transition"
                style={{
                  color: isSelected ? "#000" : "var(--sb-text)",
                  backgroundColor: isSelected ? "var(--sb-accent)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = "var(--sb-surface)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
                }}
                role="option"
                aria-selected={isSelected}
              >
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

