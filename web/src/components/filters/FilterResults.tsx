"use client";

/**
 * Filter Results Component
 * 
 * Displays filtered results in a table with sorting and pagination
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, User, Disc3, ListMusic, CalendarDays } from "lucide-react";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatInt, formatDateISO, formatMoney } from "@/lib/format";
import { todayIsoDate } from "@/lib/csv";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import type {
  EntityType,
  TrackFilterResult,
  ArtistFilterResult,
  PlaylistFilterResult,
  DateFilterResult,
  FilterResult,
} from "./filterTypes";
import { FilterConcentrationView } from "./FilterConcentrationView";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import type { CurrentTrackPlaylist } from "./trackMemberships";
import { buildFilterCsvRows } from "./filterCsv";

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
  distroByIsrc?: Map<string, { name: string; imageUrl: string | null }>;
  datasetMode?: "own" | "competitor";
  unmatchedIsrcs?: string[];
};

const PAGE_SIZE = 25;

type ResultsView = "table" | "concentration";

const VIEW_PILL_ACTIVE = "bg-black text-white dark:bg-white dark:text-black";
const VIEW_PILL_IDLE = "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20";

function viewPill(active: boolean): string {
  return [
    "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition cursor-pointer",
    active ? VIEW_PILL_ACTIVE : VIEW_PILL_IDLE,
  ].join(" ");
}

export function FilterResults({
  entityType,
  results,
  isLoading,
  error,
  distroByIsrc,
  datasetMode = "own",
  unmatchedIsrcs = [],
}: FilterResultsProps) {
  const [sort, setSort] = useState<SortConfig>({ key: "", direction: null });
  const [page, setPage] = useState(1);
  const [resultsView, setResultsView] = useState<ResultsView>("table");

  // Reset page and view when results change (e.g. new filter applied, entity switch)
  useEffect(() => { setPage(1); }, [results]);
  // Reset view to table when switching away from tracks
  useEffect(() => { if (entityType !== "tracks") setResultsView("table"); }, [entityType]);
  
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
  
  const csvRows = useMemo(
    () => buildFilterCsvRows(sortedResults as Array<Record<string, unknown>>),
    [sortedResults]
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-3 mt-4">
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
    const EmptyIcon = entityType === "tracks" ? <Disc3 className="h-6 w-6" style={{ color: "var(--sb-muted)" }} /> : entityType === "artists" ? <User className="h-6 w-6" style={{ color: "var(--sb-muted)" }} /> : entityType === "dates" ? <CalendarDays className="h-6 w-6" style={{ color: "var(--sb-muted)" }} /> : <ListMusic className="h-6 w-6" style={{ color: "var(--sb-muted)" }} />;
    return (
      <div className="mt-4 space-y-3">
        {unmatchedIsrcs.length > 0 ? (
          <details
            open
            className="rounded-xl border px-3 py-2 text-xs"
            style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
          >
            <summary className="cursor-pointer select-none">
              {unmatchedIsrcs.length} pasted ISRC{unmatchedIsrcs.length === 1 ? "" : "s"} not found in the active dataset
            </summary>
            <div className="mt-2 whitespace-pre-wrap font-mono text-[11px]">{unmatchedIsrcs.join("\n")}</div>
          </details>
        ) : null}
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
            datasetMode={datasetMode}
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
      case "dates":
        return (
          <DatesTable
            results={paginatedResults as DateFilterResult[]}
            sortHeader={SortHeader}
          />
        );
    }
  };

  const showViewToggle = entityType === "tracks" && results.length > 0;

  return (
    <div className="mt-4 space-y-4">
      {unmatchedIsrcs.length > 0 ? (
        <details
          className="rounded-xl border px-3 py-2 text-xs"
          style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
        >
          <summary className="cursor-pointer select-none">
            {unmatchedIsrcs.length} pasted ISRC{unmatchedIsrcs.length === 1 ? "" : "s"} not found in the active dataset
          </summary>
          <div className="mt-2 whitespace-pre-wrap font-mono text-[11px]">
            {unmatchedIsrcs.join("\n")}
          </div>
        </details>
      ) : null}

      {/* Results count, view toggle, and download */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
            {resultsView === "concentration"
              ? `${results.length} tracks`
              : `Showing ${paginatedResults.length} of ${results.length} results`}
          </p>
          {showViewToggle && (
            <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10">
              <button type="button" onClick={() => setResultsView("table")} className={viewPill(resultsView === "table")}>
                TABLE
              </button>
              <button type="button" onClick={() => setResultsView("concentration")} className={viewPill(resultsView === "concentration")}>
                CONCENTRATION
              </button>
            </div>
          )}
        </div>
        {resultsView === "table" && (
          <ChartCsvDownloadButton
            filename={`filter-results-${entityType}-${todayIsoDate()}.csv`}
            rows={csvRows}
            title="Download results as CSV"
          />
        )}
      </div>

      {/* Concentration view for tracks */}
      {resultsView === "concentration" && entityType === "tracks" ? (
        <FilterConcentrationView results={results as TrackFilterResult[]} distroByIsrc={distroByIsrc} />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tracks Table
// ============================================================================

function MovementPath({ playlists }: { playlists: { name: string; imageUrl: string | null }[] }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-xs flex-wrap" style={{ color: "var(--sb-muted)" }}>
      {playlists.map((pl, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="mx-1 opacity-50">{"\u2192"}</span>}
          {pl.imageUrl ? (
            <PreviewableArtwork src={pl.imageUrl} alt="" width={16} height={16} className="h-4 w-4 rounded-sm object-cover shrink-0" />
          ) : (
            <span className="h-4 w-4 rounded-sm bg-white/10 shrink-0" />
          )}
          <span className={i === playlists.length - 1 ? "font-medium" : "opacity-70"}>{pl.name}</span>
        </span>
      ))}
    </span>
  );
}

