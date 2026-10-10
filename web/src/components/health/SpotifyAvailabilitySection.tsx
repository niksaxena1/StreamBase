import Link from "next/link";

import { cachedSpotifyAvailability, describeUnavailableReason } from "@/lib/health/spotifyAvailability";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

function formatUtc(ts: string | null): string {
  if (!ts) return "—";
  return `${ts.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Own-catalog tracks the daily Spotify takedown watch
 * (scripts/check_spotify_track_availability.py) currently finds unplayable.
 * Hidden until the watch has run at least once.
 */
export async function SpotifyAvailabilitySection() {
  const { data } = await cachedSpotifyAvailability();
  if (!data || !data.lastCheckedAt) return null;

  const tracks = data.unavailable;

  return (
    <div className="space-y-2">
      <SectionHeader
        title="Spotify availability"
        subtitle={`Checked against the Spotify Web API daily, ahead of the SpotOnTrack lag. Last check: ${formatUtc(data.lastCheckedAt)}`}
        actions={
          <span className="text-xs opacity-60">
            {tracks.length} unavailable
          </span>
        }
      />
      {tracks.length === 0 ? (
        <p className="text-sm opacity-70">Every checked catalog track is playable on Spotify.</p>
      ) : (
        <GlassTable headers={["Track", "Artists", "Status", "Since"]}>
          {tracks.map((track) => (
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
                    <div className="mt-0.5 flex items-center gap-2">
                      <CopyableIsrc
                        isrc={track.isrc}
                        className="font-mono text-[10px] text-lime-600 underline hover:opacity-80 dark:text-lime-400"
                      />
                      <a
                        href={`https://open.spotify.com/track/${encodeURIComponent(track.spotify_track_id)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] underline opacity-70 hover:opacity-100"
                      >
                        Spotify
                      </a>
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
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300">
                  {describeUnavailableReason(track.reason)}
                </span>
              </TableCell>
              <TableCell mono>{formatUtc(track.unavailable_since)}</TableCell>
            </TableRow>
          ))}
        </GlassTable>
      )}
    </div>
  );
}
