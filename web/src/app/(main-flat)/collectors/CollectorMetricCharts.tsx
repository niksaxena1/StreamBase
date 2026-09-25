"use client";

import type { Dispatch, SetStateAction } from "react";

import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { DailyStreamsWithMAChart } from "@/components/charts/DailyStreamsWithMAChart";
import { MonthlyBarChart, type MonthlyDataPoint } from "@/components/charts/MonthlyBarChart";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";
import { Chip } from "@/components/ui/Chip";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import type { aggregateCumulativeSeries, aggregateDailySeries } from "@/lib/granularity";

import type { Metric } from "./collectorsTypes";

/** Selected collector header + cumulative / daily / monthly charts. */
export function CollectorMetricCharts({
  selectedCollector,
  rangeDays,
  metric,
  metricLabel,
  cumulativeLabel,
  dailyLabel,
  valueFormat,
  yTickFormat,
  chartColor,
  granCumulative,
  granDaily,
  monthlyChartDataForMetric,
  showActualRevenue,
  setShowActualRevenue,
  openRevenueForecast,
}: {
  selectedCollector: string;
  rangeDays: number;
  metric: Metric;
  metricLabel: string;
  cumulativeLabel: string;
  dailyLabel: string;
  valueFormat: "int" | "usd";
  yTickFormat: "k" | "int" | "usd_compact";
  chartColor: string;
  granCumulative: ReturnType<typeof aggregateCumulativeSeries>;
  granDaily: ReturnType<typeof aggregateDailySeries>;
  monthlyChartDataForMetric: MonthlyDataPoint[];
  showActualRevenue: boolean;
  setShowActualRevenue: Dispatch<SetStateAction<boolean>>;
  openRevenueForecast: (monthKey: string) => void;
}) {
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight sm:text-2xl flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: COLLECTOR_COLORS[selectedCollector] ?? "var(--sb-muted)",
              }}
              aria-hidden="true"
            />
            {selectedCollector}
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            {rangeDays} day view
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              {cumulativeLabel}
            </div>
            <ChartCsvDownloadButton
              rows={granCumulative as unknown as Array<Record<string, unknown>>}
              filename={`collectors-${slugifyForFilename(cumulativeLabel)}-${rangeDays}d-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <div className="mt-2 min-h-[220px]">
            <DailyStreamsChart
              data={granCumulative}
              valueLabel={metricLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
              heightPx={220}
              isCumulative={metric !== "tracks"}
              showMA7={false}
              color={chartColor}
            />
          </div>
        </SpotlightCard>

        <SpotlightCard className="lg:col-span-6 p-3 overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              {dailyLabel}
            </div>
            <ChartCsvDownloadButton
              rows={granDaily as unknown as Array<Record<string, unknown>>}
              filename={`collectors-${slugifyForFilename(dailyLabel)}-${rangeDays}d-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
          <div className="mt-2 min-h-[220px]">
            <DailyStreamsWithMAChart
              data={granDaily}
              valueLabel={metric === "tracks" ? "Tracks" : metricLabel}
              valueFormat={valueFormat}
              yTickFormat={yTickFormat}
              heightPx={220}
              dailyColor={chartColor}
            />
          </div>
        </SpotlightCard>
      </div>

      <SpotlightCard className="p-3 overflow-visible">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
            Monthly {metric === "revenue" ? "Est. Revenue" : metric === "streams" ? "Streams" : "Track"}
          </div>
          <div className="flex items-center gap-2">
            {metric === "revenue" ? (
              <Chip
                selected={showActualRevenue}
                onClick={() => setShowActualRevenue((v) => !v)}
                title="Toggle actual revenue markers"
              >
                Show actual
              </Chip>
            ) : null}
            <ChartCsvDownloadButton
              rows={(monthlyChartDataForMetric) as unknown as Array<Record<string, unknown>>}
              filename={`collectors-${slugifyForFilename(`monthly-${metric}`)}-${todayIsoDate()}.csv`}
              title="Download CSV"
            />
          </div>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          All-time monthly aggregation (not affected by date range)
        </p>
        <div className="mt-3 min-h-[220px]">
          <MonthlyBarChart
            data={monthlyChartDataForMetric}
            valueLabel={metricLabel}
            valueFormat={valueFormat}
            yTickFormat={yTickFormat}
            heightPx={220}
            color={chartColor}
            showActualRevenue={metric === "revenue" && showActualRevenue}
            onMonthClick={metric === "revenue" ? openRevenueForecast : undefined}
          />
        </div>
      </SpotlightCard>
    </>
  );
}
