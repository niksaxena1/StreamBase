"use client";

import { useEffect, useState } from "react";

import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { HOME_DETAILS_STORAGE } from "./homeUtils";
import type { PlaylistDailyStatsRow } from "./homeTypes";

export function HomeHistorySection(props: {
  history: PlaylistDailyStatsRow[];
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const [openHistory, setOpenHistory] = useState(false);

  // Restore persisted open state
  useEffect(() => {
    const restored = readStoredBool(HOME_DETAILS_STORAGE.historyOpen, false);
    if (restored) setOpenHistory(true);
  }, []);

  // Persist open state
  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.historyOpen, openHistory);
  }, [openHistory]);

  return (
    <details
      open={openHistory}
      onToggle={(ev) => setOpenHistory(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Recent History
            </div>
          </div>
        </div>
      </summary>

      <div className="mt-3">
        <GlassTable
          headers={[
            { label: "Date" },
            { label: "Tracks", align: "right" },
            { label: "" },
            { label: metric === "revenue" ? "Total Revenue" : "Total Streams", align: "right" },
            { label: metric === "revenue" ? "Daily Revenue" : "Daily Streams", align: "right" },
          ]}
          maxBodyHeightClassName="max-h-[228px] overflow-auto"
        >
          {(props.history ?? []).map((r, idx) => {
            const prev = idx < (props.history ?? []).length - 1 ? (props.history ?? [])[idx + 1] : null;
            const trackDelta = prev ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0) : 0;
            return (
              <TableRow key={r.date}>
                <TableCell mono>{formatDateISO(dataDateFromRunDate(r.date))}</TableCell>
                <TableCell numeric>{formatInt(r.track_count)}</TableCell>
                <TableCell className="w-12 pl-1 pr-0 text-xs">
                  {trackDelta !== 0 && (
                    <span className={trackDelta > 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"}>
                      {trackDelta > 0 ? "+" : ""}{formatInt(trackDelta)}
                    </span>
                  )}
                </TableCell>
                <TableCell numeric>
                  {metric === "revenue"
                    ? formatUsd(Number(r.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd)
                    : formatInt(r.total_streams_cumulative)}
                </TableCell>
                <TableCell numeric className={metric === "revenue" ? "font-medium" : "sb-positive font-medium"} style={metric === "revenue" ? { color: "#10b981" } : undefined}>
                  {metric === "revenue"
                    ? formatUsd(Number(r.daily_streams_net ?? 0) * streamPayoutPerStreamUsd)
                    : formatInt(r.daily_streams_net)}
                </TableCell>
              </TableRow>
            );
          })}
          {!props.history?.length && <EmptyState colSpan={5} message="No stats found yet" />}
        </GlassTable>
      </div>
    </details>
  );
}
