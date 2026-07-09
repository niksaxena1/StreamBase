"use client";

import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { Calendar, Search, X } from "lucide-react";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";

import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { Alert } from "@/components/ui/Alert";
import { TrackStreamsXYChart, type TrackStreamsXYPoint } from "@/components/charts/TrackStreamsXYChart";
import { ArtistStreamsXYChart, aggregateTracksToArtists } from "@/components/charts/ArtistStreamsXYChart";
import { getStreamSeriesColor, useThemeColors } from "@/components/charts/useThemeColors";
import { fetchApiJson } from "@/lib/api";
import { foldForSearch } from "@/lib/searchFold";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { todayIsoDate } from "@/lib/csv";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { HOME_DETAILS_STORAGE } from "./homeUtils";

export function HomeScatterSection(props: {
  trackScatterPoints: TrackStreamsXYPoint[];
  trackScatterErrorMessage?: string | null;
  trackScatterLoading?: boolean;
  onRequestScatterData?: () => void;
  insufficientHistory?: boolean;
  datasetMode?: "own" | "competitor";
}) {
  const { onRequestScatterData } = props;
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const themeColors = useThemeColors();
  const scatterSeriesColor = getStreamSeriesColor(themeColors, {
    datasetMode: props.datasetMode,
    isRevenue: metric === "revenue",
  });

  const [openScatter, setOpenScatter] = useState(false);
  const [scatterQuery, setScatterQuery] = useState("");
  // Debounce the search query: only commit to expensive filtering after 150ms pause.
  const [debouncedScatterQuery, setDebouncedScatterQuery] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredScatterQuery = useDeferredValue(debouncedScatterQuery);

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedScatterQuery(scatterQuery), 150);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [scatterQuery]);
  const [scatterFocusIsrc, setScatterFocusIsrc] = useState<string | null>(null);
  const [scatterFocusArtistId, setScatterFocusArtistId] = useState<string | null>(null);
  const [scatterSearchFocused, setScatterSearchFocused] = useState(false);
  const [scatterLogScale, setScatterLogScale] = useState(false);
  const [scatterReleaseCohorts, setScatterReleaseCohorts] = useState(() =>
    readStoredBool(HOME_DETAILS_STORAGE.scatterReleaseCohorts, false),
  );
  const [scatterView, setScatterView] = useState<"tracks" | "artists">("tracks");
  const [scatterArtistImagesById, setScatterArtistImagesById] = useState<Map<string, string | null> | null>(null);

  // Restore persisted open state
  useEffect(() => {
    const restored = readStoredBool(HOME_DETAILS_STORAGE.scatterOpen, false);
    if (restored) {
      setOpenScatter(true);
      onRequestScatterData?.();
    }
  }, [onRequestScatterData]);

  // Persist open state
  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.scatterOpen, openScatter);
  }, [openScatter]);

  useEffect(() => {
    writeStoredBool(HOME_DETAILS_STORAGE.scatterReleaseCohorts, scatterReleaseCohorts);
  }, [scatterReleaseCohorts]);

  // Load artist images for artist scatter view
  useEffect(() => {
    if (!openScatter) return;
    if (scatterView !== "artists") return;
    if (scatterArtistImagesById) return;

    let cancelled = false;
    async function load() {
      try {
        const json = await fetchApiJson<{ artists?: Array<{ artist_id?: string; image_url?: string | null }> }>(
          "/api/artists/options",
        );
        const rows = Array.isArray(json.artists) ? json.artists : [];
        const map = new Map<string, string | null>();
        for (const r of rows) {
          const id = String(r?.artist_id ?? "");
          if (!id) continue;
          map.set(id, (r?.image_url ?? null) as string | null);
        }
        if (!cancelled) setScatterArtistImagesById(map);
      } catch {
        // ignore
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [openScatter, scatterArtistImagesById, scatterView]);

  const scatterMode = metric === "revenue" ? "revenue" : "streams";
  const scatterTitle =
    scatterView === "artists"
      ? scatterMode === "revenue"
        ? "Artists: Total vs Daily Revenue"
        : "Artists: Total vs Daily Streams"
      : scatterMode === "revenue"
        ? "Tracks: Total vs Daily Revenue"
        : "Tracks: Total vs Daily Streams";

  // Aggregate tracks to artists for artist view
  const artistScatterPoints = useMemo(() => {
    if (scatterView !== "artists") return [];
    return aggregateTracksToArtists(props.trackScatterPoints ?? [], scatterArtistImagesById);
  }, [props.trackScatterPoints, scatterArtistImagesById, scatterView]);

  // Track search matches
  const scatterTrackMatches = useMemo(() => {
    if (scatterView !== "tracks") return [];
    const q = foldForSearch(deferredScatterQuery ?? "");
    if (!q) return [];

    const looksLikeIsrc = /^[a-z0-9]{6,}$/.test(q);
    if (!looksLikeIsrc && q.length < 2) return [];

    const out: Array<{ isrc: string; name: string; artists: string; imageUrl: string | null; score: number }> = [];
    for (const p of props.trackScatterPoints ?? []) {
      if (!p?.isrc) continue;
      const isrc = String(p.isrc);
      const isrcL = foldForSearch(isrc);
      const title = String(p.name ?? "").trim();
      const titleL = foldForSearch(title);
      const artistsArr = p.artist_names ?? [];
      const artists = (artistsArr ?? []).filter(Boolean).join(", ");
      const artistsL = foldForSearch(artists);
      const imageUrl = p.album_image_url ?? null;

      let score = Infinity;
      if (isrcL === q) score = 0;
      else if (isrcL.startsWith(q)) score = 1;
      else if (titleL === q) score = 2;
      else if (titleL.startsWith(q)) score = 3;
      else if (titleL.includes(q)) score = 4;
      else if (artistsL.includes(q)) score = 5;
      else continue;

      out.push({ isrc, name: title || isrc, artists, imageUrl, score });
      if (out.length > 50) break;
    }

    out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return out.slice(0, 8);
  }, [deferredScatterQuery, props.trackScatterPoints, scatterView]);

  // Artist search matches
  const scatterArtistMatches = useMemo(() => {
    if (scatterView !== "artists") return [];
    const q = foldForSearch(deferredScatterQuery ?? "");
    if (!q || q.length < 2) return [];

    const out: Array<{ artistId: string; name: string; trackCount: number; score: number }> = [];
    for (const a of artistScatterPoints) {
      const nameL = foldForSearch(a.artist_name);

      let score = Infinity;
      if (nameL === q) score = 0;
      else if (nameL.startsWith(q)) score = 1;
      else if (nameL.includes(q)) score = 2;
      else continue;

      out.push({ artistId: a.artist_id, name: a.artist_name, trackCount: a.track_count, score });
      if (out.length > 50) break;
    }

    out.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return out.slice(0, 8);
  }, [deferredScatterQuery, artistScatterPoints, scatterView]);

  const showScatterDropdown =
    scatterSearchFocused &&
    !scatterFocusIsrc &&
    !scatterFocusArtistId &&
    (scatterQuery ?? "").trim().length > 0 &&
    (scatterTrackMatches.length > 0 || scatterArtistMatches.length > 0);

  return (
    <details
      open={openScatter}
      onToggle={(ev) => {
        const nextOpen = ev.currentTarget.open;
        setOpenScatter(nextOpen);
        if (nextOpen) onRequestScatterData?.();
      }}
      className="rounded-xl border sb-panel p-3"
      style={{ borderColor: "var(--sb-border)" }}
    >
      <summary className="cursor-pointer select-none">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
            <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">
              {scatterTitle}
            </div>
          </div>
          {openScatter ? (
            <div
              className="flex flex-wrap items-center justify-end gap-2"
              onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}
            >
              <div
                className="text-[11px] opacity-60"
                title={
                  scatterMode === "revenue"
                    ? "X = cumulative revenue, Y = daily revenue change"
                    : "X = cumulative streams, Y = daily streams change"
                }
              >
                {scatterMode === "revenue"
                  ? "X: total revenue • Y: daily revenue"
                  : "X: total streams • Y: daily streams"}
              </div>
              {/* Tracks / Artists toggle */}
              <div className="flex items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                <button
                  type="button"
                  onClick={() => {
                    setScatterView("tracks");
                    setScatterFocusIsrc(null);
                    setScatterFocusArtistId(null);
                    setScatterQuery("");
                  }}
                  className={[
                    "rounded-full px-2 py-1 text-[11px] font-medium transition",
                    scatterView === "tracks"
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20",
                  ].join(" ")}
                >
                  Tracks
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScatterView("artists");
                    setScatterFocusIsrc(null);
                    setScatterFocusArtistId(null);
                    setScatterQuery("");
                  }}
                  className={[
                    "rounded-full px-2 py-1 text-[11px] font-medium transition",
                    scatterView === "artists"
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-black/70 hover:bg-white/50 dark:text-white/70 dark:hover:bg-white/20",
                  ].join(" ")}
                >
                  Artists
                </button>
              </div>
              <button
                type="button"
                onClick={() => setScatterLogScale((v) => !v)}
                className={[
                  "rounded-full px-2 py-1 text-[11px] font-medium transition",
                  scatterLogScale
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
                ].join(" ")}
                title={scatterLogScale ? "Switch to linear scale" : "Switch to log scale"}
              >
                {scatterLogScale ? "Log" : "Linear"}
              </button>
              {scatterView === "tracks" && scatterLogScale ? (
                <button
                  type="button"
                  onClick={() => setScatterReleaseCohorts((v) => !v)}
                  className={[
                    "inline-flex h-7 w-7 items-center justify-center rounded-full transition",
                    scatterReleaseCohorts
                      ? "bg-black text-white dark:bg-white dark:text-black"
                      : "text-black/70 hover:bg-white/70 dark:text-white/70 dark:hover:bg-white/20",
                  ].join(" ")}
                  title={
                    scatterReleaseCohorts
                      ? "Hide soft release-week clusters (log only). Each week gets its own hue; hover a blob for the week and track count."
                      : "Show soft release-week clusters (log only). Each week gets its own hue; hover a blob for the week and track count."
                  }
                  aria-label={scatterReleaseCohorts ? "Hide release cohort highlights" : "Show release cohort highlights"}
                  aria-pressed={scatterReleaseCohorts}
                >
                  <Calendar className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              ) : null}
              <ChartCsvDownloadButton
                filename={`home-scatter-${scatterView}-${todayIsoDate()}.csv`}
                rows={
                  scatterView === "tracks"
                    ? (props.trackScatterPoints ?? []).map((p) => ({
                        name: p.name,
                        isrc: p.isrc,
                        artists: (p.artist_names ?? []).join(", "),
                        release_date: p.release_date,
                        total_streams_cumulative: p.total_streams_cumulative,
                        daily_streams_delta: p.daily_streams_delta,
                      }))
                    : artistScatterPoints.map((p) => ({
                        artist_name: p.artist_name,
                        artist_id: p.artist_id,
                        track_count: p.track_count,
                        total_streams_cumulative: p.total_streams_cumulative,
                        daily_streams_delta: p.daily_streams_delta,
                      }))
                }
                title="Download scatter data CSV"
              />
            </div>
          ) : null}
        </div>
      </summary>

      <div className="mt-3">
        {props.trackScatterErrorMessage ? (
          <Alert variant="error" title="Track scatter query error">
            {props.trackScatterErrorMessage}
          </Alert>
        ) : null}

        {/* Search (focus mode) */}
        <div className="mb-3">
          <div className="relative">
            <div
              className="sb-ring flex items-center gap-2 rounded-lg bg-white/60 px-3 py-2 dark:bg-white/10"
              style={{ borderColor: "var(--sb-border)" }}
            >
              <Search className="h-4 w-4 opacity-60" style={{ color: "var(--sb-muted)" }} />
              <input
                value={scatterQuery}
                onChange={(e) => setScatterQuery(e.target.value)}
                onFocus={() => {
                  setScatterSearchFocused(true);
                  if (scatterFocusIsrc || scatterFocusArtistId) {
                    setScatterFocusIsrc(null);
                    setScatterFocusArtistId(null);
                    setScatterQuery("");
                  }
                }}
                onBlur={() => setScatterSearchFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (scatterView === "tracks") {
                      const first = scatterTrackMatches[0];
                      if (first?.isrc) {
                        setScatterFocusIsrc(first.isrc);
                        setScatterQuery(first.name || first.isrc);
                        setScatterSearchFocused(false);
                      }
                    } else {
                      const first = scatterArtistMatches[0];
                      if (first?.artistId) {
                        setScatterFocusArtistId(first.artistId);
                        setScatterQuery(first.name);
                        setScatterSearchFocused(false);
                      }
                    }
                  }
                  if (e.key === "Escape") {
                    setScatterFocusIsrc(null);
                    setScatterFocusArtistId(null);
                    setScatterQuery("");
                    setScatterSearchFocused(false);
                  }
                }}
                placeholder={scatterView === "tracks" ? "Search track (title, artist, ISRC)…" : "Search artist…"}
                className="w-full bg-transparent text-xs outline-none placeholder:opacity-60"
                style={{ color: "var(--sb-text)" }}
              />
              {(scatterQuery || scatterFocusIsrc || scatterFocusArtistId) ? (
                <button
                  type="button"
                  className="rounded p-1 transition hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    setScatterFocusIsrc(null);
                    setScatterFocusArtistId(null);
                    setScatterQuery("");
                  }}
                  title="Clear"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" style={{ color: "var(--sb-muted)" }} />
                </button>
              ) : null}
            </div>

            {showScatterDropdown ? (
              <div
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-lg border bg-white/90 shadow-lg backdrop-blur dark:bg-black/60"
                style={{ borderColor: "var(--sb-border)" }}
              >
                {scatterView === "tracks" ? (
                  scatterTrackMatches.map((m) => (
                    <button
                      key={m.isrc}
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setScatterFocusIsrc(m.isrc);
                        setScatterQuery(m.name || m.isrc);
                        setScatterSearchFocused(false);
                      }}
                    >
                      {m.imageUrl ? (
                        <PreviewableArtwork
                          src={m.imageUrl}
                          alt={m.name ?? m.isrc}
                          width={32}
                          height={32}
                          interactive="inline"
                          className="mt-0.5 h-8 w-8 rounded-md object-cover sb-ring"
                        />
                      ) : (
                        <div className="mt-0.5 h-8 w-8 rounded-md sb-ring bg-white/60 dark:bg-white/10" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" style={{ color: "var(--sb-text)" }}>
                          {m.name}
                        </div>
                        {m.artists ? (
                          <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                            {m.artists}
                          </div>
                        ) : null}
                      </div>
                      <CopyableIsrc
                        inline
                        isrc={m.isrc}
                        className="shrink-0 font-mono text-[11px] opacity-60"
                        style={{ color: "var(--sb-muted)" }}
                      />
                    </button>
                  ))
                ) : (
                  scatterArtistMatches.map((m) => (
                    <button
                      key={m.artistId}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setScatterFocusArtistId(m.artistId);
                        setScatterQuery(m.name);
                        setScatterSearchFocused(false);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium" style={{ color: "var(--sb-text)" }}>
                          {m.name}
                        </div>
                        <div className="truncate text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
                          {m.trackCount} track{m.trackCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {scatterFocusIsrc ? (
            <div className="mt-2 text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
              Focus mode: showing <span className="font-mono">{scatterFocusIsrc}</span>
            </div>
          ) : null}
          {scatterFocusArtistId ? (
            <div className="mt-2 text-[11px] opacity-70" style={{ color: "var(--sb-muted)" }}>
              Focus mode: showing artist
            </div>
          ) : null}
        </div>

        {/* Tracks chart */}
        {scatterView === "tracks" ? (
          props.trackScatterPoints?.length ? (
            <TrackStreamsXYChart
              points={props.trackScatterPoints}
              mode={scatterMode}
              payoutPerStreamUsd={streamPayoutPerStreamUsd}
              color={scatterSeriesColor}
              focusIsrc={scatterFocusIsrc}
              logScale={scatterLogScale}
              showReleaseCohorts={scatterReleaseCohorts && scatterLogScale}
              topNDelta={scatterLogScale ? 750 : 100}
              topNCumulative={scatterLogScale ? 750 : 100}
              sampleN={scatterLogScale ? 0 : 80}
              onClearFocus={() => {
                setScatterFocusIsrc(null);
                setScatterQuery("");
                setScatterSearchFocused(false);
              }}
            />
          ) : (
            <div className="py-10 text-center text-xs" style={{ color: "var(--sb-muted)" }}>
              {props.trackScatterLoading
                ? "Loading track points..."
                : props.insufficientHistory
                ? "Track points will appear once at least one competitor track snapshot is available."
                : "No track points available yet."}
            </div>
          )
        ) : null}

        {/* Artists chart */}
        {scatterView === "artists" ? (
          artistScatterPoints.length ? (
            <ArtistStreamsXYChart
              points={artistScatterPoints}
              mode={scatterMode}
              payoutPerStreamUsd={streamPayoutPerStreamUsd}
              color={scatterSeriesColor}
              focusArtistId={scatterFocusArtistId}
              logScale={scatterLogScale}
              topNDelta={scatterLogScale ? 300 : 100}
              topNCumulative={scatterLogScale ? 300 : 100}
              sampleN={scatterLogScale ? 0 : 80}
              onClearFocus={() => {
                setScatterFocusArtistId(null);
                setScatterQuery("");
                setScatterSearchFocused(false);
              }}
            />
          ) : (
            <div className="py-10 text-center text-xs" style={{ color: "var(--sb-muted)" }}>
              {props.trackScatterLoading ? "Loading artist points..." : "No artist points available yet."}
            </div>
          )
        ) : null}
      </div>
    </details>
  );
}
