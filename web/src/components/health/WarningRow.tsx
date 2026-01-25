"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

type WarningRowProps = {
  warning: {
    severity: string;
    code: string;
    playlist_key: string | null;
    message: string;
  };
  nonCatalogTracks?: Array<{ 
    isrc: string; 
    name: string | null;
    artist_names?: string[] | null;
    album_image_url?: string | null;
  }>;
};

export function WarningRow({ warning, nonCatalogTracks }: WarningRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasTracks = nonCatalogTracks && nonCatalogTracks.length > 0;
  const canExpand = warning.code === "non_catalog_tracks_present" && hasTracks;

  return (
    <>
      <tr
        className={[
          "group transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]",
          canExpand ? "cursor-pointer" : "",
        ].filter(Boolean).join(" ")}
        onClick={canExpand ? () => setExpanded(!expanded) : undefined}
      >
        <td className="px-6 py-4">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              background:
                warning.severity === "critical"
                  ? "rgba(239, 68, 68, 0.2)"
                  : warning.severity === "warn"
                    ? "rgba(245, 158, 11, 0.2)"
                    : "rgba(59, 130, 246, 0.2)",
              color:
                warning.severity === "critical"
                  ? "#991b1b"
                  : warning.severity === "warn"
                    ? "#92400e"
                    : "#1e40af",
            }}
          >
            {warning.severity}
          </span>
        </td>
        <td className="px-6 py-4 font-mono text-xs">{warning.code}</td>
        <td className="px-6 py-4">
          {warning.playlist_key ? (
            <Link
              href={`/playlists/${warning.playlist_key}`}
              className="font-mono text-xs underline transition-colors hover:text-lime-600 dark:hover:text-lime-400"
              onClick={(e) => e.stopPropagation()}
            >
              {warning.playlist_key}
            </Link>
          ) : (
            <span className="font-mono text-xs opacity-30">—</span>
          )}
        </td>
        <td className="px-6 py-4">
          <div className="flex items-center gap-2">
            {canExpand && (
              <button
                className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(!expanded);
                }}
              >
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            )}
            <span>{warning.message}</span>
          </div>
        </td>
      </tr>
      {expanded && hasTracks && (
        <tr className="bg-black/[0.01] dark:bg-white/[0.01]">
          <td colSpan={4} className="px-6 py-4">
            <div className="space-y-2">
              <div className="text-xs font-medium opacity-70 mb-2">
                Non-catalog tracks ({nonCatalogTracks.length}):
              </div>
              <div className="space-y-2">
                {nonCatalogTracks.map((track) => (
                  <div key={track.isrc} className="flex items-center gap-3 text-xs">
                    {track.album_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={track.album_image_url}
                        alt="Album cover"
                        className="h-10 w-10 rounded object-cover sb-ring flex-shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded sb-ring bg-white/60 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/tracks/${track.isrc}`}
                          className="font-medium hover:underline"
                          style={{ color: "var(--sb-text)" }}
                        >
                          {track.name || track.isrc}
                        </Link>
                        {track.artist_names && track.artist_names.length > 0 && (
                          <span className="opacity-60">
                            by <ArtistLinks artistNames={track.artist_names} />
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5">
                        <Link
                          href={`/tracks/${track.isrc}`}
                          className="font-mono text-[10px] text-lime-600 dark:text-lime-400 underline hover:opacity-80"
                        >
                          {track.isrc}
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
