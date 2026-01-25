"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { formatDateISO } from "@/lib/format";

type ChartData = {
  date: string;
  value: number;
};

type InteractiveChartSectionProps = {
  dailyStreamsData: ChartData[];
  totalStreamsData: ChartData[];
  activeTracksData: ChartData[];
  dailyStreamsValue: number;
  totalStreamsValue: number;
  activeTracksValue: number;
  rangeDays: number;
  latestDate: string | null;
};

type ChartType = "daily" | "total" | "tracks";

export function InteractiveChartSection({
  dailyStreamsData,
  totalStreamsData,
  activeTracksData,
  dailyStreamsValue,
  totalStreamsValue,
  activeTracksValue,
  rangeDays,
  latestDate,
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
    tracks: {
      title: "Active Tracks",
      data: activeTracksData,
      valueLabel: "Tracks",
    },
  };

  const currentChart = chartConfigs[selectedChart];

  return (
    <>
      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
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
        <button
          onClick={() => setSelectedChart("tracks")}
          className="w-full text-left transition-opacity hover:opacity-80 focus:outline-none"
          type="button"
        >
          <StatCard
            title="Active Tracks"
            value={<AnimatedCounter value={activeTracksValue} />}
            subtitle="Tracked"
            accent={selectedChart === "tracks"}
            trendData={activeTracksData.map((d) => d.value).slice(0, 30).reverse()}
          />
        </button>
      </div>

      {/* Chart */}
      <SpotlightCard className="relative p-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 opacity-60" />
            <div className="text-xs font-medium uppercase tracking-wide opacity-70">
              {currentChart.title}
            </div>
          </div>
          <div className="text-[11px] opacity-60">
            {latestDate && (
              <>
                Last updated <span className="font-mono">{formatDateISO(latestDate)}</span>
              </>
            )}
          </div>
        </div>

        <div className="mt-2">
          <DailyStreamsChart
            data={currentChart.data}
            valueLabel={currentChart.valueLabel}
            heightPx={220}
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
