"use client";

import { useState, useRef, useEffect } from "react";

const GRANULARITIES = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

export type Granularity = (typeof GRANULARITIES)[number]["value"];

export function GranularitySelect({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (granularity: Granularity) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [buttonWidth, setButtonWidth] = useState<number | undefined>();

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

  const selectedLabel = GRANULARITIES.find((g) => g.value === value)?.label ?? "Daily";

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-[var(--sb-radius)] border px-2.5 py-1.5 text-[11px] font-medium transition"
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
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
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
          className="absolute left-0 top-full z-50 mt-2 rounded-[var(--sb-radius)] border p-1 shadow-lg"
          style={{
            width: buttonWidth,
            backgroundColor: "var(--sb-card)",
            borderColor: "var(--sb-border-2)",
            backdropFilter: "blur(var(--sb-blur))",
            WebkitBackdropFilter: "blur(var(--sb-blur))",
          }}
        >
          {GRANULARITIES.map((granularity) => {
            const isSelected = value === granularity.value;

            return (
              <button
                key={granularity.value}
                type="button"
                onClick={() => {
                  onChange(granularity.value);
                  setIsOpen(false);
                }}
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
                <span>{granularity.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
