"use client";

import { useState, useRef, useEffect } from "react";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";

const COLLECTORS = ["A", "K", "N", "PL", "TG", "NL"] as const;

export function CollectorMultiSelect({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (collectors: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        type="button"
        onClick={() => setIsOpen(!isOpen)}
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
            className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-black"
            style={{ backgroundColor: "var(--sb-accent)" }}
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
          className="absolute left-0 top-full z-50 mt-2 min-w-[160px] rounded-[var(--sb-radius)] border p-1 shadow-lg"
          style={{
            backgroundColor: "var(--sb-card)",
            borderColor: "var(--sb-border-2)",
            backdropFilter: "blur(var(--sb-blur))",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
          }}
        >
          <div className="border-b px-2 py-1.5" style={{ borderColor: "var(--sb-border-2)" }}>
            <div className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
              Filter by Collectors
            </div>
          </div>

          <button
            type="button"
            onClick={selectAll}
            className="flex w-full items-center gap-2 rounded-[calc(var(--sb-radius)-8px)] px-2 py-1.5 text-left text-xs transition"
            style={{ 
              color: "var(--sb-text)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--sb-accent)";
              e.currentTarget.style.color = "#000";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "var(--sb-text)";
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
                className="flex w-full items-center gap-2 rounded-[calc(var(--sb-radius)-8px)] px-2 py-1.5 text-left text-xs transition"
                style={{ 
                  color: isSelected ? "#000" : "var(--sb-text)",
                  backgroundColor: isSelected ? "var(--sb-accent)" : "transparent",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = "var(--sb-surface)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }
                }}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-sm border-2 transition`}
                  style={{
                    backgroundColor: isSelected ? color : "transparent",
                    borderColor: color,
                  }}
                >
                  {isSelected && (
                    <svg className="h-2.5 w-2.5 text-black" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </span>
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
