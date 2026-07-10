"use client";

import { useEffect, useMemo, useState } from "react";

import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { dataDateFromRunDate } from "@/lib/sotDates";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { SilentSortHeader } from "@/components/ui/SilentSortHeader";

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

  type SortKey = "date" | "tracks" | "total" | "daily" | "revenue" | "missing";
  type SortState = { key: SortKey; asc: boolean } | null;
  const [sort, setSort] = useState<SortState>(null);

  function toggleSort(key: SortKey, defaultAsc: boolean) {
    if (!sort || sort.key !== key) {
      setSort({ key, asc: defaultAsc });
      return;
    }
    setSort({ key, asc: !sort.asc });
  }

  // Keep deltas meaningful: compute deltas based on date-desc order only.
  const trackDeltaByDate = useMemo(() => {
    const arr = [...rows30].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    const map = new Map<string, number>();
    for (let idx = 0; idx < arr.length; idx++) {
      const r = arr[idx]!;
      const prev = idx < arr.length - 1 ? arr[idx + 1]! : null;
      const delta = prev ? Number(r.track_count ?? 0) - Number(prev.track_count ?? 0) : 0;
      map.set(r.date, delta);
    }
    return map;
  }, [rows30]);

  const rows30Sorted = useMemo(() => {
    const out = [...rows30];
    const state = sort;
    if (!state) return out;
    out.sort((a, b) => {
      let c = 0;
      if (state.key === "date") c = String(a.date ?? "").localeCompare(String(b.date ?? ""));
      else if (state.key === "tracks") c = Number(a.track_count ?? 0) - Number(b.track_count ?? 0);
      else if (state.key === "total") c = Number(a.total_streams_cumulative ?? 0) - Number(b.total_streams_cumulative ?? 0);
      else if (state.key === "daily") c = Number(a.daily_streams_net ?? 0) - Number(b.daily_streams_net ?? 0);
      else if (state.key === "revenue") c = Number(a.total_streams_cumulative ?? 0) - Number(b.total_streams_cumulative ?? 0);
      else if (state.key === "missing") c = Number(a.missing_streams_track_count ?? 0) - Number(b.missing_streams_track_count ?? 0);
      if (c === 0) c = String(a.date ?? "").localeCompare(String(b.date ?? ""));
      return state.asc ? c : -c;
    });
    return out;
  }, [rows30, sort]);

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
            { label: <SilentSortHeader label="Date" onClick={() => toggleSort("date", false)} /> },
            { label: <SilentSortHeader label="Tracks" onClick={() => toggleSort("tracks", false)} align="right" />, align: "right" },
            { label: "" }, // Invisible column for track delta
            { label: <SilentSortHeader label="Total Streams" onClick={() => toggleSort("total", false)} align="right" />, align: "right" },
            { label: <SilentSortHeader label="Daily" onClick={() => toggleSort("daily", false)} align="right" />, align: "right" },
            { label: <SilentSortHeader label="Est. Rev" onClick={() => toggleSort("revenue", false)} align="right" />, align: "right" },
            { label: <SilentSortHeader label="Missing" onClick={() => toggleSort("missing", false)} align="right" />, align: "right" },
          ]}
          // Constrain height so the panel stays tidy; scroll for more.
          maxBodyHeightClassName="max-h-[320px] overflow-auto"
        >
          {rows30Sorted.map((r) => {
            const trackDelta = trackDeltaByDate.get(r.date) ?? 0;

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

