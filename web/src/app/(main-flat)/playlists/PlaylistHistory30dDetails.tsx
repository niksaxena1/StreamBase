"use client";

import { useEffect, useMemo, useState } from "react";

import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { readStoredBool, writeStoredBool } from "@/lib/storage";

const PLAYLIST_HISTORY_DETAILS_STORAGE = {
  history30Open: "sb:playlists:details:history30_open",
} as const;

export type PlaylistHistoryRow = {
  date: string;
  track_count: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
  missing_streams_track_count?: number | null;
};

export function PlaylistHistory30dDetails(props: { rows: PlaylistHistoryRow[] }) {
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const rows30 = useMemo(() => (props.rows ?? []).slice(0, 30), [props.rows]);

  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(readStoredBool(PLAYLIST_HISTORY_DETAILS_STORAGE.history30Open, false));
  }, []);

  useEffect(() => {
    writeStoredBool(PLAYLIST_HISTORY_DETAILS_STORAGE.history30Open, open);
  }, [open]);

  return (
    <details
      open={open}
      onToggle={(ev) => setOpen(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                <span title="Missing streams = tracks not present in catalog snapshot today">
                  History (30d)
                </span>
              </div>
            </div>
          </div>
        </div>
      </summary>

      <div className="mt-3">
        <GlassTable
          headers={[
            { label: "Date" },
            { label: "Tracks", align: "right" },
            { label: "" }, // Invisible column for track delta
            { label: "Total Streams", align: "right" },
            { label: "Daily", align: "right" },
            { label: "Est. Rev", align: "right" },
            { label: "Missing", align: "right" },
          ]}
          // Constrain height so the panel stays tidy; scroll for more.
          maxBodyHeightClassName="max-h-[320px] overflow-auto"
        >
          {rows30.map((r, idx) => {
            const prev = idx < rows30.length - 1 ? rows30[idx + 1] : null;
            const trackDelta = prev ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0) : 0;

            return (
              <TableRow key={r.date}>
                <TableCell mono>{formatDateISO(dataDateFromRunDate(r.date))}</TableCell>
                <TableCell numeric>{formatInt(r.track_count)}</TableCell>
                <TableCell className="w-12 pl-1 pr-0 text-xs">
                  {trackDelta !== 0 && (
                    <span
                      className={
                        trackDelta > 0 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400"
                      }
                    >
                      {trackDelta > 0 ? "+" : ""}
                      {formatInt(trackDelta)}
                    </span>
                  )}
                </TableCell>
                <TableCell numeric>{formatInt(r.total_streams_cumulative)}</TableCell>
                <TableCell numeric className="sb-positive font-medium">
                  {formatInt(r.daily_streams_net)}
                </TableCell>
                <TableCell numeric>
                  {formatUsd(Number(r.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd)}
                </TableCell>
                <TableCell numeric>
                  {r.missing_streams_track_count ? (
                    <span className="text-red-600 dark:text-red-400 font-medium">
                      {formatInt(r.missing_streams_track_count)}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
          {!rows30.length && <EmptyState colSpan={7} message="No stats yet for this playlist." />}
        </GlassTable>
      </div>
    </details>
  );
}

