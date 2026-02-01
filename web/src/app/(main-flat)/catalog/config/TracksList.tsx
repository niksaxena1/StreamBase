"use client";

import { useMemo } from "react";
import Link from "next/link";

import { ArtistLinks } from "@/components/ui/ArtistLinks";

type Track = {
  isrc: string;
  name: string | null;
  release_date: string | null;
  last_seen: string | null;
  albumImageUrl: string | null;
  artistNames: string[] | null;
  artistIds: string[] | null;
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
    <div className="sb-card overflow-hidden">
      <div
        className="flex items-center justify-between border-b px-3 py-2"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <div className="text-xs font-medium">
          Results{" "}
          <span style={{ color: "var(--sb-muted)" }}>
            ({filteredTracks.length.toLocaleString("en-US")})
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="text-left text-[11px]" style={{ color: "var(--sb-muted)" }}>
            <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
              <th className="px-3 py-2 font-medium"></th>
              <th className="px-3 py-2 font-medium">Track</th>
              <th className="px-3 py-2 font-medium">ISRC</th>
              <th className="px-3 py-2 font-medium">Release</th>
              <th className="px-3 py-2 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {filteredTracks.map((track) => (
              <tr
                key={track.isrc}
                className="border-b last:border-0"
                style={{ borderColor: "var(--sb-border)" }}
              >
                <td className="px-3 py-2">
                  {track.albumImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={track.albumImageUrl}
                      alt="Album cover"
                      className="h-8 w-8 rounded-lg object-cover sb-ring"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/tracks/${track.isrc}`}
                    className="font-medium transition-colors hover:text-lime-600 dark:hover:text-lime-400"
                  >
                    {track.name ?? track.isrc}
                  </Link>
                  {track.artistNames?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks
                        artistNames={track.artistNames}
                        artistIds={track.artistIds ?? undefined}
                      />
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-mono text-[11px] opacity-40" style={{ color: "var(--sb-muted)" }}>
                  <Link className="underline" href={`/tracks/${track.isrc}`}>
                    {track.isrc}
                  </Link>
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {track.release_date ?? "—"}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {track.last_seen ?? "—"}
                </td>
              </tr>
            ))}
            {!filteredTracks.length && (
              <tr>
                <td
                  className="px-3 py-6 text-sm"
                  style={{ color: "var(--sb-muted)" }}
                  colSpan={5}
                >
                  {searchQuery.trim() ? "No tracks found matching your search." : "No tracks found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
