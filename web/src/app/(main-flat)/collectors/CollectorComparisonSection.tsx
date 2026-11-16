"use client";

import Link from "@/components/shell/RouteLink";
import dynamic from "next/dynamic";
import type { Dispatch, SetStateAction } from "react";
import { Activity } from "lucide-react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { SpotlightCard } from "@/components/ui/SpotlightCard";
import { Sparkline } from "@/components/charts/Sparkline";
import { formatDateISO, formatDisplayDate, formatInt } from "@/lib/format";
import { ChartSkeleton } from "@/components/ui/Skeleton";
import {
  COLLECTOR_COLORS,
  type CollectorDailyData,
  type ComparisonMode,
} from "@/components/charts/CollectorComparisonChart";
import { CollectorMultiSelect } from "@/components/ui/CollectorMultiSelect";
import type { Granularity } from "@/components/ui/GranularitySelect";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { toneClass } from "./collectorsUtils";

import {
  COLLECTOR_ORDER,
  type CollectorSummaryRow,
  type DrillKind,
  type Metric,
} from "./collectorsTypes";

const CollectorComparisonChart = dynamic(
  () =>
    import("@/components/charts/CollectorComparisonChart").then((m) => ({
      default: m.CollectorComparisonChart,
    })),
  { loading: () => <ChartSkeleton height={260} />, ssr: false },
);

/** Display values for one comparison-table row (see `computeComparisonRow` in CollectorsClient). */
type ComparisonRowView = {
  value: number;
  spark: number[] | null;
  fmtValue: string;
  fmtYday: string;
  fmtMa7: string;
  ydayValue: number | null;
  ma7Value: number | null;
  href: string;
  isSelectedCollector: boolean;
  isEmpty: boolean;
};

export function CollectorComparisonChartCard({
  latestDate,
  granularity,
  comparisonMode,
  setComparisonMode,
  showComparisonMA7,
  setShowComparisonMA7,
  comparisonCollectors,
  setComparisonCollectors,
  comparisonChartData,
  metric,
  handleDateClick,
}: {
  latestDate: string | null;
  granularity: Granularity;
  comparisonMode: ComparisonMode;
  setComparisonMode: Dispatch<SetStateAction<ComparisonMode>>;
  showComparisonMA7: boolean;
  setShowComparisonMA7: Dispatch<SetStateAction<boolean>>;
  comparisonCollectors: string[];
  setComparisonCollectors: Dispatch<SetStateAction<string[]>>;
  comparisonChartData: CollectorDailyData[];
  metric: Metric;
  handleDateClick: (date: string) => void;
}) {
  return (
    <SpotlightCard className="relative p-3 overflow-visible">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 opacity-60" />
              <div className="text-xs font-medium uppercase tracking-wide opacity-70">
                Collector Comparison
              </div>
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Compare revenue, streams, and track change over time
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 lg:w-auto">
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {granularity === "daily" && comparisonMode !== "percentage" ? (
                <Chip
                  selected={showComparisonMA7}
                  onClick={() => setShowComparisonMA7((visible) => !visible)}
                  className="px-2 py-1 text-[10px]"
                  title="Toggle trailing 7-day moving-average lines"
                  aria-label="Toggle trailing 7-day moving-average lines"
                >
                  MA7
                </Chip>
              ) : null}
              <ChipGroup segmented>
                {(["combined", "individual", "percentage"] as const).map((m) => (
                  <Chip key={m} segmented selected={comparisonMode === m} onClick={() => setComparisonMode(m)}>
                    {m === "combined" ? "Combined" : m === "individual" ? "Individual" : "Percentage"}
                  </Chip>
                ))}
              </ChipGroup>
            </div>

            <CollectorMultiSelect selected={comparisonCollectors} onChange={setComparisonCollectors} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {comparisonMode !== "combined" && comparisonCollectors.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              {COLLECTOR_ORDER.filter((c) => comparisonCollectors.includes(c)).map((collector) => (
                <div key={collector} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: COLLECTOR_COLORS[collector] }}
                  />
                  <span style={{ color: "var(--sb-text)" }}>{collector}</span>
                </div>
              ))}
            </div>
          )}
          {granularity !== "daily" && (
            <div className="text-[10px]" style={{ color: "var(--sb-muted)" }}>
              {granularity === "weekly" ? "Weeks start Monday (ISO)" : `Last 365 days to ${formatDisplayDate(latestDate)}`}
            </div>
          )}
        </div>

        <div className="mt-2 min-h-[260px]">
          <CollectorComparisonChart
            data={comparisonChartData}
            selectedCollectors={comparisonCollectors}
            mode={comparisonMode}
            metric={metric}
            heightPx={260}
            granularity={granularity}
            showMA7={showComparisonMA7}
            onDateClick={granularity === "daily" ? handleDateClick : undefined}
          />
        </div>
      </div>
    </SpotlightCard>
  );
}

