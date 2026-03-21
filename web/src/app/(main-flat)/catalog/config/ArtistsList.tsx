"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ExternalLink, User, ChevronDown, ChevronUp } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { Modal } from "@/components/ui/Modal";
import { foldForSearch } from "@/lib/searchFold";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatInt, formatUsd2 } from "@/lib/format";

type DistroPlaylist = { key: string; name: string; imageUrl: string | null };

type Artist = {
  id: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string;
  totalStreams: number | null;
  dailyStreams: number | null;
  trackCount: number;
  dailyTrackCount: number;
  distroPlaylists: DistroPlaylist[];
};

type TrackRow = {
  isrc: string;
  name: string | null;
  albumImageUrl: string | null;
  artistIds: string[] | null;
  totalStreams: number | null;
  dailyStreams: number | null;
  distroPlaylists: DistroPlaylist[];
  externalUrl: string | null;
};

type SortOption = "name" | "total" | "daily" | "tracks";
type ModalSortKey = "name" | "total" | "daily";

type ArtistsListProps = {
  artists: Artist[];
  searchQuery: string;
  sortBy?: SortOption;
  sortAsc?: boolean;
  distroFilter?: string | null;
  allTracks?: TrackRow[];
};

const INITIAL_RENDER_CAP = 150;

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

