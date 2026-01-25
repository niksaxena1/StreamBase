import React from "react";

export function Sparkline(props: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const w = props.width ?? 320;
  const h = props.height ?? 72;
  const vals = props.values.filter((v) => Number.isFinite(v));

  if (vals.length < 2) {
    return (
      <div
        className="sb-ring grid place-items-center rounded-[var(--sb-radius)] bg-white/60 px-3 py-4 text-xs"
        style={{ color: "var(--sb-muted)" }}
      >
        Not enough data
      </div>
    );
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1, max - min);

  const step = w / (vals.length - 1);
  const points = vals
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="block"
      role="img"
      aria-label="Sparkline"
    >
      <defs>
        <linearGradient id="sbSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(199,243,60,0.40)" />
          <stop offset="100%" stopColor="rgba(199,243,60,0.00)" />
        </linearGradient>
      </defs>

      {/* hatch background */}
      <rect
        x="0"
        y="0"
        width={w}
        height={h}
        rx="12"
        fill="transparent"
      />

      {/* area */}
      <polygon
        points={`${points} ${w},${h} 0,${h}`}
        fill="url(#sbSparkFill)"
        opacity="0.8"
      />

      {/* line */}
      <polyline
        points={points}
        fill="none"
        stroke="rgba(0,0,0,0.75)"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

