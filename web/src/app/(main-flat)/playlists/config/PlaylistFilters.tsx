"use client";

import Link from "next/link";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { useEffect, useMemo, useState } from "react";
import { Search, X, Music } from "lucide-react";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { formatInt, formatUsd2 } from "@/lib/format";
import { foldForSearch } from "@/lib/searchFold";
import { useMetric } from "@/components/metrics/MetricContext";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { MenuSelect } from "@/components/ui/MenuSelect";

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  playlist_type: string | null;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
  display_order: number | null;
};

type PlaylistStats = {
  track_count: number | null;
  daily_tracks_net: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
};

type PlaylistFiltersProps = {
  playlists: PlaylistRow[];
  statsMap: Record<string, PlaylistStats>;
  statsLoading?: boolean;
  registerExport?: (fn: () => void) => void;
};

type SortOption = "name" | "total" | "daily" | "type";
type FilterType = "all" | "Catalog" | "Label" | "Entity" | "Distro" | "Standard";

export function PlaylistFilters({ playlists, statsMap, statsLoading = false, registerExport }: PlaylistFiltersProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();

  const filteredAndSorted = useMemo(() => {
    let result = [...playlists];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = foldForSearch(searchQuery);
      result = result.filter((p) =>
        foldForSearch(p.display_name).includes(query) ||
        foldForSearch(p.playlist_key).includes(query)
      );
    }

    // Filter by type
    if (typeFilter !== "all") {
      result = result.filter((p) => {
        const type = p.playlist_type || (p.is_catalog ? "Catalog" : "Standard");
        return type === typeFilter;
      });
    }

    // Sort
    result.sort((a, b) => {
      // Default grouping: use display_order if available and sortBy is "name" (default)
      if (sortBy === "name" && a.display_order !== null && b.display_order !== null) {
        return a.display_order - b.display_order;
      }
      if (sortBy === "name" && a.display_order !== null) return -1;
      if (sortBy === "name" && b.display_order !== null) return 1;

      let comparison = 0;

      const statsA = statsMap[a.playlist_key];
      const statsB = statsMap[b.playlist_key];

      const totalA =
        metric === "tracks"
          ? statsA?.track_count ?? 0
          : metric === "revenue"
            ? (statsA?.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd
            : statsA?.total_streams_cumulative ?? 0;
      const totalB =
        metric === "tracks"
          ? statsB?.track_count ?? 0
          : metric === "revenue"
            ? (statsB?.total_streams_cumulative ?? 0) * streamPayoutPerStreamUsd
            : statsB?.total_streams_cumulative ?? 0;

      const dailyA =
        metric === "tracks"
          ? statsA?.daily_tracks_net ?? 0
          : metric === "revenue"
            ? (statsA?.daily_streams_net ?? 0) * streamPayoutPerStreamUsd
            : statsA?.daily_streams_net ?? 0;
      const dailyB =
        metric === "tracks"
          ? statsB?.daily_tracks_net ?? 0
          : metric === "revenue"
            ? (statsB?.daily_streams_net ?? 0) * streamPayoutPerStreamUsd
            : statsB?.daily_streams_net ?? 0;

      switch (sortBy) {
        case "name":
          comparison = a.display_name.localeCompare(b.display_name);
          break;
        case "type":
          comparison = (a.playlist_type || (a.is_catalog ? "Catalog" : "Standard")).localeCompare(
            b.playlist_type || (b.is_catalog ? "Catalog" : "Standard"),
          );
          break;
        case "total": {
          comparison = totalA - totalB;
          break;
        }
        case "daily": {
          comparison = dailyA - dailyB;
          break;
        }
      }

      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [playlists, statsMap, searchQuery, typeFilter, sortBy, sortAsc, metric, streamPayoutPerStreamUsd]);

  const totalHeader = metric === "tracks" ? "Total" : metric === "revenue" ? "Total" : "Total";
  const dailyHeader = metric === "tracks" ? "Daily" : metric === "revenue" ? "Daily" : "Daily";

  const metricColor =
    metric === "tracks"
      ? "var(--sb-tracks)"
      : metric === "revenue"
        ? "var(--sb-revenue)"
        : "var(--sb-positive)";

  useEffect(() => {
    if (!registerExport) return;
    registerExport(() => {
      const csvData = filteredAndSorted.map((p) => {
        const stats = statsMap[p.playlist_key];
        const type = p.playlist_type || (p.is_catalog ? "Catalog" : "Standard");
        const totalStreams = stats?.total_streams_cumulative ?? null;
        const dailyStreams = stats?.daily_streams_net ?? null;
        const totalTracks = stats?.track_count ?? null;
        const dailyTracks = stats?.daily_tracks_net ?? null;
        const totalRevenueUsd = totalStreams == null ? null : totalStreams * streamPayoutPerStreamUsd;
        const dailyRevenueUsd = dailyStreams == null ? null : dailyStreams * streamPayoutPerStreamUsd;
        return {
          "Playlist Key": p.playlist_key,
          Name: p.display_name,
          Type: type,
          "Total Streams": totalStreams,
          "Daily Streams": dailyStreams,
          "Total Revenue (USD)": totalRevenueUsd,
          "Daily Revenue (USD)": dailyRevenueUsd,
          "Total Tracks": totalTracks,
          "Daily Tracks": dailyTracks,
        };
      });
      downloadCsv({
        filename: `playlist-config-export-${todayIsoDate()}.csv`,
        rows: csvData,
      });
    });
  }, [filteredAndSorted, registerExport, statsMap, streamPayoutPerStreamUsd]);

  return (
    <div className="flex flex-col space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--sb-muted)" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search playlists…"
            className="w-full rounded-xl border bg-white/70 pl-8 pr-8 py-1.5 text-xs outline-none placeholder:text-black/40 transition focus:border-black/20 focus:ring-2 focus:ring-black/5 dark:bg-white/5 dark:text-white dark:placeholder:text-white/40 dark:border-white/10 dark:focus:border-white/20 dark:focus:ring-white/5"
            style={{ borderColor: "var(--sb-border)" }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 transition hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" style={{ color: "var(--sb-muted)" }} />
            </button>
          )}
        </div>

        {/* Type Filter */}
        <MenuSelect
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as FilterType)}
          ariaLabel="Filter by playlist type"
          options={[
            { value: "all", label: "All Types" },
            { value: "Catalog", label: "Catalog" },
            { value: "Label", label: "Label" },
            { value: "Entity", label: "Entity" },
            { value: "Distro", label: "Distro" },
            { value: "Standard", label: "Standard" },
          ]}
        />

        {/* Sort */}
        <MenuSelect
          value={`${sortBy}-${sortAsc ? "asc" : "desc"}`}
          onChange={(v) => {
            const [newSortBy, newSortAsc] = String(v).split("-");
            setSortBy(newSortBy as SortOption);
            setSortAsc(newSortAsc === "asc");
          }}
          ariaLabel="Sort playlists"
          options={[
            { value: "name-asc", label: "Name ↑" },
            { value: "name-desc", label: "Name ↓" },
            { value: "total-desc", label: `${totalHeader} ↓` },
            { value: "total-asc", label: `${totalHeader} ↑` },
            { value: "daily-desc", label: `${dailyHeader} ↓` },
            { value: "daily-asc", label: `${dailyHeader} ↑` },
            { value: "type-asc", label: "Type ↑" },
            { value: "type-desc", label: "Type ↓" },
          ]}
          align="right"
        />

        {/* Results count */}
        <div className="text-xs whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
          {filteredAndSorted.length} / {playlists.length}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 flex flex-col">
        <GlassTable 
          headers={[
            "",
            "Name",
            { label: totalHeader, align: "right" },
            { label: dailyHeader, align: "right" },
            "Type",
          ]}
          className="[&_th:first-child]:w-12 [&_td:first-child]:w-12 h-full [&>div]:h-full [&>div]:max-h-none"
        >
        {filteredAndSorted.map((p) => {
          const stats = statsMap[p.playlist_key];
          
          const totalValue =
            metric === "tracks"
              ? stats?.track_count
              : metric === "revenue"
                ? (stats?.total_streams_cumulative == null ? null : stats.total_streams_cumulative * streamPayoutPerStreamUsd)
                : stats?.total_streams_cumulative;

          const dailyValue =
            metric === "tracks"
              ? stats?.daily_tracks_net
              : metric === "revenue"
                ? (stats?.daily_streams_net == null ? null : stats.daily_streams_net * streamPayoutPerStreamUsd)
                : stats?.daily_streams_net;

          const formatValue = (n: number | null | undefined) => {
            return metric === "revenue" ? formatUsd2(n) : formatInt(n);
          };

          const statPlaceholder = statsLoading ? (
            <span className="inline-block h-3.5 w-10 animate-pulse rounded bg-black/10 dark:bg-white/10" />
          ) : null;
          
          return (
            <TableRow key={p.playlist_key}>
              <TableCell className="w-12">
                {p.playlist_key === "all_catalog" ? (
                  <div
                    className="sb-ring flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{ background: "var(--sb-accent)" }}
                  >
                    <Music className="h-4 w-4" style={{ color: "black" }} />
                  </div>
                ) : p.spotify_playlist_image_url ? (
                  <PreviewableArtwork
                    src={p.spotify_playlist_image_url}
                    alt="Playlist cover"
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
                  href={`/playlists?playlist_key=${encodeURIComponent(p.playlist_key)}`}
                  className="font-medium transition-colors sb-link-hover"
                  title={`Open ${p.display_name}`}
                >
                  {p.display_name}
                </Link>
              </TableCell>
              <TableCell numeric>
                {statPlaceholder ?? (
                  <span style={{ color: metricColor }} className="font-medium">
                    {formatValue(totalValue ?? null)}
                  </span>
                )}
              </TableCell>
              <TableCell numeric>
                {statPlaceholder ??
                  (dailyValue !== null && dailyValue !== undefined ? (
                    <span style={{ color: metricColor }} className="font-medium">
                      {formatValue(dailyValue)}
                    </span>
                  ) : (
                    <span style={{ color: "var(--sb-muted)" }}>{formatInt(null)}</span>
                  ))}
              </TableCell>
              <TableCell>
                {(() => {
                  const type = p.playlist_type || (p.is_catalog ? "Catalog" : "Standard");
                  if (type === "Catalog") {
                    return (
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ background: "var(--sb-accent-10)", color: "var(--sb-positive)" }}
                      >
                        Catalog
                      </span>
                    );
                  }
                  const typeColors = {
                    Label: {
                      bg: "bg-blue-400/20",
                      text: "text-blue-800 dark:text-blue-300",
                    },
                    Entity: {
                      bg: "bg-purple-400/20",
                      text: "text-purple-800 dark:text-purple-300",
                    },
                    Distro: {
                      bg: "bg-orange-400/20",
                      text: "text-orange-800 dark:text-orange-300",
                    },
                  } as const;
                  const colors =
                    (typeColors as Record<string, { bg: string; text: string }>)[type] || {
                    bg: "bg-black/10",
                    text: "text-black/80 dark:text-white/60",
                  };
                  return (
                    <span className={`inline-flex items-center rounded-full ${colors.bg} px-2.5 py-0.5 text-xs font-medium ${colors.text}`}>
                      {type}
                    </span>
                  );
                })()}
              </TableCell>
            </TableRow>
          );
        })}
        {!filteredAndSorted.length && (
          <TableRow>
            <TableCell className="py-8 text-center opacity-50" colSpan={5}>
              No playlists found.
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
      </div>
    </div>
  );
}
