"use client";

import Link from "next/link";
import { Search, X } from "lucide-react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { IconButton } from "@/components/ui/Button";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";

import type {
  Metric,
  DrillKind,
  DrillPlaylistItem,
  DrillArtistItem,
  DrillTrackItem,
} from "./collectorsTypes";
import { DRILL_PAGE_SIZE } from "./collectorsTypes";

export function CollectorDrilldownModal({
  open,
  onClose,
  drillCollector,
  drillKind,
  latestDate,
  latestRunDate,
  drillQuery,
  setDrillQuery,
  filteredSortedDrillItems,
  drillItemsCount,
  drillError,
  drillLoading,
  drillDone,
  onLoadMore,
  metric,
  payoutPerStreamUsd,
}: {
  open: boolean;
  onClose: () => void;
  drillCollector: string | null;
  drillKind: DrillKind;
  latestDate: string | null;
  latestRunDate: string;
  drillQuery: string;
  setDrillQuery: (q: string) => void;
  filteredSortedDrillItems: (DrillPlaylistItem | DrillArtistItem | DrillTrackItem)[];
  drillItemsCount: number;
  drillError: string | null;
  drillLoading: boolean;
  drillDone: boolean;
  onLoadMore: () => void;
  metric: Metric;
  payoutPerStreamUsd: number;
}) {
  const drillEffectiveMetric: Metric =
    drillKind === "tracks" && metric === "tracks" ? "streams" : metric;
  const drillIsTracksMetric = drillEffectiveMetric === "tracks";
  const drillIsRevenueMetric = drillEffectiveMetric === "revenue";
  const drillIsStreamsMetric = drillEffectiveMetric === "streams";
  const drillTracksColorClass = "text-blue-600 dark:text-blue-400 font-medium";
  const drillStreamsNumberClass = "sb-positive font-medium";
  const drillRevenueNumberClass = "font-medium";
  const drillMetricNumberClass = drillIsRevenueMetric
    ? drillRevenueNumberClass
    : drillIsStreamsMetric
      ? drillStreamsNumberClass
      : drillTracksColorClass;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        drillCollector ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{drillCollector}</span>
            <span className="opacity-60" style={{ color: "var(--sb-muted)" }}>
              &bull;
            </span>
            <span className="font-medium">
              {drillKind === "playlists"
                ? "Playlists"
                : drillKind === "artists"
                  ? "Artists"
                  : "Tracks"}
            </span>
          </div>
        ) : (
          "Drilldown"
        )
      }
      subtitle={
        latestDate ? (
          <span>
            Data date {formatDateISO(latestDate)}{" "}
            <span className="opacity-60" style={{ color: "var(--sb-muted)" }}>
              &bull;
            </span>{" "}
            Run date <span className="font-mono">{latestRunDate}</span>
          </span>
        ) : (
          <span>
            Run date <span className="font-mono">{latestRunDate}</span>
          </span>
        )
      }
      maxWidthClassName="max-w-6xl"
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-[240px] flex-1 items-center gap-2">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
              <Input
                type="text"
                value={drillQuery}
                onChange={(e) => setDrillQuery(e.target.value)}
                placeholder={
                  drillKind === "playlists"
                    ? "Filter playlists…"
                    : drillKind === "artists"
                      ? "Filter artists…"
                      : "Filter tracks / artists / ISRC…"
                }
                className="pl-10 pr-9 py-2 text-sm"
              />
              {drillQuery.trim() ? (
                <IconButton
                  type="button"
                  aria-label="Clear filter"
                  title="Clear filter"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-md"
                  onClick={() => setDrillQuery("")}
                >
                  <X className="h-4 w-4" style={{ color: "var(--sb-muted)" }} />
                </IconButton>
              ) : null}
            </div>
          </div>

          <div
            className="text-xs whitespace-nowrap"
            style={{ color: "var(--sb-muted)" }}
          >
            {formatInt(filteredSortedDrillItems.length)} shown
            {drillQuery.trim()
              ? ` (filtered from ${formatInt(drillItemsCount)})`
              : ""}
          </div>
        </div>

        {drillError ? (
          <div className="text-xs text-red-600 dark:text-red-400">{drillError}</div>
        ) : null}

        {drillKind === "playlists" ? (
          <PlaylistDrillTable
            items={filteredSortedDrillItems as DrillPlaylistItem[]}
            loading={drillLoading}
            isTracksMetric={drillIsTracksMetric}
            isRevenueMetric={drillIsRevenueMetric}
            metricNumberClass={drillMetricNumberClass}
            tracksColorClass={drillTracksColorClass}
            payoutPerStreamUsd={payoutPerStreamUsd}
          />
        ) : drillKind === "artists" ? (
          <ArtistDrillTable
            items={filteredSortedDrillItems as DrillArtistItem[]}
            loading={drillLoading}
            isTracksMetric={drillIsTracksMetric}
            isRevenueMetric={drillIsRevenueMetric}
            metricNumberClass={drillMetricNumberClass}
            tracksColorClass={drillTracksColorClass}
            payoutPerStreamUsd={payoutPerStreamUsd}
          />
        ) : (
          <TrackDrillTable
            items={filteredSortedDrillItems as DrillTrackItem[]}
            loading={drillLoading}
            isTracksMetric={drillIsTracksMetric}
            isRevenueMetric={drillIsRevenueMetric}
            streamsNumberClass={drillStreamsNumberClass}
            metricNumberClass={drillMetricNumberClass}
            payoutPerStreamUsd={payoutPerStreamUsd}
          />
        )}

        {!drillDone && !drillLoading ? (
          <div className="flex items-center justify-center pt-2">
            <button
              type="button"
              className="sb-ring rounded-full bg-white/70 px-4 py-2 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
              style={{ color: "var(--sb-text)" }}
              onClick={onLoadMore}
            >
              Load more
            </button>
          </div>
        ) : null}

        {drillLoading ? (
          <div
            className="text-center text-xs opacity-60"
            style={{ color: "var(--sb-muted)" }}
          >
            Loading…
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ── Sub-tables ─────────────────────────────────────────────── */

function PlaylistDrillTable({
  items,
  loading,
  isTracksMetric,
  isRevenueMetric,
  metricNumberClass,
  tracksColorClass,
  payoutPerStreamUsd,
}: {
  items: DrillPlaylistItem[];
  loading: boolean;
  isTracksMetric: boolean;
  isRevenueMetric: boolean;
  metricNumberClass: string;
  tracksColorClass: string;
  payoutPerStreamUsd: number;
}) {
  return (
    <GlassTable
      headers={
        isTracksMetric
          ? ["Playlist", "Type", { label: "Tracks", align: "right" }]
          : [
              "Playlist",
              "Type",
              {
                label: isRevenueMetric ? "Total Revenue" : "Total Streams",
                align: "right",
              },
              {
                label: isRevenueMetric ? "Daily Revenue" : "Daily Streams",
                align: "right",
              },
            ]
      }
      maxBodyHeightClassName="max-h-[520px]"
    >
      {items.map((p) => {
        const totalStreams = Number(p.total_streams_cumulative ?? 0);
        const dailyStreams = Number(p.daily_streams_net ?? 0);
        const totalValue = isRevenueMetric
          ? Number(p.est_revenue_total ?? totalStreams * payoutPerStreamUsd)
          : totalStreams;
        const dailyValue = isRevenueMetric
          ? Number(p.est_revenue_daily_net ?? dailyStreams * payoutPerStreamUsd)
          : dailyStreams;

        return (
          <TableRow key={String(p.playlist_key)}>
            <TableCell>
              <div className="flex items-center gap-2">
                {p.spotify_playlist_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={String(p.spotify_playlist_image_url)}
                    alt={String(p.display_name ?? p.playlist_key)}
                    className="h-7 w-7 rounded-full object-cover sb-ring flex-shrink-0"
                  />
                ) : (
                  <div
                    className="h-7 w-7 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{
                      backgroundColor: "var(--sb-surface)",
                      color: "var(--sb-muted)",
                    }}
                  >
                    {String(p.display_name ?? p.playlist_key)
                      .trim()
                      .slice(0, 1)
                      .toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <Link
                    href={`/playlists?playlist_key=${encodeURIComponent(String(p.playlist_key))}`}
                    className="font-medium transition-colors sb-link-hover block truncate"
                  >
                    {String(p.display_name ?? p.playlist_key)}
                  </Link>
                  <div className="font-mono text-[11px] opacity-50">
                    {String(p.playlist_key)}
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              {p.playlist_type ? (
                String(p.playlist_type)
              ) : (
                <span className="opacity-30">—</span>
              )}
            </TableCell>
            {isTracksMetric ? (
              <TableCell numeric className={tracksColorClass}>
                {formatInt(Number(p.track_count ?? 0))}
              </TableCell>
            ) : (
              <>
                <TableCell
                  numeric
                  className={metricNumberClass}
                  style={isRevenueMetric ? { color: "#10b981" } : undefined}
                >
                  {isRevenueMetric ? formatUsd2(totalValue) : formatInt(totalValue)}
                </TableCell>
                <TableCell
                  numeric
                  className={metricNumberClass}
                  style={isRevenueMetric ? { color: "#10b981" } : undefined}
                >
                  {isRevenueMetric ? formatUsd2(dailyValue) : formatInt(dailyValue)}
                </TableCell>
              </>
            )}
          </TableRow>
        );
      })}
      {!items.length && !loading ? (
        <TableRow>
          <TableCell
            className="py-10 text-center opacity-50"
            colSpan={isTracksMetric ? 3 : 4}
          >
            No playlists found.
          </TableCell>
        </TableRow>
      ) : null}
    </GlassTable>
  );
}

function ArtistDrillTable({
  items,
  loading,
  isTracksMetric,
  isRevenueMetric,
  metricNumberClass,
  tracksColorClass,
  payoutPerStreamUsd,
}: {
  items: DrillArtistItem[];
  loading: boolean;
  isTracksMetric: boolean;
  isRevenueMetric: boolean;
  metricNumberClass: string;
  tracksColorClass: string;
  payoutPerStreamUsd: number;
}) {
  return (
    <GlassTable
      headers={
        isTracksMetric
          ? [{ label: "Artist" }, { label: "Tracks", align: "right" }]
          : [
              { label: "Artist" },
              { label: "Tracks", align: "right" },
              {
                label: isRevenueMetric ? "Total Revenue" : "Total Streams",
                align: "right",
              },
              {
                label: isRevenueMetric ? "Daily Revenue" : "Daily Streams",
                align: "right",
              },
            ]
      }
      maxBodyHeightClassName="max-h-[520px]"
    >
      {items.map((a) => {
        const totalStreams = Number(a.total_streams_cumulative ?? 0);
        const dailyStreams = Number(a.daily_streams_delta ?? 0);
        const totalValue = isRevenueMetric
          ? totalStreams * payoutPerStreamUsd
          : totalStreams;
        const dailyValue = isRevenueMetric
          ? dailyStreams * payoutPerStreamUsd
          : dailyStreams;

        return (
          <TableRow key={String(a.artist_id)}>
            <TableCell>
              <div className="flex items-center gap-2 min-w-0">
                {a.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={String(a.image_url)}
                    alt={String(a.name ?? a.artist_id)}
                    className="h-7 w-7 rounded-full object-cover sb-ring flex-shrink-0"
                  />
                ) : (
                  <div className="h-7 w-7 rounded-full sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <Link
                    href={`/catalog?artist_id=${encodeURIComponent(String(a.artist_id))}`}
                    className="font-medium transition-colors sb-link-hover block truncate"
                  >
                    {String(a.name ?? a.artist_id)}
                  </Link>
                  <div className="font-mono text-[11px] opacity-50">
                    {String(a.artist_id)}
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell
              numeric
              className={isTracksMetric ? tracksColorClass : "font-medium"}
            >
              {formatInt(Number(a.track_count ?? 0))}
            </TableCell>
            {isTracksMetric ? null : (
              <>
                <TableCell
                  numeric
                  className={metricNumberClass}
                  style={isRevenueMetric ? { color: "#10b981" } : undefined}
                >
                  {isRevenueMetric ? formatUsd2(totalValue) : formatInt(totalValue)}
                </TableCell>
                <TableCell
                  numeric
                  className={metricNumberClass}
                  style={isRevenueMetric ? { color: "#10b981" } : undefined}
                >
                  {isRevenueMetric ? formatUsd2(dailyValue) : formatInt(dailyValue)}
                </TableCell>
              </>
            )}
          </TableRow>
        );
      })}
      {!items.length && !loading ? (
        <TableRow>
          <TableCell
            className="py-10 text-center opacity-50"
            colSpan={isTracksMetric ? 2 : 4}
          >
            No artists found.
          </TableCell>
        </TableRow>
      ) : null}
    </GlassTable>
  );
}

function TrackDrillTable({
  items,
  loading,
  isTracksMetric,
  isRevenueMetric,
  streamsNumberClass,
  metricNumberClass,
  payoutPerStreamUsd,
}: {
  items: DrillTrackItem[];
  loading: boolean;
  isTracksMetric: boolean;
  isRevenueMetric: boolean;
  streamsNumberClass: string;
  metricNumberClass: string;
  payoutPerStreamUsd: number;
}) {
  return (
    <GlassTable
      headers={[
        "",
        "Track",
        "Artists",
        ...(isTracksMetric
          ? []
          : [
              {
                label: isRevenueMetric ? "Total Revenue" : "Total Streams",
                align: "right" as const,
              },
              (
                <span
                  key="d1"
                  title="Today minus yesterday (based on cumulative streams)."
                >
                  {isRevenueMetric ? "Daily Revenue" : "Daily Streams"}
                </span>
              ),
            ]),
      ]}
      maxBodyHeightClassName="max-h-[520px]"
    >
      {items.map((t) => {
        const totalStreams = Number(t.total_streams_cumulative ?? 0);
        const dailyStreams = Number(t.daily_streams_delta ?? 0);
        const totalValue = isRevenueMetric
          ? totalStreams * payoutPerStreamUsd
          : totalStreams;
        const dailyValue = isRevenueMetric
          ? dailyStreams * payoutPerStreamUsd
          : dailyStreams;

        return (
          <TableRow key={String(t.isrc)}>
            <TableCell>
              {t.album_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={String(t.album_image_url)}
                  alt="Album cover"
                  className="h-8 w-8 rounded-lg object-cover sb-ring"
                />
              ) : (
                <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10" />
              )}
            </TableCell>
            <TableCell>
              <Link
                href={`/tracks/${encodeURIComponent(String(t.isrc))}`}
                className="font-medium transition-colors sb-link-hover"
              >
                {String(t.name ?? t.isrc)}
              </Link>
            </TableCell>
            <TableCell className="min-w-[220px]">
              {Array.isArray(t.artist_names) && t.artist_names.length ? (
                <div
                  className="truncate text-xs opacity-70"
                  style={{ color: "var(--sb-text)" }}
                >
                  <ArtistLinks
                    artistNames={t.artist_names}
                    artistIds={
                      Array.isArray(t.artist_ids) ? t.artist_ids : null
                    }
                  />
                </div>
              ) : (
                <span className="opacity-30">—</span>
              )}
              <CopyableIsrc
                isrc={String(t.isrc)}
                className="font-mono text-[11px] opacity-40"
                style={{ color: "var(--sb-muted)" }}
              />
            </TableCell>
            {isTracksMetric ? null : (
              <>
                <TableCell
                  numeric
                  className={metricNumberClass}
                  style={isRevenueMetric ? { color: "#10b981" } : undefined}
                >
                  {isRevenueMetric
                    ? formatUsd2(totalValue)
                    : formatInt(totalValue)}
                </TableCell>
                <TableCell
                  numeric
                  className={
                    isRevenueMetric
                      ? metricNumberClass
                      : Number(t.daily_streams_delta ?? 0) < 0
                        ? "text-red-600 dark:text-red-400 font-medium"
                        : streamsNumberClass
                  }
                  style={isRevenueMetric ? { color: "#10b981" } : undefined}
                >
                  {isRevenueMetric
                    ? formatUsd2(dailyValue)
                    : `${formatInt(dailyStreams)}`}
                </TableCell>
              </>
            )}
          </TableRow>
        );
      })}
      {!items.length && !loading ? (
        <TableRow>
          <TableCell
            className="py-10 text-center opacity-50"
            colSpan={isTracksMetric ? 3 : 5}
          >
            No tracks found.
          </TableCell>
        </TableRow>
      ) : null}
    </GlassTable>
  );
}
