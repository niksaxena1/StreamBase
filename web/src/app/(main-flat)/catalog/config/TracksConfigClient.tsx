"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { SearchBox } from "./SearchBox";
import { TracksList } from "./TracksList";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import { foldForSearch } from "@/lib/searchFold";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";

type DistroPlaylist = { key: string; name: string; imageUrl: string | null };

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
  distroPlaylists: DistroPlaylist[];
};

type TracksConfigClientProps = {
  tracks: Track[];
  totalCount: number;
};

type SortOption = "name" | "total" | "daily" | "release" | "lastseen";

export function TracksConfigClient({ tracks, totalCount }: TracksConfigClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const sortValue = `${sortBy}-${sortAsc ? "asc" : "desc"}` as const;

  // Filter and sort tracks for CSV export
  const filteredAndSortedForExport = (() => {
    let result = [...tracks];

    // Filter by search query
    if (searchQuery.trim()) {
      const queryParts = searchQuery.trim().split(/\s+/).filter(Boolean);
      
      result = result.filter((track) => {
        const trackName = track.name ?? track.isrc;
        const normalizedTrackName = foldForSearch(trackName);
        const artistNamesText = (track.artistNames ?? []).join(" ");
        const normalizedArtistNames = foldForSearch(artistNamesText);
        
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
  })();

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Tracks
            {totalCount > 0 && (
              <span className="ml-2 text-base font-normal" style={{ color: "var(--sb-muted)" }}>
                ({totalCount} {totalCount === 1 ? "track" : "tracks"})
              </span>
            )}
          </h1>
          <button
            type="button"
            onClick={() => {
              const csvData = filteredAndSortedForExport.map((track) => {
                const totalStreams = track.totalStreams ?? null;
                const dailyStreams = track.dailyStreams ?? null;
                const totalRevenueUsd = totalStreams === null ? null : totalStreams * streamPayoutPerStreamUsd;
                const dailyRevenueUsd = dailyStreams === null ? null : dailyStreams * streamPayoutPerStreamUsd;
                return {
                  "Track Name": track.name ?? track.isrc,
                  ISRC: track.isrc,
                  Artists: track.artistNames?.join(" | ") ?? "",
                  "Total Streams": totalStreams,
                  "Daily Streams": dailyStreams,
                  "Total Revenue (USD)": totalRevenueUsd,
                  "Daily Revenue (USD)": dailyRevenueUsd,
                  "Distro Playlist": track.distroPlaylists.map((d) => d.name).join(", "),
                  "Release Date": track.release_date ?? "",
                  "Last Seen": track.last_seen ?? "",
                  "Spotify URL": track.externalUrl ?? "",
                };
              });
              downloadCsv({
                filename: `tracks-config-export-${todayIsoDate()}.csv`,
                rows: csvData,
              });
            }}
            className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            title="Download as CSV"
            aria-label="Download as CSV"
            style={{ color: "var(--sb-muted)" }}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox
            onSearchChange={setSearchQuery}
            placeholder="Search tracks…"
            className="min-w-[260px]"
          />
          <MenuSelect
            value={sortValue}
            onChange={(v) => {
              const [newSortBy, newSortAsc] = v.split("-");
              setSortBy(newSortBy as SortOption);
              setSortAsc(newSortAsc === "asc");
            }}
            ariaLabel="Track sorting"
            align="right"
            options={[
              { value: "name-asc", label: "Name ↑" },
              { value: "name-desc", label: "Name ↓" },
              { value: "total-desc", label: "Total ↓" },
              { value: "total-asc", label: "Total ↑" },
              { value: "daily-desc", label: "Daily ↓" },
              { value: "daily-asc", label: "Daily ↑" },
              { value: "release-desc", label: "Release ↓" },
              { value: "release-asc", label: "Release ↑" },
              { value: "lastseen-desc", label: "Last Seen ↓" },
              { value: "lastseen-asc", label: "Last Seen ↑" },
            ]}
          />
        </div>
      </div>

      <TracksList 
        tracks={tracks} 
        searchQuery={searchQuery}
        sortBy={sortBy}
        sortAsc={sortAsc}
      />
    </>
  );
}
