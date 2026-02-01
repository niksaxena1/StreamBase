"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Combobox } from "@/components/ui/Combobox";
import { hrefWithPatchedSearchParams } from "@/lib/searchParams";

type PlaylistOption = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_image_url: string | null;
  track_count?: number | null;
};

const RANGE_CHOICES = [30, 90, 365] as const;

export function PlaylistDashboardControls(props: {
  playlists: PlaylistOption[];
  playlistKey: string;
  rangeDays: number;
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
    <div className="sticky top-0 z-20 sb-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-1 sm:min-w-0">
          <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>Playlist</div>
          <div className="sb-ring rounded-xl bg-black/10 px-2.5 py-1.5 dark:bg-white/10 flex-1 min-w-0">
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

        <div className="flex items-center gap-2">
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-black/10 p-0.5 dark:bg-white/10">
            {RANGE_CHOICES.map((d) => (
              <Link
                key={d}
                href={hrefWithPatchedSearchParams(sp, { range: String(d) })}
                className={[
                  "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
                  props.rangeDays === d
                    ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                    : "hover:bg-black/10 dark:hover:bg-white/10",
                ].join(" ")}
                style={
                  props.rangeDays === d
                    ? undefined
                    : { opacity: 0.7 }
                }
              >
                {d}d
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

