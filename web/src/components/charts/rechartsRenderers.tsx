"use client";

import { isHighlightDayDateUtc } from "@/components/charts/chartUtils";

type DotProps = {
  cx?: unknown;
  cy?: unknown;
  payload?: unknown;
};

function isWeekendDate(dateString: string): boolean {
  if (!dateString) return false;
  const d = new Date(dateString + "T12:00:00Z");
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6; // Sunday or Saturday
}

export function makeHighlightDayDotRenderers(opts: {
  baseColor: string;
  highlightColor: string;
  highlightWeekdayUtc?: unknown;
  enabled?: boolean;
  stroke?: string;
  /** When true, render a tiny dip % label above weekend dots. */
  showWeekendDipLabels?: boolean;
}) {
  const enabled = opts.enabled ?? true;
  const stroke = opts.stroke ?? "var(--sb-bg)";
  const showDipLabels = opts.showWeekendDipLabels ?? false;

  const dot = (props: any) => {
    const { cx, cy, payload } = (props ?? {}) as DotProps;
    const x = Number(cx);
    const y = Number(cy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const date = String((payload as any)?.date ?? "");
    const isHighlight = enabled && date ? isHighlightDayDateUtc(date, opts.highlightWeekdayUtc) : false;
    const fill = isHighlight ? opts.highlightColor : opts.baseColor;
    const fillOpacity = isHighlight ? 0.78 : 1;

    // Weekend dip label
    const dipPct = (payload as any)?._weekendDipPct as number | null | undefined;
    const shouldShowLabel = showDipLabels && dipPct != null && Number.isFinite(dipPct) && isWeekendDate(date);

    if (!shouldShowLabel) {
      return (
        <circle cx={x} cy={y} r={3} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={1.5} />
      );
    }

    const label = `${dipPct! > 0 ? "+" : ""}${Math.round(dipPct!)}%`;

    return (
      <g>
        <circle cx={x} cy={y} r={3} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={1.5} />
        <text
          x={x}
          y={y - 10}
          textAnchor="middle"
          fontSize={8}
          fill="var(--sb-muted)"
          fillOpacity={0.75}
          fontWeight={500}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {label}
        </text>
      </g>
    );
  };

  const activeDot = (props: any) => {
    const { cx, cy, payload } = (props ?? {}) as DotProps;
    const x = Number(cx);
    const y = Number(cy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const date = String((payload as any)?.date ?? "");
    const isHighlight = enabled && date ? isHighlightDayDateUtc(date, opts.highlightWeekdayUtc) : false;
    const fill = isHighlight ? opts.highlightColor : opts.baseColor;
    const fillOpacity = isHighlight ? 0.85 : 1;

    return (
      <circle cx={x} cy={y} r={4} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={1.5} />
    );
  };

  return { dot, activeDot };
}

