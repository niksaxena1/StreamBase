import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  Brush,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  compactNumber,
  dateKey,
  formatUtcDate,
  tooltipNumber,
  utcDate,
} from "../../lib/format";
import { useWeekendShading } from "../../lib/prefs";
import { ChartFrame, type ChartProps } from "./ChartFrame";
import {
  MAX_WEEKEND_POINTS,
  prepareTimeSeries,
  weekendBands,
  zoomWindow,
  type ChartMarker,
  type Gap,
  type PreparedPoint,
  type Series,
  type TimePoint,
  type ZoomMode,
} from "./data";
import { useThemeColors } from "./useThemeColors";
export type EventMarker = {
  date: string;
  text: string;
  value?: number;
  seriesKey?: string;
};
export function DailySeriesTooltip({
  active,
  label,
  points,
  series,
  extras,
  events,
  markers,
  lines,
}: {
  active?: boolean;
  label?: number | string;
  points: PreparedPoint[];
  series: Series[];
  extras?: { key: string; label: string }[];
  events?: EventMarker[];
  markers?: ChartMarker[];
  lines?: { date: string; text: string }[];
}) {
  if (!active || label == null) return null;
  const point = points.find((point) => point.timestamp === Number(label));
  if (!point) return null;
  return (
    <div className="chart-tooltip">
      <strong className="mono">{formatUtcDate(point.date)}</strong>
      {series.map((item) => (
        <div className="row spread" key={item.key}>
          <span>{item.label}</span>
          <span className="mono">
            {typeof point[item.key] === "number"
              ? tooltipNumber(point[item.key] as number, 2)
              : "Missing"}
          </span>
        </div>
      ))}
      {extras?.map((item) => (
        <div className="row spread" key={item.key}>
          <span>{item.label}</span>
          <span className="mono">
            {point[item.key] == null
              ? "—"
              : typeof point[item.key] === "number"
                ? tooltipNumber(point[item.key] as number, 3)
                : String(point[item.key])}
          </span>
        </div>
      ))}
      {events?.map((event) => (
        <p className="negative" key={event.text}>
          {event.text}
        </p>
      ))}
      {lines?.map((line) => (
        <p className="negative" key={line.text}>
          {line.text}
        </p>
      ))}
      {markers?.flatMap((marker) =>
        marker.text.map((line) => (
          <p className="chart-flag-line" key={`${marker.date}${line}`}>
            {line}
          </p>
        )),
      )}
    </div>
  );
}
const ZOOM_LABEL: Record<ZoomMode, string> = {
  all: "All",
  "1y": "1y",
  "90d": "90d",
  "30d": "30d",
  selection: "Selection",
};
const FLAG_HEIGHT = 16;
const flagWidth = (label: string) => Math.round(10 + label.length * 6.4);
export function TimeSeriesChart({
  data,
  series,
  gaps,
  shadeGaps = true,
  events = [],
  markers = [],
  lines = [],
  extraFields,
  brush = false,
  stepDays = 1,
  height = 280,
  selection,
  weekends = true,
  zoomControls = true,
  actions,
  ...frame
}: ChartProps & {
  data: TimePoint[];
  series: Series[];
  gaps?: Gap[];
  shadeGaps?: boolean;
  events?: EventMarker[];
  /** Labelled flags (milestones) drawn above the plot with a stem to the curve. */
  markers?: ChartMarker[];
  /** Dashed vertical lines at a day (e.g. the counter switched to another Spotify release). */
  lines?: { date: string; text: string }[];
  extraFields?: { key: string; label: string }[];
  brush?: boolean;
  stepDays?: number;
  /** Offer the Weekends toggle (daily charts only). On by default, remembered per viewer. */
  weekends?: boolean;
  /** Offer the Zoom buttons (view only; never changes the lookup calculator). */
  zoomControls?: boolean;
  selection?: {
    from: string;
    to: string;
    points: { day: string; value: number; label: string }[];
    onPoint: (day: string) => void;
    onRange: (from: string, to: string) => void;
  };
}) {
  const dragStart = useRef<string | null>(null);
  const { ref, colors } = useThemeColors();
  const [flagTip, setFlagTip] = useState<{
    x: number;
    y: number;
    lines: string[];
  } | null>(null);
  const [zoom, setZoom] = useState<ZoomMode>("all");
  const [plotWidth, setPlotWidth] = useState(800);
  const [showWeekends, setShowWeekends] = useWeekendShading();
  const prepared = useMemo(
    () => prepareTimeSeries(data, series, gaps, stepDays),
    [data, series, gaps, stepDays],
  );
  const zoomed = useMemo(
    () => zoomWindow(prepared.points, zoom, selection),
    [prepared.points, zoom, selection],
  );
  const visible = useMemo(
    () =>
      zoomed
        ? prepared.points.filter(
            (p) => p.timestamp >= zoomed.from && p.timestamp <= zoomed.to,
          )
        : prepared.points,
    [prepared.points, zoomed],
  );
  const bands = useMemo(
    () =>
      weekends && showWeekends && visible.length <= MAX_WEEKEND_POINTS
        ? weekendBands(visible, stepDays)
        : [],
    [weekends, showWeekends, visible, stepDays],
  );
  const span = prepared.points.length;
  const zoomOptions = (
    ["all", "1y", "90d", "30d"] as ZoomMode[]
  ).filter(
    (mode) =>
      mode === "all" ||
      (stepDays === 1 &&
        span > { "1y": 365, "90d": 90, "30d": 30 }[mode as "1y" | "90d" | "30d"] + 7),
  );
  if (selection) zoomOptions.push("selection");
  const palette = [
    colors.positive,
    colors.tracks,
    colors.revenue,
    colors.info,
    colors.warning,
  ];
  const displayed = series.flatMap((item) =>
    item.movingAverage
      ? [
          item,
          {
            key: `${item.key}__ma7`,
            label: "7-day avg",
            color: colors.text,
          },
        ]
      : [item],
  );
  const empty = !prepared.points.some((point) =>
    series.some((item) => typeof point[item.key] === "number"),
  );
  // Flags: hide the label (keep the dot) when it would collide with the previous flag.
  const flagLayout = useMemo(() => {
    const domain = visible.length
      ? visible[visible.length - 1].timestamp - visible[0].timestamp
      : 0;
    const pxPerMs = domain > 0 ? Math.max(1, plotWidth - 70) / domain : 0;
    let lastRight = -Infinity;
    return markers
      .map((marker) => ({
        marker,
        stamp: utcDate(dateKey(marker.date)).getTime(),
      }))
      .filter(({ stamp }) => visible.length && visible[0].timestamp <= stamp && stamp <= visible[visible.length - 1].timestamp)
      .sort((a, b) => a.stamp - b.stamp)
      .map(({ marker, stamp }) => {
        const left = (stamp - visible[0].timestamp) * pxPerMs - flagWidth(marker.label) / 2;
        const labelled = left >= lastRight + 4;
        if (labelled) lastRight = left + flagWidth(marker.label);
        return { marker, stamp, labelled };
      });
  }, [markers, visible, plotWidth]);
  const stateIndex = (state: {
    activeLabel?: unknown;
    activeIndex?: unknown;
  }): PreparedPoint | undefined =>
    visible.find((p) => p.timestamp === Number(state.activeLabel)) ??
    (state.activeIndex != null
      ? visible[Number(state.activeIndex)]
      : undefined);
  const toggles: ReactNode = (
    <>
      {zoomControls && zoomOptions.length > 1 && (
        <div role="group" aria-label="Zoom" className="chart-zoom">
          {zoomOptions.map((mode) => (
            <button
              key={mode}
              type="button"
              className="button button-secondary"
              aria-pressed={zoom === mode}
              title={
                mode === "selection"
                  ? "Focus the chart on the selected dates (the calculator does not change)"
                  : mode === "all"
                    ? "Show the whole history"
                    : `Show only the last ${ZOOM_LABEL[mode]}`
              }
              onClick={() => setZoom(mode)}
            >
              {ZOOM_LABEL[mode]}
            </button>
          ))}
        </div>
      )}
      {weekends && stepDays === 1 && prepared.points.length > 0 && (
        <label
          className="row small chart-toggle"
          title={
            visible.length > MAX_WEEKEND_POINTS
              ? "Zoom in to see weekend bands"
              : "Shade Saturdays and Sundays"
          }
        >
          <input
            type="checkbox"
            checked={showWeekends}
            onChange={(event) => setShowWeekends(event.target.checked)}
          />
          Weekends
        </label>
      )}
    </>
  );
  return (
    <ChartFrame
      {...frame}
      data-testid={frame["data-testid"] ?? "time-series-chart"}
      rows={prepared.points}
      empty={empty}
      captureRef={ref}
      actions={
        <>
          {toggles}
          {actions}
        </>
      }
    >
      <div style={{ width: "100%", height, position: "relative" }}>
        <ResponsiveContainer
          onResize={(width) => setPlotWidth(width)}
        >
          <ComposedChart
            data={visible}
            margin={{
              top: flagLayout.length ? 30 : 16,
              right: 20,
              bottom: 4,
              left: 4,
            }}
            accessibilityLayer
            onMouseDown={
              selection
                ? (state) => {
                    const point = stateIndex(state);
                    dragStart.current =
                      point && typeof point[series[0]?.key] === "number"
                        ? point.date
                        : null;
                  }
                : undefined
            }
            onMouseUp={
              selection
                ? (state) => {
                    const first = dragStart.current;
                    dragStart.current = null;
                    const point = stateIndex(state);
                    if (
                      !first ||
                      !point ||
                      typeof point[series[0]?.key] !== "number"
                    )
                      return;
                    if (first === point.date) selection.onPoint(first);
                    else selection.onRange(first, point.date);
                  }
                : undefined
            }
            onMouseLeave={() => {
              dragStart.current = null;
            }}
          >
            <CartesianGrid
              stroke={colors.border}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(stamp) =>
                formatUtcDate(new Date(Number(stamp)).toISOString()).replace(
                  / \d{4}$/,
                  "",
                )
              }
              tick={{
                fill: colors.muted,
                fontSize: 11,
                fontFamily: "Geist Mono",
              }}
              axisLine={false}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              tickFormatter={compactNumber}
              tick={{
                fill: colors.muted,
                fontSize: 11,
                fontFamily: "Geist Mono",
              }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip
              filterNull={false}
              content={({ active, label }) => (
                <DailySeriesTooltip
                  active={active}
                  label={label}
                  points={prepared.points}
                  series={displayed}
                  extras={extraFields}
                  events={events.filter(
                    (event) =>
                      Number(label) === utcDate(dateKey(event.date)).getTime(),
                  )}
                  markers={markers.filter(
                    (marker) =>
                      Number(label) === utcDate(dateKey(marker.date)).getTime(),
                  )}
                  lines={lines.filter(
                    (line) =>
                      Number(label) === utcDate(dateKey(line.date)).getTime(),
                  )}
                />
              )}
            />
            <Legend
              content={({ payload }) => (
                <ul className="chart-legend">
                  {payload?.map((item) => (
                    <li key={String(item.dataKey)}>
                      <span
                        aria-hidden="true"
                        style={{ background: item.color }}
                      />
                      {item.value}
                    </li>
                  ))}
                </ul>
              )}
            />
            {bands.map((band) => (
              <ReferenceArea
                key={`weekend-${band.from}`}
                className="weekend-band"
                ifOverflow="hidden"
                x1={band.x1}
                x2={band.x2}
                fill={colors.text}
                fillOpacity={0.06}
                strokeOpacity={0}
              />
            ))}
            {shadeGaps &&
              prepared.gaps.map((gap) => (
                <ReferenceArea
                  key={gap.from}
                  ifOverflow="hidden"
                  x1={gap.x1}
                  x2={gap.x2}
                  fill={colors.warning}
                  fillOpacity={0.12}
                  strokeOpacity={0}
                />
              ))}
            {selection && (
              <ReferenceArea
                x1={utcDate(selection.from).getTime()}
                x2={utcDate(selection.to).getTime()}
                ifOverflow="hidden"
                fill={colors.accent}
                fillOpacity={0.16}
                stroke={colors.accent}
                strokeOpacity={0.4}
              />
            )}
            {series.map((item, i) => {
              const color = item.color ?? palette[i % palette.length];
              const common = {
                dataKey: item.key,
                name: item.label,
                stroke: color,
                fill: color,
                isAnimationActive: false,
              };
              return (
                <Fragment key={item.key}>
                  {item.type === "bar" ? (
                    <Bar
                      {...common}
                      fillOpacity={0.62}
                      maxBarSize={32}
                      radius={[3, 3, 0, 0]}
                    >
                      {visible.map((point) => (
                        <Cell
                          key={point.timestamp}
                          fill={
                            typeof point[item.key] === "number" &&
                            (point[item.key] as number) < 0
                              ? colors.error
                              : color
                          }
                        />
                      ))}
                    </Bar>
                  ) : item.type === "area" ? (
                    <Area
                      {...common}
                      type="linear"
                      connectNulls={false}
                      fillOpacity={0.12}
                      strokeWidth={2}
                      strokeDasharray={item.dashed ? "4 3" : undefined}
                    />
                  ) : (
                    <Line
                      {...common}
                      type="linear"
                      connectNulls={false}
                      strokeWidth={item.dashed ? 1.75 : 2}
                      strokeDasharray={item.dashed ? "5 3" : undefined}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  )}
                  {item.movingAverage && (
                    <Line
                      dataKey={`${item.key}__ma7`}
                      name="7-day avg"
                      stroke={colors.text}
                      strokeDasharray="5 3"
                      strokeWidth={1.75}
                      connectNulls={false}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </Fragment>
              );
            })}
            {events.map((event, index) => {
              const point = prepared.points.find(
                (point) => point.date === dateKey(event.date),
              );
              if (!point) return null;
              const value =
                event.value ?? point[event.seriesKey ?? series[0]?.key];
              return (
                <ReferenceDot
                  key={index}
                  x={point.timestamp}
                  y={typeof value === "number" ? value : 0}
                  r={4}
                  fill={colors.error}
                  stroke={colors.card}
                  ifOverflow="extendDomain"
                  shape={({ cx = 0, cy = 0 }) => (
                    <g
                      tabIndex={0}
                      role="img"
                      aria-label={event.text}
                      onFocus={() =>
                        setFlagTip({ x: cx, y: cy + 10, lines: [event.text] })
                      }
                      onBlur={() => setFlagTip(null)}
                      onMouseEnter={() =>
                        setFlagTip({ x: cx, y: cy + 10, lines: [event.text] })
                      }
                      onMouseLeave={() => setFlagTip(null)}
                    >
                      <circle cx={cx} cy={cy} r={5} fill={colors.error} />
                      <title>{event.text}</title>
                    </g>
                  )}
                />
              );
            })}
            {flagLayout.map(({ marker, stamp, labelled }) => {
              const lines = [marker.label, ...marker.text];
              const y =
                typeof marker.value === "number"
                  ? marker.value
                  : (visible.find((p) => p.timestamp >= stamp)?.[
                      series[0]?.key
                    ] as number | undefined);
              if (typeof y !== "number") return null;
              const width = flagWidth(marker.label);
              return (
                <ReferenceDot
                  key={`flag-${marker.date}`}
                  x={stamp}
                  y={y}
                  r={3}
                  ifOverflow="extendDomain"
                  shape={({ cx = 0, cy = 0 }) => (
                    <g
                      className="chart-flag"
                      tabIndex={0}
                      role="img"
                      aria-label={marker.text.join(". ")}
                      onFocus={() =>
                        setFlagTip({ x: cx, y: FLAG_HEIGHT + 8, lines: marker.text })
                      }
                      onBlur={() => setFlagTip(null)}
                      onMouseEnter={() =>
                        setFlagTip({ x: cx, y: FLAG_HEIGHT + 8, lines: marker.text })
                      }
                      onMouseLeave={() => setFlagTip(null)}
                    >
                      {/* wide invisible target so the thin stem is easy to hover */}
                      <rect
                        x={cx - 7}
                        y={labelled ? 0 : cy - 12}
                        width={14}
                        height={cy + 6 - (labelled ? 0 : cy - 12)}
                        fill="transparent"
                      />
                      <line
                        x1={cx}
                        x2={cx}
                        y1={labelled ? FLAG_HEIGHT : cy - 8}
                        y2={cy}
                        stroke={colors.muted}
                        strokeDasharray="2 3"
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={3.5}
                        fill="var(--sb-accent)"
                        stroke={colors.text}
                        strokeWidth={1}
                      />
                      {labelled && (
                        <>
                          <rect
                            x={cx - width / 2}
                            y={1}
                            width={width}
                            height={FLAG_HEIGHT - 2}
                            rx={4}
                            fill="var(--sb-accent)"
                            stroke={colors.border}
                          />
                          <text
                            x={cx}
                            y={FLAG_HEIGHT / 2 + 3.5}
                            textAnchor="middle"
                            fontSize={10}
                            fontWeight={600}
                            fontFamily="Geist Mono"
                            fill="var(--sb-accent-text)"
                          >
                            {marker.label}
                          </text>
                        </>
                      )}
                      <title>{lines.join("\n")}</title>
                    </g>
                  )}
                />
              );
            })}
            {lines.map((line) => {
              const stamp = utcDate(dateKey(line.date)).getTime();
              if (
                !visible.length ||
                stamp < visible[0].timestamp ||
                stamp > visible[visible.length - 1].timestamp
              )
                return null;
              return (
                <ReferenceLine
                  key={`line-${line.date}`}
                  className="chart-switch-line"
                  x={stamp}
                  stroke={colors.warning}
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  ifOverflow="hidden"
                  label={{
                    value: "⇄",
                    position: "insideTopRight",
                    fill: colors.warning,
                    fontSize: 13,
                  }}
                />
              );
            })}
            {selection?.points.map((point) => (
              <ReferenceDot
                key={point.label}
                x={utcDate(point.day).getTime()}
                y={point.value}
                r={5}
                fill={colors.accent}
                stroke={colors.text}
                label={{
                  value: point.label,
                  position: point.label === "From" ? "bottom" : "top",
                  fill: colors.text,
                  fontSize: 11,
                }}
              />
            ))}
            {brush && (
              <Brush
                dataKey="timestamp"
                height={24}
                stroke={colors.muted}
                fill={colors.card}
                tickFormatter={(stamp) =>
                  formatUtcDate(new Date(Number(stamp)).toISOString())
                }
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        {flagTip && (
          <div
            role="tooltip"
            className="chart-tooltip chart-flag-tooltip"
            style={{ left: Math.max(8, flagTip.x - 120), top: flagTip.y }}
          >
            {flagTip.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </div>
      {shadeGaps && prepared.gaps.length > 0 && (
        <p className="muted small chart-gap-note">
          Shaded bands: no usable data ({prepared.gaps.length}{" "}
          {prepared.gaps.length === 1 ? "period" : "periods"} — collection gaps
          or days when most tracks weren't read). Values are never filled in.
        </p>
      )}
    </ChartFrame>
  );
}
