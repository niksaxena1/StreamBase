import { useId } from "react";
import { sparklinePath } from "../../lib/sparkline";

/** Tiny trend line (StreamBase Sparkline pattern): gaps stay gaps, never zero. */
export function Sparkline({
  values,
  label,
  width = 132,
  height = 36,
}: {
  values: (number | null)[];
  label: string;
  width?: number;
  height?: number;
}) {
  const gradient = useId();
  const { line, area } = sparklinePath(values, width, height, 2);
  if (!line)
    return (
      <span className="muted small" role="img" aria-label={`${label}: no readings`}>
        no data
      </span>
    );
  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--sb-accent-stroke)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--sb-accent-stroke)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {area && <path d={area} fill={`url(#${gradient})`} stroke="none" />}
      <path
        d={line}
        fill="none"
        stroke="var(--sb-accent-stroke)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