export function ArtistsList({
  artists,
  searchQuery,
  sortBy = "name",
  sortAsc = true,
  distroFilter,
  allTracks = [],
}: ArtistsListProps) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const filteredAndSortedArtists = useMemo(() => {
    let result = [...artists];

    // Filter by distro playlist
    if (distroFilter) {
      result = result.filter((artist) => artist.distroPlaylists.some((d) => d.key === distroFilter));
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = foldForSearch(searchQuery);
      result = result.filter((artist) => foldForSearch(artist.name).includes(q));
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "tracks":
          comparison = (a.trackCount ?? 0) - (b.trackCount ?? 0);
          break;
        case "total":
          comparison =
            metric === "tracks"
              ? (a.trackCount ?? 0) - (b.trackCount ?? 0)
              : metric === "revenue"
                ? (a.totalStreams ?? 0) * streamPayoutPerStreamUsd -
                  (b.totalStreams ?? 0) * streamPayoutPerStreamUsd
                : (a.totalStreams ?? 0) - (b.totalStreams ?? 0);
          break;
        case "daily":
          comparison =
            metric === "tracks"
              ? (a.dailyTrackCount ?? 0) - (b.dailyTrackCount ?? 0)
              : metric === "revenue"
                ? (a.dailyStreams ?? 0) * streamPayoutPerStreamUsd -
                  (b.dailyStreams ?? 0) * streamPayoutPerStreamUsd
                : (a.dailyStreams ?? 0) - (b.dailyStreams ?? 0);
          break;
      }

      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [artists, distroFilter, metric, searchQuery, sortBy, sortAsc, streamPayoutPerStreamUsd]);

  // Color scheme based on metric
  const metricColor =
    metric === "revenue" ? "#10b981" : metric === "tracks" ? "#3b82f6" : "var(--sb-positive)";

  const getMetricValue = (artist: Artist) => {
    if (metric === "tracks") return artist.trackCount;
    return artist.totalStreams;
  };

  const getDailyMetricValue = (artist: Artist) => {
    if (metric === "tracks") return artist.dailyTrackCount;
    return artist.dailyStreams;
  };

  const formatValue = (value: number | null) => {
    if (value === null) return "—";
    if (metric === "revenue") return formatUsd2(value * streamPayoutPerStreamUsd);
    return formatInt(value);
  };

  const getTotalMetricLabel = () => {
    if (metric === "tracks") return "Total Tracks";
    if (metric === "revenue") return "Total Revenue";
    return "Total Streams";
  };

  const getDailyMetricLabel = () => {
    if (metric === "tracks") return "Daily Tracks";
    if (metric === "revenue") return "Daily Revenue";
    return "Daily Streams";
  };

  // Distro modal state
  const [distroModal, setDistroModal] = useState<{ artistId: string; artistName: string; playlists: DistroPlaylist[] } | null>(null);
  const [modalSort, setModalSort] = useState<{ key: ModalSortKey; asc: boolean } | null>({ key: "total", asc: false });

  const handleModalSort = (key: ModalSortKey) => {
    setModalSort((prev) => {
      if (!prev || prev.key !== key) return { key, asc: key === "name" };
      return { key, asc: !prev.asc };
    });
  };

  // Tracks for the open modal artist, filtered to distro-only, sorted
  const modalTracks = useMemo(() => {
    if (!distroModal) return [];
    const artistId = distroModal.artistId;
    const distroKeys = new Set(distroModal.playlists.map((p) => p.key));

    let rows = allTracks.filter(
      (t) =>
        t.artistIds?.includes(artistId) &&
        t.distroPlaylists.some((d) => distroKeys.has(d.key)),
    );

    if (modalSort) {
      rows = [...rows].sort((a, b) => {
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
  }, [distroModal, allTracks, modalSort]);

  // Incremental render cap to keep DOM node count low for large artist lists.
  const [renderCap, setRenderCap] = useState(INITIAL_RENDER_CAP);
  const visibleArtists = filteredAndSortedArtists.slice(0, renderCap);
  const hasMore = filteredAndSortedArtists.length > renderCap;

  return (
    <div className="flex flex-col space-y-2">
      <GlassTable headers={["", "Artist", "Tracks", getTotalMetricLabel(), getDailyMetricLabel(), "DISTRO", "ID", ""]}>
        {visibleArtists.map((artist) => {
          const dailyMetricValue = getDailyMetricValue(artist);

          return (
            <TableRow key={artist.id}>
            <TableCell>
              {artist.imageUrl ? (
                <Image
                  src={artist.imageUrl}
                  alt={artist.name}
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full object-cover sb-ring"
                />
              ) : (
                <div className="h-10 w-10 rounded-full sb-ring bg-white/60 flex items-center justify-center">
                  <User className="h-5 w-5 opacity-40" />
                </div>
              )}
            </TableCell>
            <TableCell>
              <Link
                className="transition-colors sb-link-hover font-medium"
                href={`/catalog?artist_id=${encodeURIComponent(artist.id)}`}
              >
                {artist.name}
              </Link>
            </TableCell>
            <TableCell className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
              {artist.trackCount}
            </TableCell>
            <TableCell>
              <span style={{ color: metricColor }} className="font-medium text-xs">
                {formatValue(getMetricValue(artist))}
              </span>
            </TableCell>
            <TableCell>
              <span style={{ color: metricColor }} className="font-medium text-xs">
                {formatValue(dailyMetricValue)}
              </span>
            </TableCell>
            <TableCell>
              {artist.distroPlaylists.length === 0 ? (
                <span className="text-xs" style={{ color: "var(--sb-muted)" }}>—</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setDistroModal({ artistId: artist.id, artistName: artist.name, playlists: artist.distroPlaylists })}
                  className="flex items-center gap-1.5 rounded px-1 -mx-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  title="View distro tracks"
                >
                  <div className="flex items-center">
                    {artist.distroPlaylists.slice(0, 3).map((d, i) => (
                      <div
                        key={d.key}
                        className="h-6 w-6 rounded-full sb-ring overflow-hidden bg-white/40 flex-shrink-0"
                        style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 3 - i }}
                      >
                        {d.imageUrl ? (
                          <Image src={d.imageUrl} alt={d.name} width={24} height={24} className="h-6 w-6 object-cover" />
                        ) : (
                          <div className="h-6 w-6 bg-white/30" />
                        )}
                      </div>
                    ))}
                  </div>
                  <span className="text-xs truncate max-w-[72px]" style={{ color: "var(--sb-muted)" }}>
                    {artist.distroPlaylists[0].name.split(" ")[0]}
                  </span>
                  {artist.distroPlaylists.length > 1 && (
                    <span className="text-xs font-medium flex-shrink-0" style={{ color: "var(--sb-muted)" }}>
                      +{artist.distroPlaylists.length - 1}
                    </span>
                  )}
                </button>
              )}
            </TableCell>
            <TableCell mono className="text-xs" style={{ color: "var(--sb-muted)" }}>
              {artist.id}
            </TableCell>
            <TableCell>
              <Link
                href={artist.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                title="Open on Spotify"
                style={{ color: "var(--sb-muted)" }}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </TableCell>
            </TableRow>
          );
        })}
        {hasMore && (
          <TableRow>
            <TableCell className="py-3 text-center" colSpan={8}>
              <button
                type="button"
                onClick={() => setRenderCap((prev) => prev + INITIAL_RENDER_CAP)}
                className="inline-flex items-center gap-1 text-xs font-medium transition-colors sb-link-hover"
                style={{ color: "var(--sb-positive)" }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Show more ({filteredAndSortedArtists.length - renderCap} remaining)
              </button>
            </TableCell>
          </TableRow>
        )}
        {!filteredAndSortedArtists.length && (
          <TableRow>
            <TableCell className="py-8 text-center opacity-50" colSpan={8}>
              {searchQuery.trim() ? "No artists found matching your search." : "No artists found."}
            </TableCell>
          </TableRow>
        )}
      </GlassTable>

      <Modal
        open={distroModal !== null}
        onClose={() => setDistroModal(null)}
        title={distroModal?.artistName}
        subtitle={
          distroModal
            ? `${distroModal.playlists.length} distro ${distroModal.playlists.length === 1 ? "playlist" : "playlists"} · ${modalTracks.length} ${modalTracks.length === 1 ? "track" : "tracks"}`
            : undefined
        }
        maxWidthClassName="max-w-2xl"
      >
        {distroModal && (
          <div className="space-y-4">
            {/* Playlist chips */}
            <div className="flex flex-wrap gap-2">
              {distroModal.playlists.map((d) => (
                <div key={d.key} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sb-ring" style={{ background: "var(--sb-glass-bg)" }}>
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

            {/* Tracks table */}
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
                    <SortHeader label="Total" sortKey="total" current={modalSort} onSort={handleModalSort} />
                  ),
                  align: "right" as const,
                },
                {
                  label: (
                    <SortHeader label="Daily" sortKey="daily" current={modalSort} onSort={handleModalSort} />
                  ),
                  align: "right" as const,
                },
                "",
              ]}
            >
              {modalTracks.map((track) => {
                const distro = track.distroPlaylists.find((d) =>
                  distroModal.playlists.some((p) => p.key === d.key),
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
                      <span className="text-xs font-mono opacity-40" style={{ color: "var(--sb-muted)" }}>
                        {track.isrc}
                      </span>
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
                        <span className="text-xs opacity-30" style={{ color: "var(--sb-muted)" }}>—</span>
                      )}
                    </TableCell>
                    <TableCell numeric className="font-medium text-xs" style={{ color: "var(--sb-positive)" }}>
                      {track.totalStreams != null ? formatInt(track.totalStreams) : "—"}
                    </TableCell>
                    <TableCell numeric className="font-medium text-xs" style={{ color: "var(--sb-positive)" }}>
                      {track.dailyStreams != null ? formatInt(track.dailyStreams) : "—"}
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
              {modalTracks.length === 0 && (
                <TableRow>
                  <TableCell className="py-8 text-center opacity-50" colSpan={6}>
                    No distro tracks found.
                  </TableCell>
                </TableRow>
              )}
            </GlassTable>
          </div>
        )}
      </Modal>
    </div>
  );
}
