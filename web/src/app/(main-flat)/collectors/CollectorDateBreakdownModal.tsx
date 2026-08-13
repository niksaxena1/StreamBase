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

function seriesColor(
  key: string,
  seriesColors?: Record<string, string>,
): string {
  return seriesColors?.[key] ?? COLLECTOR_COLORS[key] ?? "var(--sb-muted)";
}

function seriesName(key: string, seriesLabels?: Record<string, string>): string {
  return seriesLabels?.[key] ?? key;
}

function ContributionWaterfall({
  breakdownData,
  comparisonCollectors,
  metric,
  streamPayoutPerStreamUsd,
  seriesLabels,
}: {
  breakdownData: Record<string, DateBreakdownCollector>;
  comparisonCollectors: string[];
  metric: Metric;
  streamPayoutPerStreamUsd: number;
  seriesLabels?: Record<string, string>;
}) {
  const factor = metric === "revenue" ? streamPayoutPerStreamUsd : 1;
  const contributions = comparisonCollectors
    .map((key) => {
      const row = breakdownData[key];
      return {
        key,
        label: seriesName(key, seriesLabels),
        value: row ? (row.daily_streams - row.avg7_streams) * factor : 0,
      };
    })
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const steps = contributions.reduce<
    Array<(typeof contributions)[number] & { start: number; end: number }>
  >((rows, row) => {
    const start = rows.at(-1)?.end ?? 0;
    rows.push({ ...row, start, end: start + row.value });
    return rows;
  }, []);
  const total = steps.at(-1)?.end ?? 0;
  const extent = [0, total, ...steps.flatMap((step) => [step.start, step.end])];
  let min = Math.min(...extent);
  let max = Math.max(...extent);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = Math.max(1, (max - min) * 0.16);
  min -= padding;
  max += padding;
  const width = Math.max(640, (steps.length + 1) * 104 + 68);
  const height = 250;
  const chartTop = 22;
  const chartBottom = 194;
  const y = (value: number) => chartTop + ((max - value) / (max - min)) * (chartBottom - chartTop);
  const barWidth = 44;
  const formatValue = (value: number) =>
    metric === "revenue" ? formatUsd2(value) : formatInt(Math.round(value));

  return (
    <section className="border-b pb-4" style={{ borderColor: "var(--sb-border)" }}>
      <div className="mb-2">
        <div className="text-xs font-medium uppercase tracking-wide opacity-70">Variance contribution</div>
        <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          Each label&apos;s difference from its prior 7-day average; the final bar is the combined variance.
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[250px] min-w-[640px] w-full" role="img" aria-label="Waterfall of label contributions to the selected date's variance from the prior seven-day average">
          <line x1="42" x2={width - 18} y1={y(0)} y2={y(0)} stroke="var(--sb-border)" strokeDasharray="4 4" />
          {steps.map((step, index) => {
            const x = 62 + index * 104;
            const top = Math.min(y(step.start), y(step.end));
            const barHeight = Math.max(2, Math.abs(y(step.start) - y(step.end)));
            const positive = step.value >= 0;
            const nextX = 62 + (index + 1) * 104;
            return (
              <g key={step.key}>
                <rect x={x} y={top} width={barWidth} height={barHeight} rx="4" fill={positive ? "var(--sb-positive)" : "var(--sb-negative, #ef4444)"} opacity="0.78" />
                {index < steps.length - 1 ? <line x1={x + barWidth} x2={nextX} y1={y(step.end)} y2={y(step.end)} stroke="var(--sb-muted)" strokeOpacity="0.35" /> : null}
                <text x={x + barWidth / 2} y={positive ? top - 6 : top + barHeight + 13} textAnchor="middle" fill={positive ? "var(--sb-positive)" : "var(--sb-negative, #ef4444)"} fontSize="10" fontWeight="600">
                  {step.value >= 0 ? "+" : ""}{formatValue(step.value)}
                </text>
                <text x={x + barWidth / 2} y="218" textAnchor="middle" fill="var(--sb-muted)" fontSize="10">
                  {step.label.length > 13 ? `${step.label.slice(0, 12)}...` : step.label}
                </text>
              </g>
            );
          })}
          {(() => {
            const x = 62 + steps.length * 104;
            const top = Math.min(y(0), y(total));
            const barHeight = Math.max(2, Math.abs(y(0) - y(total)));
            return (
              <g>
                <rect x={x} y={top} width={barWidth} height={barHeight} rx="4" fill="var(--sb-info, #6366f1)" opacity="0.82" />
                <text x={x + barWidth / 2} y={total >= 0 ? top - 6 : top + barHeight + 13} textAnchor="middle" fill="var(--sb-info, #6366f1)" fontSize="10" fontWeight="700">
                  {total >= 0 ? "+" : ""}{formatValue(total)}
                </text>
                <text x={x + barWidth / 2} y="218" textAnchor="middle" fill="var(--sb-text)" fontSize="10" fontWeight="600">Combined</text>
              </g>
            );
          })()}
        </svg>
      </div>
    </section>
  );
}

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
  seriesColors,
  seriesLabels,
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
  seriesColors?: Record<string, string>;
  seriesLabels?: Record<string, string>;
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
            <ContributionWaterfall
              breakdownData={breakdownData}
              comparisonCollectors={comparisonCollectors}
              metric={metric}
              streamPayoutPerStreamUsd={streamPayoutPerStreamUsd}
              seriesLabels={seriesLabels}
            />

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
                            seriesColor(collector, seriesColors),
                        }}
                      />
                      <span
                        className="text-sm font-semibold"
                        style={{ color: "var(--sb-text)" }}
                      >
                        {seriesName(collector, seriesLabels)}
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
              seriesColors={seriesColors}
              seriesLabels={seriesLabels}
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
                        backgroundColor: seriesColor(collector, seriesColors),
                      }}
                    />
                    <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                      {seriesName(collector, seriesLabels)} — Top tracks
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
                                dailyStreams < 0
                                  ? "var(--sb-negative, #ef4444)"
                                  : metric === "revenue"
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
  seriesColors,
  seriesLabels,
}: {
  breakdownData: Record<string, DateBreakdownCollector>;
  comparisonCollectors: string[];
  metric: Metric;
  streamPayoutPerStreamUsd: number;
  seriesColors?: Record<string, string>;
  seriesLabels?: Record<string, string>;
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
                  backgroundColor: seriesColor(collector, seriesColors),
                }}
              />
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--sb-text)" }}
              >
                {seriesName(collector, seriesLabels)} — Roster changes
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
