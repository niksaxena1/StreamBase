"use client";

import { useMemo } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateISO, formatInt } from "@/lib/format";
import { addDaysISO } from "@/lib/sotDates";
import { useThemeColors, getChartTooltipStyle } from "@/components/charts/useThemeColors";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { Sparkline } from "@/components/charts/Sparkline";
import { SankeyFlowExperiment } from "./SankeyFlowExperiment";
import type { TestDailyRow, TestPlaylistLabel, TestRunRow, TestSankeyRow } from "./testTypes";

function generateMockHistory(days: number): TestDailyRow[] {
  const out: TestDailyRow[] = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  let total = 5_000_000;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const wave = Math.sin(i / 18) * 120_000 + Math.sin(i / 5) * 40_000;
    const daily = Math.max(0, Math.round(400_000 + wave + (i % 7 === 0 || i % 7 === 6 ? -80_000 : 0)));
    total += daily;
    out.push({ date, daily, total, track_count: 1200 + Math.floor(i / 30) });
  }
  return out;
}

function leastSquaresLine(ys: number[]): { slope: number; intercept: number } {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i];
    sumXY += i * ys[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function daysBetweenIsoDates(a: string, b: string): number {
  const t0 = new Date(`${a}T00:00:00Z`).getTime();
  const t1 = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return 0;
  return Math.round((t1 - t0) / 86_400_000);
}

function Section({
  id,
  title,
  subtitle,
  badge,
  children,
}: {
  id?: string;
  title: string;
  subtitle: string;
  badge: "Live" | "Mock" | "Mixed";
  children: React.ReactNode;
}) {
  const badgeClass =
    badge === "Live"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : badge === "Mock"
        ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
        : "bg-sky-500/15 text-sky-800 dark:text-sky-200";
  return (
    <section id={id} className="scroll-mt-24 mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight" style={{ color: "var(--sb-text)" }}>
            {title}
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs" style={{ color: "var(--sb-muted)" }}>
            {subtitle}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}>
          {badge}
        </span>
      </div>
      {children}
    </section>
  );
}

