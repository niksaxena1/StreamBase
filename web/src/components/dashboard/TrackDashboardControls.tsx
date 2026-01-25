"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Combobox } from "@/components/ui/Combobox";

type TrackOption = { isrc: string; name: string };

const RANGE_CHOICES = [30, 90, 365] as const;

function hrefWith(existing: URLSearchParams, patch: Record<string, string | null | undefined>) {
  const u = new URLSearchParams(existing.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") u.delete(k);
    else u.set(k, v);
  }
  return `?${u.toString()}`;
}

export function TrackDashboardControls(props: {
  tracks: TrackOption[];
  isrc: string | null;
  rangeDays: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    if (props.isrc) {
      try {
        localStorage.setItem("sb:last_track_isrc", props.isrc);
      } catch {
        // ignore
      }
    }
  }, [props.isrc]);

  function onSelectTrack(nextIsrc: string) {
    if (!nextIsrc || nextIsrc === props.isrc) return;
    try {
      localStorage.setItem("sb:last_track_isrc", nextIsrc);
    } catch {
      // ignore
    }
    const next = new URLSearchParams(sp.toString());
    next.set("isrc", nextIsrc);
    router.push(`?${next.toString()}`);
  }

  return (
    <div className="sb-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-xs font-medium" style={{ color: "var(--sb-text)" }}>Track</div>
          <div className="sb-ring rounded-xl bg-white/70 px-2.5 py-1.5 dark:bg-white/10">
            <Combobox
              ariaLabel="Select track"
              value={props.isrc ?? null}
              options={props.tracks.map((t) => ({ value: t.isrc, label: t.name }))}
              placeholder="Type a track…"
              onChange={onSelectTrack}
            />
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
