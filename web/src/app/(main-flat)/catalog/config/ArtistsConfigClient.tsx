"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

import { SearchBox } from "./SearchBox";
import { ArtistsList } from "./ArtistsList";
import { IconButton } from "@/components/ui/Button";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import { useMetric } from "@/components/metrics/MetricContext";

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

type ArtistsConfigClientProps = {
  artists: Artist[];
  totalCount: number;
};

type SortOption = "name" | "total" | "daily";

export function ArtistsConfigClient({ artists, totalCount }: ArtistsConfigClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const { metric } = useMetric();

  // Filter and sort artists for CSV export
  const filteredAndSortedForExport = (() => {
    let result = [...artists];

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((artist) => artist.name.toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "total":
          comparison = (a.totalStreams ?? 0) - (b.totalStreams ?? 0);
          break;
        case "daily":
          comparison = (a.dailyStreams ?? 0) - (b.dailyStreams ?? 0);
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
          <Link
            href="/catalog"
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            aria-label="Back to catalog"
            title="Back to catalog"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </Link>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Artists
              {totalCount > 0 && (
                <span className="ml-2 text-base font-normal" style={{ color: "var(--sb-muted)" }}>
                  ({totalCount} {totalCount === 1 ? "artist" : "artists"})
                </span>
              )}
            </h1>
          </div>
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
          </select>
          <SearchBox onSearchChange={setSearchQuery} placeholder="Search artists…" />
          <IconButton
            type="button"
            onClick={() => {
              const csvData = filteredAndSortedForExport.map((artist) => {
                if (metric === "tracks") {
                  return {
                    "Artist Name": artist.name,
                    "Artist ID": artist.id,
                    "Total Tracks": artist.trackCount,
                    "Daily Tracks": artist.dailyTrackCount,
                    "Spotify URL": artist.externalUrl,
                  };
                }
                return {
                  "Artist Name": artist.name,
                  "Artist ID": artist.id,
                  "Total Streams": artist.totalStreams ?? "",
                  "Daily Streams": artist.dailyStreams ?? "",
                  "Spotify URL": artist.externalUrl,
                };
              });
              downloadCsv({
                filename: `artists-config-export-${todayIsoDate()}.csv`,
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

      <ArtistsList 
        artists={artists} 
        searchQuery={searchQuery}
        sortBy={sortBy}
        sortAsc={sortAsc}
      />
    </>
  );
}
