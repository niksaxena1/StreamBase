"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, Music } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

type Track = {
  isrc: string;
  name: string | null;
  albumImageUrl: string | null;
  artistNames: string[] | null;
  artistIds: string[] | null;
  externalUrl: string | null;
};

type TracksListProps = {
  tracks: Track[];
  searchQuery: string;
};

// Normalize text for fuzzy matching: remove accents, quotes, convert to lowercase
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/["'"]/g, "") // Remove quotes
    .toLowerCase()
    .trim();
}

function fuzzyMatch(query: string, text: string): boolean {
  const normalizedQuery = normalizeText(query);
  const normalizedText = normalizeText(text);
  return normalizedText.includes(normalizedQuery);
}

export function TracksList({ tracks, searchQuery }: TracksListProps) {
  const filteredTracks = useMemo(() => {
    if (!searchQuery.trim()) {
      return tracks;
    }
    
    // Split query into words to allow searching for both artist and track name
    const queryParts = searchQuery.trim().split(/\s+/).filter(Boolean);
    
    return tracks.filter((track) => {
      const trackName = track.name ?? track.isrc;
      const normalizedTrackName = normalizeText(trackName);
      const artistNamesText = (track.artistNames ?? []).join(" ");
      const normalizedArtistNames = normalizeText(artistNamesText);
      
      // Check if all query parts match either the track name or artist names
      return queryParts.every((part) => {
        const normalizedPart = normalizeText(part);
        return normalizedTrackName.includes(normalizedPart) || 
               normalizedArtistNames.includes(normalizedPart);
      });
    });
  }, [tracks, searchQuery]);

  return (
    <GlassTable headers={["", "Track", "Artists", "ISRC", ""]}>
      {filteredTracks.map((track) => (
        <TableRow key={track.isrc}>
          <TableCell>
            {track.albumImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.albumImageUrl}
                alt="Album cover"
                className="h-10 w-10 rounded-lg object-cover sb-ring"
              />
            ) : (
              <div className="h-10 w-10 rounded-lg sb-ring bg-white/60 flex items-center justify-center">
                <Music className="h-5 w-5 opacity-40" />
              </div>
            )}
          </TableCell>
          <TableCell>
            <Link
              className="transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium"
              href={`/tracks/${track.isrc}`}
            >
              {track.name ?? track.isrc}
            </Link>
          </TableCell>
          <TableCell>
            {track.artistNames?.length ? (
              <ArtistLinks
                artistNames={track.artistNames}
                artistIds={track.artistIds ?? undefined}
              />
            ) : (
              <span className="text-xs opacity-50">—</span>
            )}
          </TableCell>
          <TableCell mono className="text-xs">
            {track.isrc}
          </TableCell>
          <TableCell>
            {track.externalUrl ? (
              <Link
                href={track.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                title="Open on Spotify"
                style={{ color: "var(--sb-muted)" }}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            ) : null}
          </TableCell>
        </TableRow>
      ))}
      {!filteredTracks.length && (
        <TableRow>
          <TableCell className="py-8 text-center opacity-50" colSpan={5}>
            {searchQuery.trim() ? "No tracks found matching your search." : "No tracks found."}
          </TableCell>
        </TableRow>
      )}
    </GlassTable>
  );
}
