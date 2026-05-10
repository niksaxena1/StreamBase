"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { Modal } from "@/components/ui/Modal";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatInt, formatUsd2 } from "@/lib/format";

export type DistroPlaylist = { key: string; name: string; imageUrl: string | null };

export type ArtistDistroTrackRow = {
  isrc: string;
  name: string | null;
  albumImageUrl: string | null;
  artistIds: string[] | null;
  totalStreams: number | null;
  dailyStreams: number | null;
  distroPlaylists: DistroPlaylist[];
  externalUrl: string | null;
};

type ModalSortKey = "name" | "total" | "daily";

function SortHeader({
  label,
  sortKey,
  current,
  onSort,
}: {
  label: string;
  sortKey: ModalSortKey;
  current: { key: ModalSortKey; asc: boolean } | null;
  onSort: (key: ModalSortKey) => void;
}) {
  const active = current?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 uppercase tracking-wider text-[11px] font-medium transition-opacity hover:opacity-100"
      style={{ opacity: active ? 1 : 0.6, color: "inherit" }}
    >
      {label}
      {active ? (
        current.asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : null}
    </button>
  );
}

export function ArtistDistroTracksModal({
  open,
  onClose,
  artistName,
  distroPlaylists,
  tracks,
  artistIdToName,
  loading = false,
  error = null,
}: {
  open: boolean;
  onClose: () => void;
  artistName: string;
  distroPlaylists: DistroPlaylist[];
  tracks: ArtistDistroTrackRow[];
  artistIdToName: Map<string, string>;
  loading?: boolean;
  error?: string | null;
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  // Same as TracksList / catalog tables: row-level streams when global metric is "tracks".
  const displayMetric = metric === "tracks" ? "streams" : metric;
  const metricColor =
    displayMetric === "revenue" ? "#10b981" : "var(--sb-positive)";

  const formatMetricCell = (value: number | null) => {
    if (value === null) return "—";
    if (displayMetric === "revenue") return formatUsd2(value * streamPayoutPerStreamUsd);
    return formatInt(value);
  };

  const totalColumnLabel =
    displayMetric === "revenue" ? "Total Revenue" : "Total Streams";
  const dailyColumnLabel =
    displayMetric === "revenue" ? "Daily Revenue" : "Daily Streams";

  const [modalSort, setModalSort] = useState<{ key: ModalSortKey; asc: boolean } | null>({
    key: "total",
    asc: false,
  });

  const handleModalSort = (key: ModalSortKey) => {
    setModalSort((prev) => {
      if (!prev || prev.key !== key) return { key, asc: key === "name" };
      return { key, asc: !prev.asc };
    });
  };

  const sortedTracks = useMemo(() => {
    let rows = [...tracks];
    if (modalSort) {
      rows.sort((a, b) => {
        let c = 0;
        if (modalSort.key === "name") {
          const an = (a.name ?? a.isrc).toLowerCase();
          const bn = (b.name ?? b.isrc).toLowerCase();
          c = an.localeCompare(bn);
        } else if (modalSort.key === "total") {
          const av = a.totalStreams ?? -1;
          const bv = b.totalStreams ?? -1;
          c = av - bv;
        } else if (modalSort.key === "daily") {
          const av = a.dailyStreams ?? -1;
          const bv = b.dailyStreams ?? -1;
          c = av - bv;
        }
        if (c === 0) c = a.isrc.localeCompare(b.isrc);
        return modalSort.asc ? c : -c;
      });
    }
    return rows;
  }, [tracks, modalSort]);

  const subtitle =
    `${distroPlaylists.length} distro ${distroPlaylists.length === 1 ? "playlist" : "playlists"} · ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={artistName}
      subtitle={loading ? "Loading…" : error ? undefined : subtitle}
      maxWidthClassName="max-w-2xl"
    >
      <div className="space-y-4">
        {error ? (
          <p className="text-sm opacity-80" style={{ color: "var(--sb-muted)" }}>
            {error}
          </p>
        ) : null}

        {!error && !loading && distroPlaylists.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {distroPlaylists.map((d) => (
              <div
                key={d.key}
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sb-ring"
                style={{ background: "var(--sb-glass-bg)" }}
              >
                {d.imageUrl && (
                  <Image
                    src={d.imageUrl}
                    alt={d.name}
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded-full object-cover flex-shrink-0"
                  />
                )}
                <span style={{ color: "var(--sb-text)" }}>{d.name}</span>
              </div>
            ))}
          </div>
        )}

        {!error && (
        <GlassTable
          maxBodyHeightClassName="max-h-[480px]"
          headers={[
            "",
            {
              label: (
                <SortHeader label="Track" sortKey="name" current={modalSort} onSort={handleModalSort} />
              ),
            },
            "DISTRO",
            {
              label: (
                <SortHeader
                  label={totalColumnLabel}
                  sortKey="total"
                  current={modalSort}
                  onSort={handleModalSort}
                />
              ),
              align: "right" as const,
            },
            {
              label: (
                <SortHeader
                  label={dailyColumnLabel}
                  sortKey="daily"
                  current={modalSort}
                  onSort={handleModalSort}
                />
              ),
              align: "right" as const,
            },
            "",
          ]}
        >
          {loading ? (
            <TableRow>
              <TableCell className="py-10 text-center opacity-60" colSpan={6}>
                Loading tracks…
              </TableCell>
            </TableRow>
          ) : null}

          {!loading &&
            sortedTracks.map((track) => {
              const distro = track.distroPlaylists.find((d) =>
                distroPlaylists.some((p) => p.key === d.key),
              );
              return (
                <TableRow key={track.isrc}>
                  <TableCell>
                    {track.albumImageUrl ? (
                      <Image
                        src={track.albumImageUrl}
                        alt="Album cover"
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded-lg object-cover sb-ring"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/tracks/${track.isrc}`}
                      className="font-medium transition-colors sb-link-hover block truncate max-w-[220px]"
                    >
                      {track.name ?? track.isrc}
                    </Link>
                    {track.artistIds && track.artistIds.length > 0 ? (
                      <span className="mt-1 inline-block text-xs">
                        {track.artistIds
                          .filter((id) => artistIdToName.has(id))
                          .map((artistId, index) => {
                            const nm = artistIdToName.get(artistId)!;
                            return (
                              <Fragment key={artistId}>
                                {index > 0 ? ", " : null}
                                <Link
                                  href={`/catalog?artist_id=${encodeURIComponent(artistId)}`}
                                  className="font-medium transition-colors sb-link-hover sb-link-muted"
                                >
                                  {nm}
                                </Link>
                              </Fragment>
                            );
                          })}
                      </span>
                    ) : (
                      <CopyableIsrc
                        isrc={track.isrc}
                        className="text-xs font-mono opacity-40"
                        style={{ color: "var(--sb-muted)" }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {distro ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        {distro.imageUrl ? (
                          <Image
                            src={distro.imageUrl}
                            alt={distro.name}
                            width={20}
                            height={20}
                            className="h-5 w-5 rounded-full object-cover sb-ring flex-shrink-0"
                          />
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-white/30 flex-shrink-0" />
                        )}
                        <span className="text-xs truncate max-w-[100px]" style={{ color: "var(--sb-muted)" }}>
                          {distro.name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs opacity-30" style={{ color: "var(--sb-muted)" }}>
                        —
                      </span>
                    )}
                  </TableCell>
                  <TableCell numeric className="font-medium text-xs" style={{ color: metricColor }}>
                    {formatMetricCell(track.totalStreams)}
                  </TableCell>
                  <TableCell numeric className="font-medium text-xs" style={{ color: metricColor }}>
                    {formatMetricCell(track.dailyStreams)}
                  </TableCell>
                  <TableCell>
                    {track.externalUrl ? (
                      <Link
                        href={track.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-full p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                        title="Open on Spotify"
                        style={{ color: "var(--sb-muted)" }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}

          {!loading && sortedTracks.length === 0 && (
            <TableRow>
              <TableCell className="py-8 text-center opacity-50" colSpan={6}>
                No distro tracks found.
              </TableCell>
            </TableRow>
          )}
        </GlassTable>
        )}
      </div>
    </Modal>
  );
}
