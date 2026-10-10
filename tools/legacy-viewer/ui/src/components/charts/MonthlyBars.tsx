import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compactNumber, monthLabel, tooltipNumber } from "../../lib/format";
import type { MonthBar } from "../../lib/lookup";
import { useThemeColors } from "./useThemeColors";

/**
 * Streams per month as bars. Months with reading notes (partial, substituted, reset, gap) are
 * drawn in amber; months overlapping the calculator's dates carry an outline. Clicking a bar
 * does what the table row does; the table is the keyboard path.
 */
export function MonthlyBars({
  bars,
  onSelect,
  height = 150,
}: {
  bars: MonthBar[];
  onSelect: (month: string) => void;
  height?: number;
}) {
  const { ref, colors } = useThemeColors();
  const data = bars.map((bar) => ({
    ...bar,
    short: monthLabel(bar.month).replace(/ \d{2}(\d{2})$/, " ’$1"),
  }));
  return (
    <div
      ref={ref}
      className="monthly-bars"
      data-testid="monthly-bars"
      role="group"
      aria-label="Streams per month chart. Click a bar to compare that month; the Streams per month table is the keyboard alternative."
    >
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <CartesianGrid
              stroke={colors.border}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="short"
              tick={{ fill: colors.muted, fontSize: 10, fontFamily: "Geist Mono" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={18}
            />
            <YAxis
              tickFormatter={compactNumber}
              tick={{ fill: colors.muted, fontSize: 10, fontFamily: "Geist Mono" }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <ReferenceLine y={0} stroke={colors.border} />
            <Tooltip
              cursor={{ fill: colors.text, fillOpacity: 0.06 }}
              content={({ active, payload }) => {
                const bar = active ? (payload?.[0]?.payload as MonthBar | undefined) : undefined;
                if (!bar) return null;
                return (
                  <div className="chart-tooltip">
                    <strong>{bar.label}</strong>
                    <div className="row spread">
                      <span>Streams in month</span>
                      <span className="mono">{tooltipNumber(bar.value)}</span>
                    </div>
                    {bar.flags.map((flag) => (
                      <p key={flag} className="chart-flag-line">
                        {flag}
                      </p>
                    ))}
                    <p className="muted small">Click to compare this month</p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="value"
              isAnimationActive={false}
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
              cursor="pointer"
              onClick={(entry) => {
                const month = (entry as unknown as { payload?: MonthBar }).payload?.month;
                if (month) onSelect(month);
              }}
            >
              {data.map((bar) => (
                <Cell
                  key={bar.month}
                  fill={bar.flagged ? colors.warning : colors.accent}
                  fillOpacity={bar.selected ? 1 : 0.55}
                  stroke={bar.selected ? colors.text : "none"}
                  strokeWidth={bar.selected ? 1.5 : 0}
                  data-flagged={bar.flagged || undefined}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="muted small monthly-bars-key">
        <span className="swatch" aria-hidden="true" style={{ background: colors.accent }} /> month
        <span className="swatch warn" aria-hidden="true" style={{ background: colors.warning }} /> has reading
        notes (partial, substituted, reset or gap) · outlined = inside the chosen dates
      </p>
    </div>
  );
}
