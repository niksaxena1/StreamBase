"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { formatInt, formatUsd } from "@/lib/format";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { todayIsoDate } from "@/lib/csv";
import type { NegativeDailyStreamsRow } from "./homeTypes";

const STORAGE_KEY_OPEN = "sb:home-negative-daily-open";

type SortKey = "date" | "daily_streams_delta" | "total_streams_cumulative";

export function HomeNegativeStreamsSection(props: {
  negativeDailyStreams: NegativeDailyStreamsRow[];
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const [open, setOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setOpen(readStoredBool(STORAGE_KEY_OPEN, false));
  }, []);

  useEffect(() => {
    writeStoredBool(STORAGE_KEY_OPEN, open);
  }, [open]);

  const data = props.negativeDailyStreams ?? [];

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      let av: number, bv: number;
      if (sortKey === "date") {
        av = new Date(a.date).getTime();
        bv = new Date(b.date).getTime();
      } else {
        av = Number(a[sortKey] ?? 0);
        bv = Number(b[sortKey] ?? 0);
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return null;
    return <span className="ml-1 opacity-60">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  // Metric-aware formatters. "tracks" is treated the same as "streams".
  const isRevenue = metric === "revenue";
  const formatMetricValue = (streams: number) =>
    isRevenue ? formatUsd(streams * streamPayoutPerStreamUsd) : formatInt(streams);

  // Total streams is always positive — use accent positive colour.
  const totalClass = isRevenue ? "font-medium" : "sb-positive font-medium";
  const totalStyle = isRevenue ? ({ color: "#10b981" } as const) : undefined;

  // Daily delta is always negative here — always red regardless of metric.
  const dailyStyle = { color: "#ef4444" } as const;

  const columnLabel = isRevenue ? "DAILY REV Δ" : "DAILY Δ";
  const totalColumnLabel = isRevenue ? "TOTAL REV" : "TOTAL";

  const count = data.length;

  return (
    <details
      open={open}
      onToggle={(ev) => setOpen(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <span
              className="mt-0.5 flex-shrink-0 text-xs opacity-60 transition-transform duration-150"
              style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▸
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                TRACKS: NEGATIVE STREAMS
              </div>
              {open ? (
                <div className="mt-0.5 text-[10px] opacity-40">
                  All dates where daily streams dropped vs previous day
                  {count > 0 ? ` · ${count} occurrence${count !== 1 ? "s" : ""}` : ""}
                </div>
              ) : null}
            </div>
          </div>
          {open ? (
            <div
              className="flex-shrink-0"
              onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
            >
              <ChartCsvDownloadButton
                filename={`home-negative-streams-${todayIsoDate()}.csv`}
                rows={sorted.map((r) => ({
                  name: r.name,
                  isrc: r.isrc,
                  artists: (r.artist_names ?? []).join(", "),
                  date: r.date,
                  daily_streams_delta: r.daily_streams_delta,
                  total_streams_cumulative: r.total_streams_cumulative,
                }))}
                title="Download negative streams CSV"
              />
            </div>
          ) : null}
        </div>
      </summary>

      <div className="mt-3">
        <GlassTable
          headers={[
            "TRACK",
            {
              label: (
                <button type="button" className="sb-link-hover" onClick={() => toggleSort("date")}>
                  DATE{sortIndicator("date")}
                </button>
              ),
              align: "center",
            },
            {
              label: (
                <button 
                  type="button" 
                  className="sb-link-hover" 
                  onClick={() => toggleSort("daily_streams_delta")}
                  title="Stream change from previous day (negative values indicate corrections or deduplication)"
                >
                  {columnLabel}{sortIndicator("daily_streams_delta")}
                </button>
              ),
              align: "right",
            },
            {
              label: (
                <button 
                  type="button" 
                  className="sb-link-hover" 
                  onClick={() => toggleSort("total_streams_cumulative")}
                  title="Cumulative stream total as of the date shown"
                >
                  {totalColumnLabel}{sortIndicator("total_streams_cumulative")}
                </button>
              ),
              align: "right",
            },
          ]}
          maxBodyHeightClassName="max-h-[600px]"
        >
          {sorted.length === 0 ? (
            <EmptyState colSpan={4} message="No negative stream occurrences found" />
          ) : (
            sorted.map((row, idx) => (
              <TableRow key={`${row.isrc}-${row.date}-${idx}`}>
                <TableCell>
                  <div className="flex items-center gap-2 min-w-0">
                    {row.album_image_url ? (
                      <PreviewableArtwork
                        src={row.album_image_url}
                        alt={row.name}
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded-lg object-cover sb-ring flex-shrink-0"
                        label={row.name}
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <Link
                        href={`/catalog?isrc=${encodeURIComponent(row.isrc)}`}
                        className="font-medium transition-colors sb-link-hover block truncate"
                      >
                        {row.name}
                      </Link>
                      <div className="text-[10px] opacity-50 truncate">
                        {row.artist_names && row.artist_names.length > 0
                          ? row.artist_names.map((artistName, i) => {
                              const artistId = row.artist_ids?.[i];
                              return (
                                <span key={i}>
                                  {i > 0 && ", "}
                                  {artistId ? (
                                    <Link
                                      href={`/catalog?artist_id=${encodeURIComponent(artistId)}`}
                                      className="sb-link-hover hover:opacity-80 transition-opacity"
                                    >
                                      {artistName}
                                    </Link>
                                  ) : (
                                    artistName
                                  )}
                                </span>
                              );
                            })
                          : "—"}
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className="text-center font-mono text-[11px]">
                  {row.date}
                </TableCell>

                <TableCell numeric style={dailyStyle} className="font-semibold">
                  {formatMetricValue(row.daily_streams_delta)}
                </TableCell>

                <TableCell numeric className={totalClass} style={totalStyle}>
                  {formatMetricValue(row.total_streams_cumulative)}
                </TableCell>
              </TableRow>
            ))
          )}
        </GlassTable>
      </div>
    </details>
  );
}
