"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Combobox } from "@/components/ui/Combobox";
import { FilterBar } from "@/components/ui/FilterBar";
import { PlaylistMembershipStats } from "@/components/dashboard/PlaylistMembershipStats";
import type { DatasetMode } from "@/lib/datasetMode";
import { lastPlaylistKeyStorageKey, writeDatasetSelectionStorage } from "@/lib/datasetSelectionStorage";

type PlaylistOption = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_image_url: string | null;
  track_count?: number | null;
};

export function PlaylistDashboardControls(props: {
  datasetMode?: DatasetMode;
  playlists: PlaylistOption[];
  playlistKey: string;
  /** Track count for the selected playlist (as of latest stats row), if known */
  trackCount: number | null;
  /** Distinct credited artists on those tracks at the same run date, if known */
  artistCount: number | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const datasetMode = props.datasetMode ?? "own";
  const playlistStorageKey = lastPlaylistKeyStorageKey(datasetMode);

  useEffect(() => {
    writeDatasetSelectionStorage(playlistStorageKey, props.playlistKey);
  }, [playlistStorageKey, props.playlistKey]);

  function onSelectPlaylist(nextKey: string) {
    if (!nextKey || nextKey === props.playlistKey) return;
    writeDatasetSelectionStorage(playlistStorageKey, nextKey);
    const next = new URLSearchParams(sp.toString());
    next.set("playlist_key", nextKey);
    router.push(`?${next.toString()}`);
  }

  const showStats =
    (props.trackCount != null && Number.isFinite(props.trackCount)) ||
    (props.artistCount != null && Number.isFinite(props.artistCount));

  return (
    <FilterBar
      left={
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="shrink-0 text-xs font-medium">Playlist</div>
          <div className="sb-ring w-full min-w-[280px] max-w-[400px] rounded-xl bg-black/10 px-2.5 py-1.5 dark:bg-white/10">
            <Combobox
              ariaLabel="Select playlist"
              value={props.playlistKey}
              options={props.playlists.map((p) => ({
                value: p.playlist_key,
                label: p.display_name,
                imageUrl: p.playlist_key === "all_catalog" ? null : p.spotify_playlist_image_url,
                isAllCatalog: p.playlist_key === "all_catalog",
                trackCount: p.track_count,
              }))}
              placeholder="Type a playlist…"
              onChange={onSelectPlaylist}
              imageShape="square"
            />
          </div>
        </div>
      }
      right={
        showStats ? (
          <PlaylistMembershipStats
            trackCount={props.trackCount}
            artistCount={props.artistCount}
            className="hidden lg:flex"
          />
        ) : null
      }
    />
  );
}

