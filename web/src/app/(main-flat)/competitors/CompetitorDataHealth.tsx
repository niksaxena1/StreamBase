"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, SlidersHorizontal, XCircle } from "lucide-react";

import { formatInt } from "@/lib/format";
import { addDaysISO, dataDateFromRunDate } from "@/lib/sotDates";
import { useThemeColors } from "@/components/charts/useThemeColors";
import { isOwnCatalogLabelKey } from "@/lib/competitors/ownCatalog";

import { median } from "./competitorWorkspaceAnalytics";
import type {
  CompetitorOverrideDay,
  CompetitorRunRow,
  CompetitorWarningRow,
  LabelDailyPoint,
  LabelRow,
} from "./competitorsTypes";
import { labelColor } from "./competitorsUtils";

type Anomaly = {
  date: string;
  label: LabelRow;
  value: number;
  baseline: number;
  deltaPct: number;
};

function mondayOfWeek(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dow = parsed.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysISO(date, delta);
}

export function CompetitorDataHealth({
  labels,
  labelSeries,
  runHistory,
  warnings,
  overrideDays,
  overrideRowCount,
}: {
  labels: LabelRow[];
  labelSeries: LabelDailyPoint[];
  runHistory: CompetitorRunRow[];
  warnings: CompetitorWarningRow[];
  overrideDays: CompetitorOverrideDay[];
  overrideRowCount: number;
}) {
  const colors = useThemeColors();
  const competitorLabels = useMemo(
    () => labels.filter((label) => label.is_active !== false && !isOwnCatalogLabelKey(label.label_key)),
    [labels],
  );
  const byLabel = useMemo(() => {
    const output = new Map<string, LabelDailyPoint[]>();
    for (const point of labelSeries) {
      if (!competitorLabels.some((label) => label.label_key === point.label_key)) continue;
      const rows = output.get(point.label_key) ?? [];
      rows.push(point);
      output.set(point.label_key, rows);
    }
    for (const rows of output.values()) rows.sort((a, b) => a.date.localeCompare(b.date));
    return output;
  }, [competitorLabels, labelSeries]);
  const allDates = useMemo(
    () => [...new Set(labelSeries.filter((point) => competitorLabels.some((label) => label.label_key === point.label_key)).map((point) => point.date))].sort(),
    [competitorLabels, labelSeries],
  );
  const totalsByDate = useMemo(() => {
    const output = new Map<string, number>();
    for (const point of labelSeries) {
      if (!competitorLabels.some((label) => label.label_key === point.label_key)) continue;
      output.set(point.date, (output.get(point.date) ?? 0) + Number(point.daily_streams_net ?? 0));
    }
    return output;
  }, [competitorLabels, labelSeries]);
  const heatDates = allDates.slice(-84);
  const heatCells = useMemo(() => {
    if (!heatDates.length) return [] as Array<{ date: string; value: number | null; dow: number; week: number }>;
    const start = mondayOfWeek(heatDates[0]);
    const end = heatDates.at(-1)!;
    const output: Array<{ date: string; value: number | null; dow: number; week: number }> = [];
    for (let date = start, index = 0; date <= end; date = addDaysISO(date, 1), index += 1) {
      output.push({ date, value: totalsByDate.get(date) ?? null, dow: index % 7, week: Math.floor(index / 7) });
    }
    return output;
  }, [heatDates, totalsByDate]);
  const heatValues = heatCells.map((cell) => cell.value).filter((value): value is number => value != null).sort((a, b) => a - b);
  const heatHigh = heatValues[Math.floor(heatValues.length * 0.9)] ?? Math.max(1, ...heatValues);
  const heatLow = heatValues[Math.floor(heatValues.length * 0.1)] ?? 0;
  const weekCount = Math.max(1, ...heatCells.map((cell) => cell.week + 1));
  const anomalyFloor = allDates.length ? addDaysISO(allDates.at(-1)!, -29) : "";
  const anomalies = useMemo(() => {
    const output: Anomaly[] = [];
    competitorLabels.forEach((label) => {
      const rows = byLabel.get(label.label_key) ?? [];
      rows.forEach((row, index) => {
        if (anomalyFloor && row.date < anomalyFloor) return;
        const prior = rows.slice(Math.max(0, index - 7), index).map((point) => point.daily_streams_net).filter((value) => value > 0);
        if (prior.length < 4) return;
        const baseline = median(prior);
        if (baseline <= 0) return;
        const deltaPct = ((row.daily_streams_net - baseline) / baseline) * 100;
        if (Math.abs(deltaPct) < 30) return;
        output.push({ date: row.date, label, value: row.daily_streams_net, baseline, deltaPct });
      });
    });
    return output.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  }, [anomalyFloor, byLabel, competitorLabels]);
  const latestDataDate = allDates.at(-1) ?? null;
  const matrixDates = useMemo(
    () =>
      latestDataDate
        ? Array.from({ length: 14 }, (_, index) => addDaysISO(latestDataDate, index - 13))
        : [],
    [latestDataDate],
  );
  const pointLookup = useMemo(
    () => new Map(labelSeries.map((point) => [`${point.label_key}|${point.date}`, point])),
    [labelSeries],
  );
  const overridesByDataDate = useMemo(
    () => new Map(overrideDays.map((row) => [dataDateFromRunDate(row.date), row.count])),
    [overrideDays],
  );
  const successfulRuns = runHistory.filter((run) => run.status === "success").length;
  const successRate = runHistory.length ? (successfulRuns / runHistory.length) * 100 : 0;
  const missingCells = competitorLabels.reduce(
    (sum, label) => sum + matrixDates.filter((date) => !pointLookup.has(`${label.label_key}|${date}`)).length,
    0,
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-lg border sm:grid-cols-4" style={{ borderColor: colors.border, background: colors.border }}>
        {[
          { label: "Run success", value: `${successRate.toFixed(0)}%`, icon: CheckCircle2, color: successRate >= 95 ? colors.positive : colors.warning },
          { label: "Missing label-days", value: formatInt(missingCells), icon: XCircle, color: missingCells ? colors.error : colors.positive },
          { label: "30d outliers", value: formatInt(anomalies.length), icon: AlertTriangle, color: anomalies.length ? colors.warning : colors.positive },
          { label: "Override rows", value: formatInt(overrideRowCount), icon: SlidersHorizontal, color: colors.info },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 bg-[var(--sb-card)] px-4 py-3">
            <item.icon className="h-4 w-4" style={{ color: item.color }} />
            <div>
              <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: colors.muted }}>{item.label}</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums" style={{ color: item.color }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      <section className="sb-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Daily stream calendar</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>Combined competitor-label daily streams; known recent override dates are outlined.</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <div className="grid min-w-[620px] gap-1" style={{ gridTemplateColumns: `28px repeat(${weekCount}, minmax(12px, 1fr))` }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
              <div key={`${day}-${index}`} className="flex h-4 items-center text-[9px]" style={{ gridColumn: 1, gridRow: index + 1, color: colors.muted }}>{day}</div>
            ))}
            {heatCells.map((cell) => {
              const normalized = cell.value == null ? 0 : Math.max(0.08, Math.min(1, (cell.value - heatLow) / Math.max(1, heatHigh - heatLow)));
              const overrideCount = overridesByDataDate.get(cell.date) ?? 0;
              return (
                <div
                  key={cell.date}
                  className="h-4 rounded-sm"
                  style={{
                    gridColumn: cell.week + 2,
                    gridRow: cell.dow + 1,
                    background: cell.value == null ? "var(--sb-row-hover)" : `color-mix(in srgb, ${colors.accent} ${Math.round(normalized * 88)}%, transparent)`,
                    outline: overrideCount ? `1px solid ${colors.info}` : undefined,
                    outlineOffset: overrideCount ? "1px" : undefined,
                  }}
                  title={`${cell.date}: ${cell.value == null ? "no row" : `${formatInt(cell.value)} daily streams`}${overrideCount ? `; ${formatInt(overrideCount)} override rows` : ""}`}
                />
              );
            })}
          </div>
        </div>
      </section>

      <section className="sb-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Label-day coverage</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>Rows present across the latest 14 data dates. Amber cells are below 20% of that label&apos;s visible median.</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid gap-1" style={{ gridTemplateColumns: `150px repeat(${matrixDates.length}, minmax(24px, 1fr))` }}>
              <div />
              {matrixDates.map((date) => <div key={date} className="-rotate-45 pb-2 text-center font-mono text-[8px]" style={{ color: colors.muted }}>{date.slice(5)}</div>)}
              {competitorLabels.map((label, labelIndex) => {
                const labelValues = (byLabel.get(label.label_key) ?? []).slice(-14).map((row) => row.daily_streams_net).filter((value) => value > 0);
                const labelMedian = median(labelValues);
                return (
                  <div key={label.label_key} className="contents">
                    <div className="flex items-center gap-2 truncate text-[10px]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: labelColor(label, labelIndex) }} />
                      {label.display_name}
                    </div>
                    {matrixDates.map((date) => {
                      const point = pointLookup.get(`${label.label_key}|${date}`);
                      const low = point && labelMedian > 0 && point.daily_streams_net < labelMedian * 0.2;
                      return (
                        <div
                          key={`${label.label_key}-${date}`}
                          className="h-5 rounded-sm"
                          style={{ background: !point ? colors.error : low ? colors.warning : labelColor(label, labelIndex), opacity: !point ? 0.65 : low ? 0.72 : 0.5 }}
                          title={`${label.display_name}, ${date}: ${point ? formatInt(point.daily_streams_net) : "missing"}`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="sb-card overflow-hidden">
        <div className="border-b px-4 py-3" style={{ borderColor: colors.border }}>
          <h2 className="text-sm font-semibold">Recent outliers</h2>
          <p className="mt-1 text-xs" style={{ color: colors.muted }}>
            At least 30% from the prior seven-positive-day median, within the latest 30 days. Dates are data dates, so
            they read one day earlier than the ingestion run that recorded them.
          </p>
        </div>
        <div className="divide-y" style={{ borderColor: colors.border }}>
          {anomalies.slice(0, 16).map((anomaly, index) => {
            const labelIndex = Math.max(0, competitorLabels.findIndex((label) => label.label_key === anomaly.label.label_key));
            return (
              <div key={`${anomaly.date}-${anomaly.label.label_key}-${index}`} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
                <time
                  className="font-mono text-[10px]"
                  style={{ color: colors.muted }}
                  dateTime={anomaly.date}
                  title={`Data date ${anomaly.date}`}
                >
                  {anomaly.date.slice(5)}
                </time>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-xs font-medium">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: labelColor(anomaly.label, labelIndex) }} />
                    {anomaly.label.display_name}
                  </div>
                  <div className="mt-0.5 truncate text-[9px]" style={{ color: colors.muted }}>7d median {formatInt(Math.round(anomaly.baseline))}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-xs tabular-nums">{formatInt(Math.round(anomaly.value))}</div>
                  <div className="font-mono text-[10px] tabular-nums" style={{ color: anomaly.deltaPct >= 0 ? colors.positive : colors.error }}>
                    {anomaly.deltaPct >= 0 ? "+" : ""}{anomaly.deltaPct.toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
          {!anomalies.length ? <div className="px-4 py-8 text-center text-xs" style={{ color: colors.muted }}>No 30-day outliers.</div> : null}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="sb-card p-4">
          <h2 className="text-sm font-semibold">Ingestion runs</h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...runHistory].reverse().map((run) => (
              <div
                key={`${run.run_date}-${run.started_at ?? ""}`}
                className="h-6 min-w-3 flex-1 rounded-sm"
                style={{ background: run.status === "success" ? colors.positive : run.status === "running" ? colors.info : colors.error, opacity: 0.68 }}
                title={`${run.run_date}: ${run.status}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[9px]" style={{ color: colors.muted }}>
            <span>{runHistory.at(-1)?.run_date ?? ""}</span><span>{runHistory[0]?.run_date ?? ""}</span>
          </div>
        </section>

        <section className="sb-card overflow-hidden">
          <div className="border-b px-4 py-3" style={{ borderColor: colors.border }}><h2 className="text-sm font-semibold">Recent warnings</h2></div>
          <div className="divide-y" style={{ borderColor: colors.border }}>
            {warnings.slice(0, 8).map((warning, index) => (
              <div key={`${warning.run_date}-${warning.code}-${index}`} className="grid grid-cols-[72px_70px_minmax(0,1fr)] gap-2 px-4 py-2 text-[10px]">
                <time className="font-mono" style={{ color: colors.muted }}>{warning.run_date}</time>
                <span style={{ color: warning.severity === "critical" ? colors.error : warning.severity === "warn" ? colors.warning : colors.info }}>{warning.code}</span>
                <span className="truncate" title={warning.message}>{warning.message}</span>
              </div>
            ))}
            {!warnings.length ? <div className="px-4 py-8 text-center text-xs" style={{ color: colors.muted }}>No recent warnings.</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
