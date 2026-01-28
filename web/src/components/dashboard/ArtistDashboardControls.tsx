"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Combobox } from "@/components/ui/Combobox";

type ArtistOption = { id: string; name: string; imageUrl?: string | null };
type TrackOption = { isrc: string; name: string; albumImageUrl?: string | null };

const RANGE_CHOICES = [30, 90, 365] as const;

function hrefWith(existing: URLSearchParams, patch: Record<string, string | null | undefined>) {
  const u = new URLSearchParams(existing.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") u.delete(k);
    else u.set(k, v);
  }
  return `?${u.toString()}`;
}

export function ArtistDashboardControls(props: {
  artists: ArtistOption[];
  artistId: string;
  tracks: TrackOption[];
  isrc: string | null;
  rangeDays: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    try {
      localStorage.setItem("sb:last_artist_id", props.artistId);
    } catch {
      // ignore
    }
    if (props.isrc) {
      try {
        localStorage.setItem(`sb:last_isrc_by_artist:${props.artistId}`, props.isrc);
      } catch {
        // ignore
      }
    }
  }, [props.artistId, props.isrc]);

  // Auto-select first track alphabetically when artist is selected but no track is chosen
  useEffect(() => {
    // Only auto-select if:
    // 1. No track is currently selected
    // 2. There are tracks available for this artist
    // 3. There's no remembered track for this artist
    if (!props.isrc && props.tracks.length > 0) {
      let rememberedIsrc: string | null = null;
      try {
        rememberedIsrc = localStorage.getItem(`sb:last_isrc_by_artist:${props.artistId}`);
      } catch {
        // ignore
      }

      // If no remembered track, auto-select the first one alphabetically
      // (tracks are already sorted alphabetically from the server)
      if (!rememberedIsrc && props.tracks.length > 0) {
        const firstTrackIsrc = props.tracks[0].isrc;
        const next = new URLSearchParams(sp.toString());
        next.set("isrc", firstTrackIsrc);
        router.replace(`?${next.toString()}`);
      }
    }
  }, [props.artistId, props.isrc, props.tracks, sp, router]);

  function onSelectArtist(nextId: string) {
    if (!nextId || nextId === props.artistId) return;

    try {
      localStorage.setItem("sb:last_artist_id", nextId);
    } catch {
      // ignore
    }

    let rememberedIsrc: string | null = null;
    try {
      rememberedIsrc = localStorage.getItem(`sb:last_isrc_by_artist:${nextId}`);
    } catch {
      // ignore
    }

    const next = new URLSearchParams(sp.toString());
    next.set("artist_id", nextId);
    
    // If there's a remembered track, use it; otherwise let the server auto-select the first track
    if (rememberedIsrc) {
      next.set("isrc", rememberedIsrc);
    } else {
      // Don't set isrc - the server will auto-select the first track alphabetically
      next.delete("isrc");
    }
    
    router.push(`?${next.toString()}`);
  }

  function onSelectTrack(nextIsrc: string) {
    // allow clearing selection via "(none)"
    if (nextIsrc === "") {
      const next = new URLSearchParams(sp.toString());
      next.delete("isrc");
      router.push(`?${next.toString()}`);
      return;
    }
    if (!nextIsrc || nextIsrc === props.isrc) return;
    try {
      localStorage.setItem(`sb:last_isrc_by_artist:${props.artistId}`, nextIsrc);
    } catch {
      // ignore
    }
    const next = new URLSearchParams(sp.toString());
    next.set("isrc", nextIsrc);
    router.push(`?${next.toString()}`);
  }

  return (
    <div className="relative z-20 rounded-xl border border-lime-500/20 bg-lime-500/10 p-3 shadow-sm backdrop-blur-sm dark:bg-lime-400/10 dark:border-lime-400/20">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <div className="text-xs font-medium">Artist</div>
            <div className="sb-ring rounded-xl bg-black/10 px-2.5 py-1.5 dark:bg-white/10 min-w-[280px] w-full max-w-[400px]">
              <Combobox
                ariaLabel="Select artist"
                value={props.artistId}
                options={props.artists.map((a) => ({ value: a.id, label: a.name, imageUrl: a.imageUrl }))}
                placeholder="Type an artist…"
                onChange={onSelectArtist}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-xs font-medium">Track</div>
            <div className="sb-ring rounded-xl bg-black/10 px-2.5 py-1.5 dark:bg-white/10 min-w-[280px] w-full max-w-[400px]">
              <Combobox
                ariaLabel="Select track"
                value={props.isrc ?? null}
                options={[
                  { value: "", label: "(none)" },
                  ...props.tracks.map((t) => ({ value: t.isrc, label: t.name, imageUrl: t.albumImageUrl })),
                ]}
                placeholder="Type a track…"
                onChange={(v) => onSelectTrack(v)}
                imageShape="square"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="sb-ring flex items-center gap-0.5 rounded-full bg-black/10 p-0.5 dark:bg-white/10">
            {RANGE_CHOICES.map((d) => (
              <Link
                key={d}
                href={hrefWith(sp, { range: String(d) })}
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

