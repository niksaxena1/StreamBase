"use client";

/**
 * Filter Results Component
 * 
 * Displays filtered results in a table with sorting and pagination
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, User, Disc3, ListMusic } from "lucide-react";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatInt, formatDateISO } from "@/lib/format";
import type { 
  EntityType, 
  TrackFilterResult, 
  ArtistFilterResult, 
  PlaylistFilterResult,
  FilterResult,
} from "./filterTypes";

function ArtistLinksInline(props: { names?: string[]; ids?: string[] }) {
  const names = props.names ?? [];
  const ids = props.ids ?? [];
  if (!names.length) return <span>Unknown artist</span>;

  return (
    <>
      {names.map((name, idx) => {
        const label = String(name ?? "").trim();
        if (!label) return null;
        const id = String(ids[idx] ?? "").trim();
        const sep = idx > 0 ? <span style={{ color: "var(--sb-muted)" }}>, </span> : null;
        return (
          <span key={`${id || "noid"}-${idx}`}>
            {sep}
            {id ? (
              <Link
                href={`/artists/${encodeURIComponent(id)}`}
                className="hover:underline"
                style={{ color: "var(--sb-muted)" }}
              >
                {label}
              </Link>
            ) : (
              <span style={{ color: "var(--sb-muted)" }}>{label}</span>
            )}
          </span>
        );
      })}
    </>
  );
}

type SortDirection = "asc" | "desc" | null;

type SortConfig = {
  key: string;
  direction: SortDirection;
};

type FilterResultsProps = {
  entityType: EntityType;
  results: FilterResult[];
  isLoading: boolean;
  error: string | null;
  totalCount: number | null;
};

const PAGE_SIZE = 25;

export function FilterResults({ entityType, results, isLoading, error, totalCount }: FilterResultsProps) {
  const [sort, setSort] = useState<SortConfig>({ key: "", direction: null });
  const [page, setPage] = useState(1);
  
  // Sort results
  const sortedResults = useMemo(() => {
    if (!sort.key || !sort.direction) return results;
    
    return [...results].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sort.key];
      const bVal = (b as Record<string, unknown>)[sort.key];
      
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sort.direction === "asc" ? -1 : 1;
      if (bVal == null) return sort.direction === "asc" ? 1 : -1;
      
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sort.direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sort.direction === "asc" 
        ? aStr.localeCompare(bStr) 
        : bStr.localeCompare(aStr);
    });
  }, [results, sort]);
  
  // Paginate results
  const paginatedResults = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return sortedResults.slice(start, start + PAGE_SIZE);
  }, [sortedResults, page]);
  
  const totalPages = Math.ceil(results.length / PAGE_SIZE);
  
  function handleSort(key: string) {
    setSort((prev) => {
      if (prev.key !== key) return { key, direction: "desc" };
      if (prev.direction === "desc") return { key, direction: "asc" };
      if (prev.direction === "asc") return { key: "", direction: null };
      return { key, direction: "desc" };
    });
    setPage(1);
  }
  
  function SortIcon({ columnKey }: { columnKey: string }) {
    if (sort.key !== columnKey) {
      return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    }
    return sort.direction === "desc" 
      ? <ArrowDown className="h-3 w-3" />
      : <ArrowUp className="h-3 w-3" />;
  }

  function SortHeader({
    columnKey,
    children,
    align = "left",
  }: {
    columnKey: string;
    children: React.ReactNode;
    align?: "left" | "right";
  }) {
    return (
      <button
        type="button"
        onClick={() => handleSort(columnKey)}
        className={[
          "inline-flex items-center gap-1 font-medium uppercase tracking-wider text-[11px]",
          "hover:opacity-100 transition",
          align === "right" ? "justify-end w-full" : "",
        ].join(" ")}
        style={{ color: "var(--sb-muted)" }}
      >
        {children}
        <SortIcon columnKey={columnKey} />
      </button>
    );
  }
  
  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-3 mt-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
      </div>
    );
  }
  
  // Error state
  if (error) {
    return (
      <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }
  
  // Empty state
  if (results.length === 0) {
    const EmptyIcon = entityType === "tracks" ? <Disc3 className="h-6 w-6" style={{ color: "var(--sb-muted)" }} /> : entityType === "artists" ? <User className="h-6 w-6" style={{ color: "var(--sb-muted)" }} /> : <ListMusic className="h-6 w-6" style={{ color: "var(--sb-muted)" }} />;
    return (
      <div className="mt-4">
        <GlassTable headers={[{ label: "Results" }]} maxBodyHeightClassName="max-h-[240px] overflow-auto">
          <EmptyState colSpan={1} message="No results found. Try adjusting your filter conditions." icon={EmptyIcon} />
        </GlassTable>
      </div>
    );
  }
  
  // Render based on entity type
  const renderTable = () => {
    switch (entityType) {
      case "tracks":
        return (
          <TracksTable
            results={paginatedResults as TrackFilterResult[]}
            sortHeader={SortHeader}
          />
        );
      case "artists":
        return (
          <ArtistsTable
            results={paginatedResults as ArtistFilterResult[]}
            sortHeader={SortHeader}
          />
        );
      case "playlists":
        return (
          <PlaylistsTable
            results={paginatedResults as PlaylistFilterResult[]}
            sortHeader={SortHeader}
          />
        );
    }
  };
  
  return (
    <div className="mt-4 space-y-4">
      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          Showing {paginatedResults.length} of {totalCount ?? results.length} results
        </p>
      </div>
      
      {/* Table */}
      {renderTable()}
      
      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="text-sm px-4" style={{ color: "var(--sb-muted)" }}>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tracks Table
