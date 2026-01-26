"use client";

import { useState } from "react";
import { SearchBox } from "./SearchBox";
import { TracksList } from "./TracksList";

type Track = {
  isrc: string;
  name: string | null;
  albumImageUrl: string | null;
  artistNames: string[] | null;
  artistIds: string[] | null;
  externalUrl: string | null;
};

type TracksConfigClientProps = {
  tracks: Track[];
  totalCount: number;
};

export function TracksConfigClient({ tracks, totalCount }: TracksConfigClientProps) {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Tracks
            {totalCount > 0 && (
              <span className="ml-2 text-base font-normal" style={{ color: "var(--sb-muted)" }}>
                ({totalCount} {totalCount === 1 ? "track" : "tracks"})
              </span>
            )}
          </h1>
        </div>
        <SearchBox onSearchChange={setSearchQuery} placeholder="Search tracks…" />
      </div>

      <TracksList tracks={tracks} searchQuery={searchQuery} />
    </>
  );
}
