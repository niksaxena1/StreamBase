"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";

type ChartData = {
  date: string;
  value: number;
};

type InteractiveChartSectionProps = {
  dailyStreamsData: ChartData[];
  totalStreamsData: ChartData[];
  dailyStreamsValue: number;
  totalStreamsValue: number;
  rangeDays: number;
};

type ChartType = "daily" | "total";

export function InteractiveChartSection({
  dailyStreamsData,
  totalStreamsData,
  dailyStreamsValue,
  totalStreamsValue,
  rangeDays,
}: InteractiveChartSectionProps) {
  const [selectedChart, setSelectedChart] = useState<ChartType>("daily");

  const chartConfigs = {
    daily: {
      title: "Daily Streams",
      data: dailyStreamsData,
      valueLabel: "Streams",
    },
    total: {
      title: "Total Streams",
      data: totalStreamsData,
      valueLabel: "Total Streams",
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
            title="Daily Streams"
            value={<AnimatedCounter value={dailyStreamsValue} />}
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
            title="Total Streams"
            value={<AnimatedCounter value={totalStreamsValue} />}
            subtitle="Lifetime"
            accent={selectedChart === "total"}
            trendData={totalStreamsData.map((d) => d.value).slice(0, 30).reverse()}
          />
        </button>
      </div>

      {/* Chart */}
      <SpotlightCard className="relative p-3">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 opacity-60" />
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">
            {currentChart.title}
          </div>
        </div>

        <div className="mt-2">
          <DailyStreamsChart
            data={currentChart.data}
            valueLabel={currentChart.valueLabel}
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
