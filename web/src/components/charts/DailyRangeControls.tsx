"use client";

import { useEffect, useState } from "react";
import { usePhoneChart } from "./usePhoneChart";

type Range = "full" | "typical";
const sessionChoices = new Map<string | undefined, Range>();

export function resolveDailyRange(stored: string | null | undefined, phone: boolean, session?: Range): Range {
  return session ?? (stored === "full" || stored === "typical" ? stored : phone ? "typical" : "full");
}

export function useDailyRange(storageKey?: string) {
  const phone = usePhoneChart();
  const [choice, setChoice] = useState<{ key?: string; range?: Range }>({});
  useEffect(() => {
    let stored: string | null | undefined = sessionChoices.get(storageKey);
    try { if (storageKey) stored = localStorage.getItem(storageKey) ?? stored; } catch { /* Storage may be blocked. */ }
    setChoice({ key: storageKey, range: stored === "full" || stored === "typical" ? stored : undefined });
  }, [storageKey]);
  return {
    typical: resolveDailyRange(choice.key === storageKey ? choice.range : undefined, phone, sessionChoices.get(storageKey)) === "typical",
    setRange(range: Range) {
      setChoice({ key: storageKey, range });
      sessionChoices.set(storageKey, range);
      try { if (storageKey) localStorage.setItem(storageKey, range); } catch { /* Keep the choice in memory. */ }
    },
  };
}

export function DailyRangeToggle({ typical, setRange }: { typical: boolean; setRange: (range: Range) => void }) {
  return (
    <div
      role="group"
      aria-label="Daily streams chart range"
      className="flex shrink-0 rounded-md border text-xs"
      style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {(["full", "typical"] as const).map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={typical === (range === "typical")}
          onClick={() => setRange(range)}
          className="min-h-8 rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-1"
          style={{ color: "var(--sb-text)", opacity: typical === (range === "typical") ? 1 : 0.55 }}
        >
          {range === "full" ? "Full range" : "Typical range"}
        </button>
      ))}
    </div>
  );
}

export function CappedDailyPoint({ cx, cy, formattedValue, edge, color, index, count, showLabel }: {
  cx: number; cy: number; formattedValue: string; edge: "low" | "high"; color: string; index: number; count: number; showLabel: boolean;
}) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <g role="img" aria-label={`Clipped value: ${formattedValue}`}>
      <title>{`Actual value: ${formattedValue}`}</title>
      <path d={`M${cx - 4},${cy}H${cx + 4}M${cx},${cy}v${edge === "high" ? 5 : -5}`} stroke={color} strokeWidth={2} />
      {showLabel ? <text
        x={cx} y={cy + (edge === "high" ? 14 : -9)}
        textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
        fontSize={9} fill={color} stroke="var(--sb-surface)" strokeWidth={3} paintOrder="stroke"
      >
        {formattedValue}
      </text> : null}
    </g>
  );
}
