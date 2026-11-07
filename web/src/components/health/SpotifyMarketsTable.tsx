"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";

import { SpotifyIconLink } from "@/components/spotify/SpotifyIconLink";
import Link from "@/components/shell/RouteLink";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { IconButton } from "@/components/ui/Button";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { Input } from "@/components/ui/Input";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { Select } from "@/components/ui/Select";
import { DailyStreamsLabel, MarketChip, MarketChipList, MarketCoverage } from "@/components/spotify/SpotifyMarketParts";
import {
  DistributorGroupsView,
  RecentChangesList,
  TerritoryViewToggle,
} from "@/components/spotify/SpotifyTerritoryViews";
import { cx } from "@/lib/cx";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import {
  buildTerritoryCsvRows,
  filterRestrictedTracks,
  groupByDistributor,
  marketName,
  NO_DISTRIBUTOR_KEY,
  TERRITORY_CSV_HEADERS,
  tallyMarkets,
  unusualReasonSummary,
} from "@/lib/health/spotifyMarketFormat";
import type { SpotifyMarketEvent, SpotifyMarketRestrictedTrack } from "@/lib/health/spotifyMarketTypes";
import { useStoredBoolState } from "@/lib/useStoredBoolState";

const BY_DISTRIBUTOR_KEY = "sb:health:territories:by_distributor";

/**
 * Health Territories table: filter by territory (chip toggles from the summary), distributor and free
 * text, switch between "By track" and "By distributor", and download the filtered rows as CSV.
 */
export function SpotifyMarketsTable({
  tracks,
  events,
}: {
  tracks: SpotifyMarketRestrictedTrack[];
  events: SpotifyMarketEvent[];
}) {
  const [byDistributor, setByDistributor] = useStoredBoolState(BY_DISTRIBUTOR_KEY, false);
  const [territories, setTerritories] = useState<Set<string>>(() => new Set());
  const [distributorKey, setDistributorKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const tally = useMemo(() => tallyMarkets(tracks.filter((t) => t.available_count > 0)), [tracks]);
  const distributors = useMemo(() => groupByDistributor(tracks), [tracks]);
  const filtered = useMemo(
    () => filterRestrictedTracks(tracks, { territories, distributorKey, query }),
    [tracks, territories, distributorKey, query],
  );
  const filtering = territories.size > 0 || distributorKey != null || query.trim() !== "";

  function toggleTerritory(code: string) {
    setTerritories((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function clearFilters() {
    setTerritories(new Set());
    setDistributorKey(null);
    setQuery("");
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
            Territories with gaps{" "}
            <span className="normal-case tracking-normal opacity-70">· click to filter the table</span>
          </div>
          {territories.size > 0 ? (
            <button type="button" onClick={() => setTerritories(new Set())} className="text-xs hover:underline" style={{ color: "var(--sb-muted)" }}>
              Clear territories
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tally.map(({ code, count }) => {
            const on = territories.has(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                aria-label={`${marketName(code)}: ${count} ${count === 1 ? "track" : "tracks"}`}
                onClick={() => toggleTerritory(code)}
                className={cx(
                  "rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)]",
                  on ? "ring-2 ring-[var(--sb-accent)]" : "opacity-90 hover:opacity-100",
                )}
              >
                <MarketChip code={code} count={count} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artist, title or ISRC"
          aria-label="Search artist, title or ISRC"
          className="max-w-xs"
        />
        <Select
          value={distributorKey ?? ""}
          onChange={(e) => setDistributorKey(e.target.value || null)}
          aria-label="Filter by distributor"
          className="w-auto max-w-[16rem]"
        >
          <option value="">All distributors</option>
          {distributors.map((g) => (
            <option key={g.key} value={g.key}>
              {g.name} ({g.tracks.length})
            </option>
          ))}
        </Select>
        {filtering ? (
          <button type="button" onClick={clearFilters} className="text-xs hover:underline" style={{ color: "var(--sb-muted)" }}>
            Clear filters
          </button>
        ) : null}
        <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
          {filtering ? `${filtered.length} of ${tracks.length} tracks` : `${tracks.length} tracks`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <TerritoryViewToggle byDistributor={byDistributor} onChange={setByDistributor} />
          <IconButton
            className="h-7 w-7 shrink-0"
            aria-label="Export CSV"
            title={filtering ? "Export the filtered tracks as CSV" : "Export CSV"}
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv({
                filename: `territories-${todayIsoDate()}.csv`,
                rows: buildTerritoryCsvRows(filtered),
                headers: [...TERRITORY_CSV_HEADERS],
                sortForExport: false,
              })
            }
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          No tracks match these filters.
        </p>
      ) : byDistributor ? (
        <DistributorGroupsView tracks={filtered} />
      ) : (
        <GlassTable
          headers={["Track", "Distributor", { label: "Daily streams", align: "right" }, "Missing in", "Coverage"]}
          maxBodyHeightClassName="max-h-[640px]"
        >
          {filtered.map((track) => {
            const unusual = unusualReasonSummary(track.unavailable_reasons);
            return (
              <TableRow key={track.isrc}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {track.album_image_url ? (
                      <PreviewableArtwork
                        src={track.album_image_url}
                        alt="Album cover"
                        width={40}
                        height={40}
                        className="h-10 w-10 flex-shrink-0 rounded object-cover sb-ring"
                        label={track.name || track.isrc}
                      />
                    ) : (
                      <div className="h-10 w-10 flex-shrink-0 rounded bg-white/60 sb-ring" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-1 text-sm leading-snug">
                        {track.artist_names && track.artist_names.length > 0 ? (
                          <>
                            <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
                            <span style={{ color: "var(--sb-muted)" }}>–</span>
                          </>
                        ) : null}
                        <Link href={`/tracks/${track.isrc}`} className="font-medium hover:underline" style={{ color: "var(--sb-text)" }}>
                          {track.name || track.isrc}
                        </Link>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                        <CopyableIsrc isrc={track.isrc} className="font-mono text-[10px] text-lime-600 underline hover:opacity-80 dark:text-lime-400" />
                        <SpotifyIconLink trackId={track.spotify_track_id} label={track.name ?? undefined} />
                        {unusual ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{unusual}</span> : null}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {track.distributor ? (
                    <button
                      type="button"
                      onClick={() => setDistributorKey(track.distributor?.key ?? NO_DISTRIBUTOR_KEY)}
                      title="Filter to this distributor"
                      className="text-left text-xs hover:underline"
                      style={{ color: "var(--sb-text)" }}
                    >
                      {track.distributor.name}
                    </button>
                  ) : (
                    <span className="opacity-30">—</span>
                  )}
                </TableCell>
                <TableCell align="right">
                  <DailyStreamsLabel value={track.daily_streams} />
                </TableCell>
                <TableCell>
                  {track.available_count === 0 ? (
                    <span className="text-xs text-red-700 dark:text-red-300">Every territory</span>
                  ) : (
                    <MarketChipList markets={track.unavailable_markets} reasons={track.unavailable_reasons} max={10} />
                  )}
                </TableCell>
                <TableCell>
                  <MarketCoverage available={track.available_count} checked={track.markets_checked} />
                </TableCell>
              </TableRow>
            );
          })}
        </GlassTable>
      )}

      <div>
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
          Recent changes <span className="normal-case tracking-normal opacity-70">· last 30 days</span>
        </div>
        <RecentChangesList events={events} />
      </div>
    </div>
  );
}
