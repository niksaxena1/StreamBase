"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ExternalLink, ChevronDown } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { foldForSearch } from "@/lib/searchFold";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatInt, formatUsd2 } from "@/lib/format";

/** Number of rows to render initially before requiring "Show more". */
const INITIAL_RENDER_CAP = 150;

type Track = {
  isrc: string;
  name: string | null;
  release_date: string | null;
  last_seen: string | null;
  albumImageUrl: string | null;
  artistNames: string[] | null;
  artistIds: string[] | null;
  externalUrl: string | null;
  totalStreams: number | null;
  dailyStreams: number | null;
};

type SortOption = "name" | "total" | "daily" | "release" | "lastseen";

type TracksListProps = {
  tracks: Track[];
  searchQuery: string;
  sortBy?: SortOption;
  sortAsc?: boolean;
};

export function TracksList({ tracks, searchQuery, sortBy = "name", sortAsc = true }: TracksListProps) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const filteredAndSortedTracks = useMemo(() => {
    let result = [...tracks];

    // Filter by search query
    if (searchQuery.trim()) {
      // Split query into words to allow searching for both artist and track name
      const queryParts = searchQuery.trim().split(/\s+/).filter(Boolean);
      
      result = result.filter((track) => {
        const trackName = track.name ?? track.isrc;
        const normalizedTrackName = foldForSearch(trackName);
        const artistNamesText = (track.artistNames ?? []).join(" ");
        const normalizedArtistNames = foldForSearch(artistNamesText);
        
        // Check if all query parts match either the track name or artist names
        return queryParts.every((part) => {
          const normalizedPart = foldForSearch(part);
          return normalizedTrackName.includes(normalizedPart) || 
                 normalizedArtistNames.includes(normalizedPart);
        });
      });
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name": {
          const nameA = a.name ?? a.isrc;
          const nameB = b.name ?? b.isrc;
          comparison = nameA.localeCompare(nameB);
          break;
        }
        case "total":
          comparison = (a.totalStreams ?? 0) - (b.totalStreams ?? 0);
          break;
        case "daily":
          comparison = (a.dailyStreams ?? 0) - (b.dailyStreams ?? 0);
          break;
        case "release":
          comparison = (a.release_date ?? "").localeCompare(b.release_date ?? "");
          break;
        case "lastseen":
          comparison = (a.last_seen ?? "").localeCompare(b.last_seen ?? "");
          break;
      }

      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [tracks, searchQuery, sortBy, sortAsc]);

  // For tracks, use streams instead of tracks metric
  const displayMetric = metric === "tracks" ? "streams" : metric;
  
  // Color scheme based on metric
  const metricColor =
    displayMetric === "revenue" ? "#10b981" : "var(--sb-accent)";

  const formatValue = (value: number | null) => {
    if (value === null) return "—";
    if (displayMetric === "revenue") return formatUsd2(value * streamPayoutPerStreamUsd);
    return formatInt(value);
  };

  const getTotalMetricLabel = () => {
    if (displayMetric === "revenue") return "Total Revenue";
    return "Total Streams";
  };

  const getDailyMetricLabel = () => {
    if (displayMetric === "revenue") return "Daily Revenue";
    return "Daily Streams";
  };

  // Incremental render cap to keep DOM node count low for large catalogs.
  const [renderCap, setRenderCap] = useState(INITIAL_RENDER_CAP);
  const visibleTracks = filteredAndSortedTracks.slice(0, renderCap);
  const hasMore = filteredAndSortedTracks.length > renderCap;

  return (
    <div className="flex flex-col space-y-2">
      <GlassTable headers={["", "Track", getTotalMetricLabel(), getDailyMetricLabel(), "ISRC", "Release", "Last seen", ""]}>
        {visibleTracks.map((track) => (
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
                className="font-medium transition-colors sb-link-hover"
              >
                {track.name ?? track.isrc}
              </Link>
              {track.artistNames?.length ? (
                <div className="mt-0.5 text-xs opacity-60">
                  <ArtistLinks
                    artistNames={track.artistNames}
                    artistIds={track.artistIds ?? undefined}
                  />
                </div>
              ) : null}
            </TableCell>
            <TableCell>
              <span style={{ color: metricColor }} className="font-medium text-xs">
                {formatValue(track.totalStreams)}
              </span>
            </TableCell>
            <TableCell>
              <span style={{ color: metricColor }} className="font-medium text-xs">
                {formatValue(track.dailyStreams)}
              </span>
            </TableCell>
            <TableCell mono className="text-xs" style={{ color: "var(--sb-muted)" }}>
              {track.isrc}
            </TableCell>
            <TableCell className="text-xs">
              {track.release_date ?? "—"}
            </TableCell>
            <TableCell className="text-xs">
              {track.last_seen ?? "—"}
            </TableCell>
            <TableCell>
              {track.externalUrl ? (
                <Link
                  href={track.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  title="Open on Spotify"
                  style={{ color: "var(--sb-muted)" }}
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
        {hasMore && (
          <TableRow>
            <TableCell className="py-3 text-center" colSpan={8}>
              <button
                type="button"
                onClick={() => setRenderCap((prev) => prev + INITIAL_RENDER_CAP)}
                className="inline-flex items-center gap-1 text-xs font-medium transition-colors sb-link-hover"
                style={{ color: "var(--sb-accent)" }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Show more ({filteredAndSortedTracks.length - renderCap} remaining)
              </button>
            </TableCell>
          </TableRow>
        )}
        {!filteredAndSortedTracks.length && (
          <TableRow>
            <TableCell className="py-8 text-center opacity-50" colSpan={8}>
              {searchQuery.trim() ? "No tracks found matching your search." : "No tracks found."}
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
    </div>
  );
}
