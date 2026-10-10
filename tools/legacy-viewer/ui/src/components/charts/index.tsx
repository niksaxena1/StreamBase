import { Num } from "../ui/Num";
import {
  Bar as RBar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie as RPie,
  PieChart as RPieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DAY_MS,
  compactNumber,
  dateKey,
  formatUtcDate,
  fullNumber,
  tooltipNumber,
  utcDate,
  weekStart,
} from "../../lib/format";
import { ChartFrame, type ChartProps } from "./ChartFrame";
import { histogramBins } from "./data";
import { useThemeColors } from "./useThemeColors";
export { TimeSeriesChart } from "./TimeSeriesChart";
export { MonthlyBars } from "./MonthlyBars";
export { Sparkline } from "./Sparkline";
export { ChartFrame } from "./ChartFrame";
export type { ChartProps } from "./ChartFrame";
export type RankingPoint = { name: string; value: number | null };
export function BarChart({
  data,
  horizontal = false,
  height = 280,
  ...frame
}: ChartProps & { data: RankingPoint[]; horizontal?: boolean }) {
  const { ref, colors } = useThemeColors();
  const axis = {
    tick: { fill: colors.muted, fontFamily: "Geist Mono", fontSize: 11 },
    axisLine: false,
    tickLine: false,
  };
  return (
    <ChartFrame
      {...frame}
      data-testid={frame["data-testid"] ?? "bar-chart"}
      rows={data}
      empty={!data.some((row) => row.value != null)}
      captureRef={ref}
    >
      <div style={{ height, width: "100%" }}>
        <ResponsiveContainer>
          <RBarChart
            data={data}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 12, right: 28, left: 12, bottom: 8 }}
            accessibilityLayer
          >
            <CartesianGrid
              stroke={colors.border}
              strokeDasharray="3 3"
              vertical={horizontal}
              horizontal={!horizontal}
            />
            <XAxis
              {...axis}
              type={horizontal ? "number" : "category"}
              dataKey={horizontal ? undefined : "name"}
              tickFormatter={horizontal ? compactNumber : undefined}
            />
            <YAxis
              {...axis}
              type={horizontal ? "category" : "number"}
              dataKey={horizontal ? "name" : undefined}
              tickFormatter={!horizontal ? compactNumber : undefined}
              width={horizontal ? 110 : 60}
            />
            <RTooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as RankingPoint | undefined;
                return active && row ? (
                  <div className="chart-tooltip">
                    <strong>{row.name}</strong>
                    <p className="mono">{tooltipNumber(row.value)}</p>
                  </div>
                ) : null;
              }}
            />
            <RBar
              dataKey="value"
              name="Value"
              fill={colors.positive}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
            />
          </RBarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
