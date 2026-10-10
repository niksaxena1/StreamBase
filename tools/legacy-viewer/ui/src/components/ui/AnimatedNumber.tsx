import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, valueAt } from "../../lib/animation";

/**
 * Counts up to `value` (from 0 on first show, from the previous value afterwards).
 * Respects prefers-reduced-motion. `data-value` always holds the exact final value.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 650,
  className,
}: {
  value: number;
  format: (value: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(() =>
    prefersReducedMotion() || durationMs <= 0 ? value : 0,
  );
  const shown = useRef(display);
  useEffect(() => {
    const from = shown.current;
    if (from === value) return;
    if (prefersReducedMotion() || durationMs <= 0) {
      shown.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      shown.current = valueAt(from, value, t);
      setDisplay(shown.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs]);
  return (
    <span className={className} data-value={value}>
      {format(Math.round(display))}
    </span>
  );
}
