"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ExternalLink, User, ChevronDown } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
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
};

type SortOption = "name" | "total" | "daily";

type ArtistsListProps = {
  artists: Artist[];
  searchQuery: string;
  sortBy?: SortOption;
  sortAsc?: boolean;
};

const INITIAL_RENDER_CAP = 150;

export function ArtistsList({ artists, searchQuery, sortBy = "name", sortAsc = true }: ArtistsListProps) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const filteredAndSortedArtists = useMemo(() => {
    let result = [...artists];

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
  }, [artists, metric, searchQuery, sortBy, sortAsc, streamPayoutPerStreamUsd]);

  // Color scheme based on metric
  const metricColor =
    metric === "revenue" ? "#10b981" : metric === "tracks" ? "#3b82f6" : "var(--sb-accent)";

  const getMetricValue = (artist: Artist) => {
    if (metric === "tracks") {
      return artist.trackCount;
    }
    return artist.totalStreams;
  };

  const getDailyMetricValue = (artist: Artist) => {
    if (metric === "tracks") {
      return artist.dailyTrackCount;
    }
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

  // Incremental render cap to keep DOM node count low for large artist lists.
  const [renderCap, setRenderCap] = useState(INITIAL_RENDER_CAP);
  const visibleArtists = filteredAndSortedArtists.slice(0, renderCap);
  const hasMore = filteredAndSortedArtists.length > renderCap;

  return (
    <div className="flex flex-col space-y-2">
      <GlassTable headers={["", "Artist", getTotalMetricLabel(), getDailyMetricLabel(), "ID", ""]}>
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
            <TableCell className="py-3 text-center" colSpan={6}>
              <button
                type="button"
                onClick={() => setRenderCap((prev) => prev + INITIAL_RENDER_CAP)}
                className="inline-flex items-center gap-1 text-xs font-medium transition-colors sb-link-hover"
                style={{ color: "var(--sb-accent)" }}
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Show more ({filteredAndSortedArtists.length - renderCap} remaining)
              </button>
            </TableCell>
          </TableRow>
        )}
        {!filteredAndSortedArtists.length && (
          <TableRow>
            <TableCell className="py-8 text-center opacity-50" colSpan={6}>
              {searchQuery.trim() ? "No artists found matching your search." : "No artists found."}
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
    </div>
  );
}
