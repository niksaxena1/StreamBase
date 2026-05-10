"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ExternalLink, User, ChevronDown } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import {
  ArtistDistroTracksModal,
  type DistroPlaylist,
} from "@/components/catalog/ArtistDistroTracksModal";
import { foldForSearch } from "@/lib/searchFold";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatInt, formatUsd2 } from "@/lib/format";

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
  inHouse: boolean;
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
type InHouseFilter = "all" | "in_house" | "nih";

type ArtistsListProps = {
  artists: Artist[];
  searchQuery: string;
  sortBy?: SortOption;
  sortAsc?: boolean;
  distroFilter?: string | null;
  inHouseFilter?: InHouseFilter;
  allTracks?: TrackRow[];
  savingArtistId?: string | null;
  onToggleInHouse?: (artistId: string, nextInHouse: boolean) => void;
};

const INITIAL_RENDER_CAP = 150;

export function ArtistsList({
  artists,
  searchQuery,
  sortBy = "name",
  sortAsc = true,
  distroFilter,
  inHouseFilter = "all",
  allTracks = [],
  savingArtistId = null,
  onToggleInHouse,
}: ArtistsListProps) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  
  // Create a map for quick artist name lookup by ID
  const artistIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const artist of artists) {
      map.set(artist.id, artist.name);
    }
    return map;
  }, [artists]);

  const filteredAndSortedArtists = useMemo(() => {
    let result = [...artists];

    if (inHouseFilter === "in_house") {
      result = result.filter((artist) => artist.inHouse);
    } else if (inHouseFilter === "nih") {
      result = result.filter((artist) => !artist.inHouse);
    }

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
  }, [artists, distroFilter, inHouseFilter, metric, searchQuery, sortBy, sortAsc, streamPayoutPerStreamUsd]);

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

  const modalTracks = useMemo(() => {
    if (!distroModal) return [];
    const artistId = distroModal.artistId;
    const distroKeys = new Set(distroModal.playlists.map((p) => p.key));
    return allTracks.filter(
      (t) =>
        t.artistIds?.includes(artistId) &&
        t.distroPlaylists.some((d) => distroKeys.has(d.key)),
    );
  }, [distroModal, allTracks]);

  // Incremental render cap to keep DOM node count low for large artist lists.
  const [renderCap, setRenderCap] = useState(INITIAL_RENDER_CAP);
  const visibleArtists = filteredAndSortedArtists.slice(0, renderCap);
  const hasMore = filteredAndSortedArtists.length > renderCap;

  return (
    <div className="flex flex-col space-y-2">
      <GlassTable headers={["", "Artist", "Tracks", getTotalMetricLabel(), getDailyMetricLabel(), "Status", "DISTRO", "ID", ""]}>
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
              <button
                type="button"
                onClick={() => onToggleInHouse?.(artist.id, !artist.inHouse)}
                disabled={!onToggleInHouse || savingArtistId === artist.id}
                className={[
                  "sb-ring rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition",
                  artist.inHouse
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    : "border-transparent bg-black/5 text-black/40 hover:bg-black/10 dark:bg-white/5 dark:text-white/35 dark:hover:bg-white/10",
                ].join(" ")}
                title={artist.inHouse ? "Mark as NIH" : "Mark as In-House"}
                aria-label={`${artist.name}: ${artist.inHouse ? "mark as NIH" : "mark as In-House"}`}
              >
                {artist.inHouse ? "In-House" : "NIH"}
              </button>
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
            <TableCell className="py-3 text-center" colSpan={9}>
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
            <TableCell className="py-8 text-center opacity-50" colSpan={9}>
              {searchQuery.trim() ? "No artists found matching your search." : "No artists found."}
            </TableCell>
          </TableRow>
        )}
      </GlassTable>

      <ArtistDistroTracksModal
        open={distroModal !== null}
        onClose={() => setDistroModal(null)}
        artistName={distroModal?.artistName ?? ""}
        distroPlaylists={distroModal?.playlists ?? []}
        tracks={modalTracks}
        artistIdToName={artistIdToName}
      />
    </div>
  );
}
