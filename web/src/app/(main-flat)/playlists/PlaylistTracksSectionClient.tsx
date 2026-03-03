"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Download } from "lucide-react";

import { formatDateISO, formatInt, formatUsd } from "@/lib/format";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { ArtistLinks } from "@/components/ui/ArtistLinks";
import { useMetric } from "@/components/metrics/MetricContext";
import { usePayoutRate } from "@/components/payout/PayoutRateContext";
import { downloadCsv, slugifyForFilename, todayIsoDate } from "@/lib/csv";
import { readStoredBool, writeStoredBool } from "@/lib/storage";
import { useLongPress } from "@/components/charts/useLongPress";

const PLAYLIST_TRACKS_STORAGE = {
  artistsOpen: "sb:playlists:details:artists_open",
} as const;

type PlaylistTopTrackRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  total: number | null;
  daily: number | null;
  release_date?: string | null;
};

type PlaylistAddedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  release_date?: string | null;
};

type PlaylistRemovedRow = {
  isrc: string;
  name: string | null;
  album_image_url: string | null;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  valid_from: string;
  valid_to: string | null;
  release_date?: string | null;
};

type DebugCounts = {
  totalRows: number | null;
  nullValidToRows: number | null;
  activeAtRunDateRows: number | null;
  maxValidFrom: string | null;
  minValidFrom: string | null;
};

function fmtDelta(args: { mode: "streams" | "revenue"; value: number; streamPayoutPerStreamUsd: number }) {
  if (args.mode === "revenue") return formatUsd(args.value * args.streamPayoutPerStreamUsd);
  return formatInt(args.value);
}

function fmtTotal(args: { mode: "streams" | "revenue"; value: number; streamPayoutPerStreamUsd: number }) {
  if (args.mode === "revenue") return formatUsd(args.value * args.streamPayoutPerStreamUsd);
  return formatInt(args.value);
}

