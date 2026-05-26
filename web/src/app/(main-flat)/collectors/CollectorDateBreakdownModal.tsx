"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown, ArrowRightLeft } from "lucide-react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { Modal } from "@/components/ui/Modal";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { formatDateOrdinalDMonYYYY, formatInt, formatUsd2 } from "@/lib/format";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";

import type { Metric, DateBreakdownCollector } from "./collectorsTypes";

export function CollectorDateBreakdownModal({
  open,
  onClose,
  breakdownDate,
  breakdownData,
  breakdownLoading,
  breakdownError,
  comparisonCollectors,
  metric,
  streamPayoutPerStreamUsd,
}: {
  open: boolean;
  onClose: () => void;
  breakdownDate: string | null;
  breakdownData: Record<string, DateBreakdownCollector> | null;
  breakdownLoading: boolean;
  breakdownError: string | null;
  comparisonCollectors: string[];
  metric: Metric;
  streamPayoutPerStreamUsd: number;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        breakdownDate
          ? `Breakdown for ${formatDateOrdinalDMonYYYY(breakdownDate)}`
          : "Date Breakdown"
      }
      subtitle={`Showing ${metric === "revenue" ? "revenue" : "streams"} collected on this date vs. the prior 7-day average`}
      maxWidthClassName="max-w-4xl"
    >
      <div className="space-y-4">
        {breakdownError ? (
          <div className="text-xs text-red-600 dark:text-red-400">
            {breakdownError}
          </div>
        ) : breakdownLoading ? (
          <div
            className="text-center text-xs opacity-60 py-8"
            style={{ color: "var(--sb-muted)" }}
          >
            Loading breakdown…
          </div>
        ) : breakdownData ? (
          <>
            {/* Per-collector summary cards */}
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${comparisonCollectors.length}, minmax(0, 1fr))`,
              }}
            >
              {comparisonCollectors.map((collector) => {
                const d = breakdownData[collector];
                if (!d) return null;
                const deltaPct = d.delta_pct;
                const isUp = deltaPct != null && deltaPct >= 0;
                const absValue =
                  metric === "revenue"
                    ? formatUsd2(d.daily_streams * streamPayoutPerStreamUsd)
                    : formatInt(d.daily_streams);
                const avg7Formatted =
                  metric === "revenue"
                    ? formatUsd2(d.avg7_streams * streamPayoutPerStreamUsd)
                    : formatInt(Math.round(d.avg7_streams));

                return (
                  <div
                    key={collector}
                    className="rounded-xl border p-3"
                    style={{
                      borderColor: "var(--sb-border)",
                      background: "var(--sb-surface)",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            COLLECTOR_COLORS[collector] ?? "var(--sb-muted)",
                        }}
                      />
                      <span
                        className="text-sm font-semibold"
                        style={{ color: "var(--sb-text)" }}
                      >
                        {collector}
                      </span>
                    </div>
                    <div
                      className="text-lg font-bold"
                      style={{ color: "var(--sb-text)" }}
                    >
                      {absValue}
                    </div>
                    <div
                      className="text-[10px] mt-0.5 uppercase tracking-wider"
                      style={{ color: "var(--sb-muted)" }}
                    >
                      {metric === "revenue"
                        ? "revenue on this date"
                        : "streams on this date"}
                    </div>
                    <div
                      className="text-xs mt-1.5"
                      style={{ color: "var(--sb-muted)" }}
                    >
                      7-day avg: {avg7Formatted}
                    </div>
                    {deltaPct != null && (
                      <div className="flex items-center gap-1 mt-1.5">
                        {isUp ? (
                          <TrendingUp
                            className="h-3.5 w-3.5"
                            style={{ color: "#22c55e" }}
                          />
                        ) : (
                          <TrendingDown
                            className="h-3.5 w-3.5"
                            style={{ color: "#ef4444" }}
                          />
                        )}
                        <span
                          className="text-xs font-semibold"
                          style={{ color: isUp ? "#22c55e" : "#ef4444" }}
                        >
                          {isUp ? "+" : ""}
                          {deltaPct.toFixed(1)}%
                        </span>
                        <span
                          className="text-[10px] opacity-50"
                          style={{ color: "var(--sb-muted)" }}
                        >
                          vs 7d avg
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Roster changes */}
            <RosterChangesSection
              breakdownData={breakdownData}
              comparisonCollectors={comparisonCollectors}
              metric={metric}
              streamPayoutPerStreamUsd={streamPayoutPerStreamUsd}
            />

            {/* Top tracks per collector */}
            {comparisonCollectors.map((collector) => {
              const d = breakdownData[collector];
              if (!d?.top_tracks?.length) return null;

              return (
                <div key={collector}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{
                        backgroundColor:
                          COLLECTOR_COLORS[collector] ?? "var(--sb-muted)",
                      }}
                    />
                    <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                      {collector} — Top tracks
                    </span>
                  </div>
                  <GlassTable
                    headers={[
                      "",
                      "Track",
                      {
                        label:
                          metric === "revenue"
                            ? "Daily Revenue"
                            : "Daily Streams",
                        align: "right",
                      },
                      {
                        label:
                          metric === "revenue"
                            ? "Total Revenue"
                            : "Total Streams",
                        align: "right",
                      },
                    ]}
                  >
                    {d.top_tracks.map((t) => {
                      const dailyStreams = Number(t.daily_streams_delta ?? 0);
                      const totalStreams = Number(
                        t.total_streams_cumulative ?? 0,
                      );
                      const dailyFormatted =
                        metric === "revenue"
                          ? formatUsd2(
                              dailyStreams * streamPayoutPerStreamUsd,
                            )
                          : formatInt(dailyStreams);
                      const totalFormatted =
                        metric === "revenue"
                          ? formatUsd2(
                              totalStreams * streamPayoutPerStreamUsd,
                            )
                          : formatInt(totalStreams);

                      return (
                        <TableRow key={t.isrc}>
                          <TableCell>
                            {t.album_image_url ? (
                              <PreviewableArtwork
                                src={String(t.album_image_url)}
                                alt="Album"
                                width={28}
                                height={28}
                                className="h-7 w-7 rounded-lg object-cover sb-ring"
                                label={t.name ?? t.isrc}
                              />
                            ) : (
                              <div className="h-7 w-7 rounded-lg sb-ring bg-white/60 dark:bg-white/10" />
                            )}
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/tracks/${encodeURIComponent(t.isrc)}`}
                              className="font-medium transition-colors sb-link-hover text-sm"
                            >
                              {t.name ?? t.isrc}
                            </Link>
                            {t.artist_names?.length ? (
                              <div className="text-xs opacity-60 truncate">
                                <ArtistLinks
                                  artistNames={t.artist_names}
                                  artistIds={t.artist_ids}
                                />
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell
                            numeric
                            className="font-medium"
                            style={{
                              color:
                                metric === "revenue"
                                  ? "#10b981"
                                  : "var(--sb-positive)",
                            }}
                          >
                            {dailyFormatted}
                          </TableCell>
                          <TableCell numeric className="opacity-60">
                            {totalFormatted}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </GlassTable>
                </div>
              );
            })}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/* ── Roster changes sub-section ─────────────────────────────── */

