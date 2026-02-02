"use client";

import { useState, useMemo } from "react";
import { Search, X, Music } from "lucide-react";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { formatInt } from "@/lib/format";
import { foldForSearch } from "@/lib/searchFold";

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
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
};

type PlaylistFiltersProps = {
  playlists: PlaylistRow[];
  statsMap: Record<string, PlaylistStats>;
};

type SortOption = "name" | "tracks" | "streams" | "daily" | "type";
type FilterType = "all" | "Catalog" | "Label" | "Entity" | "Distro" | "Standard";

export function PlaylistFilters({ playlists, statsMap }: PlaylistFiltersProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortOption>("name");
  const [sortAsc, setSortAsc] = useState(true);

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

      switch (sortBy) {
        case "name":
          comparison = a.display_name.localeCompare(b.display_name);
          break;
        case "type":
          const typeA = a.playlist_type || (a.is_catalog ? "Catalog" : "Standard");
          const typeB = b.playlist_type || (b.is_catalog ? "Catalog" : "Standard");
          comparison = typeA.localeCompare(typeB);
          break;
        case "tracks": {
          const statsA = statsMap[a.playlist_key];
          const statsB = statsMap[b.playlist_key];
          const tracksA = statsA?.track_count ?? 0;
          const tracksB = statsB?.track_count ?? 0;
          comparison = tracksA - tracksB;
          break;
        }
        case "streams": {
          const statsA = statsMap[a.playlist_key];
          const statsB = statsMap[b.playlist_key];
          const streamsA = statsA?.total_streams_cumulative ?? 0;
          const streamsB = statsB?.total_streams_cumulative ?? 0;
          comparison = streamsA - streamsB;
          break;
        }
        case "daily": {
          const statsA = statsMap[a.playlist_key];
          const statsB = statsMap[b.playlist_key];
          const dailyA = statsA?.daily_streams_net ?? 0;
          const dailyB = statsB?.daily_streams_net ?? 0;
          comparison = dailyA - dailyB;
          break;
        }
      }

      return sortAsc ? comparison : -comparison;
    });

    return result;
  }, [playlists, statsMap, searchQuery, typeFilter, sortBy, sortAsc]);

  return (
    <div className="flex h-full flex-col space-y-3">
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
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as FilterType)}
          className="rounded-xl border bg-white/70 px-2.5 py-1.5 text-xs outline-none transition focus:border-black/20 focus:ring-2 focus:ring-black/5 dark:bg-white/5 dark:text-white dark:border-white/10 dark:focus:border-white/20 dark:focus:ring-white/5"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <option value="all">All Types</option>
          <option value="Catalog">Catalog</option>
          <option value="Label">Label</option>
          <option value="Entity">Entity</option>
          <option value="Distro">Distro</option>
          <option value="Standard">Standard</option>
        </select>

        {/* Sort */}
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
          <option value="tracks-desc">Tracks ↓</option>
          <option value="tracks-asc">Tracks ↑</option>
          <option value="streams-desc">Streams ↓</option>
          <option value="streams-asc">Streams ↑</option>
          <option value="daily-desc">L24H ↓</option>
          <option value="daily-asc">L24H ↑</option>
          <option value="type-asc">Type ↑</option>
          <option value="type-desc">Type ↓</option>
        </select>

        {/* Results count */}
        <div className="text-xs whitespace-nowrap" style={{ color: "var(--sb-muted)" }}>
          {filteredAndSorted.length} / {playlists.length}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0">
        <GlassTable 
          headers={["", "Name", "Tracks", "Cum. Streams", "L24H Streams", "Type"]}
          className="[&_th:first-child]:w-12 [&_td:first-child]:w-12 h-full [&>div]:h-full [&>div]:max-h-none"
        >
        {filteredAndSorted.map((p) => {
          const stats = statsMap[p.playlist_key];
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
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.spotify_playlist_image_url}
                    alt="Playlist cover"
                    className="h-8 w-8 rounded-lg object-cover sb-ring"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                )}
              </TableCell>
              <TableCell>
                <span className="font-medium">{p.display_name}</span>
              </TableCell>
              <TableCell>
                {formatInt(stats?.track_count ?? null)}
              </TableCell>
              <TableCell>
                {formatInt(stats?.total_streams_cumulative ?? null)}
              </TableCell>
              <TableCell>
                {stats?.daily_streams_net !== null && stats?.daily_streams_net !== undefined ? (
                  <span className="sb-positive font-medium">
                    +{formatInt(stats.daily_streams_net)}
                  </span>
                ) : (
                  formatInt(null)
                )}
              </TableCell>
              <TableCell>
                {(() => {
                  const type = p.playlist_type || (p.is_catalog ? "Catalog" : "Standard");
                  const typeColors: Record<string, { bg: string; text: string }> = {
                    Catalog: {
                      bg: "bg-lime-400/20",
                      text: "text-lime-800 dark:text-lime-300",
                    },
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
                  };
                  const colors = typeColors[type] || {
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
            <TableCell className="py-8 text-center opacity-50" colSpan={6}>
              No playlists found.
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
      </div>
    </div>
  );
}