function TracksTable({
  results,
  sortHeader: SortHeader,
  datasetMode,
}: {
  results: TrackFilterResult[];
  sortHeader: React.ComponentType<{
    columnKey: string;
    children: React.ReactNode;
    align?: "left" | "right";
  }>;
  datasetMode: "own" | "competitor";
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const displayMetric = metric === "revenue" ? "revenue" : "streams";
  const totalLabel = displayMetric === "revenue" ? "Total Revenue" : "Total Streams";
  const dailyLabel = displayMetric === "revenue" ? "Daily Revenue" : "Daily Streams";
  const metricStyle = {
    color: displayMetric === "revenue" ? "#10b981" : "var(--sb-positive)",
  };
  const hasDistroMovements = results.some((t) => t.moved_distro_playlists && t.moved_distro_playlists.length > 1);
  const hasEntityMovements = results.some((t) => t.moved_entity_playlists && t.moved_entity_playlists.length > 1);

  const formatTrackMetric = (streams: number | null) => {
    if (displayMetric === "revenue") {
      const value = streams != null ? streams * streamPayoutPerStreamUsd : null;
      return value == null
        ? null
        : formatMoney(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return streams == null ? null : formatInt(streams);
  };

  return (
    <GlassTable
      headers={[
        { label: "Track" },
        { label: <SortHeader columnKey="total_streams" align="right">{totalLabel}</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="daily_streams" align="right">{dailyLabel}</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="release_date">Release</SortHeader> },
        ...(datasetMode === "own"
          ? [{ label: "Distro Playlists" }, { label: "Entity Playlists" }]
          : [{ label: "Current Playlists" }]),
        ...(hasDistroMovements ? [{ label: "Distro Movement" }] : []),
        ...(hasEntityMovements ? [{ label: "Entity Movement" }] : []),
      ]}
      maxBodyHeightClassName="max-h-[440px] overflow-auto"
    >
      {results.map((track) => (
        <TableRow key={track.isrc}>
          <TableCell className="min-w-[260px]">
            <div className="flex items-center gap-3">
              {track.spotify_album_image_url ? (
                <PreviewableArtwork
                  src={track.spotify_album_image_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg object-cover sb-ring"
                  label={track.name}
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
                <div className="mt-0.5 font-mono text-[10px] opacity-50" style={{ color: "var(--sb-muted)" }}>
                  {track.isrc}
                </div>
              </div>
            </div>
          </TableCell>
          <TableCell numeric mono style={metricStyle}>
            {formatTrackMetric(track.total_streams)}
          </TableCell>
          <TableCell numeric mono empty={track.daily_streams == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            <span style={metricStyle}>{formatTrackMetric(track.daily_streams)}</span>
          </TableCell>
          <TableCell empty={track.release_date == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            {track.release_date ? formatDateISO(track.release_date) : null}
          </TableCell>
          {datasetMode === "own" ? (
            <>
              <TableCell empty={track.current_distro_playlists.length === 0} emptyFallback="—">
                <CurrentPlaylistList playlists={track.current_distro_playlists} />
              </TableCell>
              <TableCell empty={track.current_entity_playlists.length === 0} emptyFallback="—">
                <CurrentPlaylistList playlists={track.current_entity_playlists} />
              </TableCell>
            </>
          ) : (
            <TableCell empty={track.current_playlists.length === 0} emptyFallback="—">
              <CurrentPlaylistList playlists={track.current_playlists} />
            </TableCell>
          )}
          {hasDistroMovements && (
            <TableCell empty={!track.moved_distro_playlists} emptyFallback="—">
              {track.moved_distro_playlists && track.moved_distro_playlists.length > 1 ? (
                <MovementPath playlists={track.moved_distro_playlists} />
              ) : null}
            </TableCell>
          )}
          {hasEntityMovements && (
            <TableCell empty={!track.moved_entity_playlists} emptyFallback="—">
              {track.moved_entity_playlists && track.moved_entity_playlists.length > 1 ? (
                <MovementPath playlists={track.moved_entity_playlists} />
              ) : null}
            </TableCell>
          )}
        </TableRow>
      ))}
    </GlassTable>
  );
}

function CurrentPlaylistList({ playlists }: { playlists: CurrentTrackPlaylist[] }) {
  if (!playlists.length) return null;
  return (
    <div className="flex min-w-[150px] flex-wrap gap-1">
      {playlists.map((playlist) => (
        <Link
          key={playlist.key}
          href={`/playlists?playlist_key=${encodeURIComponent(playlist.key)}`}
          className="inline-flex max-w-[180px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition hover:brightness-95"
          style={{ background: "var(--sb-accent-10)", color: "var(--sb-text)" }}
          title={playlist.name}
        >
          {playlist.imageUrl ? (
            <PreviewableArtwork
              src={playlist.imageUrl}
              alt=""
              width={14}
              height={14}
              interactive="inline"
              className="h-3.5 w-3.5 shrink-0 rounded-full object-cover"
            />
          ) : null}
          <span className="truncate">{playlist.name}</span>
        </Link>
      ))}
    </div>
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
        { label: <SortHeader columnKey="daily_streams" align="right">Daily</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="track_count" align="right">Tracks</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="in_house_status">Status</SortHeader> },
        { label: "" },
      ]}
      maxBodyHeightClassName="max-h-[440px] overflow-auto"
    >
      {results.map((artist) => (
        <TableRow key={artist.artist_id}>
          <TableCell className="min-w-[260px]">
            <div className="flex items-center gap-3">
              {artist.image_url ? (
                <PreviewableArtwork
                  src={artist.image_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full object-cover sb-ring"
                  label={artist.artist_name}
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
          <TableCell numeric mono empty={artist.daily_streams == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            {artist.daily_streams != null ? formatInt(artist.daily_streams) : null}
          </TableCell>
          <TableCell numeric mono style={{ color: "var(--sb-muted)" }}>{formatInt(artist.track_count)}</TableCell>
          <TableCell>
            <span
              className={[
                "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                artist.in_house_status === "in_house"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  : "bg-black/5 text-black/40 dark:bg-white/5 dark:text-white/35",
              ].join(" ")}
            >
              {artist.in_house_status === "in_house" ? "In-House" : "NIH"}
            </span>
          </TableCell>
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
        { label: <SortHeader columnKey="est_total_revenue" align="right">Est. Rev</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="est_daily_revenue" align="right">Daily Rev</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="est_monthly_revenue" align="right">Mo. Rev</SortHeader>, align: "right" },
        { label: "" },
      ]}
      maxBodyHeightClassName="max-h-[440px] overflow-auto"
    >
      {results.map((playlist) => (
        <TableRow key={playlist.playlist_key}>
          <TableCell className="min-w-[260px]">
            <div className="flex items-center gap-3">
              {playlist.spotify_playlist_image_url ? (
                <PreviewableArtwork
                  src={playlist.spotify_playlist_image_url}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg object-cover sb-ring"
                  label={playlist.display_name ?? playlist.playlist_key}
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
          <TableCell numeric mono style={{ color: "var(--sb-muted)" }}>
            {formatMoney(playlist.est_total_revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </TableCell>
          <TableCell numeric mono empty={playlist.est_daily_revenue == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            {playlist.est_daily_revenue != null
              ? formatMoney(playlist.est_daily_revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : null}
          </TableCell>
          <TableCell numeric mono empty={playlist.est_monthly_revenue == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
            {playlist.est_monthly_revenue != null
              ? formatMoney(playlist.est_monthly_revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : null}
          </TableCell>
          <TableCell className="w-10">{null}</TableCell>
        </TableRow>
      ))}
    </GlassTable>
  );
}

// ============================================================================
// Dates Table
// ============================================================================

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function DatesTable({
  results,
  sortHeader: SortHeader,
}: {
  results: DateFilterResult[];
  sortHeader: React.ComponentType<{
    columnKey: string;
    children: React.ReactNode;
    align?: "left" | "right";
  }>;
}) {
  return (
    <GlassTable
      headers={[
        { label: <SortHeader columnKey="date">Date</SortHeader> },
        { label: <SortHeader columnKey="daily_streams" align="right">Daily Streams</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="moving_avg_7d" align="right">7d Avg</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="growth_pct" align="right">DoD %</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="wow_growth_pct" align="right">WoW %</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="streams_per_track" align="right">Str/Trk</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="track_count" align="right">Tracks</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="tracks_added" align="right">Added</SortHeader>, align: "right" },
        { label: <SortHeader columnKey="est_daily_revenue" align="right">Est. Rev</SortHeader>, align: "right" },
      ]}
      maxBodyHeightClassName="max-h-[440px] overflow-auto"
    >
      {results.map((row) => {
        const growthColor =
          row.growth_pct == null
            ? "var(--sb-muted)"
            : row.growth_pct > 0
              ? "var(--sb-success, #22c55e)"
              : row.growth_pct < 0
                ? "var(--sb-danger, #ef4444)"
                : "var(--sb-muted)";
        const wowColor =
          row.wow_growth_pct == null
            ? "var(--sb-muted)"
            : row.wow_growth_pct > 0
              ? "var(--sb-success, #22c55e)"
              : row.wow_growth_pct < 0
                ? "var(--sb-danger, #ef4444)"
                : "var(--sb-muted)";
        const addedColor =
          row.tracks_added > 0
            ? "var(--sb-success, #22c55e)"
            : row.tracks_added < 0
              ? "var(--sb-danger, #ef4444)"
              : "var(--sb-muted)";

        return (
          <TableRow key={row.date}>
            <TableCell className="min-w-[140px]">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 opacity-40 shrink-0" />
                <div>
                  <span className="text-sm font-medium" style={{ color: "var(--sb-text)" }}>
                    {formatDateISO(row.date)}
                  </span>
                  <span className="text-xs ml-2" style={{ color: "var(--sb-muted)" }}>
                    {DAY_NAMES[row.day_of_week] ?? ""}
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell numeric mono>{formatInt(row.daily_streams)}</TableCell>
            <TableCell numeric mono empty={row.moving_avg_7d == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
              {row.moving_avg_7d != null ? formatInt(Math.round(row.moving_avg_7d)) : null}
            </TableCell>
            <TableCell numeric mono empty={row.growth_pct == null} emptyFallback="—">
              {row.growth_pct != null ? (
                <span style={{ color: growthColor }}>
                  {row.growth_pct > 0 ? "+" : ""}{row.growth_pct.toFixed(1)}%
                </span>
              ) : null}
            </TableCell>
            <TableCell numeric mono empty={row.wow_growth_pct == null} emptyFallback="—">
              {row.wow_growth_pct != null ? (
                <span style={{ color: wowColor }}>
                  {row.wow_growth_pct > 0 ? "+" : ""}{row.wow_growth_pct.toFixed(1)}%
                </span>
              ) : null}
            </TableCell>
            <TableCell numeric mono empty={row.streams_per_track == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
              {row.streams_per_track != null ? formatInt(Math.round(row.streams_per_track)) : null}
            </TableCell>
            <TableCell numeric mono style={{ color: "var(--sb-muted)" }}>
              {formatInt(row.track_count)}
            </TableCell>
            <TableCell numeric mono>
              {row.tracks_added !== 0 ? (
                <span style={{ color: addedColor }}>
                  {row.tracks_added > 0 ? "+" : ""}{row.tracks_added}
                </span>
              ) : null}
            </TableCell>
            <TableCell numeric mono empty={row.est_daily_revenue == null} emptyFallback="—" style={{ color: "var(--sb-muted)" }}>
              {row.est_daily_revenue != null
                ? formatMoney(row.est_daily_revenue, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : null}
            </TableCell>
          </TableRow>
        );
      })}
    </GlassTable>
  );
}