function RosterChangesSection({
  breakdownData,
  comparisonCollectors,
  metric,
  streamPayoutPerStreamUsd,
}: {
  breakdownData: Record<string, DateBreakdownCollector>;
  comparisonCollectors: string[];
  metric: Metric;
  streamPayoutPerStreamUsd: number;
}) {
  const hasRosterChanges = comparisonCollectors.some((c) => {
    const d = breakdownData[c];
    return (
      d &&
      ((d.roster_additions?.length ?? 0) > 0 ||
        (d.roster_removals?.length ?? 0) > 0)
    );
  });
  if (!hasRosterChanges) return null;

  return (
    <>
      {comparisonCollectors.map((collector) => {
        const d = breakdownData[collector];
        if (!d) return null;
        const additions = d.roster_additions ?? [];
        const removals = d.roster_removals ?? [];
        if (!additions.length && !removals.length) return null;

        const impact = d.roster_cumulative_impact ?? 0;
        const isPositive = impact >= 0;

        return (
          <div
            key={`roster-${collector}`}
            className="rounded-xl border p-3"
            style={{
              borderColor: isPositive
                ? "rgba(245,158,11,0.4)"
                : "rgba(239,68,68,0.4)",
              background: isPositive
                ? "rgba(245,158,11,0.06)"
                : "rgba(239,68,68,0.06)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <ArrowRightLeft
                className="h-3.5 w-3.5"
                style={{ color: "#F59E0B" }}
              />
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor:
                    COLLECTOR_COLORS[collector] ?? "var(--sb-muted)",
                }}
              />
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--sb-text)" }}
              >
                {collector} — Roster changes
              </span>
            </div>

            <div className="text-xs mb-2" style={{ color: "var(--sb-muted)" }}>
              {additions.length > 0 && (
                <span>
                  <span style={{ color: "#22c55e" }}>
                    +{additions.length} track
                    {additions.length !== 1 ? "s" : ""} added
                  </span>
                  {removals.length > 0 && <span> &middot; </span>}
                </span>
              )}
              {removals.length > 0 && (
                <span style={{ color: "#ef4444" }}>
                  &minus;{removals.length} track
                  {removals.length !== 1 ? "s" : ""} removed
                </span>
              )}
              <span> — cumulative impact: </span>
              <span
                className="font-semibold"
                style={{ color: isPositive ? "#22c55e" : "#ef4444" }}
              >
                {isPositive ? "+" : "−"}
                {metric === "revenue"
                  ? formatUsd2(
                      Math.abs(impact) * streamPayoutPerStreamUsd,
                    )
                  : formatInt(Math.abs(impact))}
              </span>
            </div>

            {additions.length > 0 && (
              <div className="space-y-1.5">
                {additions.map((t) => (
                  <div key={t.isrc} className="flex items-center gap-2">
                    {t.album_image_url ? (
                      <PreviewableArtwork
                        src={String(t.album_image_url)}
                        alt="Album"
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-md object-cover sb-ring flex-none"
                        label={t.name ?? t.isrc}
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-md sb-ring bg-white/60 dark:bg-white/10 flex-none" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/tracks/${encodeURIComponent(t.isrc)}`}
                        className="text-xs font-medium sb-link-hover truncate block"
                      >
                        {t.name ?? t.isrc}
                      </Link>
                      {t.artist_names?.length ? (
                        <div className="text-[10px] opacity-50 truncate">
                          <ArtistLinks
                            artistNames={t.artist_names}
                            artistIds={t.artist_ids}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right flex-none">
                      <div
                        className="text-xs font-semibold"
                        style={{ color: "#22c55e" }}
                      >
                        +
                        {metric === "revenue"
                          ? formatUsd2(
                              t.cumulative_streams *
                                streamPayoutPerStreamUsd,
                            )
                          : formatInt(t.cumulative_streams)}
                      </div>
                      <div
                        className="text-[10px]"
                        style={{ color: "var(--sb-muted)" }}
                      >
                        accumulated
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {removals.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {removals.map((t) => (
                  <div
                    key={t.isrc}
                    className="flex items-center gap-2 opacity-60"
                  >
                    {t.album_image_url ? (
                      <PreviewableArtwork
                        src={String(t.album_image_url)}
                        alt="Album"
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-md object-cover sb-ring flex-none"
                        label={t.name ?? t.isrc}
                      />
                    ) : (
                      <div className="h-6 w-6 rounded-md sb-ring bg-white/60 dark:bg-white/10 flex-none" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span
                        className="text-xs font-medium truncate block"
                        style={{ color: "var(--sb-text)" }}
                      >
                        {t.name ?? t.isrc}
                      </span>
                    </div>
                    <div className="text-right flex-none">
                      <div
                        className="text-xs font-semibold"
                        style={{ color: "#ef4444" }}
                      >
                        &minus;
                        {metric === "revenue"
                          ? formatUsd2(
                              t.cumulative_streams *
                                streamPayoutPerStreamUsd,
                            )
                          : formatInt(t.cumulative_streams)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
