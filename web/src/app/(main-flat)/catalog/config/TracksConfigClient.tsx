"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { SearchBox } from "./SearchBox";
import { TracksList } from "./TracksList";
import { IconButton } from "@/components/ui/Button";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import { foldForSearch } from "@/lib/searchFold";

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

type TracksConfigClientProps = {
  tracks: Track[];
  totalCount: number;
};

type SortOption = "name" | "total" | "daily" | "release" | "lastseen";

export function TracksConfigClient({ tracks, totalCount }: TracksConfigClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [sortAsc, setSortAsc] = useState(true);

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
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Tracks
            {totalCount > 0 && (
              <span className="ml-2 text-base font-normal" style={{ color: "var(--sb-muted)" }}>
                ({totalCount} {totalCount === 1 ? "track" : "tracks"})
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={`${sortBy}-${sortAsc ? "asc" : "desc"}`}
            onChange={(e) => {
              const [newSortBy, newSortAsc] = e.target.value.split("-");
              setSortBy(newSortBy as SortOption);
              setSortAsc(newSortAsc === "asc");
            }}
            className="rounded-xl border bg-white/70 px-2.5 py-1.5 text-xs outline-none transition focus:border-black/20 focus:ring-2 focus:ring-black/5 dark:bg-white/5 dark:text-white dark:border-white/10 dark:focus:border-white/20 dark:focus:ring-white/5"
            style={{ borderColor: "var(--sb-border)" }}
          >
            <option value="name-asc">Name ↑</option>
            <option value="name-desc">Name ↓</option>
            <option value="total-desc">Total ↓</option>
            <option value="total-asc">Total ↑</option>
            <option value="daily-desc">Daily ↓</option>
            <option value="daily-asc">Daily ↑</option>
            <option value="release-desc">Release ↓</option>
            <option value="release-asc">Release ↑</option>
            <option value="lastseen-desc">Last Seen ↓</option>
            <option value="lastseen-asc">Last Seen ↑</option>
          </select>
          <SearchBox onSearchChange={setSearchQuery} placeholder="Search tracks…" />
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const csvData = filteredAndSortedForExport.map((track) => ({
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
