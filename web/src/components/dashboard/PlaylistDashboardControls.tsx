"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Combobox } from "@/components/ui/Combobox";
import { FilterBar } from "@/components/ui/FilterBar";

type PlaylistOption = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_image_url: string | null;
  track_count?: number | null;
};

export function PlaylistDashboardControls(props: {
  playlists: PlaylistOption[];
  playlistKey: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    try {
      localStorage.setItem("sb:last_playlist_key", props.playlistKey);
    } catch {
      // ignore
    }
  }, [props.playlistKey]);

  function onSelectPlaylist(nextKey: string) {
    if (!nextKey || nextKey === props.playlistKey) return;
    try {
      localStorage.setItem("sb:last_playlist_key", nextKey);
    } catch {
      // ignore
    }
    const next = new URLSearchParams(sp.toString());
    next.set("playlist_key", nextKey);
    router.push(`?${next.toString()}`);
  }

  return (
    <FilterBar
      left={
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium">Playlist</div>
                  <div className="sb-ring rounded-xl bg-black/10 px-2.5 py-1.5 dark:bg-white/10 min-w-[280px] w-full max-w-[400px]">
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
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}