export function TestExperimentsClient({
  history: historyProp,
  runs,
  playlists,
  sankeyRows,
  sankeyAsOfDate,
}: {
  history: TestDailyRow[];
  runs: TestRunRow[];
  playlists: TestPlaylistLabel[];
  sankeyRows: TestSankeyRow[];
  sankeyAsOfDate: string | null;
}) {
  const colors = useThemeColors();
  const tooltipStyle = getChartTooltipStyle(colors);

  const history = useMemo(() => {
    if (historyProp.length >= 14) return historyProp;
    return generateMockHistory(220);
  }, [historyProp]);

  const usingMockHistory = historyProp.length < 14;

  const dailySeries = useMemo(
    () =>
      history.map((r) => ({
        date: r.date,
        daily: r.daily ?? 0,
        total: r.total ?? 0,
      })),
    [history],
  );

  /** Aligned current vs prior window (same length). */
  const periodCompare = useMemo(() => {
    const windowLen = Math.min(90, Math.floor(dailySeries.length / 2));
    if (windowLen < 7) return [];
    const tail = dailySeries.slice(-windowLen);
    const prior = dailySeries.slice(-windowLen * 2, -windowLen);
    return tail.map((row, i) => ({
      i: i + 1,
      date: row.date,
      current: row.daily,
      prior: prior[i]?.daily ?? null,
    }));
  }, [dailySeries]);

  const periodDeltaSummary = useMemo(() => {
    const rows = periodCompare.filter((r) => r.prior != null && r.prior > 0);
    if (!rows.length) return null;
    const sumC = rows.reduce((s, r) => s + r.current, 0);
    const sumP = rows.reduce((s, r) => s + (r.prior as number), 0);
    return { pct: ((sumC - sumP) / sumP) * 100, sumC, sumP, days: rows.length };
  }, [periodCompare]);

  const yoyCompare = useMemo(() => {
    const byDate = new Map(dailySeries.map((r) => [r.date, r.daily]));
    const last = dailySeries.slice(-60);
    return last.map((r) => {
      const y = addDaysISO(r.date, -365);
      return {
        date: r.date,
        current: r.daily,
        yoy: byDate.get(y) ?? null,
      };
    });
  }, [dailySeries]);

  const yoyPointCoverage = useMemo(() => {
    const n = yoyCompare.length;
    if (!n) return { matched: 0, total: 0 };
    const matched = yoyCompare.filter((r) => r.yoy != null).length;
    return { matched, total: n };
  }, [yoyCompare]);

  const growthSeries = useMemo(() => {
    return dailySeries.map((r, idx) => {
      const j = idx - 7;
      const prev = j >= 0 ? dailySeries[j].daily : null;
      const wow = prev != null && prev > 0 ? ((r.daily - prev) / prev) * 100 : null;
      return { date: r.date, daily: r.daily, wow, wowBar: wow ?? 0 };
    });
  }, [dailySeries]);

  const accelSeries = useMemo(() => {
    return growthSeries.map((r, idx) => {
      const j = idx - 7;
      const prevWow = j >= 0 ? growthSeries[j].wow : null;
      const accel =
        r.wow != null && prevWow != null ? r.wow - prevWow : null;
      return { date: r.date, wow: r.wow, accel };
    });
  }, [growthSeries]);

  const heatmapWeeks = useMemo(() => {
    const tail = dailySeries.slice(-182); // 26 weeks
    const weeks: { label: string; days: { date: string; v: number; dow: number }[] }[] = [];
    for (let w = 0; w < 26; w++) {
      const chunk = tail.slice(w * 7, (w + 1) * 7);
      if (!chunk.length) break;
      weeks.push({
        label: chunk[0]?.date?.slice(5) ?? "",
        days: chunk.map((d, dow) => ({ date: d.date, v: d.daily, dow })),
      });
    }
    return weeks;
  }, [dailySeries]);

  const heatmapMax = useMemo(() => {
    let m = 1;
    for (const w of heatmapWeeks) for (const d of w.days) m = Math.max(m, d.v);
    return m;
  }, [heatmapWeeks]);

  const forecastData = useMemo(() => {
    const tail = dailySeries.slice(-45);
    if (tail.length < 14) return [];
    const ys = tail.map((t) => t.daily);
    const { slope, intercept } = leastSquaresLine(ys);
    const out: { date: string; actual: number | null; forecast: number | null }[] = [];
    for (let i = 0; i < tail.length; i++) {
      const date = tail[i].date;
      out.push({ date, actual: tail[i].daily, forecast: null });
    }
    const lastDate = tail[tail.length - 1].date;
    for (let k = 1; k <= 14; k++) {
      const idx = tail.length - 1 + k;
      const d = addDaysISO(lastDate, k);
      const yhat = Math.max(0, intercept + slope * idx);
      out.push({ date: d, actual: null, forecast: yhat });
    }
    return out;
  }, [dailySeries]);

  const mockMovers = useMemo(
    () =>
      [
        { name: "Neon Static", delta: 12400, series: [120, 132, 128, 140, 155, 162, 180, 210, 245, 280] },
        { name: "Glass Echo", delta: 8900, series: [400, 395, 402, 410, 420, 430, 455, 480, 500, 520] },
        { name: "Late July", delta: -2100, series: [300, 290, 285, 270, 260, 255, 248, 240, 235, 228] },
        { name: "Courier", delta: 5600, series: [80, 82, 85, 90, 88, 92, 95, 102, 110, 118] },
        { name: "Soft Alarm", delta: 3200, series: [200, 205, 208, 212, 218, 225, 230, 238, 245, 252] },
        { name: "Empty Rail", delta: -980, series: [150, 148, 149, 147, 146, 145, 144, 143, 142, 141] },
      ].sort((a, b) => b.delta - a.delta),
    [],
  );

  const overlapMatrix = useMemo(() => {
    const slice = playlists.slice(0, 4);
    const labels =
      slice.length >= 2 ? slice.map((p) => p.display_name.slice(0, 12)) : ["Releases", "External", "Radio", "Staff picks"];
    const n = labels.length;
    const cells: number[][] = [];
    for (let i = 0; i < n; i++) {
      cells[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) cells[i][j] = 100;
        else cells[i][j] = Math.round(12 + ((i + j * 3) % 5) * 7 + (i > j ? 3 : 0));
      }
    }
    return { labels, cells };
  }, [playlists]);

  const cohortLines = useMemo(
    () => [
      { name: "Jan drop", color: colors.accentStroke, points: [12, 18, 24, 30, 35, 40, 44, 48, 52, 55, 58, 60] },
      { name: "Mar drop", color: colors.tracks, points: [10, 22, 34, 42, 48, 53, 57, 60, 62, 64, 65, 66] },
      { name: "Jun drop", color: colors.revenue, points: [8, 15, 22, 30, 38, 45, 51, 56, 59, 61, 62, 63] },
      { name: "Sep drop", color: colors.warning, points: [20, 28, 35, 41, 46, 50, 53, 55, 56, 57, 58, 58] },
    ],
    [colors.accentStroke, colors.revenue, colors.tracks, colors.warning],
  );

  const cohortHeat = useMemo(
    () =>
      cohortLines.map((c) =>
        c.points.map((p, w) => ({
          week: w,
          cohort: c.name,
          intensity: p,
        })),
      ),
    [cohortLines],
  );

  const benchmarkBins = useMemo(() => {
    const vals = dailySeries.slice(-120).map((d) => d.daily);
    if (!vals.length) return { bins: [] as { lo: number; hi: number; count: number }[], pick: 0, pctl: 0 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const binCount = 14;
    const step = (max - min) / binCount || 1;
    const bins = Array.from({ length: binCount }, (_, i) => ({
      lo: min + i * step,
      hi: min + (i + 1) * step,
      count: 0,
    }));
    for (const v of vals) {
      const i = Math.min(binCount - 1, Math.max(0, Math.floor((v - min) / step)));
      bins[i].count += 1;
    }
    const pick = vals[Math.floor(vals.length * 0.72)];
    const sorted = [...vals].sort((a, b) => a - b);
    const rank = sorted.filter((x) => x < pick).length;
    const pctl = (rank / sorted.length) * 100;
    return { bins, pick, pctl };
  }, [dailySeries]);

  const runsAsc = useMemo(() => [...runs].reverse(), [runs]);

  const trackCountDisplay =
    historyProp.length > 0 ? historyProp[historyProp.length - 1]?.track_count : history[history.length - 1]?.track_count;

  const runsBarData = useMemo(
    () => runsAsc.slice(-24).map((r) => ({ ...r, bar: 1 })),
    [runsAsc],
  );

  const runGapStats = useMemo(() => {
    const asc = [...runs].sort((a, b) => a.run_date.localeCompare(b.run_date));
    if (asc.length < 2) return null;
    const gaps: number[] = [];
    for (let i = 1; i < asc.length; i++) {
      gaps.push(daysBetweenIsoDates(asc[i - 1].run_date, asc[i].run_date));
    }
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const lastGap = gaps[gaps.length - 1];
    return { avg, lastGap };
  }, [runs]);

  const benchmarkChart = useMemo(() => {
    const bins = benchmarkBins.bins.map((b) => ({
      label: `${formatInt(Math.round(b.lo))}`,
      count: b.count,
      lo: b.lo,
      hi: b.hi,
    }));
    const idx = benchmarkBins.bins.findIndex((b) => benchmarkBins.pick >= b.lo && benchmarkBins.pick < b.hi);
    const refLabel = idx >= 0 ? bins[idx]?.label : null;
    return { bins, refLabel };
  }, [benchmarkBins]);

  const legendProps = { wrapperStyle: { fontSize: 11, paddingTop: 6 }, iconType: "line" as const };

  const periodWindowDays = periodCompare.length;

  return (
    <div id="test-experiments-top" className="space-y-2">
      {usingMockHistory && (
        <p className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}>
          Less than 14 real rows from <code className="text-[11px]">all_catalog</code>; charts use generated sample series so layouts stay visible.
        </p>
      )}

      <nav
        className="rounded-xl border p-3 text-xs"
        style={{ borderColor: "var(--sb-border)" }}
        aria-label="Jump to experiment"
      >
        <div className="mb-2 font-medium uppercase tracking-wider opacity-60" style={{ color: "var(--sb-muted)" }}>
          On this page
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5" style={{ color: "var(--sb-muted)" }}>
          <li>
            <a href="#test-experiments-top" className="underline decoration-black/20 underline-offset-2 hover:opacity-80 dark:decoration-white/25">
              Top
            </a>
          </li>
          {(
            [
              ["exp-period", "1 Period"],
              ["exp-yoy", "2 YoY"],
              ["exp-growth", "3 Growth"],
              ["exp-heatmap", "4 Heatmap"],
              ["exp-movers", "5 Movers"],
              ["exp-overlap", "6 Overlap"],
              ["exp-cohort", "7 Cohort"],
              ["exp-coverage", "8 Coverage"],
              ["exp-genre", "9 Split"],
              ["exp-benchmark", "10 Pctl"],
              ["exp-sankey", "11 Sankey"],
              ["exp-forecast", "12 Forecast"],
            ] as const
          ).map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="underline decoration-black/20 underline-offset-2 hover:opacity-80 dark:decoration-white/25">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Section
        id="exp-period"
        title="1. Period comparison (current vs prior window)"
        subtitle="Same-length windows: last N days vs the N days before. Summary shows aggregate % change."
        badge={usingMockHistory ? "Mock" : "Live"}
      >
        <SpotlightCard className="p-3">
          {periodWindowDays > 0 ? (
            <p className="mb-2 text-[10px]" style={{ color: "var(--sb-muted)" }}>
              Window: last <strong style={{ color: "var(--sb-text)" }}>{periodWindowDays}</strong> days vs the{" "}
              <strong style={{ color: "var(--sb-text)" }}>{periodWindowDays}</strong> days immediately before (aligned by index).
            </p>
          ) : null}
          <div className="mb-2 flex flex-wrap gap-4 text-xs" style={{ color: "var(--sb-muted)" }}>
            {periodDeltaSummary ? (
              <>
                <span>
                  Δ vs prior window:{" "}
                  <strong style={{ color: "var(--sb-text)" }}>
                    {periodDeltaSummary.pct >= 0 ? "+" : ""}
                    {periodDeltaSummary.pct.toFixed(1)}%
                  </strong>
                </span>
                <span>
                  Current sum: <strong style={{ color: "var(--sb-text)" }}>{formatInt(periodDeltaSummary.sumC)}</strong>
                </span>
                <span>
                  Prior sum: <strong style={{ color: "var(--sb-text)" }}>{formatInt(periodDeltaSummary.sumP)}</strong>
                </span>
              </>
            ) : (
              <span>Not enough overlapping history.</span>
            )}
          </div>
          {periodCompare.length ? (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={periodCompare} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis dataKey="i" tick={{ fill: colors.muted, fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatInt(v)} width={48} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [formatInt(Number(value)), "Daily"]}
                    labelFormatter={(_, p) => {
                      const pl = (p as { payload?: { date?: string } }[])?.[0]?.payload;
                      return pl?.date ? formatDateISO(pl.date) : "";
                    }}
                  />
                  <Line type="monotone" dataKey="current" name="Current window" stroke={colors.accentStroke} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="prior" name="Prior window" stroke={colors.info} dot={false} strokeWidth={2} strokeDasharray="6 4" />
                  <Legend {...legendProps} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
              Need at least 14 days of history to build two aligned windows.
            </p>
          )}
        </SpotlightCard>
      </Section>

      <Section
        id="exp-yoy"
        title="2. YoY overlay (when a matching date exists)"
        subtitle="Each point: daily streams on date vs daily streams on date − 365d (requires a full year of history)."
        badge={usingMockHistory ? "Mock" : "Live"}
      >
        <SpotlightCard className="p-3">
          {yoyCompare.length ? (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yoyCompare} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: colors.muted, fontSize: 9 }}
                    tickFormatter={(d) => String(d).slice(5)}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatInt(v)} width={48} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="current" name="Current" stroke={colors.accentStroke} dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="yoy" name="Year ago" stroke={colors.tracks} dot={false} strokeWidth={2} strokeDasharray="5 5" />
                  <Legend {...legendProps} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
              No points in range.
            </p>
          )}
          <p className="mt-2 text-[10px]" style={{ color: "var(--sb-muted)" }}>
            YoY points matched: {yoyPointCoverage.matched}/{yoyPointCoverage.total} (nulls mean no row exactly 365d earlier).
          </p>
        </SpotlightCard>
      </Section>

      <Section
        id="exp-growth"
        title="3. Growth & velocity"
        subtitle="WoW % change on daily streams; second chart shows change in that % (acceleration)."
        badge={usingMockHistory ? "Mock" : "Live"}
      >
        <SpotlightCard className="p-3">
          {growthSeries.length ? (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={growthSeries.slice(-120)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis dataKey="date" tick={{ fill: colors.muted, fontSize: 9 }} tickFormatter={(d) => String(d).slice(5)} interval={15} />
                  <YAxis
                    yAxisId="l"
                    tick={{ fill: colors.muted, fontSize: 10 }}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                    width={44}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar yAxisId="l" dataKey="wowBar" name="WoW %" fill={colors.accent} opacity={0.35} />
                  <Line yAxisId="l" type="monotone" dataKey="wow" name="WoW % (line)" stroke={colors.accentStroke} dot={false} strokeWidth={1.5} />
                  <Legend {...legendProps} iconType="rect" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-6 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
              No series data.
            </p>
          )}
          {accelSeries.length ? (
            <div className="mt-4 h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={accelSeries.slice(-120)} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis dataKey="date" tick={{ fill: colors.muted, fontSize: 9 }} tickFormatter={(d) => String(d).slice(5)} interval={15} />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10 }} tickLine={false} tickFormatter={(v) => `${v}%`} width={44} />
                  <ReferenceLine y={0} stroke={colors.muted} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="accel" name="Δ WoW %" stroke={colors.revenue} dot={false} strokeWidth={2} />
                  <Legend {...legendProps} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : null}
        </SpotlightCard>
      </Section>

      <Section
        id="exp-heatmap"
        title="4. Calendar heatmap"
        subtitle="Last 26 weeks × 7 days; color = daily streams (portfolio)."
        badge={usingMockHistory ? "Mock" : "Live"}
      >
        <SpotlightCard className="p-3 overflow-x-auto">
          {heatmapWeeks.length ? (
            <>
              <div
                className="flex gap-0.5"
                style={{ minWidth: 520 }}
                role="img"
                aria-label={`Daily streams heatmap, approximately ${heatmapWeeks.length} weeks by seven days. Brighter is higher streams.`}
              >
                {heatmapWeeks.map((w, wi) => (
                  <div key={wi} className="flex flex-col gap-0.5">
                    {w.days.map((d, di) => {
                      const t = heatmapMax ? d.v / heatmapMax : 0;
                      const bg =
                        colors.isDark
                          ? `rgba(199, 243, 60, ${0.12 + t * 0.85})`
                          : `rgba(65, 120, 20, ${0.08 + t * 0.55})`;
                      return (
                        <div
                          key={`${d.date}-${di}`}
                          className="h-3 w-3 rounded-sm"
                          style={{ backgroundColor: bg }}
                          title={`${formatDateISO(d.date)} · ${formatInt(d.v)}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px]" style={{ color: "var(--sb-muted)" }}>
                Each column is seven consecutive days (oldest left); not calendar-aligned weeks.
              </p>
              <div className="mt-3 flex items-center gap-2 text-[10px]" style={{ color: "var(--sb-muted)" }}>
                <span className="w-14 flex-shrink-0 tabular-nums">0</span>
                <div
                  className="h-2 min-w-0 flex-1 rounded-full"
                  style={{
                    background: colors.isDark
                      ? "linear-gradient(90deg, rgba(199, 243, 60, 0.12), rgba(199, 243, 60, 0.92))"
                      : "linear-gradient(90deg, rgba(65, 120, 20, 0.08), rgba(65, 120, 20, 0.62))",
                  }}
                  role="presentation"
                />
                <span className="w-20 flex-shrink-0 text-right tabular-nums">{formatInt(heatmapMax)}</span>
              </div>
              <p className="mt-1 text-[10px] opacity-80" style={{ color: "var(--sb-muted)" }}>
                Daily streams (max in this grid = right value).
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
              No daily points to plot.
            </p>
          )}
        </SpotlightCard>
      </Section>

      <Section
        id="exp-movers"
        title="5. Movers strip"
        subtitle="Ranked Δ with sparklines — sample track names; wire to real top gainers/losers from your drill queries."
        badge="Mock"
      >
        <SpotlightCard className="p-3">
          <div className="divide-y" style={{ borderColor: "var(--sb-border)" }}>
            {mockMovers.map((m) => (
              <div key={m.name} className="flex items-center gap-3 py-2.5">
                <div className="h-8 w-24 flex-shrink-0">
                  <Sparkline data={m.series} trend={m.delta >= 0 ? "up" : "down"} />
                </div>
                <div className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: "var(--sb-text)" }}>
                  {m.name}
                </div>
                <div
                  className="flex-shrink-0 text-sm tabular-nums"
                  style={{ color: m.delta >= 0 ? colors.positive : colors.error }}
                >
                  {m.delta >= 0 ? "+" : ""}
                  {formatInt(m.delta)}
                </div>
              </div>
            ))}
          </div>
        </SpotlightCard>
      </Section>

      <Section
        id="exp-overlap"
        title="6. Playlist overlap"
        subtitle="Jaccard-style matrix (mock %). Labels from your playlists when ≥2 exist."
        badge="Mixed"
      >
        <SpotlightCard className="p-3">
          <div className="mb-4 flex flex-wrap gap-3 text-xs" style={{ color: "var(--sb-muted)" }}>
            <span>
              Streams from tracks in <strong style={{ color: "var(--sb-text)" }}>one</strong> playlist only:{" "}
              <strong style={{ color: "var(--sb-text)" }}>54%</strong> (mock)
            </span>
            <span>
              In <strong style={{ color: "var(--sb-text)" }}>2+</strong>:{" "}
              <strong style={{ color: "var(--sb-text)" }}>46%</strong> (mock)
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[280px] border-collapse text-center text-xs">
              <caption className="sr-only">Mock playlist overlap percentages; diagonal is omitted.</caption>
              <thead>
                <tr>
                  <th className="p-1" />
                  {overlapMatrix.labels.map((l, ci) => (
                    <th key={`col-${ci}-${l}`} className="p-1 font-medium" style={{ color: "var(--sb-muted)" }}>
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overlapMatrix.labels.map((row, i) => (
                  <tr key={`row-${i}-${row}`}>
                    <td className="p-1 text-left font-medium" style={{ color: "var(--sb-muted)" }}>
                      {row}
                    </td>
                    {overlapMatrix.cells[i].map((c, j) => (
                      <td key={`c-${i}-${j}`} className="p-1 tabular-nums" style={{ color: "var(--sb-text)" }}>
                        {i === j ? "—" : `${c}%`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SpotlightCard>
      </Section>

      <Section
        id="exp-cohort"
        title="7. Release cohort aging"
        subtitle="Left: median cumulative % vs weeks since release (mock cohorts). Right: heat intensity mock."
        badge="Mock"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <SpotlightCard className="p-3">
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={cohortLines[0].points.map((_, w) => {
                    const row: Record<string, string | number> = { week: w };
                    for (const c of cohortLines) row[c.name] = c.points[w] ?? null;
                    return row;
                  })}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis dataKey="week" tick={{ fill: colors.muted, fontSize: 10 }} />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10 }} width={36} domain={[0, "auto"]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  {cohortLines.map((c) => (
                    <Line key={c.name} type="monotone" dataKey={c.name} stroke={c.color} dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SpotlightCard>
          <SpotlightCard className="p-3">
            <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(12, minmax(0,1fr))` }}>
              {cohortHeat.flat().map((cell, idx) => {
                const t = cell.intensity / 70;
                const bg = colors.isDark ? `rgba(59, 130, 246, ${0.15 + t * 0.8})` : `rgba(30, 64, 175, ${0.12 + t * 0.5})`;
                return <div key={idx} className="aspect-square rounded-sm" style={{ backgroundColor: bg }} title={cell.cohort} />;
              })}
            </div>
            <p className="mt-2 text-[10px]" style={{ color: "var(--sb-muted)" }}>
              Rows ≈ cohorts, columns = week index (illustrative).
            </p>
          </SpotlightCard>
        </div>
      </Section>

      <Section
        id="exp-coverage"
        title="8. Coverage & lag"
        subtitle="Live run timeline from ingestion_runs; KPIs are simple derivations."
        badge="Mixed"
      >
        <SpotlightCard className="p-3">
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--sb-border)" }}>
              <div style={{ color: "var(--sb-muted)" }}>History rows</div>
              <div className="mt-1 font-semibold tabular-nums" style={{ color: "var(--sb-text)" }}>
                {formatInt(historyProp.length || history.length)}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--sb-border)" }}>
              <div style={{ color: "var(--sb-muted)" }}>Latest track_count</div>
              <div className="mt-1 font-semibold tabular-nums" style={{ color: "var(--sb-text)" }}>
                {trackCountDisplay != null ? formatInt(trackCountDisplay) : "—"}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--sb-border)" }}>
              <div style={{ color: "var(--sb-muted)" }}>Ingestion runs loaded</div>
              <div className="mt-1 font-semibold tabular-nums" style={{ color: "var(--sb-text)" }}>
                {formatInt(runs.length)}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--sb-border)" }}>
              <div style={{ color: "var(--sb-muted)" }}>Avg / last run gap (days)</div>
              <div className="mt-1 font-semibold tabular-nums" style={{ color: "var(--sb-text)" }}>
                {runGapStats ? (
                  <>
                    {runGapStats.avg.toFixed(1)} / {runGapStats.lastGap}
                  </>
                ) : (
                  "—"
                )}
              </div>
            </div>
          </div>
          {runsBarData.length ? (
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={runsBarData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis dataKey="run_date" tick={{ fill: colors.muted, fontSize: 9 }} tickFormatter={(d) => String(d).slice(5)} interval={3} />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10 }} width={28} domain={[0, 1]} ticks={[0, 1]} tickFormatter={(v) => (v === 1 ? "ok" : "")} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(_, n, p) => {
                      const st = (p.payload as TestRunRow)?.status ?? "";
                      return [st, "status"];
                    }}
                  />
                  <Bar dataKey="bar" radius={[3, 3, 0, 0]}>
                    {runsBarData.map((r, i) => (
                      <Cell
                        key={`${r.run_date}-${i}`}
                        fill={
                          String(r.status).toLowerCase().includes("fail") || String(r.status).toLowerCase().includes("error")
                            ? colors.error
                            : colors.positive
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
              No ingestion runs returned for this page load.
            </p>
          )}
          <p className="mt-2 text-[10px]" style={{ color: "var(--sb-muted)" }}>
            Bar chart is a coarse timeline (1 = run row exists). Hover for status string.
          </p>
        </SpotlightCard>
      </Section>

      <Section
        id="exp-genre"
        title="9. Genre / label / distributor split"
        subtitle="Stacked share — illustrative. Schema here has no reliable genre/label dimension; wire when you store it."
        badge="Mock"
      >
        <SpotlightCard className="p-3">
          <div className="h-14 w-full overflow-hidden rounded-lg" style={{ background: colors.border }}>
            <div className="flex h-full w-full">
              <div className="h-full" style={{ width: "38%", background: colors.accentStroke }} title="Indie / alt (mock)" />
              <div className="h-full" style={{ width: "27%", background: colors.tracks }} title="Electronic (mock)" />
              <div className="h-full" style={{ width: "20%", background: colors.revenue }} title="Hip-hop (mock)" />
              <div className="h-full" style={{ width: "15%", background: colors.warning }} title="Other (mock)" />
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--sb-muted)" }}>
            <li>
              <span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: colors.accentStroke }} /> Indie / alt 38%
            </li>
            <li>
              <span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: colors.tracks }} /> Electronic 27%
            </li>
            <li>
              <span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: colors.revenue }} /> Hip-hop 20%
            </li>
            <li>
              <span className="inline-block h-2 w-2 rounded-sm align-middle" style={{ background: colors.warning }} /> Other 15%
            </li>
          </ul>
        </SpotlightCard>
      </Section>

      <Section
        id="exp-benchmark"
        title="10. Benchmark percentile"
        subtitle="Histogram of recent daily portfolio streams; marker = mock “selected track” daily level vs that distribution."
        badge={usingMockHistory ? "Mock" : "Mixed"}
      >
        <SpotlightCard className="p-3">
          <div className="mb-2 text-xs" style={{ color: "var(--sb-muted)" }}>
            Example pick at <strong style={{ color: "var(--sb-text)" }}>{formatInt(benchmarkBins.pick)}</strong> streams/day → ~{" "}
            <strong style={{ color: "var(--sb-text)" }}>{benchmarkBins.pctl.toFixed(0)}th</strong> percentile of last 120 days.
          </div>
          {benchmarkChart.bins.length ? (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={benchmarkChart.bins} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis dataKey="label" tick={{ fill: colors.muted, fontSize: 8 }} interval={2} />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10 }} width={32} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill={colors.accent} opacity={0.5} radius={[2, 2, 0, 0]} />
                  {benchmarkChart.refLabel ? (
                    <ReferenceLine
                      x={benchmarkChart.refLabel}
                      stroke={colors.error}
                      strokeWidth={2}
                      label={{ value: "pick", fill: colors.muted, fontSize: 10 }}
                    />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
              No values to bin.
            </p>
          )}
        </SpotlightCard>
      </Section>

      <Section
        id="exp-sankey"
        title="11. Catalog grouping flow"
        subtitle="Real latest own-catalog data: collector/type to organizing playlist to track. This is a distribution view, not a claim that playlists feed streams."
        badge="Live"
      >
        <SpotlightCard>
          <SankeyFlowExperiment colors={colors} rows={sankeyRows} asOfDate={sankeyAsOfDate} />
        </SpotlightCard>
      </Section>

      <Section
        id="exp-forecast"
        title="12. Simple forecast (linear trend)"
        subtitle="OLS on last 45 daily points; dashed extension — not a production model."
        badge={usingMockHistory ? "Mock" : "Live"}
      >
        <SpotlightCard className="p-3">
          {forecastData.length ? (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={forecastData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} opacity={0.4} />
                  <XAxis dataKey="date" tick={{ fill: colors.muted, fontSize: 9 }} tickFormatter={(d) => String(d).slice(5)} interval={8} />
                  <YAxis tick={{ fill: colors.muted, fontSize: 10 }} tickLine={false} tickFormatter={(v) => formatInt(v)} width={48} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="actual" name="Actual" fill={colors.accent10} stroke={colors.accentStroke} strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="forecast" name="Projected" stroke={colors.info} dot={false} strokeWidth={2} strokeDasharray="6 4" connectNulls />
                  <Legend {...legendProps} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-8 text-center text-sm" style={{ color: "var(--sb-muted)" }}>
              Need at least 14 days in the daily series to fit and extend the trend.
            </p>
          )}
        </SpotlightCard>
      </Section>

      <p className="pt-8 text-center text-[11px]" style={{ color: "var(--sb-muted)" }}>
        <a href="#test-experiments-top" className="underline decoration-black/20 underline-offset-2 hover:opacity-80 dark:decoration-white/25">
          Back to top
        </a>
      </p>
    </div>
  );
}