export function PlaylistTracksSectionClient(props: {
  playlistKey: string;
  latestRunDate: string | null;
  currentRows: PlaylistTopTrackRow[];
  addedLast7Days: PlaylistAddedRow[];
  removed: PlaylistRemovedRow[];
  topErrMessage: string | null;
  addedErrMessage: string | null;
  removedErrMessage: string | null;
  debug: DebugCounts | null;
}) {
  const { metric } = useMetric();
  const { streamPayoutPerStreamUsd } = usePayoutRate();
  const hasStatsDate = !!props.latestRunDate;

  // Track-level tables only make sense for streams/revenue; treat "tracks" as streams.
  const mode: "streams" | "revenue" = metric === "revenue" ? "revenue" : "streams";
  const dailyLabel = mode === "revenue" ? "Daily revenue" : "Daily streams";
  const totalLabel = mode === "revenue" ? "Total revenue" : "Total streams";

  // Match global metric coloring used across the app.
  // This table treats "tracks" as streams, so it uses the streams color for both.
  const numberStyle =
    metric === "revenue"
      ? ({ color: "#10b981" } as const) // emerald-500
      : ({ color: "var(--sb-accent-stroke)" } as const);

  // On mobile, the "Added" column is hidden. Long-pressing the "Release"
  // header toggles between showing release date and added date.
  const [showAddedOnMobile, setShowAddedOnMobile] = useState(false);
  const longPressFiredRef = useRef(false);

  const toggleDateColumn = useCallback(() => {
    setShowAddedOnMobile((prev) => !prev);
    longPressFiredRef.current = true;
  }, []);

  const {
    onPointerDown: releaseLpDown,
    onPointerMove: releaseLpMove,
    onPointerUp: releaseLpUp,
    onPointerCancel: releaseLpCancel,
  } = useLongPress({ onLongPress: toggleDateColumn });

  const [artistsOpen, setArtistsOpen] = useState(true);
  const [artistImagesById, setArtistImagesById] = useState<Map<string, string | null>>(new Map());

  type SortState<K extends string> = { key: K; asc: boolean } | null;
  type CurrentSortKey = "track" | "release" | "daily" | "total" | "added";
  type AddedSortKey = "track" | "release" | "added";
  type RemovedSortKey = "track" | "release" | "removed" | "added";
  type ArtistSortKey = "artist" | "tracks" | "total" | "daily";

  const [currentSort, setCurrentSort] = useState<SortState<CurrentSortKey>>(null);
  const [addedSort, setAddedSort] = useState<SortState<AddedSortKey>>(null);
  const [removedSort, setRemovedSort] = useState<SortState<RemovedSortKey>>(null);
  const [artistSort, setArtistSort] = useState<SortState<ArtistSortKey>>(null);

  function toggleSort<K extends string>(
    setter: (next: SortState<K>) => void,
    current: SortState<K>,
    key: K,
    defaultAsc: boolean,
  ) {
    if (!current || current.key !== key) {
      setter({ key, asc: defaultAsc });
      return;
    }
    setter({ key, asc: !current.asc });
  }

  function SilentSortHeader(props: { label: React.ReactNode; onClick: () => void; align?: "left" | "right" }) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        className={[
          "w-full select-none cursor-default uppercase",
          props.align === "right" ? "text-right" : "text-left",
        ].join(" ")}
        // Intentionally no hover/active styles: hidden power-user feature.
        style={{ color: "inherit" }}
      >
        {typeof props.label === "string" ? props.label.toUpperCase() : props.label}
      </button>
    );
  }

  function cmpString(a: string, b: string) {
    return a.localeCompare(b);
  }

  function cmpNullableIso(a: string | null | undefined, b: string | null | undefined) {
    const aa = String(a ?? "").trim();
    const bb = String(b ?? "").trim();
    const aNull = !aa;
    const bNull = !bb;
    if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1; // nulls last
    return cmpString(aa, bb);
  }

  function cmpNullableNumber(a: number | null | undefined, b: number | null | undefined) {
    const av = a == null || !Number.isFinite(a) ? null : Number(a);
    const bv = b == null || !Number.isFinite(b) ? null : Number(b);
    const aNull = av == null;
    const bNull = bv == null;
    if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1; // nulls last
    return av - bv;
  }

  function cmpTrackName(a: { name: string | null; isrc: string }, b: { name: string | null; isrc: string }) {
    const aa = (String(a.name ?? "").trim() || a.isrc).toLowerCase();
    const bb = (String(b.name ?? "").trim() || b.isrc).toLowerCase();
    return cmpString(aa, bb);
  }

  useEffect(() => {
    setArtistsOpen(readStoredBool(PLAYLIST_TRACKS_STORAGE.artistsOpen, true));
  }, []);

  useEffect(() => {
    writeStoredBool(PLAYLIST_TRACKS_STORAGE.artistsOpen, artistsOpen);
  }, [artistsOpen]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/artists/options");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const rows = Array.isArray((json as any)?.artists) ? ((json as any).artists as any[]) : [];
        const map = new Map<string, string | null>();
        for (const r of rows) {
          const id = String(r?.artist_id ?? "");
          if (!id) continue;
          map.set(id, (r?.image_url ?? null) as string | null);
        }
        if (!cancelled) setArtistImagesById(map);
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const artistRows = useMemo(() => {
    type ArtistAgg = {
      artist_id: string | null;
      artist_name: string;
      tracks: number;
      value_total: number;
      value_daily: number;
    };

    const byKey = new Map<string, ArtistAgg>();

    for (const t of props.currentRows) {
      const ids = Array.isArray(t.artist_ids) ? t.artist_ids : [];
      const names = Array.isArray(t.artist_names) ? t.artist_names : [];
      const n = Math.max(ids.length, names.length);
      const totalStreams = Number(t.total ?? 0);
      const dailyStreams = Number(t.daily ?? 0);
      const totalValue = mode === "revenue" ? totalStreams * streamPayoutPerStreamUsd : totalStreams;
      const dailyValue = mode === "revenue" ? dailyStreams * streamPayoutPerStreamUsd : dailyStreams;

      for (let i = 0; i < n; i++) {
        const artist_id = (ids[i] ?? null) as string | null;
        const artist_name = String(names[i] ?? artist_id ?? "Unknown artist");
        const key = artist_id ? `id:${artist_id}` : `name:${artist_name}`;

        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, {
            artist_id,
            artist_name,
            tracks: 1,
            value_total: totalValue,
            value_daily: dailyValue,
          });
        } else {
          prev.tracks += 1;
          prev.value_total += totalValue;
          prev.value_daily += dailyValue;
        }
      }
    }

    const rows = [...byKey.values()];
    return rows;
  }, [props.currentRows, mode, streamPayoutPerStreamUsd]);

  const artistRowsSorted = useMemo(() => {
    const rows = [...artistRows];
    const state = artistSort;
    if (!state) {
      rows.sort((a, b) => b.value_total - a.value_total);
      return rows;
    }

    rows.sort((a, b) => {
      let c = 0;
      if (state.key === "artist") c = a.artist_name.localeCompare(b.artist_name);
      else if (state.key === "tracks") c = a.tracks - b.tracks;
      else if (state.key === "total") c = a.value_total - b.value_total;
      else if (state.key === "daily") c = a.value_daily - b.value_daily;
      if (c === 0) c = (a.artist_id ?? a.artist_name).localeCompare(b.artist_id ?? b.artist_name);
      return state.asc ? c : -c;
    });
    return rows;
  }, [artistRows, artistSort]);

  const currentRowsSorted = useMemo(() => {
    const rows = [...props.currentRows];
    const state = currentSort;
    if (!state) return rows;
    rows.sort((a, b) => {
      let c = 0;
      if (state.key === "track") c = cmpTrackName(a, b);
      else if (state.key === "release") c = cmpNullableIso(a.release_date, b.release_date);
      else if (state.key === "daily") c = cmpNullableNumber(a.daily, b.daily);
      else if (state.key === "total") c = cmpNullableNumber(a.total, b.total);
      else if (state.key === "added") c = cmpNullableIso(a.valid_from, b.valid_from);
      if (c === 0) c = a.isrc.localeCompare(b.isrc);
      return state.asc ? c : -c;
    });
    return rows;
  }, [props.currentRows, currentSort]);

  const addedRowsSorted = useMemo(() => {
    const rows = [...props.addedLast7Days];
    const state = addedSort;
    if (!state) return rows;
    rows.sort((a, b) => {
      let c = 0;
      if (state.key === "track") c = cmpTrackName(a, b);
      else if (state.key === "release") c = cmpNullableIso(a.release_date, b.release_date);
      else if (state.key === "added") c = cmpNullableIso(a.valid_from, b.valid_from);
      if (c === 0) c = a.isrc.localeCompare(b.isrc);
      return state.asc ? c : -c;
    });
    return rows;
  }, [props.addedLast7Days, addedSort]);

  const removedRowsSorted = useMemo(() => {
    const rows = [...props.removed];
    const state = removedSort;
    if (!state) return rows;
    rows.sort((a, b) => {
      let c = 0;
      if (state.key === "track") c = cmpTrackName(a, b);
      else if (state.key === "release") c = cmpNullableIso(a.release_date, b.release_date);
      else if (state.key === "removed") c = cmpNullableIso(a.valid_to, b.valid_to);
      else if (state.key === "added") c = cmpNullableIso(a.valid_from, b.valid_from);
      if (c === 0) c = a.isrc.localeCompare(b.isrc);
      return state.asc ? c : -c;
    });
    return rows;
  }, [props.removed, removedSort]);

  const exportArtists = () => {
    const rows = artistRows.map((a) => ({
      Artist: a.artist_name,
      ArtistId: a.artist_id ?? "",
      Tracks: a.tracks,
      [totalLabel]: a.value_total,
      [dailyLabel]: a.value_daily,
    }));

    downloadCsv({
      filename: `playlist-${slugifyForFilename(props.playlistKey)}-artists-${todayIsoDate()}.csv`,
      rows,
    });
  };

  const exportCurrentTracks = () => {
    const rows = currentRowsSorted.map((t) => {
      const daily =
        mode === "revenue"
          ? t.daily === null
            ? null
            : t.daily * streamPayoutPerStreamUsd
          : t.daily;
      const total =
        mode === "revenue"
          ? t.total === null
            ? null
            : t.total * streamPayoutPerStreamUsd
          : t.total;

      return {
        ISRC: t.isrc,
        Release: t.release_date ?? "",
        Track: t.name ?? "",
        Artists: t.artist_names ?? [],
        Added: t.valid_from,
        [dailyLabel]: daily,
        [totalLabel]: total,
      } as Record<string, unknown>;
    });

    downloadCsv({
      filename: `playlist-${slugifyForFilename(props.playlistKey)}-tracks-current-${todayIsoDate()}.csv`,
      rows,
    });
  };

  const exportAddedTracks = () => {
    const rows = addedRowsSorted.map((t) => ({
      ISRC: t.isrc,
      Release: t.release_date ?? "",
      Track: t.name ?? "",
      Artists: t.artist_names ?? [],
      Added: t.valid_from,
    }));

    downloadCsv({
      filename: `playlist-${slugifyForFilename(props.playlistKey)}-tracks-added-7d-${todayIsoDate()}.csv`,
      rows,
    });
  };

  const exportRemovedTracks = () => {
    const rows = removedRowsSorted.map((t) => ({
      ISRC: t.isrc,
      Release: t.release_date ?? "",
      Track: t.name ?? "",
      Artists: t.artist_names ?? [],
      Removed: t.valid_to ?? "",
      Added: t.valid_from,
    }));

    downloadCsv({
      filename: `playlist-${slugifyForFilename(props.playlistKey)}-tracks-removed-${todayIsoDate()}.csv`,
      rows,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-end justify-between px-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Tracks currently in playlist</h2>
              <button
                type="button"
                onClick={exportCurrentTracks}
                className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                title="Download as CSV"
                aria-label="Download as CSV"
                style={{ color: "var(--sb-muted)" }}
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {hasStatsDate && props.debug ? (
            <details
              className="rounded-xl border px-3 py-2 text-xs"
              style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
            >
              <summary className="cursor-pointer select-none">Debug: playlist_memberships snapshot</summary>
              <div className="mt-2 grid grid-cols-1 gap-1 font-mono">
                <div>playlist_key={props.playlistKey}</div>
                <div>run_date={props.latestRunDate}</div>
                <div>rows_total={props.debug.totalRows ?? "?"}</div>
                <div>rows_valid_to_null={props.debug.nullValidToRows ?? "?"}</div>
                <div>rows_active_at_run_date={props.debug.activeAtRunDateRows ?? "?"}</div>
                <div>valid_from_min={props.debug.minValidFrom ?? "?"}</div>
                <div>valid_from_max={props.debug.maxValidFrom ?? "?"}</div>
              </div>
            </details>
          ) : null}
          <GlassTable
            headers={[
              "",
              {
                label: (
                  <SilentSortHeader
                    label="Track"
                    onClick={() => toggleSort(setCurrentSort, currentSort, "track", true)}
                  />
                ),
              },
              {
                label: (
                  <div
                    onPointerDown={releaseLpDown}
                    onPointerMove={releaseLpMove}
                    onPointerUp={releaseLpUp}
                    onPointerCancel={releaseLpCancel}
                  >
                    <SilentSortHeader
                      label={
                        <>
                          <span className="sm:hidden">{showAddedOnMobile ? "Added" : "Release"}</span>
                          <span className="hidden sm:inline">Release</span>
                        </>
                      }
                      onClick={() => {
                        if (longPressFiredRef.current) {
                          longPressFiredRef.current = false;
                          return;
                        }
                        toggleSort(setCurrentSort, currentSort, showAddedOnMobile ? "added" : "release", false);
                      }}
                    />
                  </div>
                ),
              },
              {
                label: (
                  <SilentSortHeader
                    label={dailyLabel}
                    onClick={() => toggleSort(setCurrentSort, currentSort, "daily", false)}
                    align="right"
                  />
                ),
                align: "right",
              },
              {
                label: (
                  <SilentSortHeader
                    label={totalLabel}
                    onClick={() => toggleSort(setCurrentSort, currentSort, "total", false)}
                    align="right"
                  />
                ),
                align: "right",
              },
              {
                label: (
                  <SilentSortHeader
                    label="Added"
                    onClick={() => toggleSort(setCurrentSort, currentSort, "added", false)}
                    align="right"
                  />
                ),
                align: "right",
                className: "hidden sm:table-cell",
              },
            ]}
          >
            {!hasStatsDate ? (
              <EmptyState colSpan={6} message="No stats date available yet" />
            ) : props.topErrMessage ? (
              <EmptyState colSpan={6} message={`Error loading current tracks: ${props.topErrMessage}`} />
            ) : null}
            {currentRowsSorted.map((t) => (
              <TableRow key={t.isrc}>
                <TableCell className="w-10 min-w-[40px]">
                  {t.album_image_url ? (
                    <Image src={t.album_image_url} alt="Album cover" width={32} height={32} className="h-8 w-8 rounded-lg object-cover sb-ring" />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                  )}
                </TableCell>
                <TableCell>
                  <Link href={`/tracks/${t.isrc}`} className="font-medium transition-colors sb-link-hover">
                    {t.name ?? t.isrc}
                  </Link>
                  {t.artist_names?.length ? (
                    <div className="mt-0.5 text-xs opacity-60">
                      <ArtistLinks artistNames={t.artist_names} artistIds={t.artist_ids ?? undefined} />
                    </div>
                  ) : null}
                </TableCell>
                <TableCell mono className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  {showAddedOnMobile ? formatDateISO(t.valid_from) : formatDateISO(t.release_date)}
                </TableCell>
                <TableCell className="font-medium" style={numberStyle}>
                  {t.daily === null ? "—" : fmtDelta({ mode, value: t.daily, streamPayoutPerStreamUsd })}
                </TableCell>
                <TableCell className="font-medium" style={numberStyle}>
                  {t.total === null ? "—" : fmtTotal({ mode, value: t.total, streamPayoutPerStreamUsd })}
                </TableCell>
                <TableCell mono className="text-xs hidden sm:table-cell">{formatDateISO(t.valid_from)}</TableCell>
              </TableRow>
            ))}
            {hasStatsDate && !props.topErrMessage && !props.currentRows.length && (
              <EmptyState colSpan={6} message="No active tracks found" />
            )}
          </GlassTable>
        </div>

        <div className="flex h-full flex-col gap-3">
          <div className="space-y-3">
            <div className="flex items-end justify-between px-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Tracks added (last 7 days)</h2>
                <button
                  type="button"
                  onClick={exportAddedTracks}
                  className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  title="Download as CSV"
                  aria-label="Download as CSV"
                  style={{ color: "var(--sb-muted)" }}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Based on membership added date.
              </div>
            </div>
            <GlassTable
              headers={[
                "",
                {
                  label: (
                    <SilentSortHeader
                      label="Track"
                      onClick={() => toggleSort(setAddedSort, addedSort, "track", true)}
                    />
                  ),
                },
                {
                  label: (
                    <SilentSortHeader
                      label="Release"
                      onClick={() => toggleSort(setAddedSort, addedSort, "release", false)}
                    />
                  ),
                },
                {
                  label: (
                    <SilentSortHeader
                      label="Added"
                      onClick={() => toggleSort(setAddedSort, addedSort, "added", false)}
                      align="right"
                    />
                  ),
                  align: "right",
                },
              ]}
              maxBodyHeightClassName="max-h-[260px]"
            >
              {props.addedErrMessage ? (
                <EmptyState colSpan={4} message={`Error loading added tracks: ${props.addedErrMessage}`} />
              ) : null}
              {addedRowsSorted.map((m, idx) => (
                <TableRow key={`${m.isrc}-${m.valid_from}-${idx}`}>
                  <TableCell>
                    {m.album_image_url ? (
                      <Image
                        src={m.album_image_url}
                        alt="Album cover"
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded-lg object-cover sb-ring"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/tracks/${m.isrc}`} className="font-medium transition-colors sb-link-hover">
                      {m.name ?? m.isrc}
                    </Link>
                    {m.artist_names?.length ? (
                      <div className="mt-0.5 text-xs opacity-60">
                        <ArtistLinks artistNames={m.artist_names} artistIds={m.artist_ids ?? undefined} />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell mono className="text-xs" style={{ color: "var(--sb-muted)" }}>
                    {formatDateISO(m.release_date)}
                  </TableCell>
                  <TableCell mono className="text-xs">{formatDateISO(m.valid_from)}</TableCell>
                </TableRow>
              ))}
              {!props.addedErrMessage && !props.addedLast7Days.length && (
                <EmptyState colSpan={4} message="No tracks added in the last 7 days" />
              )}
            </GlassTable>
          </div>

          <div className="flex flex-1 flex-col gap-3">
            <div className="flex items-end justify-between px-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Tracks removed</h2>
                <button
                  type="button"
                  onClick={exportRemovedTracks}
                  className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  title="Download as CSV"
                  aria-label="Download as CSV"
                  style={{ color: "var(--sb-muted)" }}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Most recent removals first.
              </div>
            </div>
            <GlassTable
              className="flex-1"
              bodyClassName="flex-1"
              maxBodyHeightClassName="flex-1"
              headers={[
                "",
                {
                  label: (
                    <SilentSortHeader
                      label="Track"
                      onClick={() => toggleSort(setRemovedSort, removedSort, "track", true)}
                    />
                  ),
                },
                {
                  label: (
                    <SilentSortHeader
                      label="Release"
                      onClick={() => toggleSort(setRemovedSort, removedSort, "release", false)}
                    />
                  ),
                },
                {
                  label: (
                    <SilentSortHeader
                      label="Removed"
                      onClick={() => toggleSort(setRemovedSort, removedSort, "removed", false)}
                      align="right"
                    />
                  ),
                  align: "right",
                },
                {
                  label: (
                    <SilentSortHeader
                      label="Added"
                      onClick={() => toggleSort(setRemovedSort, removedSort, "added", false)}
                      align="right"
                    />
                  ),
                  align: "right",
                },
              ]}
            >
              {props.removedErrMessage ? (
                <EmptyState colSpan={5} message={`Error loading removed tracks: ${props.removedErrMessage}`} />
              ) : null}
              {removedRowsSorted.map((m, idx) => (
                <TableRow key={`${m.isrc}-${m.valid_from}-${idx}`}>
                  <TableCell>
                    {m.album_image_url ? (
                      <Image src={m.album_image_url} alt="Album cover" width={32} height={32} className="h-8 w-8 rounded-lg object-cover sb-ring" />
                    ) : (
                      <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/tracks/${m.isrc}`} className="font-medium transition-colors sb-link-hover">
                      {m.name ?? m.isrc}
                    </Link>
                    {m.artist_names?.length ? (
                      <div className="mt-0.5 text-xs opacity-60">
                        <ArtistLinks artistNames={m.artist_names} artistIds={m.artist_ids ?? undefined} />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell mono className="text-xs" style={{ color: "var(--sb-muted)" }}>
                    {formatDateISO(m.release_date)}
                  </TableCell>
                  <TableCell mono className="text-xs">{m.valid_to ? formatDateISO(m.valid_to) : "—"}</TableCell>
                  <TableCell mono className="text-xs">{formatDateISO(m.valid_from)}</TableCell>
                </TableRow>
              ))}
              {!props.removedErrMessage && !props.removed.length && (
                <EmptyState colSpan={5} message="No removed tracks found" />
              )}
            </GlassTable>
          </div>
        </div>
      </div>

      <details
        open={artistsOpen}
        onToggle={(ev) => setArtistsOpen(ev.currentTarget.open)}
        className="rounded-xl border sb-panel p-3"
        style={{ borderColor: "var(--sb-border)" }}
      >
        <summary className="cursor-pointer select-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0 text-xs opacity-60">▸</span>
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-medium uppercase tracking-wider opacity-60">Artists in playlist</div>
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    exportArtists();
                  }}
                  className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                  title="Download as CSV"
                  aria-label="Download as CSV"
                  style={{ color: "var(--sb-muted)" }}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {artistsOpen ? (
                <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  From "Tracks currently in playlist" table
                </div>
              ) : null}
            </div>
          </div>
        </summary>

        <div className="mt-3">
          <GlassTable
            headers={[
              {
                label: (
                  <SilentSortHeader
                    label="Artist"
                    onClick={() => toggleSort(setArtistSort, artistSort, "artist", true)}
                  />
                ),
              },
              {
                label: (
                  <SilentSortHeader
                    label="Tracks"
                    onClick={() => toggleSort(setArtistSort, artistSort, "tracks", false)}
                    align="right"
                  />
                ),
                align: "right",
              },
              {
                label: (
                  <SilentSortHeader
                    label={mode === "revenue" ? "Total revenue" : "Total streams"}
                    onClick={() => toggleSort(setArtistSort, artistSort, "total", false)}
                    align="right"
                  />
                ),
                align: "right",
              },
              {
                label: (
                  <SilentSortHeader
                    label={mode === "revenue" ? "Daily revenue" : "Daily streams"}
                    onClick={() => toggleSort(setArtistSort, artistSort, "daily", false)}
                    align="right"
                  />
                ),
                align: "right",
              },
            ]}
            maxBodyHeightClassName="max-h-[320px] overflow-auto"
          >
            {!hasStatsDate ? (
              <EmptyState colSpan={4} message="No stats date available yet" />
            ) : props.topErrMessage ? (
              <EmptyState colSpan={4} message={`Error loading artists: ${props.topErrMessage}`} />
            ) : null}

            {artistRowsSorted.slice(0, 60).map((a) => (
              <TableRow key={a.artist_id ?? a.artist_name}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {a.artist_id && artistImagesById.get(a.artist_id) ? (
                      <Image
                        src={artistImagesById.get(a.artist_id) ?? ""}
                        alt=""
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded-full object-cover sb-ring"
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-7 w-7 rounded-full sb-ring bg-white/60 dark:bg-white/10" />
                    )}

                    <div className="min-w-0">
                      {a.artist_id ? (
                        <Link
                          href={`/catalog?artist_id=${encodeURIComponent(a.artist_id)}`}
                          className="block truncate font-medium transition-colors sb-link-hover"
                          title={a.artist_id}
                        >
                          {a.artist_name}
                        </Link>
                      ) : (
                        <div className="truncate font-medium">{a.artist_name}</div>
                      )}
                      {a.artist_id ? (
                        <div className="mt-0.5 font-mono text-[11px] opacity-50" style={{ color: "var(--sb-muted)" }}>
                          {a.artist_id}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell numeric className="font-medium">
                  {formatInt(a.tracks)}
                </TableCell>
                <TableCell numeric className="font-medium" style={numberStyle}>
                  {mode === "revenue" ? formatUsd(a.value_total) : formatInt(a.value_total)}
                </TableCell>
                <TableCell numeric className="font-medium" style={numberStyle}>
                  {mode === "revenue" ? formatUsd(a.value_daily) : formatInt(a.value_daily)}
                </TableCell>
              </TableRow>
            ))}

            {hasStatsDate && !props.topErrMessage && !artistRowsSorted.length && (
              <EmptyState colSpan={4} message="No artists found" />
            )}
            {artistRowsSorted.length > 60 ? (
              <EmptyState colSpan={4} message={`Showing top 60 of ${formatInt(artistRowsSorted.length)} artists`} />
            ) : null}
          </GlassTable>
        </div>
      </details>
    </div>
  );
}

