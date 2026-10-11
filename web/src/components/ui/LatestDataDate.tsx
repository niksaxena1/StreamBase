"use client";

import { useId, useState } from "react";
import { pipelineUpdateTooltip } from "@/lib/pipelineUpdateTimes";

// The app's existing tooltip components are chart-payload tooltips, not focusable hints.
export function LatestDataDate({ date, datasetMode }: { date: string; datasetMode: "own" | "competitor" }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={id}
        className="rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2"
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => { if (event.key === "Escape") setDismissed(true); }}
      >
        Latest data date: <span className="font-mono">{date}</span>
      </span>
      <span
        id={id}
        role="tooltip"
        hidden={dismissed || !(hovered || focused)}
        className="absolute left-0 top-full z-50 w-72 max-w-[80vw] rounded-md border p-2 text-xs shadow-lg"
        style={{ background: "var(--sb-surface)", color: "var(--sb-text)", borderColor: "var(--sb-border)" }}
      >
        {pipelineUpdateTooltip(datasetMode)}
      </span>
    </span>
  );
}
