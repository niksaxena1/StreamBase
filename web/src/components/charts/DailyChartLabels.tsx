"use client";

import { usePlotArea, useYAxisDomain } from "recharts";
import { AED_PER_USD, getCurrencyDisplay } from "@/lib/format";
import { createAxisTickFormatter, placeChartLabels, type ChartLabel } from "./chartUtils";

/** Numeric axis endpoints are ticks too: select one unit from the whole domain. */
export function UniformYAxisTick({ x, y, payload, money = false, isDark }: {
  x?: number | string; y?: number | string; payload?: { value?: number }; money?: boolean; isDark: boolean;
}) {
  const domain = useYAxisDomain();
  const aed = money && getCurrencyDisplay() === "AED";
  const formatter = createAxisTickFormatter((domain ?? []).map(Number), aed ? AED_PER_USD : 1);
  const number = formatter(Number(payload?.value ?? 0));
  const text = !money ? number : aed ? `AED ${number}` : number.startsWith("-") ? `-$${number.slice(1)}` : `$${number}`;
  return <text x={x} y={y} dy="0.32em" textAnchor="end" fontSize={10} fill={isDark ? "var(--sb-muted)" : "var(--sb-chart-label)"}>
    {text}
  </text>;
}

type LabelPoint = {
  date: string; value: number | null | undefined; ma7?: number | null;
  dip?: number | null; edge?: "low" | "high" | null; maEdge?: "low" | "high" | null;
  capLabel?: string; maCapLabel?: string;
  capColor?: string; maCapColor?: string; partial?: boolean;
};

export function DailyChartLabels({ points, phone, showDips, isDark }: {
  points: LabelPoint[]; phone: boolean; showDips: boolean; isDark: boolean;
}) {
  const plot = usePlotArea();
  const domain = useYAxisDomain()?.map(Number);
  if (!plot || !domain || domain.length !== 2 || domain[1] === domain[0]) return null;
  const candidates: (ChartLabel & { color?: string })[] = [];
  const add = (index: number, value: number, text: string, id: string, priority: number, offset: number, color?: string) => {
    const width = text.length * 6;
    const x = plot.x + (points.length === 1 ? plot.width / 2 : index * plot.width / (points.length - 1));
    const y = plot.y + (domain[1] - value) * plot.height / (domain[1] - domain[0]) + offset;
    candidates.push({ id, text, priority, color,
      x: Math.max(plot.x + width / 2, Math.min(plot.x + plot.width - width / 2, x)),
      y: Math.max(plot.y + 10, Math.min(plot.y + plot.height - 3, y)),
    });
  };
  points.forEach((point, index) => {
    if (typeof point.value === "number" && Number.isFinite(point.value)) {
      if (point.capLabel) add(index, point.value, point.capLabel, `cap-${index}`, Number.MAX_SAFE_INTEGER, point.edge === "high" ? 14 : -9, point.capColor);
      else if (showDips && point.dip != null && Number.isFinite(point.dip) && [0, 6].includes(new Date(`${point.date}T12:00:00Z`).getUTCDay())) {
        add(index, point.value, `${point.dip > 0 ? "+" : ""}${Math.round(point.dip)}%`, `dip-${index}`, point.dip, -10);
      }
    }
    if (point.maCapLabel && typeof point.ma7 === "number") add(index, point.ma7, point.maCapLabel, `ma-cap-${index}`, Number.MAX_SAFE_INTEGER - 1, point.maEdge === "high" ? 14 : -9, point.maCapColor);
    if (point.partial) add(index, domain[1], "partial", `partial-${index}`, Number.MAX_SAFE_INTEGER - 2, 10);
  });
  // Cap annotations reserve room for outlier values; percentages compete by magnitude.
  const caps = candidates.filter(label => !label.id.startsWith("dip-"));
  const dips = candidates.filter(label => label.id.startsWith("dip-")).sort((a, b) => Math.abs(b.priority) - Math.abs(a.priority)).slice(0, phone ? 4 : undefined);
  return <g style={{ pointerEvents: "none", userSelect: "none" }}>
    {placeChartLabels([...caps, ...dips], phone ? 4 : Infinity).map(label => <text key={label.id} x={label.x} y={label.y}
      textAnchor="middle" fontSize={9} fontWeight={500}
      fill={isDark ? label.color ?? "var(--sb-muted)" : "var(--sb-chart-label)"}
      fillOpacity={isDark ? label.id.startsWith("dip-") ? 0.75 : label.id.startsWith("partial-") ? 0.7 : 1 : 1}
      stroke="var(--sb-surface)" strokeWidth={3} paintOrder="stroke">{label.text}</text>)}
  </g>;
}
