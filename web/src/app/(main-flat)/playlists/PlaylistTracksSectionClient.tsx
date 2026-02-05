"use client";

import Link from "next/link";
import { Download } from "lucide-react";

import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { downloadCsv, slugifyForFilename, todayIsoDate } from "@/lib/csv";

type PlaylistTopTrackRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  total: number | null;
  daily: number | null;
};

type PlaylistAddedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
};

type PlaylistRemovedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  valid_to: string | null;
};

type DebugCounts = {
  totalRows: number | null;
  nullValidToRows: number | null;
  activeAtRunDateRows: number | null;
  maxValidFrom: string | null;
  minValidFrom: string | null;
};

function fmtDelta(args: { mode: "streams" | "revenue"; value: number; streamPayoutPerStreamUsd: number }) {
  if (args.mode === "revenue") return `+${formatUsd(args.value * args.streamPayoutPerStreamUsd)}`;
  return `+${formatInt(args.value)}`;
}

function fmtTotal(args: { mode: "streams" | "revenue"; value: number; streamPayoutPerStreamUsd: number }) {
  if (args.mode === "revenue") return formatUsd(args.value * args.streamPayoutPerStreamUsd);
  return formatInt(args.value);
}

export function PlaylistTracksSectionClient(props: {
  playlistKey: string;
  latestRunDate: string | null;
  currentRows: PlaylistTopTrackRow[];
  addedLast7Days: PlaylistAddedRow[];
  removed: PlaylistRemovedRow[];
  topErrMessage: string | null;
  addedErrMessage: string | null;
  removedErrMessage: string | null;
  debug: DebugCounts | null;
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const hasStatsDate = !!props.latestRunDate;

  // Track-level tables only make sense for streams/revenue; treat "tracks" as streams.
  const mode: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";
  const dailyLabel = mode === "revenue" ? "Daily revenue" : "Daily streams";
  const totalLabel = mode === "revenue" ? "Total revenue" : "Total streams";

  // Match global metric coloring used across the app.
  // This table treats "tracks" as streams, so it uses the streams color for both.
  const numberStyle =
    metric === "revenue"
      ? ({ color: "#10b981" } as const) // emerald-500
      : ({ color: "var(--sb-accent-stroke)" } as const);

  const exportCurrentTracks = () => {
    const rows = props.currentRows.map((t) => {
      const daily =
        mode === "revenue"
          ? t.daily === null
            ? null
            : t.daily * streamPayoutPerStreamUsd
          : t.daily;
      const total =
        mode === "revenue"
          ? t.total === null
            ? null
            : t.total * streamPayoutPerStreamUsd
          : t.total;

      return {
        ISRC: t.isrc,
        Track: t.name ?? "",
        Artists: t.artist_names ?? [],
        Added: t.valid_from,
        [dailyLabel]: daily,
        [totalLabel]: total,
      } as Record<string, unknown>;
    });

    downloadCsv({
      filename: `playlist-${slugifyForFilename(props.playlistKey)}-tracks-current-${todayIsoDate()}.csv`,
      rows,
    });
  };

  const exportAddedTracks = () => {
    const rows = props.addedLast7Days.map((t) => ({
      ISRC: t.isrc,
      Track: t.name ?? "",
      Artists: t.artist_names ?? [],
      Added: t.valid_from,
    }));

    downloadCsv({
      filename: `playlist-${slugifyForFilename(props.playlistKey)}-tracks-added-7d-${todayIsoDate()}.csv`,
      rows,
    });
  };

  const exportRemovedTracks = () => {
    const rows = props.removed.map((t) => ({
      ISRC: t.isrc,
      Track: t.name ?? "",
      Artists: t.artist_names ?? [],
      Removed: t.valid_to ?? "",
      Added: t.valid_from,
    }));

    downloadCsv({
      filename: `playlist-${slugifyForFilename(props.playlistKey)}-tracks-removed-${todayIsoDate()}.csv`,
      rows,
    });
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Tracks currently in playlist</h2>
            <button
              type="button"
              onClick={exportCurrentTracks}
              className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              title="Download as CSV"
              aria-label="Download as CSV"
              style={{ color: "var(--sb-muted)" }}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {hasStatsDate && props.debug ? (
          <details
            className="rounded-xl border px-3 py-2 text-xs"
            style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
          >
            <summary className="cursor-pointer select-none">Debug: playlist_memberships snapshot</summary>
            <div className="mt-2 grid grid-cols-1 gap-1 font-mono">
              <div>playlist_key={props.playlistKey}</div>
              <div>run_date={props.latestRunDate}</div>
              <div>rows_total={props.debug.totalRows ?? "?"}</div>
              <div>rows_valid_to_null={props.debug.nullValidToRows ?? "?"}</div>
              <div>rows_active_at_run_date={props.debug.activeAtRunDateRows ?? "?"}</div>
              <div>valid_from_min={props.debug.minValidFrom ?? "?"}</div>
              <div>valid_from_max={props.debug.maxValidFrom ?? "?"}</div>
            </div>
          </details>
        ) : null}
        <GlassTable headers={["", "Track", "ISRC", dailyLabel, totalLabel, "Added"]}>
          {!hasStatsDate ? (
            <EmptyState colSpan={6} message="No stats date available yet" />
          ) : props.topErrMessage ? (
            <EmptyState colSpan={6} message={`Error loading current tracks: ${props.topErrMessage}`} />
          ) : null}
          {props.currentRows.map((t) => (
            <TableRow key={t.isrc}>
              <TableCell>
                {t.album_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.album_image_url} alt="Album cover" className="h-8 w-8 rounded-lg object-cover sb-ring" />
                ) : (
                  <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                )}
              </TableCell>
              <TableCell>
                <Link href={`/tracks/${t.isrc}`} className="font-medium transition-colors sb-link-hover">
                  {t.name ?? t.isrc}
                </Link>
                {t.artist_names?.length ? (
                  <div className="mt-0.5 text-xs opacity-60">
                    <ArtistLinks artistNames={t.artist_names} artistIds={t.artist_ids ?? undefined} />
                  </div>
                ) : null}
              </TableCell>
              <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                {t.isrc}
              </TableCell>
              <TableCell className="font-medium" style={numberStyle}>
                {t.daily === null ? "—" : fmtDelta({ mode, value: t.daily, streamPayoutPerStreamUsd })}
              </TableCell>
              <TableCell className="font-medium" style={numberStyle}>
                {t.total === null ? "—" : fmtTotal({ mode, value: t.total, streamPayoutPerStreamUsd })}
              </TableCell>
              <TableCell mono className="text-xs">
                {formatDateISO(t.valid_from)}
              </TableCell>
            </TableRow>
          ))}
          {hasStatsDate && !props.topErrMessage && !props.currentRows.length && (
            <EmptyState colSpan={6} message="No active tracks found" />
          )}
        </GlassTable>
      </div>

      <div className="flex h-full flex-col gap-3">
        <div className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Tracks added (last 7 days)</h2>
              <button
                type="button"
                onClick={exportAddedTracks}
                className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                title="Download as CSV"
                aria-label="Download as CSV"
                style={{ color: "var(--sb-muted)" }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Based on membership added date.
            </div>
          </div>
          <GlassTable headers={["", "Track", "ISRC", "Added"]} maxBodyHeightClassName="max-h-[260px]">
            {props.addedErrMessage ? (
              <EmptyState colSpan={4} message={`Error loading added tracks: ${props.addedErrMessage}`} />
            ) : null}
            {props.addedLast7Days.map((m, idx) => (
              <TableRow key={`${m.isrc}-${m.valid_from}-${idx}`}>
                <TableCell>
                  {m.album_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.album_image_url} alt="Album cover" className="h-8 w-8 rounded-lg object-cover sb-ring" />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                  )}
                </TableCell>
                <TableCell>
                  <Link href={`/tracks/${m.isrc}`} className="font-medium transition-colors sb-link-hover">
                    {m.name ?? m.isrc}
                  </Link>
                  {m.artist_names?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks artistNames={m.artist_names} artistIds={m.artist_ids ?? undefined} />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                  {m.isrc}
                </TableCell>
                <TableCell mono className="text-xs">
                  {formatDateISO(m.valid_from)}
                </TableCell>
              </TableRow>
            ))}
            {!props.addedErrMessage && !props.addedLast7Days.length && (
              <EmptyState colSpan={4} message="No tracks added in the last 7 days" />
            )}
          </GlassTable>
        </div>

        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-end justify-between px-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Tracks removed</h2>
              <button
                type="button"
                onClick={exportRemovedTracks}
                className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                title="Download as CSV"
                aria-label="Download as CSV"
                style={{ color: "var(--sb-muted)" }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              Most recent removals first.
            </div>
          </div>
          <GlassTable
            className="flex-1"
            bodyClassName="flex-1"
            maxBodyHeightClassName="flex-1"
            headers={["", "Track", "ISRC", "Removed", "Added"]}
          >
            {props.removedErrMessage ? (
              <EmptyState colSpan={5} message={`Error loading removed tracks: ${props.removedErrMessage}`} />
            ) : null}
            {props.removed.map((m, idx) => (
              <TableRow key={`${m.isrc}-${m.valid_from}-${idx}`}>
                <TableCell>
                  {m.album_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.album_image_url} alt="Album cover" className="h-8 w-8 rounded-lg object-cover sb-ring" />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                  )}
                </TableCell>
                <TableCell>
                  <Link href={`/tracks/${m.isrc}`} className="font-medium transition-colors sb-link-hover">
                    {m.name ?? m.isrc}
                  </Link>
                  {m.artist_names?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks artistNames={m.artist_names} artistIds={m.artist_ids ?? undefined} />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell mono className="text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>
                  {m.isrc}
                </TableCell>
                <TableCell mono className="text-xs">{m.valid_to ? formatDateISO(m.valid_to) : "—"}</TableCell>
                <TableCell mono className="text-xs">{formatDateISO(m.valid_from)}</TableCell>
              </TableRow>
            ))}
            {!props.removedErrMessage && !props.removed.length && <EmptyState colSpan={5} message="No removed tracks found" />}
          </GlassTable>
        </div>
      </div>
    </div>
  );
}

