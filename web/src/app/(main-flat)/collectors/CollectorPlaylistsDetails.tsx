"use client";

import Link from "next/link";
import type { Dispatch, SetStateAction } from "react";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { formatDateISO, formatInt, formatUsd2 } from "@/lib/format";

import type { SelectedPlaylistMeta, TopPlaylistRow } from "./collectorsTypes";

/** Top playlists for the selected collector (collapsible). */
export function CollectorPlaylistsDetails({
  openPlaylists,
  setOpenPlaylists,
  latestDate,
  topPlaylists,
  playlistMetaByKey,
  payoutPerStreamUsd,
}: {
  openPlaylists: boolean;
  setOpenPlaylists: Dispatch<SetStateAction<boolean>>;
  latestDate: string | null;
  topPlaylists: TopPlaylistRow[];
  playlistMetaByKey: Map<string, SelectedPlaylistMeta>;
  payoutPerStreamUsd: number;
}) {
  return (
    <details
      open={openPlaylists}
      onToggle={(ev) => setOpenPlaylists(ev.currentTarget.open)}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="flex-shrink-0 text-xs opacity-60 mt-0.5">▸</span>
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              Playlists
            </div>
          </div>
        </div>
      </summary>

      <div className="mt-3">
        <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Ranked by est. revenue (daily) on data date{" "}
          {latestDate ? formatDateISO(latestDate) : "—"}
        </div>
        <GlassTable
          headers={[
            "Playlist",
            "Est. Rev (Daily)",
            "Daily Streams",
            <span
              key="missing"
              title="Number of tracks in the playlist that don't have stream data in the catalog snapshot for this day."
            >
              Cat. Missing Tracks
            </span>,
          ]}
          maxBodyHeightClassName="max-h-[320px]"
        >
          {topPlaylists.map((p) => (
            <TableRow key={p.playlist_key}>
              <TableCell>
                <div className="flex items-center gap-2">
                  {(() => {
                    const meta = playlistMetaByKey.get(String(p.playlist_key));
                    const imgUrl = meta?.spotify_playlist_image_url ?? null;
                    const label = meta?.display_name ?? p.display_name ?? p.playlist_key;
                    return imgUrl ? (
                      <PreviewableArtwork
                        src={imgUrl}
                        alt={label}
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-full object-cover sb-ring flex-shrink-0"
                        label={label}
                      />
                    ) : (
                      <div
                        className="h-6 w-6 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}
                        title={label}
                      >
                        {String(label).trim().slice(0, 1).toUpperCase()}
                      </div>
                    );
                  })()}
                  <Link
                    href={`/playlists?playlist_key=${encodeURIComponent(String(p.playlist_key))}`}
                    className="font-medium transition-colors sb-link-hover"
                  >
                    {p.display_name}
                  </Link>
                </div>
                <div className="font-mono text-[11px] opacity-50">{p.playlist_key}</div>
              </TableCell>
              <TableCell className="font-medium">
                {formatUsd2(Number(p.daily_streams_net ?? 0) * payoutPerStreamUsd)}
              </TableCell>
              <TableCell className="sb-positive font-medium">
                {formatInt(p.daily_streams_net)}
              </TableCell>
              <TableCell title={p.missing_streams_track_count ? "Missing catalog tracks for this date." : undefined}>
                {p.missing_streams_track_count ? (
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    {formatInt(p.missing_streams_track_count)}
                  </span>
                ) : (
                  <span className="opacity-30">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {!topPlaylists.length ? (
            <TableRow>
              <TableCell className="py-8 text-center opacity-50" colSpan={4}>
                No playlists found for this collector/date.
              </TableCell>
            </TableRow>
          ) : null}
        </GlassTable>
      </div>
    </details>
  );
}
