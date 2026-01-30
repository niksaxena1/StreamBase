"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ArtistLinks } from "@/components/ui/ArtistLinks";

type WarningRowProps = {
  warning: {
    severity: string;
    code: string;
    playlist_key: string | null;
    message: string;
    details_json?: any;
  };
  nonCatalogTracks?: Array<{
    isrc: string;
    name: string | null;
    artist_names?: string[] | null;
    artist_ids?: string[] | null;
    album_image_url?: string | null;
  }>;
  trackCountSwingTracks?: {
    added: Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
    }>;
    removed: Array<{
      isrc: string;
      name: string | null;
      artist_names?: string[] | null;
      artist_ids?: string[] | null;
      album_image_url?: string | null;
    }>;
  };
  missingEnrichmentTracks?: Array<{
    isrc: string;
    name: string | null;
    artist_names?: string[] | null;
    artist_ids?: string[] | null;
    album_image_url?: string | null;
  }> | null;
  enrichmentWarning?: {
    missing_enrichment_track_count?: number;
    note?: string;
  };
};

export function WarningRow({ warning, nonCatalogTracks, trackCountSwingTracks, missingEnrichmentTracks, enrichmentWarning }: WarningRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [thumbByIsrc, setThumbByIsrc] = useState<Record<string, string | null>>({});
  const hasTracks = nonCatalogTracks && nonCatalogTracks.length > 0;
  const hasSwingTracks = trackCountSwingTracks && 
    (trackCountSwingTracks.added.length > 0 || trackCountSwingTracks.removed.length > 0);
  const hasMissingEnrichmentTracks = missingEnrichmentTracks !== undefined && (
    (Array.isArray(missingEnrichmentTracks) && missingEnrichmentTracks.length > 0) || 
    missingEnrichmentTracks === null
  );
  const canExpand = (warning.code === "non_catalog_tracks_present" && hasTracks) ||
                   (warning.code === "track_count_swing" && hasSwingTracks) ||
                   (warning.code === "tracks_missing_enrichment" && hasMissingEnrichmentTracks);

  const missingThumbIsrcs = useMemo(() => {
    if (!expanded) return [];
    if (warning.code !== "tracks_missing_enrichment") return [];
    if (!Array.isArray(missingEnrichmentTracks)) return [];
    const need = missingEnrichmentTracks
      .filter((t) => !t.album_image_url)
      .map((t) => (t.isrc ?? "").trim().toUpperCase())
      .filter(Boolean);
    // Limit per expand to keep UI snappy / avoid rate limits
    return need.slice(0, 50);
  }, [expanded, warning.code, missingEnrichmentTracks]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (missingThumbIsrcs.length === 0) return;

      // Prefer a single batched request (faster + fewer token fetches).
      try {
        const res = await fetch("/api/spotify-track-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ isrcs: missingThumbIsrcs }),
        });
        if (res.status === 404) {
          // Older dev servers may not pick up new route files without restart.
          // Fallback: hit the single-track endpoint for each ISRC.
          for (const isrc of missingThumbIsrcs) {
            if (cancelled) return;
            if (thumbByIsrc[isrc] !== undefined) continue;
            try {
              const one = await fetch(`/api/spotify-track?isrc=${encodeURIComponent(isrc)}`, {
                cache: "no-store",
              });
              const j = (await one.json()) as { albumImageUrl?: string | null };
              const url = one.ok ? (j.albumImageUrl ?? null) : null;
              if (!cancelled) setThumbByIsrc((prev) => ({ ...prev, [isrc]: url }));
            } catch {
              if (!cancelled) setThumbByIsrc((prev) => ({ ...prev, [isrc]: null }));
            }
          }
          return;
        }

        const json = (await res.json()) as { byIsrc?: Record<string, string | null> };
        const byIsrc = res.ok ? (json.byIsrc ?? {}) : {};
        if (!cancelled) setThumbByIsrc((prev) => ({ ...prev, ...byIsrc }));
      } catch {
        // If the batch route fails, fall back to doing nothing (placeholders remain).
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // thumbByIsrc intentionally omitted to avoid refetch loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingThumbIsrcs]);

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
            className={[
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
              warning.severity === "critical"
                ? "bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300"
                : warning.severity === "warn"
                  ? "bg-orange-500/20 text-orange-700 dark:bg-orange-500/30 dark:text-orange-300"
                  : "bg-blue-500/20 text-blue-700 dark:bg-blue-500/30 dark:text-blue-300",
            ].join(" ")}
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
      {expanded && (
        <tr className="bg-black/[0.01] dark:bg-white/[0.01]">
          <td colSpan={4} className="px-6 py-4">
            {warning.code === "non_catalog_tracks_present" && hasTracks && (
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
                              by <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
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
            )}

            {warning.code === "track_count_swing" && hasSwingTracks && trackCountSwingTracks && (
              <div className="space-y-4">
                {trackCountSwingTracks.added.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium opacity-70 mb-2">
                      Added tracks ({trackCountSwingTracks.added.length}):
                    </div>
                    <div className="space-y-2">
                      {trackCountSwingTracks.added.map((track) => (
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
                                  by <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
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
                )}

                {trackCountSwingTracks.removed.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium opacity-70 mb-2">
                      Removed tracks ({trackCountSwingTracks.removed.length}):
                    </div>
                    <div className="space-y-2">
                      {trackCountSwingTracks.removed.map((track) => (
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
                                  by <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
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
                )}
              </div>
            )}

            {warning.code === "tracks_missing_enrichment" && hasMissingEnrichmentTracks && (
              <div className="space-y-2">
                {Array.isArray(missingEnrichmentTracks) && missingEnrichmentTracks.length > 0 ? (
                  <>
                    <div className="text-xs font-medium opacity-70 mb-2">
                      Missing Enrichment ({missingEnrichmentTracks.length}):
                    </div>
                    <div className="space-y-2">
                      {missingEnrichmentTracks.map((track) => {
                        const isrc = (track.isrc ?? "").trim().toUpperCase();
                        const fetchedUrl = thumbByIsrc[isrc];
                        const hasThumb =
                          fetchedUrl !== undefined
                            ? fetchedUrl !== null
                            : !!track.album_image_url;
                        const imageUrl =
                          fetchedUrl !== undefined ? fetchedUrl : track.album_image_url;

                        return (
                          <div key={track.isrc} className="flex items-center gap-3 text-xs">
                            {hasThumb && imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={imageUrl}
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
                                    by <ArtistLinks artistNames={track.artist_names} artistIds={track.artist_ids ?? undefined} />
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
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="text-xs opacity-60">
                    <p className="mb-2">Track details not available in current warning record.</p>
                    <p>{enrichmentWarning?.note || "Run the Spotify enrichment workflow to update artist names and metadata."}</p>
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
