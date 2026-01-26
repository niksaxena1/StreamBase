"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SearchBox } from "./SearchBox";
import { ArtistsList } from "./ArtistsList";

type Artist = {
  id: string;
  name: string;
  imageUrl: string | null;
  externalUrl: string;
};

type ArtistsConfigClientProps = {
  artists: Artist[];
  totalCount: number;
};

export function ArtistsConfigClient({ artists, totalCount }: ArtistsConfigClientProps) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            href="/catalog"
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            aria-label="Back to catalog"
            title="Back to catalog"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </Link>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Artists
              {totalCount > 0 && (
                <span className="ml-2 text-base font-normal" style={{ color: "var(--sb-muted)" }}>
                  ({totalCount} {totalCount === 1 ? "artist" : "artists"})
                </span>
              )}
            </h1>
          </div>
        </div>
        <SearchBox onSearchChange={setSearchQuery} placeholder="Search artists…" />
      </div>

      <ArtistsList artists={artists} searchQuery={searchQuery} />
    </>
  );
}
