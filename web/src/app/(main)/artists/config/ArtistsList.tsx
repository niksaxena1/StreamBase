"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, User } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";

type Artist = {
  id: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string;
};

type ArtistsListProps = {
  artists: Artist[];
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

export function ArtistsList({ artists, searchQuery }: ArtistsListProps) {
  const filteredArtists = useMemo(() => {
    if (!searchQuery.trim()) {
      return artists;
    }
    return artists.filter((artist) => fuzzyMatch(searchQuery, artist.name));
  }, [artists, searchQuery]);

  return (
    <GlassTable headers={["", "Artist", "ID", ""]}>
        {filteredArtists.map((artist) => (
          <TableRow key={artist.id}>
            <TableCell>
              {artist.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artist.imageUrl}
                  alt={artist.name}
                  className="h-10 w-10 rounded-full object-cover sb-ring"
                />
              ) : (
                <div className="h-10 w-10 rounded-full sb-ring bg-white/60 flex items-center justify-center">
                  <User className="h-5 w-5 opacity-40" />
                </div>
              )}
            </TableCell>
            <TableCell>
              <Link
                className="transition-colors sb-link-hover font-medium"
                href={`/catalog?artist_id=${encodeURIComponent(artist.id)}`}
              >
                {artist.name}
              </Link>
            </TableCell>
            <TableCell mono className="text-xs">
              {artist.id}
            </TableCell>
            <TableCell>
              <Link
                href={artist.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                title="Open on Spotify"
                style={{ color: "var(--sb-muted)" }}
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
        {!filteredArtists.length && (
          <TableRow>
            <TableCell className="py-8 text-center opacity-50" colSpan={4}>
              {searchQuery.trim() ? "No artists found matching your search." : "No artists found."}
            </TableCell>
          </TableRow>
        )}
    </GlassTable>
  );
}