export function BarGauge({
  data,
  topN = 10,
  ...frame
}: ChartProps & { data: RankingPoint[]; topN?: number }) {
  const { ref, colors } = useThemeColors();
  const rows = [...data]
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
    .slice(0, Math.max(0, topN));
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value ?? 0)));
  return (
    <ChartFrame
      {...frame}
      data-testid={frame["data-testid"] ?? "bar-gauge"}
      rows={rows}
      empty={!rows.length}
      captureRef={ref}
    >
      <div className="bar-gauges">
        {rows.map((row) => (
          <div key={row.name}>
            <div className="row spread">
              <span>{row.name}</span>
              <span className="mono"><Num value={row.value} /></span>
            </div>
            <div
              className={`gauge-track ${row.value === null ? "missing" : ""}`}
              role="img"
              aria-label={`${row.name}: ${row.value === null ? "missing" : fullNumber(row.value)}`}
            >
              <div
                style={{
                  width: `${(Math.abs(row.value ?? 0) / max) * 100}%`,
                  background:
                    row.value != null && row.value < 0
                      ? colors.error
                      : colors.positive,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}
export function StatPanel({
  value,
  sublabel,
  ...frame
}: ChartProps & { value: number | null; sublabel?: string }) {
  const { ref } = useThemeColors();
  return (
    <ChartFrame
      {...frame}
      data-testid={frame["data-testid"] ?? "stat-panel"}
      rows={[{ label: frame.title, value }]}
      captureRef={ref}
    >
      <div className="stat-panel">
        <div className="mono"><Num value={value} /></div>
        {sublabel && <p className="muted">{sublabel}</p>}
      </div>
    </ChartFrame>
  );
}
export function PieChart({
  data,
  height = 280,
  ...frame
}: ChartProps & { data: RankingPoint[] }) {
  const { ref, colors } = useThemeColors(),
    palette = [
      colors.positive,
      colors.tracks,
      colors.revenue,
      colors.info,
      colors.warning,
    ];
  const values = data.filter(
    (row): row is { name: string; value: number } =>
      row.value !== null && row.value > 0,
  );
  return (
    <ChartFrame
      {...frame}
      data-testid={frame["data-testid"] ?? "pie-chart"}
      rows={data}
      empty={!values.length}
      captureRef={ref}
    >
      <div style={{ height, width: "100%" }}>
        <ResponsiveContainer>
          <RPieChart accessibilityLayer>
            <RPie
              data={values}
              dataKey="value"
              nameKey="name"
              innerRadius="50%"
              outerRadius="76%"
              paddingAngle={3}
              isAnimationActive={false}
            >
              {values.map((row, i) => (
                <Cell
                  key={row.name}
                  fill={palette[i % palette.length]}
                  stroke={colors.card}
                />
              ))}
            </RPie>
            <RTooltip
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="chart-tooltip">
                    <strong>{String(payload[0].name)}</strong>
                    <p className="mono">
                      {tooltipNumber(Number(payload[0].value))}
                    </p>
                  </div>
                ) : null
              }
            />
            <Legend wrapperStyle={{ color: colors.text, fontSize: 12 }} />
          </RPieChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
export function Histogram({
  values,
  bins = 10,
  ...frame
}: ChartProps & { values: number[]; bins?: number }) {
  return (
    <BarChart
      {...frame}
      data-testid={frame["data-testid"] ?? "histogram"}
      data={histogramBins(values, bins)}
    />
  );
}
export function CalendarHeatmap({
  data,
  bounds,
  ...frame
}: ChartProps & {
  data: { date: string; value: number | null }[];
  bounds?: { from: string; to: string };
}) {
  const { ref, colors } = useThemeColors();
  const sorted = data
    .map((row) => ({ ...row, date: dateKey(row.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = bounds?.from ?? sorted[0]?.date,
    last = bounds?.to ?? sorted[sorted.length - 1]?.date;
  const map = new Map(sorted.map((row) => [row.date, row.value])),
    days: { date: string; value: number | null }[] = [];
  if (first && last)
    for (
      let stamp = utcDate(first).getTime();
      stamp <= utcDate(last).getTime();
      stamp += DAY_MS
    ) {
      const date = dateKey(new Date(stamp).toISOString());
      days.push({ date, value: map.get(date) ?? null });
    }
  const max = Math.max(1, ...days.map((row) => row.value ?? 0)),
    padding = first
      ? Math.round(
          (utcDate(first).getTime() - utcDate(weekStart(first)).getTime()) /
            DAY_MS,
        )
      : 0;
  return (
    <ChartFrame
      {...frame}
      data-testid={frame["data-testid"] ?? "calendar-heatmap"}
      rows={days}
      empty={!days.length}
      captureRef={ref}
    >
      <div className="heatmap-scroll">
        <div
          className="heatmap"
          style={{
            gridTemplateColumns: `repeat(${Math.ceil((days.length + padding) / 7)}, 22px)`,
          }}
        >
          {Array.from({ length: padding }, (_, i) => (
            <span key={`pad-${i}`} />
          ))}
          {days.map((row) => (
            <button
              type="button"
              key={row.date}
              aria-label={`${formatUtcDate(row.date)}: ${row.value === null ? "missing" : fullNumber(row.value)}`}
              title={`${formatUtcDate(row.date)} · ${row.value === null ? "Missing" : fullNumber(row.value)}`}
              className={row.value === null ? "missing" : "covered"}
              style={
                row.value === null
                  ? undefined
                  : {
                      background: `color-mix(in srgb, ${colors.positive} ${15 + (Math.max(0, row.value) / max) * 85}%, var(--sb-card))`,
                    }
              }
            />
          ))}
        </div>
      </div>
      <div className="row small heatmap-legend">
        <span className="heatmap-key missing" /> Missing{" "}
        <span className="heatmap-key zero" /> Zero{" "}
        <span className="heatmap-key covered" /> Observed
      </div>
    </ChartFrame>
  );
}
