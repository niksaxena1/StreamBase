"use client";

import React from "react";
import { useIsDarkTheme } from "@/components/charts/useIsDarkTheme";

export function LineChart(props: {
  points: { xLabel: string; y: number | null }[];
  width?: number;
  height?: number;
  ariaLabel?: string;
}) {
  const isDark = useIsDarkTheme();

  const w = props.width ?? 760;
  const h = props.height ?? 220;
  const pad = 14;

  const vals = props.points
    .map((p) => (p.y === null ? null : Number(p.y)))
    .filter((v): v is number => v !== null && Number.isFinite(v));

  if (vals.length < 2) {
    return (
      <div
        className="sb-ring grid place-items-center rounded-[var(--sb-radius)] bg-white/60 px-3 py-6 text-xs"
        style={{ color: "var(--sb-muted)" }}
      >
        Not enough data for a chart yet.
      </div>
    );
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = Math.max(1, max - min);

  const usableW = w - pad * 2;
  const usableH = h - pad * 2;

  const normalized = props.points
    .map((p) => ({
      xLabel: p.xLabel,
      y: p.y === null ? null : Number(p.y),
    }))
    .filter((p) => p.y !== null && Number.isFinite(p.y)) as {
    xLabel: string;
    y: number;
  }[];

  const step = usableW / Math.max(1, normalized.length - 1);
  const pts = normalized.map((p, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (p.y - min) / range) * usableH;
    return { x, y, xLabel: p.xLabel, v: p.y };
  });

  const polyline = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

  // Area fill to baseline
  const area = `${polyline} ${pad + usableW},${pad + usableH} ${pad},${pad + usableH}`;

  const firstLabel = pts[0]?.xLabel ?? "";
  const lastLabel = pts[pts.length - 1]?.xLabel ?? "";

  return (
    <div className="sb-ring rounded-[var(--sb-radius)] bg-white/60 p-3">
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={props.ariaLabel ?? "Line chart"}
      >
        <defs>
          <pattern
            id="sbHatch"
            width="8"
            height="8"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(35)"
          >
            <line x1="0" y1="0" x2="0" y2="8" stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"} strokeWidth="2" />
          </pattern>
          <linearGradient id="sbArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(199,243,60,0.30)" />
            <stop offset="100%" stopColor="rgba(199,243,60,0.00)" />
          </linearGradient>
        </defs>

        {/* background hatch */}
        <rect x="0" y="0" width={w} height={h} rx="12" fill="url(#sbHatch)" opacity="0.6" />

        {/* area */}
        <polygon points={area} fill="url(#sbArea)" />

        {/* line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={isDark ? "rgba(255,255,255,0.78)" : "rgba(0,0,0,0.78)"}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* end dot */}
        {pts.length ? (
          <>
            <circle
              cx={pts[pts.length - 1].x}
              cy={pts[pts.length - 1].y}
              r="4"
              fill="var(--sb-positive)"
              stroke={isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.65)"}
              strokeWidth="1"
            />
          </>
        ) : null}
      </svg>

      <div className="mt-2 flex items-center justify-between text-[11px]" style={{ color: "var(--sb-muted)" }}>
        <span className="font-mono">{firstLabel}</span>
        <span className="font-mono">{lastLabel}</span>
      </div>
    </div>
  );
}

