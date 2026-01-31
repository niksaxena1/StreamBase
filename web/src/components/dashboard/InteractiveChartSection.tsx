"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";

type ChartData = {
  date: string;
  value: number;
  ma7?: number | null;
};

type InteractiveChartSectionProps = {
  dailyStreamsData: ChartData[];
  totalStreamsData: ChartData[];
  dailyStreamsValue: number;
  totalStreamsValue: number;
  rangeDays: number;
  dailyTitle?: string;
  totalTitle?: string;
  dailyValueLabel?: string;
  totalValueLabel?: string;
  valueFormat?: "int" | "usd";
  yTickFormat?: "k" | "int" | "usd_compact";
  color?: string;
  /**
   * Optional controlled mode for which chart is selected.
   * If omitted, the component manages its own state.
   */
  selectedChart?: ChartType;
  onSelectChart?: (next: ChartType) => void;
};

type ChartType = "daily" | "total";

export function InteractiveChartSection({
  dailyStreamsData,
  totalStreamsData,
  dailyStreamsValue,
  totalStreamsValue,
  rangeDays,
  dailyTitle = "Daily Streams",
  totalTitle = "Total Streams",
  dailyValueLabel = "Streams",
  totalValueLabel = "Total Streams",
  valueFormat = "int",
  yTickFormat = "k",
  color = "#c7f33c",
  selectedChart: selectedChartProp,
  onSelectChart,
}: InteractiveChartSectionProps) {
  const [selectedChartState, setSelectedChartState] =
    useState<ChartType>("daily");
  const selectedChart = selectedChartProp ?? selectedChartState;
  const setSelectedChart = onSelectChart ?? setSelectedChartState;

  const chartConfigs = {
    daily: {
      title: dailyTitle,
      data: dailyStreamsData,
      valueLabel: dailyValueLabel,
    },
    total: {
      title: totalTitle,
      data: totalStreamsData,
      valueLabel: totalValueLabel,
    },
  };

  const currentChart = chartConfigs[selectedChart];

  return (
    <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <button
          onClick={() => setSelectedChart("daily")}
          className="w-full text-left transition-opacity hover:opacity-80 focus:outline-none"
          type="button"
        >
          <StatCard
            title={dailyTitle}
            value={<AnimatedCounter value={dailyStreamsValue} format={valueFormat} />}
            subtitle={`${rangeDays}d view`}
            accent={selectedChart === "daily"}
            trend="up"
            trendData={dailyStreamsData.map((d) => d.value).slice(0, 30).reverse()}
          />
        </button>
        <button
          onClick={() => setSelectedChart("total")}
          className="w-full text-left transition-opacity hover:opacity-80 focus:outline-none"
          type="button"
        >
          <StatCard
            title={totalTitle}
            value={<AnimatedCounter value={totalStreamsValue} format={valueFormat} />}
            subtitle="Lifetime"
            accent={selectedChart === "total"}
            trendData={totalStreamsData.map((d) => d.value).slice(0, 30).reverse()}
          />
        </button>
      </div>

      {/* Chart */}
      <SpotlightCard className="relative p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 opacity-60" />
            <div className="text-xs font-medium uppercase tracking-wide opacity-70">
              {currentChart.title}
            </div>
          </div>
          <ChartCsvDownloadButton
            rows={currentChart.data as Array<Record<string, unknown>>}
            filename={`home-${slugifyForFilename(currentChart.title)}-${rangeDays}d-${todayIsoDate()}.csv`}
            title="Download CSV"
          />
        </div>

        <div className="mt-2">
          <DailyStreamsChart
            data={currentChart.data}
            valueLabel={currentChart.valueLabel}
            valueFormat={valueFormat}
            yTickFormat={yTickFormat}
            color={color}
            heightPx={220}
            showMA7={selectedChart === "daily"}
            isCumulative={selectedChart === "total"}
          />
        </div>

        {/* Decorative background glow (subtle) */}
        <div
          className="pointer-events-none absolute -right-14 -top-14 h-40 w-40 rounded-full opacity-15 blur-3xl"
          style={{ background: "var(--sb-accent)" }}
        />
      </SpotlightCard>
    </>
  );
}
