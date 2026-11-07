import Link from "@/components/shell/RouteLink";
import { SpotifyIconLink } from "@/components/spotify/SpotifyIconLink";

import { cachedSpotifyMarketAvailability } from "@/lib/health/spotifyMarketAvailability";
import { formatScanTime, unusualReasonSummary } from "@/lib/health/spotifyMarketFormat";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { MarketChipList, MarketCountrySummary, MarketCoverage } from "@/components/spotify/SpotifyMarketParts";

/**
 * Own-catalog tracks the weekly market scan
 * (scripts/scan_spotify_market_availability.py) finds unplayable in at least
 * one Spotify territory. Hidden until the scan has run at least once.
 */
export async function SpotifyMarketsSection() {
  const { data } = await cachedSpotifyMarketAvailability();
  if (!data || !data.lastCheckedAt) return null;

  const tracks = data.restricted;

  return (
    <div className="space-y-3" id="territories">
      <SectionHeader
        title="Territories"
        subtitle={`Territories where a track can't be played on Spotify. Checked weekly · last scan ${formatScanTime(data.lastCheckedAt)}${
          data.marketsChecked ? ` · ${data.marketsChecked} territories` : ""
        }`}
        actions={
          <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"} with gaps
          </span>
        }
      />
      {tracks.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
          Every checked track plays in every territory.
        </p>
      ) : (
        <>
          <MarketCountrySummary tracks={tracks.filter((t) => t.available_count > 0)} max={20} />
          <GlassTable headers={["Track", "Artists", "Missing in", "Coverage"]}>
            {tracks.map((track) => {
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
                          className="h-10 w-10 rounded object-cover sb-ring flex-shrink-0"
                          label={track.name || track.isrc}
                        />
                      ) : (
                        <div className="h-10 w-10 rounded sb-ring bg-white/60 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/tracks/${track.isrc}`}
                          className="font-medium hover:underline"
                          style={{ color: "var(--sb-text)" }}
                        >
                          {track.name || track.isrc}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                          <CopyableIsrc
                            isrc={track.isrc}
                            className="font-mono text-[10px] text-lime-600 underline hover:opacity-80 dark:text-lime-400"
                          />
                          <SpotifyIconLink trackId={track.spotify_track_id} label={track.name ?? undefined} />
                          {unusual ? <span className="text-[11px] text-amber-700 dark:text-amber-300">{unusual}</span> : null}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {track.artist_names && track.artist_names.length > 0 ? (
                      <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
                    ) : (
                      <span className="opacity-30">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {track.available_count === 0 ? (
                      <span className="text-xs text-red-700 dark:text-red-300">Every market</span>
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
        </>
      )}
    </div>
  );
}
