"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ExternalLink, User, Download } from "lucide-react";

import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { IconButton } from "@/components/ui/Button";
import { foldForSearch } from "@/lib/searchFold";
import { downloadCsv, todayIsoDate } from "@/lib/csv";

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

export function ArtistsList({ artists, searchQuery }: ArtistsListProps) {
  const filteredArtists = useMemo(() => {
    if (!searchQuery.trim()) {
      return artists;
    }
    const q = foldForSearch(searchQuery);
    return artists.filter((artist) => foldForSearch(artist.name).includes(q));
  }, [artists, searchQuery]);

  return (
    <div className="flex flex-col space-y-2">
      <div className="flex items-center justify-end">
        <IconButton
          type="button"
          onClick={() => {
            const csvData = filteredArtists.map((artist) => ({
              "Artist Name": artist.name,
              "Artist ID": artist.id,
              "Spotify URL": artist.externalUrl,
            }));
            downloadCsv({
              filename: `artists-config-export-${todayIsoDate()}.csv`,
              rows: csvData,
            });
          }}
          title="Download table as CSV"
          aria-label="Download table as CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </IconButton>
      </div>
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
    </div>
  );
}