// ============================================================================

function TracksTable({
  results,
  sortHeader: SortHeader,
}: {
  results: TrackFilterResult[];
  sortHeader: React.ComponentType<{
    columnKey: string;
    children: React.ReactNode;
    align?: "left" | "right";
  }>;
}) {
  return (
    <GlassTable
      headers={[
        { label: "Track" },
        { label: <SortHeader columnKey="total_streams" align="right">Total Streams</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="daily_streams" align="right">Daily</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="release_date">Release</SortHeader> },
        { label: "" },
      ]}
      maxBodyHeightClassName="max-h-[440px] overflow-auto"
    >
      {results.map((track) => (
        <TableRow key={track.isrc}>
          <TableCell className="min-w-[260px]">
            <div className="flex items-center gap-3">
              {track.spotify_album_image_url ? (
                <Image
                  src={track.spotify_album_image_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg object-cover sb-ring"
                />
              ) : (
                <div className="h-10 w-10 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex items-center justify-center">
                  <Disc3 className="h-5 w-5 opacity-40" />
                </div>
              )}
              <div className="min-w-0">
                <Link
                  href={
                    (track.spotify_artist_ids?.[0] ?? "").trim()
                      ? `/catalog?artist_id=${encodeURIComponent(String(track.spotify_artist_ids?.[0] ?? ""))}&isrc=${encodeURIComponent(track.isrc)}`
                      : `/catalog?isrc=${encodeURIComponent(track.isrc)}`
                  }
                  className="font-medium text-sm hover:underline truncate block"
                  style={{ color: "var(--sb-text)" }}
                >
                  {track.name}
                </Link>
                <div className="text-xs truncate" style={{ color: "var(--sb-muted)" }}>
                  <ArtistLinksInline
                    names={track.spotify_artist_names}
                    ids={track.spotify_artist_ids}
                  />
                </div>
              </div>
            </div>
          </TableCell>
          <TableCell numeric mono>{formatInt(track.total_streams)}</TableCell>
          <TableCell numeric mono empty={track.daily_streams == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            {track.daily_streams != null ? formatInt(track.daily_streams) : null}
          </TableCell>
          <TableCell empty={track.release_date == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            {track.release_date ? formatDateISO(track.release_date) : null}
          </TableCell>
          <TableCell className="w-10">
            {track.spotify_track_id ? (
              <a
                href={`https://open.spotify.com/track/${track.spotify_track_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="opacity-50 hover:opacity-100 transition"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </TableCell>
        </TableRow>
      ))}
    </GlassTable>
  );
}

// ============================================================================
// Artists Table
// ============================================================================

function ArtistsTable({
  results,
  sortHeader: SortHeader,
}: {
  results: ArtistFilterResult[];
  sortHeader: React.ComponentType<{
    columnKey: string;
    children: React.ReactNode;
    align?: "left" | "right";
  }>;
}) {
  return (
    <GlassTable
      headers={[
        { label: "Artist" },
        { label: <SortHeader columnKey="total_streams" align="right">Total Streams</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="track_count" align="right">Tracks</SortHeader>, align: "right" },
        { label: "" },
      ]}
      maxBodyHeightClassName="max-h-[440px] overflow-auto"
    >
      {results.map((artist) => (
        <TableRow key={artist.artist_id}>
          <TableCell className="min-w-[260px]">
            <div className="flex items-center gap-3">
              {artist.image_url ? (
                <Image
                  src={artist.image_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full object-cover sb-ring"
                />
              ) : (
                <div className="h-10 w-10 rounded-full sb-ring bg-white/60 dark:bg-white/10 flex items-center justify-center">
                  <User className="h-5 w-5 opacity-40" />
                </div>
              )}
              <Link
                href={`/artists/${artist.artist_id}`}
                className="font-medium text-sm hover:underline"
                style={{ color: "var(--sb-text)" }}
              >
                {artist.artist_name}
              </Link>
            </div>
          </TableCell>
          <TableCell numeric mono>{formatInt(artist.total_streams)}</TableCell>
          <TableCell numeric mono style={{ color: "var(--sb-muted)" }}>{formatInt(artist.track_count)}</TableCell>
          <TableCell className="w-10">
            <a
              href={`https://open.spotify.com/artist/${artist.artist_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-50 hover:opacity-100 transition"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </TableCell>
        </TableRow>
      ))}
    </GlassTable>
  );
}

// ============================================================================
// Playlists Table
// ============================================================================

function PlaylistsTable({
  results,
  sortHeader: SortHeader,
}: {
  results: PlaylistFilterResult[];
  sortHeader: React.ComponentType<{
    columnKey: string;
    children: React.ReactNode;
    align?: "left" | "right";
  }>;
}) {
  return (
    <GlassTable
      headers={[
        { label: "Playlist" },
        { label: <SortHeader columnKey="track_count" align="right">Tracks</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="total_streams" align="right">Total Streams</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="daily_streams" align="right">Daily</SortHeader>, align: "right" },
        { label: "" },
      ]}
      maxBodyHeightClassName="max-h-[440px] overflow-auto"
    >
      {results.map((playlist) => (
        <TableRow key={playlist.playlist_key}>
          <TableCell className="min-w-[260px]">
            <div className="flex items-center gap-3">
              {playlist.spotify_playlist_image_url ? (
                <Image
                  src={playlist.spotify_playlist_image_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg object-cover sb-ring"
                />
              ) : (
                <div className="h-10 w-10 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex items-center justify-center">
                  <ListMusic className="h-5 w-5 opacity-40" />
                </div>
              )}
              <div className="min-w-0">
                <Link
                  href={`/playlists?playlist_key=${encodeURIComponent(String(playlist.playlist_key))}`}
                  className="font-medium text-sm hover:underline truncate block"
                  style={{ color: "var(--sb-text)" }}
                >
                  {playlist.display_name}
                </Link>
                <div className="flex items-center gap-2 text-xs" style={{ color: "var(--sb-muted)" }}>
                  {playlist.is_catalog ? (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--sb-accent)]/20">Catalog</span>
                  ) : null}
                  {playlist.playlist_type ? <span>{playlist.playlist_type}</span> : null}
                </div>
              </div>
            </div>
          </TableCell>
          <TableCell numeric mono>{formatInt(playlist.track_count)}</TableCell>
          <TableCell numeric mono>{formatInt(playlist.total_streams)}</TableCell>
          <TableCell numeric mono empty={playlist.daily_streams == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            {playlist.daily_streams != null ? formatInt(playlist.daily_streams) : null}
          </TableCell>
          <TableCell className="w-10">{null}</TableCell>
        </TableRow>
      ))}
    </GlassTable>
  );
}
