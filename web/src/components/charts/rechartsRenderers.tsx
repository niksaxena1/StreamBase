"use client";

import { isHighlightDayDateUtc } from "@/components/charts/chartUtils";

type DotProps = {
  cx?: unknown;
  cy?: unknown;
  payload?: unknown;
};

export function makeHighlightDayDotRenderers(opts: {
  baseColor: string;
  highlightColor: string;
  highlightWeekdayUtc?: unknown;
  enabled?: boolean;
  stroke?: string;
}) {
  const enabled = opts.enabled ?? true;
  const stroke = opts.stroke ?? "var(--sb-bg)";

  const dot = (props: any) => {
    const { cx, cy, payload } = (props ?? {}) as DotProps;
    const x = Number(cx);
    const y = Number(cy);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const date = String((payload as any)?.date ?? "");
    const isHighlight = enabled && date ? isHighlightDayDateUtc(date, opts.highlightWeekdayUtc) : false;
    const fill = isHighlight ? opts.highlightColor : opts.baseColor;
    const fillOpacity = isHighlight ? 0.78 : 1;

    return (
      <circle cx={x} cy={y} r={3} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={1.5} />
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

