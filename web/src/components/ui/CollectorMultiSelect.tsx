"use client";

import { useState, useRef, useEffect } from "react";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";
import { useMetric } from "@/components/metrics/MetricContext";

const COLLECTORS = ["A", "K", "N", "PL", "TG", "NL"] as const;

export function CollectorMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (collectors: string[]) => void;
}) {
  const { metric } = useMetric();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [buttonWidth, setButtonWidth] = useState<number | undefined>();

  const accentBg =
    metric === "revenue"
      ? "#10b981"
      : metric === "tracks"
        ? "#3b82f6"
        : "var(--sb-accent)";
  const accentText = metric === "streams" ? "#000" : "#fff";

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Update button width when dropdown opens
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      setButtonWidth(buttonRef.current.offsetWidth);
    }
  }, [isOpen]);

  const toggleCollector = (collector: string) => {
    if (selected.includes(collector)) {
      onChange(selected.filter((c) => c !== collector));
    } else {
      onChange([...selected, collector]);
    }
  };

  const selectAll = () => {
    onChange([...COLLECTORS]);
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-[var(--sb-radius)] border px-2.5 py-1.5 text-[11px] font-medium transition hover:bg-[var(--sb-card)]"
        style={{
          backgroundColor: "var(--sb-surface)",
          borderColor: "var(--sb-border-2)",
          color: "var(--sb-text)",
        }}
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          style={{ color: "var(--sb-muted)" }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
          />
        </svg>
        <span>Collectors</span>
        {selected.length > 0 && (
          <span
            className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold"
            style={{ backgroundColor: accentBg, color: accentText }}
          >
            {selected.length}
          </span>
        )}
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
          className="absolute left-0 top-full z-50 mt-2 rounded-[var(--sb-radius)] border p-1 shadow-lg"
          style={{
            width: buttonWidth,
            backgroundColor: "var(--sb-card)",
            borderColor: "var(--sb-border-2)",
            backdropFilter: "blur(var(--sb-blur))",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
          }}
        >
          <button
            type="button"
            onClick={selectAll}
            className="flex w-full items-center gap-2 rounded-[calc(var(--sb-radius)-8px)] px-2 py-1.5 text-left text-xs transition hover:bg-[var(--sb-surface)]"
            style={{ 
              color: "var(--sb-text)",
            }}
          >
            Select All
          </button>

          <div className="my-1 border-t" style={{ borderColor: "var(--sb-border-2)" }} />

          {COLLECTORS.map((collector) => {
            const isSelected = selected.includes(collector);
            const color = COLLECTOR_COLORS[collector];

            return (
              <button
                key={collector}
                type="button"
                onClick={() => toggleCollector(collector)}
                className={`flex w-full items-center gap-2 rounded-[calc(var(--sb-radius)-8px)] px-2 py-1.5 text-left text-xs transition ${
                  !isSelected ? "hover:bg-[var(--sb-surface)]" : ""
                }`}
                style={{ 
                  color: isSelected ? accentText : "var(--sb-text)",
                  backgroundColor: isSelected ? accentBg : "transparent",
                }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span>{collector}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
