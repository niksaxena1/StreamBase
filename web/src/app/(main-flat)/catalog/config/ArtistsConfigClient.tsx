"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Download } from "lucide-react";

import { SearchBox } from "./SearchBox";
import { ArtistsList } from "./ArtistsList";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import { foldForSearch } from "@/lib/searchFold";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { useMetric } from "@/components/metrics/MetricContext";

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

type ArtistsConfigClientProps = {
  artists: Artist[];
  totalCount: number;
  allTracks: TrackRow[];
};

type SortOption = "name" | "total" | "daily" | "tracks";

export function ArtistsConfigClient({ artists, totalCount, allTracks }: ArtistsConfigClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [distroFilter, setDistroFilter] = useState<string | null>(null);
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const { metric } = useMetric();
  const sortValue = `${sortBy}-${sortAsc ? "asc" : "desc"}` as const;

  // Derive unique distro playlists for the filter dropdown
  const availableDistros = useMemo(() => {
    const map = new Map<string, DistroPlaylist>();
    for (const artist of artists) {
      for (const d of artist.distroPlaylists) {
        if (!map.has(d.key)) map.set(d.key, d);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [artists]);

  // Filter and sort artists (shared between CSV export and list)
  const filteredAndSorted = useMemo(() => {
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
  }, [artists, distroFilter, searchQuery, sortBy, sortAsc, metric, streamPayoutPerStreamUsd]);

  const selectedDistro = distroFilter ? availableDistros.find((d) => d.key === distroFilter) : null;

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
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Artists
              {totalCount > 0 && (
                <span className="ml-2 text-base font-normal" style={{ color: "var(--sb-muted)" }}>
                  ({totalCount} {totalCount === 1 ? "artist" : "artists"})
                </span>
              )}
            </h1>
            <button
              type="button"
              onClick={() => {
                const csvData = filteredAndSorted.map((artist) => {
                  const totalStreams = artist.totalStreams ?? null;
                  const dailyStreams = artist.dailyStreams ?? null;
                  const totalRevenueUsd = totalStreams === null ? null : totalStreams * streamPayoutPerStreamUsd;
                  const dailyRevenueUsd = dailyStreams === null ? null : dailyStreams * streamPayoutPerStreamUsd;
                  return {
                    "Artist Name": artist.name,
                    "Artist ID": artist.id,
                    "Total Streams": totalStreams,
                    "Daily Streams": dailyStreams,
                    "Total Revenue (USD)": totalRevenueUsd,
                    "Daily Revenue (USD)": dailyRevenueUsd,
                    "Total Tracks": artist.trackCount,
                    "Daily Tracks": artist.dailyTrackCount,
                    "Distro Playlists": artist.distroPlaylists.map((d) => d.name).join(", "),
                    "Spotify URL": artist.externalUrl,
                  };
                });
                downloadCsv({
                  filename: `artists-config-export-${todayIsoDate()}.csv`,
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
        </div>
        <div className="flex items-center gap-2">
          {/* Distro filter */}
          {availableDistros.length > 0 && (
            <div className="flex items-center gap-1.5">
              {selectedDistro && (
                <button
                  type="button"
                  onClick={() => setDistroFilter(null)}
                  className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10 sb-ring"
                  title="Clear distro filter"
                  style={{ color: "var(--sb-muted)" }}
                >
                  {selectedDistro.imageUrl && (
                    <Image
                      src={selectedDistro.imageUrl}
                      alt={selectedDistro.name}
                      width={16}
                      height={16}
                      className="h-4 w-4 rounded-full object-cover flex-shrink-0"
                    />
                  )}
                  <span className="max-w-[80px] truncate">{selectedDistro.name}</span>
                  <span className="opacity-50">×</span>
                </button>
              )}
              <MenuSelect
                value={distroFilter ?? ""}
                onChange={(v) => setDistroFilter(v || null)}
                ariaLabel="Filter by distro playlist"
                align="right"
                options={[
                  { value: "", label: "All distros" },
                  ...availableDistros.map((d) => ({ value: d.key, label: d.name })),
                ]}
              />
            </div>
          )}
          <SearchBox
            onSearchChange={setSearchQuery}
            placeholder="Search artists…"
            className="min-w-[260px]"
          />
          <MenuSelect
            value={sortValue}
            onChange={(v) => {
              const [newSortBy, newSortAsc] = v.split("-");
              setSortBy(newSortBy as SortOption);
              setSortAsc(newSortAsc === "asc");
            }}
            ariaLabel="Artist sorting"
            align="right"
            options={[
              { value: "name-asc", label: "Name ↑" },
              { value: "name-desc", label: "Name ↓" },
              { value: "tracks-desc", label: "Tracks ↓" },
              { value: "tracks-asc", label: "Tracks ↑" },
              { value: "total-desc", label: "Total ↓" },
              { value: "total-asc", label: "Total ↑" },
              { value: "daily-desc", label: "Daily ↓" },
              { value: "daily-asc", label: "Daily ↑" },
            ]}
          />
        </div>
      </div>

      <ArtistsList
        artists={artists}
        searchQuery={searchQuery}
        sortBy={sortBy}
        sortAsc={sortAsc}
        distroFilter={distroFilter}
        allTracks={allTracks}
      />
    </>
  );
}
