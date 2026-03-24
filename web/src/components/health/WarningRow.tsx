"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Music } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/GlassTable";
import { TrackListItem } from "@/components/health/TrackListItem";
import { StaleTrackResolver } from "@/components/health/StaleTrackResolver";
import { useRouter } from "next/navigation";
import { fetchApiJson } from "@/lib/api";
import type {
  PlaylistMeta,
  WarningExpandedData,
  TrackBase,
  StaleTrack,
  DecreasedTrack,
  RemovedTrack,
  PrevNonzeroTrack,
  ExcludedZeroedTrack,
  NegativeDailyStreamTrack,
  OverlapTrack,
} from "@/lib/health/types";

// ---------------------------------------------------------------------------
// Inline quick-action helpers
// ---------------------------------------------------------------------------

function QuickOverrideButton({
  isrc,
  date,
}: {
  isrc: string;
  date: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [streams, setStreams] = useState("");
  const [note, setNote] = useState("Quick override from Health page");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [errMsg, setErrMsg] = useState("");

  const handleSubmit = useCallback(async () => {
    const n = Number(streams);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      setErrMsg("Enter a valid number");
      return;
    }
    if (!note.trim()) {
      setErrMsg("Note is required");
      return;
    }
    setState("loading");
    setErrMsg("");
    try {
      await fetchApiJson("/api/health-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "quick_override",
          isrc,
          date,
          streams_cumulative: n,
          note: note.trim(),
        }),
      });
      setState("done");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setState("error");
      setErrMsg(e instanceof Error ? e.message : "Failed");
    }
  }, [isrc, date, streams, note, router]);

  if (state === "done")
    return <span className="text-[10px] text-green-700 dark:text-green-500">Overridden</span>;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[10px] px-1.5 py-0.5 rounded sb-ring bg-white/60 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 opacity-70 hover:opacity-100 transition"
      >
        Override
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1">
      <input
        type="text"
        inputMode="numeric"
        value={streams}
        onChange={(e) => {
          setStreams(e.target.value);
          setErrMsg("");
        }}
        placeholder="Cumulative streams"
        className="sb-ring h-6 w-32 rounded px-2 text-[10px] bg-white/60 dark:bg-white/10"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setErrMsg("");
        }}
        placeholder="Note (required)"
        className="sb-ring h-6 w-48 rounded px-2 text-[10px] bg-white/60 dark:bg-white/10"
      />
      <button
        type="button"
        onClick={handleSubmit}
        disabled={state === "loading"}
        className="text-[10px] px-1.5 py-0.5 rounded sb-ring bg-black text-white dark:bg-white dark:text-black hover:opacity-80 transition disabled:opacity-40"
      >
        {state === "loading" ? "..." : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[10px] px-1.5 py-0.5 rounded opacity-60 hover:opacity-100"
      >
        Cancel
      </button>
      {errMsg && <span className="text-[10px] text-red-400">{errMsg}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCodeLabel(code: string) {
  const raw = (code ?? "").trim();
  if (!raw) return "—";
  if (raw === "entity_distro_drift") return "Entity Distro Mismatch";
  if (raw === "individual_tracks_stale") return "Stale Tracks";
  if (raw === "total_streams_decreased") return "Total Streams Decreased";
  if (raw === "excluded_track_streams_zeroed") return "Excluded Track Zeroed";
  if (raw === "distro_overlap") return "Distro Overlap";
  return raw
    .split("_")
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function DriftPlaylistChip({
  playlistKey,
  meta,
  label,
}: {
  playlistKey: string;
  meta?: PlaylistMeta | null;
  label?: string;
}) {
  const name = meta?.name ?? playlistKey;
  const imageUrl = meta?.imageUrl ?? null;

  return (
    <Link
      href={`/playlists?playlist_key=${encodeURIComponent(playlistKey)}`}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-opacity hover:opacity-80 whitespace-nowrap"
      style={{ backgroundColor: "var(--sb-surface)" }}
      onClick={(e) => e.stopPropagation()}
      title={`${name} (${playlistKey})`}
    >
      {label && <span className="opacity-50">{label}</span>}
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className="h-4 w-4 rounded-full object-cover sb-ring flex-shrink-0"
        />
      ) : (
        <div
          className="h-4 w-4 rounded-full sb-ring flex items-center justify-center text-[8px] font-bold flex-shrink-0"
          style={{
            backgroundColor: "var(--sb-row-odd)",
            color: "var(--sb-muted)",
          }}
        >
          {name.trim().slice(0, 1).toUpperCase()}
        </div>
      )}
      <span className="font-medium">{name}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Props (#9: simplified from 15 → 5 props)
// ---------------------------------------------------------------------------

type WarningRowProps = {
  warning: {
    severity: string;
    code: string;
    playlist_key: string | null;
    message: string;
  };
  playlistMeta: PlaylistMeta | null;
  expandedData: WarningExpandedData;
  allPlaylistMeta: Record<string, PlaylistMeta>;
  /** Run date (= ingestion snapshot date) for stream overrides. */
  runDate?: string | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WarningRow({
  warning,
  playlistMeta,
  expandedData,
  allPlaylistMeta,
  runDate,
}: WarningRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [thumbByIsrc, setThumbByIsrc] = useState<
    Record<string, string | null>
  >({});
  const canExpand = expandedData !== null;

  // Lazy-load album thumbnails for tracks that are missing them.
  const missingThumbIsrcs = useMemo(() => {
    if (!expanded || !expandedData) return [];
    const wantsThumbs =
      expandedData.type === "tracks_missing_enrichment" ||
      expandedData.type === "catalog_missing_stream_snapshots" ||
      expandedData.type === "catalog_streams_missing_prev_nonzero" ||
      expandedData.type === "individual_tracks_stale" ||
      expandedData.type === "excluded_track_streams_zeroed";
    if (!wantsThumbs) return [];

    const src = expandedData.tracks;
    if (!Array.isArray(src)) return [];
    return src
      .filter((t: TrackBase) => !t.album_image_url)
      .map((t: TrackBase) => (t.isrc ?? "").trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 50);
  }, [expanded, expandedData]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (missingThumbIsrcs.length === 0) return;

      try {
        const json = await fetchApiJson<{ byIsrc: Record<string, string | null> }>(
          "/api/spotify-track-batch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ isrcs: missingThumbIsrcs }),
          },
        );
        const byIsrc = json.byIsrc ?? {};
        if (!cancelled) setThumbByIsrc((prev) => ({ ...prev, ...byIsrc }));
      } catch {
        // Placeholders remain
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
      <TableRow
        className={canExpand ? "cursor-pointer" : ""}
        onClick={canExpand ? () => setExpanded(!expanded) : undefined}
      >
        {/* Severity */}
        <TableCell>
          <span
            className={[
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
              warning.severity === "critical"
                ? "bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300"
                : warning.severity === "warn"
                  ? "bg-orange-500/20 text-orange-700 dark:bg-orange-500/30 dark:text-orange-300"
                  : "bg-blue-500/20 text-blue-700 dark:bg-blue-500/30 dark:text-blue-300",
            ].join(" ")}
          >
            {warning.severity}
          </span>
        </TableCell>

        {/* Code */}
        <TableCell className="hidden sm:table-cell text-xs font-medium">
          <div className="truncate" title={warning.code}>
            {formatCodeLabel(warning.code)}
          </div>
        </TableCell>

        {/* Playlist */}
        <TableCell className="hidden sm:table-cell">
          {warning.playlist_key ? (
            <Link
              href={`/playlists?playlist_key=${encodeURIComponent(String(warning.playlist_key))}`}
              className="flex items-center gap-2 min-w-0 transition-colors sb-link-hover"
              onClick={(e) => e.stopPropagation()}
              title={`${playlistMeta?.name ?? warning.playlist_key} (${warning.playlist_key})`}
            >
              {warning.playlist_key === "all_catalog" ? (
                <span
                  className="h-5 w-5 rounded-full sb-ring flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--sb-accent)", color: "#000" }}
                  aria-hidden="true"
                >
                  <Music className="h-3.5 w-3.5" />
                </span>
              ) : playlistMeta?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={playlistMeta.imageUrl}
                  alt={playlistMeta.name}
                  className="h-5 w-5 rounded-full object-cover sb-ring flex-shrink-0"
                />
              ) : (
                <div
                  className="h-5 w-5 rounded-full sb-ring flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                  style={{
                    backgroundColor: "var(--sb-surface)",
                    color: "var(--sb-muted)",
                  }}
                  aria-hidden="true"
                >
                  {(playlistMeta?.name ?? warning.playlist_key)
                    .trim()
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
              )}
              <span className="min-w-0 flex-1 truncate text-xs">
                {playlistMeta?.name ?? warning.playlist_key}
              </span>
            </Link>
          ) : (
            <span className="text-xs opacity-30">—</span>
          )}
        </TableCell>

        {/* Message */}
        <TableCell>
          <div className="flex items-center gap-2 min-w-0">
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
            <div className="min-w-0 flex-1">
              <div className="truncate">{warning.message}</div>

              {/* Mobile meta: code + playlist inline */}
              <div className="mt-1 flex items-center gap-2 text-[11px] opacity-70 sm:hidden min-w-0">
                <span className="truncate">
                  {formatCodeLabel(warning.code)}
                </span>
                {warning.playlist_key ? (
                  <>
                    <span className="opacity-40">·</span>
                    <Link
                      href={`/playlists?playlist_key=${encodeURIComponent(String(warning.playlist_key))}`}
                      className="flex items-center gap-1.5 min-w-0 hover:opacity-90"
                      onClick={(e) => e.stopPropagation()}
                      title={`${playlistMeta?.name ?? warning.playlist_key} (${warning.playlist_key})`}
                    >
                      {warning.playlist_key === "all_catalog" ? (
                        <span
                          className="h-4 w-4 rounded-full sb-ring flex items-center justify-center flex-shrink-0"
                          style={{
                            background: "var(--sb-accent)",
                            color: "#000",
                          }}
                          aria-hidden="true"
                        >
                          <Music className="h-3 w-3" />
                        </span>
                      ) : playlistMeta?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={playlistMeta.imageUrl}
                          alt={playlistMeta.name}
                          className="h-4 w-4 rounded-full object-cover sb-ring flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="h-4 w-4 rounded-full sb-ring flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                          style={{
                            backgroundColor: "var(--sb-surface)",
                            color: "var(--sb-muted)",
                          }}
                          aria-hidden="true"
                        >
                          {(playlistMeta?.name ?? warning.playlist_key)
                            .trim()
                            .slice(0, 1)
                            .toUpperCase()}
                        </div>
                      )}
                      <span className="truncate">
                        {playlistMeta?.name ?? warning.playlist_key}
                      </span>
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </TableCell>
      </TableRow>

      {/* ---- Expanded content ---- */}
      {expanded && expandedData && (
        <TableRow style={{ background: "var(--sb-row-odd)" }}>
          <TableCell colSpan={4} className="py-4">
            <ExpandedContent
              data={expandedData}
              thumbByIsrc={thumbByIsrc}
              allPlaylistMeta={allPlaylistMeta}
              runDate={runDate}
              playlistKey={warning.playlist_key}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Expanded content — switch on the discriminated union
// ---------------------------------------------------------------------------

function ExpandedContent({
  data,
  thumbByIsrc,
  allPlaylistMeta,
  runDate,
  playlistKey,
}: {
  data: NonNullable<WarningExpandedData>;
  thumbByIsrc: Record<string, string | null>;
  allPlaylistMeta: Record<string, PlaylistMeta>;
  runDate?: string | null;
  playlistKey: string | null;
}) {
  switch (data.type) {
    case "non_catalog_tracks_present":
      return (
        <TrackSection label="Non-catalog tracks" count={data.tracks.length}>
          {data.tracks.map((t) => (
            <TrackListItem key={t.isrc} track={t} />
          ))}
        </TrackSection>
      );

    case "track_count_swing":
      return (
        <div className="space-y-4">
          {data.swing.added.length > 0 && (
            <TrackSection label="Added tracks" count={data.swing.added.length}>
              {data.swing.added.map((t) => (
                <TrackListItem key={t.isrc} track={t} />
              ))}
            </TrackSection>
          )}
          {data.swing.removed.length > 0 && (
            <TrackSection
              label="Removed tracks"
              count={data.swing.removed.length}
            >
              {data.swing.removed.map((t) => (
                <TrackListItem key={t.isrc} track={t} />
              ))}
            </TrackSection>
          )}
        </div>
      );

    case "tracks_missing_enrichment":
      return Array.isArray(data.tracks) && data.tracks.length > 0 ? (
        <TrackSection label="Missing Enrichment" count={data.tracks.length}>
          {data.tracks.map((t) => (
            <TrackListItem
              key={t.isrc}
              track={t}
              thumbOverrides={thumbByIsrc}
            />
          ))}
        </TrackSection>
      ) : (
        <FallbackNote note={data.note} />
      );

    case "catalog_missing_stream_snapshots":
      return Array.isArray(data.tracks) && data.tracks.length > 0 ? (
        <TrackSection
          label="Missing catalog stream snapshots"
          count={data.tracks.length}
        >
          {data.tracks.map((t) => (
            <TrackListItem
              key={t.isrc}
              track={t}
              thumbOverrides={thumbByIsrc}
              actions={
                runDate ? (
                  <QuickOverrideButton
                    isrc={t.isrc.trim().toUpperCase()}
                    date={runDate}
                  />
                ) : undefined
              }
            />
          ))}
        </TrackSection>
      ) : (
        <FallbackNote note={data.note} />
      );

    case "catalog_streams_missing_prev_nonzero":
      return Array.isArray(data.tracks) && data.tracks.length > 0 ? (
        <TrackSection
          label="Missing stream totals with prior non-zero"
          count={data.tracks.length}
        >
          {(data.tracks as PrevNonzeroTrack[]).map((t) => (
            <TrackListItem
              key={t.isrc}
              track={t}
              thumbOverrides={thumbByIsrc}
              inlineExtra={
                typeof t.prev_streams_cumulative === "number" &&
                Number.isFinite(t.prev_streams_cumulative) ? (
                  <span className="opacity-60">
                    · prev:{" "}
                    <span className="font-mono">
                      {t.prev_streams_cumulative.toLocaleString()}
                    </span>
                  </span>
                ) : undefined
              }
              actions={
                runDate ? (
                  <QuickOverrideButton
                    isrc={t.isrc.trim().toUpperCase()}
                    date={runDate}
                  />
                ) : undefined
              }
            />
          ))}
        </TrackSection>
      ) : (
        <FallbackNote note={data.note} />
      );

    case "individual_tracks_stale":
      return Array.isArray(data.tracks) && data.tracks.length > 0 ? (
        runDate ? (
          <StaleTrackResolver
            tracks={data.tracks as StaleTrack[]}
            thumbOverrides={thumbByIsrc}
            runDate={runDate}
          />
        ) : (
          <TrackSection
            label="Tracks with stale streams"
            count={data.tracks.length}
          >
            {(data.tracks as StaleTrack[]).map((t) => {
              const cumulative =
                typeof t.streams_cumulative === "number" &&
                Number.isFinite(t.streams_cumulative)
                  ? t.streams_cumulative
                  : null;
              return (
                <TrackListItem
                  key={t.isrc}
                  track={t}
                  thumbOverrides={thumbByIsrc}
                  inlineExtra={
                    <>
                      {cumulative !== null && (
                        <span className="opacity-60">
                          · total:{" "}
                          <span className="font-mono">
                            {cumulative.toLocaleString()}
                          </span>
                        </span>
                      )}
                      {typeof t.avg_daily_7d === "number" &&
                        Number.isFinite(t.avg_daily_7d) && (
                          <span className="opacity-60">
                            · avg/day:{" "}
                            <span className="font-mono">
                              {t.avg_daily_7d.toLocaleString(undefined, {
                                maximumFractionDigits: 1,
                              })}
                            </span>
                          </span>
                        )}
                    </>
                  }
                />
              );
            })}
          </TrackSection>
        )
      ) : (
        <FallbackNote note={data.note} />
      );

    case "excluded_track_streams_zeroed":
      return Array.isArray(data.tracks) && data.tracks.length > 0 ? (
        <TrackSection
          label="Excluded tracks with streams zeroed"
          count={data.tracks.length}
        >
          {(data.tracks as ExcludedZeroedTrack[]).map((t) => (
            <TrackListItem
              key={t.isrc}
              track={t}
              thumbOverrides={thumbByIsrc}
              inlineExtra={
                typeof t.prev_streams === "number" &&
                Number.isFinite(t.prev_streams) ? (
                  <span className="opacity-60">
                    · prev:{" "}
                    <span className="font-mono">
                      {t.prev_streams.toLocaleString()}
                    </span>
                  </span>
                ) : undefined
              }
            />
          ))}
        </TrackSection>
      ) : (
        <FallbackNote note={data.note} />
      );

    case "total_streams_decreased": {
      const hasDecreased = Array.isArray(data.tracks) && data.tracks.length > 0;
      const hasRemoved = Array.isArray(data.removedTracks) && data.removedTracks.length > 0;

      if (!hasDecreased && !hasRemoved) {
        return <FallbackNote note={data.note} />;
      }

      return (
        <div className="space-y-5">
          {/* Removed tracks section */}
          {hasRemoved && (
            <div>
              <div className="text-xs font-medium opacity-70 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-orange-500/20 text-orange-700 dark:bg-orange-500/30 dark:text-orange-300">
                  Removed
                </span>
                <span>
                  Tracks removed from playlist ({data.removedTracks!.length})
                  {data.removedStreamsTotal > 0 && (
                    <> — lost {data.removedStreamsTotal.toLocaleString()} cumulative streams</>
                  )}
                  :
                </span>
              </div>
              <div className="space-y-1">
                {(data.removedTracks as RemovedTrack[]).map((t) => {
                  const prev =
                    typeof t.prev_streams === "number" && Number.isFinite(t.prev_streams)
                      ? t.prev_streams
                      : null;
                  return (
                    <TrackListItem
                      key={t.isrc}
                      track={t}
                      compact
                      className="rounded-lg px-2.5 py-2"
                      style={{ backgroundColor: "var(--sb-surface)" }}
                      trailing={
                        prev !== null ? (
                          <div className="flex-shrink-0 ml-2 flex items-center gap-1.5 text-[10px] font-mono">
                            <span className="px-2 py-1 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
                              −{prev.toLocaleString()} streams
                            </span>
                          </div>
                        ) : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Decreased tracks section */}
          {hasDecreased && (
            <div>
              <div className="text-xs font-medium opacity-70 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300">
                  Decreased
                </span>
                <span>
                  Tracks with decreased streams ({data.tracks!.length}):
                </span>
              </div>
              <div className="space-y-1">
                {(data.tracks as DecreasedTrack[]).map((t) => {
                  const prev =
                    typeof t.prev_streams === "number" && Number.isFinite(t.prev_streams)
                      ? t.prev_streams
                      : null;
                  const today =
                    typeof t.today_streams === "number" && Number.isFinite(t.today_streams)
                      ? t.today_streams
                      : null;
                  const delta =
                    typeof t.delta === "number" && Number.isFinite(t.delta)
                      ? t.delta
                      : null;
                  return (
                    <TrackListItem
                      key={t.isrc}
                      track={t}
                      compact
                      className="rounded-lg px-2.5 py-2"
                      style={{ backgroundColor: "var(--sb-surface)" }}
                      trailing={
                        <div className="flex-shrink-0 ml-2 flex items-center gap-2 text-[10px] font-mono">
                          {prev !== null && today !== null && (
                            <span className="opacity-70">
                              {prev.toLocaleString()} → {today.toLocaleString()}
                            </span>
                          )}
                          {delta !== null && (
                            <span className="px-2 py-1 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-medium">
                              {delta.toLocaleString()}
                            </span>
                          )}
                        </div>
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}

          {data.note && (
            <div className="text-xs opacity-60 p-2 rounded bg-white/30 dark:bg-white/5">
              {data.note}
            </div>
          )}
        </div>
      );
    }

    case "entity_distro_drift":
      return (
        <div className="space-y-5">
          {data.drift.extra.length > 0 && (
            <div>
              <div className="text-xs font-medium opacity-70 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-orange-500/20 text-orange-700 dark:bg-orange-500/30 dark:text-orange-300">
                  Extra in Distro
                </span>
                <span>
                  Tracks in Distro playlists but NOT in Entity (
                  {data.drift.extra.length}):
                </span>
              </div>
              <div className="space-y-1">
                {data.drift.extra.map((t) => (
                  <TrackListItem
                    key={t.isrc}
                    track={t}
                    compact
                    className="rounded-lg px-2.5 py-2"
                    style={{ backgroundColor: "var(--sb-surface)" }}
                    trailing={
                      t.source_playlist_key ? (
                        <div className="flex-shrink-0 ml-2">
                          <DriftPlaylistChip
                            playlistKey={t.source_playlist_key}
                            meta={
                              allPlaylistMeta?.[t.source_playlist_key]
                            }
                            label="via"
                          />
                        </div>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
          {data.drift.missing.length > 0 && (
            <div>
              <div className="text-xs font-medium opacity-70 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-blue-500/20 text-blue-700 dark:bg-blue-500/30 dark:text-blue-300">
                  Missing from Distro
                </span>
                <span>
                  Tracks in Entity but NOT in any Distro playlist (
                  {data.drift.missing.length}):
                </span>
              </div>
              <div className="space-y-1">
                {data.drift.missing.map((t) => (
                  <TrackListItem
                    key={t.isrc}
                    track={t}
                    compact
                    className="rounded-lg px-2.5 py-2"
                    style={{ backgroundColor: "var(--sb-surface)" }}
                    trailing={
                      playlistKey ? (
                        <div className="flex-shrink-0 ml-2">
                          <DriftPlaylistChip
                            playlistKey={playlistKey}
                            meta={allPlaylistMeta?.[playlistKey]}
                            label="in"
                          />
                        </div>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      );

    case "distro_overlap":
      return Array.isArray(data.tracks) && data.tracks.length > 0 ? (
        <div>
          <div className="text-xs font-medium opacity-70 mb-3 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-orange-500/20 text-orange-700 dark:bg-orange-500/30 dark:text-orange-300">
              Overlap
            </span>
            <span>
              Tracks active in 2+ Distro playlists ({data.tracks.length}):
            </span>
          </div>
          <div className="space-y-1">
            {(data.tracks as OverlapTrack[]).map((t) => (
              <TrackListItem
                key={t.isrc}
                track={t}
                compact
                align="start"
                className="rounded-lg px-2.5 py-2"
                style={{ backgroundColor: "var(--sb-surface)" }}
                trailing={
                  <div className="flex flex-wrap gap-1 flex-shrink-0 ml-2">
                    {t.distro_playlist_keys.map((pk) => (
                      <DriftPlaylistChip
                        key={pk}
                        playlistKey={pk}
                        meta={allPlaylistMeta?.[pk]}
                        label="in"
                      />
                    ))}
                  </div>
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <FallbackNote note={data.note} />
      );

    case "negative_daily_streams":
      return Array.isArray(data.tracks) && data.tracks.length > 0 ? (
        <div className="space-y-3">
          <div className="text-xs font-medium opacity-70 mb-3 flex items-center gap-2">
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-red-500/20 text-red-700 dark:bg-red-500/30 dark:text-red-300">
              Negative Deltas
            </span>
            <span>
              Tracks with stream corrections ({data.tracks.length}):
            </span>
          </div>
          <div className="space-y-1">
            {(data.tracks as NegativeDailyStreamTrack[]).map((t) => {
              const delta =
                typeof t.daily_streams_delta === "number" &&
                Number.isFinite(t.daily_streams_delta)
                  ? t.daily_streams_delta
                  : null;
              return (
                <TrackListItem
                  key={`${t.isrc}-negative`}
                  track={t}
                  compact
                  className="rounded-lg px-2.5 py-2"
                  style={{ backgroundColor: "var(--sb-surface)" }}
                  trailing={
                    delta !== null && (
                      <div className="flex-shrink-0 ml-2 text-[10px] font-mono font-medium px-2 py-1 rounded bg-red-500/20 text-red-600 dark:bg-red-500/30 dark:text-red-300">
                        {delta.toLocaleString()}
                      </div>
                    )
                  }
                />
              );
            })}
          </div>
          {data.note && (
            <div className="text-xs opacity-60 p-2 rounded bg-white/30 dark:bg-white/5">
              {data.note}
            </div>
          )}
        </div>
      ) : (
        <FallbackNote note={data.note} />
      );
  }
}

// ---------------------------------------------------------------------------
// Small sub-components
// ---------------------------------------------------------------------------

function TrackSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium opacity-70 mb-2">
        {label} ({count}):
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FallbackNote({ note }: { note?: string }) {
  return (
    <div className="text-xs opacity-60 space-y-1.5">
      <p className="mb-1">Track-level details not loaded. Possible causes:</p>
      <ul className="list-disc list-inside space-y-1 ml-1">
        <li>Details may not be available in the warning record</li>
        <li>Track metadata might be loading (check again after next ingestion run)</li>
        <li>The warning might be resolved in the latest data</li>
      </ul>
      {note && (
        <div className="mt-2 pt-2 border-t border-white/10">
          <p className="font-medium">Info: {note}</p>
        </div>
      )}
    </div>
  );
}