export function CollectorComparisonTable({
  latestDate,
  selectedCollector,
  ranked,
  computeComparisonRow,
  comparisonTableMetric,
  comparisonTableMetricLabel,
  comparisonTableHeaderLabel,
  comparisonTableValueCellColor,
  comparisonBaseline,
  setComparisonBaseline,
  openDrill,
}: {
  latestDate: string | null;
  selectedCollector: string;
  ranked: CollectorSummaryRow[];
  computeComparisonRow: (r: CollectorSummaryRow) => ComparisonRowView;
  comparisonTableMetric: "streams" | "revenue";
  comparisonTableMetricLabel: string;
  comparisonTableHeaderLabel: string;
  comparisonTableValueCellColor: string;
  comparisonBaseline: "ma7" | "yday";
  setComparisonBaseline: Dispatch<SetStateAction<"ma7" | "yday">>;
  openDrill: (collector: string, kind: DrillKind) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between px-1">
        <div>
          <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>
            Comparison Table
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Showing {comparisonTableMetricLabel.toLowerCase()} on data date{" "}
            {latestDate ? formatDateISO(latestDate) : "—"}
          </div>
        </div>
      </div>

      <GlassTable
        tableLayout="fixed"
        className="relative"
        bodyClassName="overflow-x-auto"
          headers={[
            {
              label: "Collector",
              className: "sticky left-0 z-20 min-w-[110px]",
            },
            { label: <span title="Number of playlists">Playlists</span>, className: "w-[70px] text-right" },
            { label: "Artists", className: "w-[84px] text-right" },
            { label: "Tracks", className: "w-[84px] text-right" },
            { label: comparisonTableHeaderLabel, className: "w-[110px] text-right font-medium" },
            {
              label: (
                <button
                  type="button"
                  onClick={() => setComparisonBaseline((v) => (v === "ma7" ? "yday" : "ma7"))}
                  className="w-full text-right"
                  title={
                    comparisonBaseline === "ma7"
                      ? "Showing 7d avg (click to toggle to Yesterday)"
                      : "Showing Yesterday (click to toggle to 7d avg)"
                  }
                >
                  <span className="flex flex-col items-end"><span className="text-[9px] opacity-70">Metric</span>{comparisonBaseline === "ma7" ? "7-day avg" : "Yesterday"}</span>
                </button>
              ),
              className: "w-[110px]",
            },
            { label: "Trend", className: "hidden md:table-cell w-[110px]" },
          ]}
        >
          {ranked.map((r) => {
            const row = computeComparisonRow(r);

            return (
              <TableRow
                key={r.collector}
                title={row.isEmpty ? "No data in this period" : undefined}
                className={row.isSelectedCollector ? "bg-[color-mix(in_srgb,var(--sb-accent)_10%,transparent)] shadow-[inset_2px_0_0_var(--sb-accent)] hover:bg-[color-mix(in_srgb,var(--sb-accent)_10%,transparent)]" : "hover:bg-[color-mix(in_srgb,var(--sb-accent)_6%,transparent)]"}
              >
                <TableCell
                  className={`sticky left-0 z-10 px-0 py-0 ${row.isSelectedCollector ? "[background:linear-gradient(color-mix(in_srgb,var(--sb-accent)_10%,transparent),color-mix(in_srgb,var(--sb-accent)_10%,transparent)),linear-gradient(var(--sb-card),var(--sb-card)),var(--sb-bg)]" : "[background:linear-gradient(var(--sb-card),var(--sb-card)),var(--sb-bg)]"}`}
                >
                  <Link
                    href={row.href}
                    className={[
                      "flex h-full w-full items-center gap-2 px-3 py-2 font-medium transition-colors",
                      "sb-link-hover",
                      r.collector === selectedCollector ? "opacity-100" : "opacity-70",
                      row.isEmpty ? "opacity-50" : "",
                    ].join(" ")}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: COLLECTOR_COLORS[r.collector] ?? "var(--sb-muted)" }}
                      aria-hidden="true"
                    />
                    {r.collector}
                  </Link>
                </TableCell>
                <TableCell numeric>
                  <button
                    type="button"
                    className="w-full text-right font-medium transition-colors sb-link-hover"
                    onClick={() => openDrill(r.collector, "playlists")}
                    title={`Show playlists for ${r.collector}`}
                  >
                    <span className={row.isEmpty ? "opacity-50" : ""}>{formatInt(r.playlists)}</span>
                  </button>
                </TableCell>
                <TableCell numeric>
                  <button
                    type="button"
                    className="w-full text-right font-medium transition-colors sb-link-hover"
                    onClick={() => openDrill(r.collector, "artists")}
                    title={`Show artists for ${r.collector}`}
                  >
                    <span className={row.isEmpty ? "opacity-50" : ""}>{formatInt(r.artist_count)}</span>
                  </button>
                </TableCell>
                <TableCell numeric>
                  <button
                    type="button"
                    className="w-full text-right font-medium transition-colors sb-link-hover"
                    onClick={() => openDrill(r.collector, "tracks")}
                    title={`Show tracks for ${r.collector}`}
                  >
                    <span className={row.isEmpty ? "opacity-50" : ""}>{formatInt(r.track_count)}</span>
                  </button>
                </TableCell>
                <TableCell
                  numeric
                  className={`font-medium ${toneClass(row.value)}`}
                >
                  <span className={row.isEmpty ? "opacity-50" : ""}>{row.value ? row.fmtValue : "—"}</span>
                </TableCell>
                <TableCell numeric>
                  <span className={`${toneClass(comparisonBaseline === "ma7" ? row.ma7Value : row.ydayValue)} ${row.isEmpty ? "opacity-50" : ""}`}>
                    {(comparisonBaseline === "ma7" ? row.ma7Value : row.ydayValue)
                      ? comparisonBaseline === "ma7" ? row.fmtMa7 : row.fmtYday
                      : "—"}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className={`h-5 w-20 opacity-60 ${row.isEmpty ? "opacity-50" : ""}`}>
                    <Sparkline
                      data={row.spark ?? undefined}
                      mock={false}
                      trend="neutral"
                      upColor={comparisonTableMetric === "revenue" ? comparisonTableValueCellColor : undefined}
                    />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </GlassTable>
    </div>
  );
}
