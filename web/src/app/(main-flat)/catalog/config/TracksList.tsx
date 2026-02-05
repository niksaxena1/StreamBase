"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";

import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { IconButton } from "@/components/ui/Button";
import { foldForSearch } from "@/lib/searchFold";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { formatInt, formatUsd2 } from "@/lib/format";

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

  return (
    <div className="sb-card overflow-hidden">
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <div className="text-xs font-medium">
          Results{" "}
          <span style={{ color: "var(--sb-muted)" }}>
            ({filteredAndSortedTracks.length.toLocaleString("en-US")})
          </span>
        </div>
        <IconButton
          type="button"
          onClick={() => {
            const csvData = filteredAndSortedTracks.map((track) => ({
              "Track Name": track.name ?? track.isrc,
              ISRC: track.isrc,
              Artists: track.artistNames?.join(" | ") ?? "",
              "Total Streams": track.totalStreams ?? "",
              "Daily Streams": track.dailyStreams ?? "",
              "Release Date": track.release_date ?? "",
              "Last Seen": track.last_seen ?? "",
            }));
            downloadCsv({
              filename: `tracks-config-export-${todayIsoDate()}.csv`,
              rows: csvData,
            });
          }}
          title="Download table as CSV"
          aria-label="Download table as CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-left text-[11px]" style={{ color: "var(--sb-muted)" }}>
            <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
              <th className="px-3 py-2 font-medium"></th>
              <th className="px-3 py-2 font-medium">Track</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Daily</th>
              <th className="px-3 py-2 font-medium">ISRC</th>
              <th className="px-3 py-2 font-medium">Release</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedTracks.map((track) => (
              <tr
                key={track.isrc}
                className="border-b last:border-0"
                style={{ borderColor: "var(--sb-border)" }}
              >
                <td className="px-3 py-2">
                  {track.albumImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.albumImageUrl}
                      alt="Album cover"
                      className="h-8 w-8 rounded-lg object-cover sb-ring"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                  )}
                </td>
                <td className="px-3 py-2">
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
                </td>
                <td className="px-3 py-2 text-xs">
                  <span style={{ color: metricColor }} className="font-medium">
                    {formatValue(track.totalStreams)}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span style={{ color: metricColor }} className="font-medium">
                    {track.dailyStreams !== null && track.dailyStreams > 0 ? "+" : ""}
                    {formatValue(track.dailyStreams)}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] opacity-40" style={{ color: "var(--sb-muted)" }}>
                  <Link className="underline" href={`/tracks/${track.isrc}`}>
                    {track.isrc}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {track.release_date ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {track.last_seen ?? "—"}
                </td>
                <td className="px-3 py-2">
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
                </td>
              </tr>
            ))}
            {!filteredAndSortedTracks.length && (
              <tr>
                <td
                  className="px-3 py-6 text-sm"
                  style={{ color: "var(--sb-muted)" }}
                  colSpan={8}
                >
                  {searchQuery.trim() ? "No tracks found matching your search." : "No tracks found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
