"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

type PlaylistOption = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
};

const RANGE_CHOICES = [30, 90, 365] as const;

function hrefWith(existing: URLSearchParams, patch: Record<string, string | null | undefined>) {
  const u = new URLSearchParams(existing.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") u.delete(k);
    else u.set(k, v);
  }
  return `?${u.toString()}`;
}

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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>Playlist</div>
          <div className="sb-ring rounded-xl bg-white/70 px-2.5 py-1.5 dark:bg-white/10">
            <select
              value={props.playlistKey}
              onChange={(e) => onSelectPlaylist(e.target.value)}
              className="bg-transparent text-xs outline-none"
              style={{ color: "var(--sb-text)" }}
              aria-label="Select playlist"
            >
              {props.playlists.map((p) => (
                <option key={p.playlist_key} value={p.playlist_key}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-white/70 p-0.5 dark:bg-white/10">
            {RANGE_CHOICES.map((d) => (
              <Link
                key={d}
                href={hrefWith(sp, { range: String(d) })}
                className={[
                  "rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
                  props.rangeDays === d
                    ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                    : "hover:bg-white/70 dark:hover:bg-white/10",
                ].join(" ")}
                style={
                  props.rangeDays === d
                    ? undefined
                    : { color: "var(--sb-muted)" }
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

