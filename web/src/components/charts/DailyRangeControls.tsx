"use client";

import { useEffect, useState } from "react";
import { formatClippedDailyValue } from "./dailyRange";

type Range = "full" | "typical";

export function useDailyRange(storageKey?: string) {
  const [choice, setChoice] = useState<{ key?: string; range: Range }>({ range: "full" });
  useEffect(() => {
    let range: Range = "full";
    try { if (storageKey && localStorage.getItem(storageKey) === "typical") range = "typical"; } catch { /* Storage may be blocked. */ }
    setChoice({ key: storageKey, range });
  }, [storageKey]);
  return {
    typical: Boolean(storageKey && choice.key === storageKey && choice.range === "typical"),
    setRange(range: Range) {
      setChoice({ key: storageKey, range });
      try { if (storageKey) localStorage.setItem(storageKey, range); } catch { /* Keep the choice in memory. */ }
    },
  };
}

export function DailyRangeToggle({ typical, setRange }: { typical: boolean; setRange: (range: Range) => void }) {
  return (
    <div
      role="group"
      aria-label="Daily streams chart range"
      className="absolute right-0 top-0 z-10 flex rounded-md border text-[10px]"
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
          className="rounded-md px-1.5 py-0.5 focus-visible:outline focus-visible:outline-1"
          style={{ color: "var(--sb-text)", opacity: typical === (range === "typical") ? 1 : 0.55 }}
        >
          {range === "full" ? "Full range" : "Typical range"}
        </button>
      ))}
    </div>
  );
}

export function CappedDailyPoint({ cx, cy, value, edge, color, index, count }: {
  cx: number; cy: number; value: number; edge: "low" | "high"; color: string; index: number; count: number;
}) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return (
    <g role="img" aria-label={`Clipped daily streams: ${value}`}>
      <title>{`Actual daily streams: ${value}`}</title>
      <path d={`M${cx - 4},${cy}H${cx + 4}M${cx},${cy}v${edge === "high" ? 5 : -5}`} stroke={color} strokeWidth={2} />
      <text
        x={cx} y={cy + (edge === "high" ? 14 : -9)}
        textAnchor={index === 0 ? "start" : index === count - 1 ? "end" : "middle"}
        fontSize={9} fill={color} stroke="var(--sb-surface)" strokeWidth={3} paintOrder="stroke"
      >
        {formatClippedDailyValue(value)}
      </text>
    </g>
  );
}
