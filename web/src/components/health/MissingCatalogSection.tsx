import Link from "next/link";

import { cachedMissingCatalogTracks } from "@/lib/health/cachedHealthQueries";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { ExportMissingTracksButton } from "@/components/health/ExportMissingTracksButton";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

/**
 * Async server component for the "All Missing Catalog Tracks" section.
 * Wrapped in <Suspense> so it streams independently of the warnings table.
 */
export async function MissingCatalogSection({
  runDate,
  dataDate,
}: {
  runDate: string | null;
  dataDate: string | null;
}) {
  if (!runDate) return null;

  const { data: allMissingTracks } = await cachedMissingCatalogTracks(runDate);
  if (!allMissingTracks?.length) return null;

  return (
    <div className="space-y-2">
      <SectionHeader
        title={
          <>
            All Missing Catalog Tracks{" "}
            <span className="text-xs font-normal opacity-60">
              ({dataDate ?? "—"})
            </span>
          </>
        }
        subtitle="Tracks in playlists that don't have stream data in the catalog snapshot for this day"
        actions={
          <>
            <span className="text-xs opacity-60">
              {allMissingTracks.length} tracks
            </span>
            <ExportMissingTracksButton
              tracks={allMissingTracks}
              date={dataDate ?? "—"}
            />
          </>
        }
      />
      <GlassTable headers={["Track", "Artists", "Playlists"]}>
        {allMissingTracks.map((track) => (
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
                  <div className="mt-0.5">
                    <CopyableIsrc
                      isrc={track.isrc}
                      className="font-mono text-[10px] text-lime-600 underline hover:opacity-80 dark:text-lime-400"
                    />
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              {track.artist_names && track.artist_names.length > 0 ? (
                <ArtistLinks
                  artistNames={track.artist_names}
                  artistIds={track.artist_ids ?? undefined}
                />
              ) : (
                <span className="opacity-30">—</span>
              )}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {track.playlists.map((pl) => (
                  <Link
                    key={pl}
                    href={`/playlists?playlist_key=${encodeURIComponent(String(pl))}`}
                    className="font-mono text-[10px] underline hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {pl}
                  </Link>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </GlassTable>
    </div>
  );
}
