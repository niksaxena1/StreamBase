"use client";

import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { useEffect, useMemo, useState } from "react";
import { Disc3, ListMusic, UserRound } from "lucide-react";
import { fetchApiJson } from "@/lib/api";
import { formatDateISO, formatInt } from "@/lib/format";
import { slugifyForFilename, todayIsoDate } from "@/lib/csv";
import type { ThemeColors } from "@/components/charts/useThemeColors";
import { accentRgba } from "./networkGraphPure";
import { ChartCsvDownloadButton } from "@/components/charts/ChartCsvDownloadButton";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { Modal } from "@/components/ui/Modal";
import { GlassTable, TableRow, TableCell, EmptyState } from "@/components/ui/GlassTable";
import { NetworkCatalogArtistLink, NetworkCatalogRoutedLink } from "./NetworkCatalogLinks";
import type { IsrcDetailPayload } from "./networkIsrcDetail";
import type { GraphEdge, GraphNode } from "./page";
import { useNetworkMetricStreams } from "./useNetworkMetricStreams";

export function SelectionStatsPanel({
  artistCount,
  playlistScopeLabel,
  internalEdgeCount,
  weightSum,
  uniqueCollabTracks,
  streamTotals,
  colors,
  onOpenCollabsList,
  onOpenScopedTracks,
  onClear,
}: {
  artistCount: number;
  playlistScopeLabel: string;
  internalEdgeCount: number;
  weightSum: number;
  uniqueCollabTracks: number;
  streamTotals: {
    total: number | null;
    daily: number | null;
    trackCount: number | null;
    loading: boolean;
  };
  colors: ThemeColors;
  onOpenCollabsList: () => void;
  onOpenScopedTracks: () => void;
  onClear: () => void;
}) {
  const { metricColor, formatFromStreamCount, totalColumnLabel, dailyColumnLabel } =
    useNetworkMetricStreams();

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b text-xs"
      style={{
        borderColor: colors.border,
        backgroundColor: colors.isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
        color: colors.text,
      }}
    >
      <div className="font-semibold" style={{ color: colors.accent }}>
        {artistCount} artist{artistCount !== 1 ? "s" : ""} selected
      </div>
      <div style={{ color: colors.muted }}>
        Scope: <span style={{ color: colors.text }}>{playlistScopeLabel}</span>
      </div>
      {artistCount >= 1 ? (
        <>
          <div style={{ color: colors.muted }}>
            In-scope tracks (deduped):{" "}
            <span className="font-mono font-medium" style={{ color: colors.text }}>
              {streamTotals.loading
                ? "…"
                : streamTotals.trackCount != null
                  ? formatInt(streamTotals.trackCount)
                  : "—"}
            </span>
          </div>
          <div style={{ color: colors.muted }}>
            {totalColumnLabel} (selection):{" "}
            <span className="font-mono font-medium" style={{ color: metricColor }}>
              {streamTotals.loading
                ? "…"
                : formatFromStreamCount(streamTotals.total)}
            </span>
            <span className="mx-1 opacity-50">·</span>
            {dailyColumnLabel}:{" "}
            <span className="font-mono font-medium" style={{ color: metricColor }}>
              {streamTotals.loading
                ? "…"
                : formatFromStreamCount(streamTotals.daily)}
            </span>
          </div>
        </>
      ) : null}
      {artistCount >= 2 ? (
        <>
          <div style={{ color: colors.muted }}>
            Collab links:{" "}
            <span className="font-mono font-medium" style={{ color: colors.text }}>
              {internalEdgeCount}
            </span>
          </div>
          <div style={{ color: colors.muted }}>
            Shared track credits:{" "}
            <span className="font-mono font-medium" style={{ color: colors.text }}>
              {weightSum}
            </span>
          </div>
          <div style={{ color: colors.muted }}>
            Unique collab tracks (internal edges):{" "}
            <span className="font-mono font-medium" style={{ color: colors.text }}>
              {uniqueCollabTracks}
            </span>
          </div>
        </>
      ) : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {artistCount >= 1 ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              color: colors.accent,
              backgroundColor: accentRgba(colors.accent, colors.isDark ? 0.12 : 0.15),
            }}
            onClick={onOpenScopedTracks}
          >
            <Disc3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Tracks in scope
          </button>
        ) : null}
        {artistCount >= 2 && internalEdgeCount > 0 ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              color: colors.accent,
              backgroundColor: accentRgba(colors.accent, colors.isDark ? 0.12 : 0.15),
            }}
            onClick={onOpenCollabsList}
          >
            <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Tracks & collabs
          </button>
        ) : null}
        <button
          type="button"
          className="rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors"
          style={{
            color: colors.muted,
            backgroundColor: colors.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
          }}
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}

export function SelectionScopedTracksModal({
  open,
  onClose,
  artistIds,
  playlistKey,
  scopeCacheKey,
  hideNonPrimary,
  scopeLabel,
  expectedTrackCount,
  onTrackRowPrimary,
}: {
  open: boolean;
  onClose: () => void;
  artistIds: string[];
  playlistKey: string | null;
  /** Distinguishes custom / catalog when `playlistKey` is null for multiple scopes. */
  scopeCacheKey: string;
  hideNonPrimary: boolean;
  scopeLabel: string;
  expectedTrackCount: number | null;
  /** Plain click / tap on track title: stay on network (e.g. close modal + refocus graph). */
  onTrackRowPrimary: (isrc: string) => void;
}) {
  const { metricColor, formatFromStreamCount, totalColumnLabel, dailyColumnLabel, displayMetric } =
    useNetworkMetricStreams();

  const listKey = useMemo(
    () =>
      artistIds.length === 0
        ? ""
        : `${[...artistIds].sort().join("\0")}\0${playlistKey ?? ""}\0${scopeCacheKey}\0${hideNonPrimary ? "1" : "0"}`,
    [artistIds, playlistKey, scopeCacheKey, hideNonPrimary],
  );

  const [isrcs, setIsrcs] = useState<string[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listTruncated, setListTruncated] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || listKey === "") {
      setIsrcs([]);
      setListTruncated(false);
      return;
    }
    let cancelled = false;
    setListLoading(true);
    fetchApiJson<{ isrcs?: string[]; hasMore?: boolean }>("/api/admin/network-selection-scoped-isrcs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistIds,
        playlistKey: playlistKey ?? null,
        hideNonPrimary,
        offset: 0,
      }),
    })
      .then((j) => {
        if (cancelled) return;
        setIsrcs(j.isrcs ?? []);
        setListTruncated(Boolean(j.hasMore));
      })
      .catch(() => {
        if (!cancelled) {
          setIsrcs([]);
          setListTruncated(false);
        }
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, listKey, artistIds, playlistKey, hideNonPrimary]);

  const [detailByIsrc, setDetailByIsrc] = useState<Map<string, IsrcDetailPayload>>(() => new Map());
  const [detailsLoading, setDetailsLoading] = useState(false);

  useEffect(() => {
    if (!open || isrcs.length === 0) {
      setDetailByIsrc(new Map());
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    const BATCH = 400;
    const parts: string[][] = [];
    for (let i = 0; i < isrcs.length; i += BATCH) parts.push(isrcs.slice(i, i + BATCH));

    void Promise.all(
      parts.map((part) =>
        fetchApiJson<{ tracks?: IsrcDetailPayload[] }>("/api/admin/isrc-batch-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isrcs: part }),
        }),
      ),
    )
      .then((jsons) => {
        if (cancelled) return;
        const m = new Map<string, IsrcDetailPayload>();
        for (const jj of jsons) {
          for (const t of jj.tracks ?? []) {
            m.set(t.isrc, t);
          }
        }
        setDetailByIsrc(m);
      })
      .catch(() => {
        if (!cancelled) setDetailByIsrc(new Map());
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isrcs]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const csvRows = useMemo(() => {
    return isrcs.map((isrc) => {
      const d = detailByIsrc.get(isrc);
      return {
        track: d?.name ?? "—",
        isrc,
        release_date: d?.release_date ? formatDateISO(d.release_date) : "",
        total_streams: d?.totalStreams ?? "",
        daily_streams: d?.dailyStreams ?? "",
        artists: d?.artistsOnTrack ?? "",
      };
    });
  }, [isrcs, detailByIsrc]);

  const subParts = [
    `${artistIds.length} artist${artistIds.length !== 1 ? "s" : ""}`,
    expectedTrackCount != null ? `${formatInt(expectedTrackCount)} tracks deduped` : null,
    listTruncated ? "first page of ISRCs shown (export or narrow selection for full list)" : null,
  ].filter(Boolean);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tracks in selection"
      subtitle={`${scopeLabel} · ${subParts.join(" · ")}`}
      maxWidthClassName="max-w-5xl"
      headerActions={
        <ChartCsvDownloadButton
          rows={csvRows as unknown as Array<Record<string, unknown>>}
          filename={`network-selection-tracks-${slugifyForFilename(scopeLabel)}-${todayIsoDate()}.csv`}
          title="Download CSV"
          sortForExport={false}
          headers={["track", "isrc", "release_date", "total_streams", "daily_streams", "artists"]}
          disabled={isrcs.length === 0}
        />
      }
    >
      <div className="mb-3">
        {listLoading || detailsLoading ? (
          <span className="text-[11px] opacity-60" style={{ color: "var(--sb-muted)" }}>
            Loading tracks…
          </span>
        ) : (
          <span className="text-[11px] opacity-60" style={{ color: "var(--sb-muted)" }}>
            Deduped in-scope tracks for the selected artists.{" "}
            {displayMetric === "revenue"
              ? "Est. revenue uses your payout rate × latest cumulative stream totals in the data."
              : "Stream totals use the latest cumulative day in your data."}{" "}
            Track title: click or tap to return to the graph (modal closes); Ctrl/⌘+click or long-press opens Catalog.
          </span>
        )}
      </div>
      <GlassTable
        headers={[
          { label: "Track", className: "min-w-0" },
          { label: totalColumnLabel, align: "right" as const, className: "w-[100px]" },
          { label: dailyColumnLabel, align: "right" as const, className: "w-[100px]" },
          { label: "ISRC", className: "w-[140px]" },
        ]}
        maxBodyHeightClassName="max-h-[60vh]"
        tableLayout="fixed"
      >
        {isrcs.length === 0 && !listLoading ? (
          <EmptyState
            colSpan={4}
            message="No in-scope tracks"
            description="These artists may have no scoped credits under the current playlist / hide-non-primary rules."
          />
        ) : (
          isrcs.map((isrc) => {
            const d = detailByIsrc.get(isrc);
            const displayName = d?.name ?? "—";
            const albumUrl = d?.spotify_album_image_url ?? null;
            const releaseRaw = d?.release_date ?? null;
            const total = d?.totalStreams ?? null;
            const daily = d?.dailyStreams ?? null;

            return (
              <TableRow key={isrc}>
                <TableCell className="align-top">
                  <div className="flex min-w-0 items-center gap-2">
                    {albumUrl ? (
                      <PreviewableArtwork
                        src={albumUrl}
                        alt={displayName}
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 rounded-lg object-cover sb-ring"
                      />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sb-ring bg-white/60 dark:bg-white/10">
                        <Disc3 className="h-4 w-4 opacity-40" aria-hidden />
                      </div>
                    )}
                    <div className="min-w-0">
                      <NetworkCatalogRoutedLink
                        href={`/catalog?isrc=${encodeURIComponent(isrc)}`}
                        className="sb-link-hover block truncate text-sm font-medium"
                        onPrimaryAction={() => onTrackRowPrimary(isrc)}
                      >
                        {displayName}
                      </NetworkCatalogRoutedLink>
                      {d?.artistsOnTrack ? (
                        <div className="mt-0.5 text-[10px] leading-snug opacity-70 line-clamp-2">
                          {d.artistsOnTrack}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell numeric className="align-top text-xs font-medium" style={{ color: metricColor }}>
                  {detailsLoading ? "…" : formatFromStreamCount(total)}
                </TableCell>
                <TableCell
                  numeric
                  className="align-top text-xs font-medium opacity-80"
                  style={{ color: metricColor }}
                >
                  {detailsLoading ? "…" : formatFromStreamCount(daily)}
                </TableCell>
                <TableCell className="align-top" mono>
                  <div className="min-w-0 space-y-0.5">
                    <CopyableIsrc
                      isrc={isrc}
                      className="block font-mono text-[11px] opacity-70"
                      style={{ color: "var(--sb-muted)" }}
                    />
                    <div className="text-[10px] opacity-55" style={{ color: "var(--sb-muted)" }}>
                      {releaseRaw ? formatDateISO(releaseRaw) : "—"}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </GlassTable>
    </Modal>
  );
}

function SelectionArtistAvatar({ url }: { url: string | null }) {
  return url ? (
    <PreviewableArtwork
      src={url}
      alt="Artist"
      width={28}
      height={28}
      className="h-7 w-7 shrink-0 rounded-full object-cover sb-ring"
    />
  ) : (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full sb-ring"
      style={{ background: "var(--sb-row-hover)" }}
    >
      <UserRound className="h-3.5 w-3.5 opacity-40" aria-hidden />
    </div>
  );
}

export function SelectionCollabsModal({
  open,
  onClose,
  internalEdges,
  nodes,
  scopeLabel,
  onNetworkSelectArtist,
}: {
  open: boolean;
  onClose: () => void;
  internalEdges: GraphEdge[];
  nodes: GraphNode[];
  scopeLabel: string;
  onNetworkSelectArtist?: (artistId: string) => void;
}) {
  const { metricColor, formatFromStreamCount, totalColumnLabel, dailyColumnLabel, displayMetric } =
    useNetworkMetricStreams();
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const nameById = useMemo(() => new Map(nodes.map((n) => [n.id, n.name])), [nodes]);

  const rows = useMemo(() => {
    const out: Array<{
      key: string;
      artistIdFirst: string;
      artistIdSecond: string;
      artistNameFirst: string;
      artistNameSecond: string;
      pairLabel: string;
      trackName: string;
      isrc: string;
    }> = [];
    for (const e of internalEdges) {
      const nameSource = nameById.get(e.source) ?? e.source;
      const nameTarget = nameById.get(e.target) ?? e.target;
      let artistIdFirst = e.source;
      let artistIdSecond = e.target;
      let labelFirst = nameSource;
      let labelSecond = nameTarget;
      if (nameSource.localeCompare(nameTarget) > 0) {
        artistIdFirst = e.target;
        artistIdSecond = e.source;
        labelFirst = nameTarget;
        labelSecond = nameSource;
      }
      const pairLabel = `${labelFirst} × ${labelSecond}`;
      for (const t of e.shared_tracks ?? []) {
        if (!t.isrc) continue;
        out.push({
          key: `${e.source}|${e.target}|${t.isrc}`,
          artistIdFirst,
          artistIdSecond,
          artistNameFirst: labelFirst,
          artistNameSecond: labelSecond,
          pairLabel,
          trackName: t.name ?? "—",
          isrc: t.isrc,
        });
      }
    }
    out.sort(
      (a, b) =>
        a.pairLabel.localeCompare(b.pairLabel) ||
        a.trackName.localeCompare(b.trackName) ||
        a.isrc.localeCompare(b.isrc),
    );
    return out;
  }, [internalEdges, nameById]);

  const [detailByIsrc, setDetailByIsrc] = useState<Map<string, IsrcDetailPayload>>(() => new Map());
  const [detailsLoading, setDetailsLoading] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) {
      setDetailByIsrc(new Map());
      setDetailsLoading(false);
      return;
    }
    const isrcs = [...new Set(rows.map((r) => r.isrc))];
    if (isrcs.length === 0) {
      setDetailByIsrc(new Map());
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetailsLoading(true);
    fetchApiJson<{ tracks?: IsrcDetailPayload[] }>("/api/admin/isrc-batch-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isrcs }),
    })
      .then((j) => {
        if (cancelled) return;
        const m = new Map<string, IsrcDetailPayload>();
        for (const t of j.tracks ?? []) {
          m.set(t.isrc, t);
        }
        setDetailByIsrc(m);
      })
      .catch(() => {
        if (!cancelled) setDetailByIsrc(new Map());
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rows]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const csvRows = useMemo(() => {
    return rows.map((r) => {
      const d = detailByIsrc.get(r.isrc);
      return {
        collaboration: r.pairLabel,
        track: d?.name ?? r.trackName,
        isrc: r.isrc,
        release_date: d?.release_date ? formatDateISO(d.release_date) : "",
        total_streams: d?.totalStreams ?? "",
        daily_streams: d?.dailyStreams ?? "",
      };
    });
  }, [rows, detailByIsrc]);

  const linkWord = internalEdges.length === 1 ? "link" : "links";
  const creditWord = rows.length === 1 ? "credit" : "credits";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Selected collaborations"
      subtitle={`${scopeLabel} · ${internalEdges.length} collab ${linkWord} · ${rows.length} track ${creditWord}`}
      maxWidthClassName="max-w-5xl"
      headerActions={
        <ChartCsvDownloadButton
          rows={csvRows as unknown as Array<Record<string, unknown>>}
          filename={`network-collabs-${slugifyForFilename(scopeLabel)}-${todayIsoDate()}.csv`}
          title="Download CSV"
          sortForExport={false}
          headers={["collaboration", "track", "isrc", "release_date", "total_streams", "daily_streams"]}
          disabled={rows.length === 0}
        />
      }
    >
      <div className="mb-3">
        {detailsLoading ? (
          <span className="text-[11px] opacity-60" style={{ color: "var(--sb-muted)" }}>
            Loading track metadata…
          </span>
        ) : (
          <span className="text-[11px] opacity-60" style={{ color: "var(--sb-muted)" }}>
            {displayMetric === "revenue"
              ? "Est. revenue uses your payout rate × stream totals (same source as catalog)."
              : "Stream totals use the latest cumulative day in your data (same as catalog)."}{" "}
            Click or tap an artist (name or photo) to select only them on the graph (this dialog closes). Ctrl/⌘+click or
            long-press opens Catalog. Playlist / filters stay the same.
          </span>
        )}
      </div>
      <GlassTable
        headers={[
          { label: "Collaboration", className: "w-[200px]" },
          { label: "Track", className: "min-w-0" },
          { label: totalColumnLabel, align: "right" as const, className: "w-[100px]" },
          { label: dailyColumnLabel, align: "right" as const, className: "w-[100px]" },
          { label: "ISRC", className: "w-[140px]" },
        ]}
        maxBodyHeightClassName="max-h-[60vh]"
        tableLayout="fixed"
      >
        {rows.length === 0 ? (
          <EmptyState
            colSpan={5}
            message="No shared track rows"
            description="Per-link tracks may be omitted for large graphs, or these edges have no ISRC payload yet."
          />
        ) : (
          rows.map((r) => {
            const d = detailByIsrc.get(r.isrc);
            const n1 = nodeById.get(r.artistIdFirst);
            const n2 = nodeById.get(r.artistIdSecond);
            const displayName = d?.name ?? r.trackName;
            const albumUrl = d?.spotify_album_image_url ?? null;
            const releaseRaw = d?.release_date ?? null;
            const total = d?.totalStreams ?? null;
            const daily = d?.dailyStreams ?? null;

            return (
              <TableRow key={r.key}>
                <TableCell className="align-top">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex shrink-0 -space-x-1.5">
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdFirst}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="shrink-0 rounded-full sb-ring transition-opacity hover:opacity-90"
                      >
                        <SelectionArtistAvatar url={n1?.image_url ?? null} />
                      </NetworkCatalogArtistLink>
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdSecond}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="shrink-0 rounded-full sb-ring transition-opacity hover:opacity-90"
                      >
                        <SelectionArtistAvatar url={n2?.image_url ?? null} />
                      </NetworkCatalogArtistLink>
                    </div>
                    <div
                      className="min-w-0 text-xs font-medium leading-snug"
                      style={{ color: "var(--sb-text)" }}
                      title={r.pairLabel}
                    >
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdFirst}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="sb-link-hover"
                      >
                        {r.artistNameFirst}
                      </NetworkCatalogArtistLink>
                      <span className="mx-0.5 opacity-50" aria-hidden>
                        ×
                      </span>
                      <NetworkCatalogArtistLink
                        artistId={r.artistIdSecond}
                        onNetworkSelectArtist={onNetworkSelectArtist}
                        className="sb-link-hover"
                      >
                        {r.artistNameSecond}
                      </NetworkCatalogArtistLink>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex min-w-0 items-center gap-2">
                    {albumUrl ? (
                      <PreviewableArtwork
                        src={albumUrl}
                        alt={displayName}
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 rounded-lg object-cover sb-ring"
                      />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sb-ring bg-white/60 dark:bg-white/10">
                        <Disc3 className="h-4 w-4 opacity-40" aria-hidden />
                      </div>
                    )}
                    <div className="min-w-0">
                      <NetworkCatalogRoutedLink
                        href={`/catalog?artist_id=${encodeURIComponent(r.artistIdFirst)}&isrc=${encodeURIComponent(r.isrc)}`}
                        className="sb-link-hover block truncate text-sm font-medium"
                        onPrimaryAction={() => onNetworkSelectArtist?.(r.artistIdFirst)}
                      >
                        {displayName}
                      </NetworkCatalogRoutedLink>
                    </div>
                  </div>
                </TableCell>
                <TableCell numeric className="align-top text-xs font-medium" style={{ color: metricColor }}>
                  {detailsLoading ? "…" : formatFromStreamCount(total)}
                </TableCell>
                <TableCell
                  numeric
                  className="align-top text-xs font-medium opacity-80"
                  style={{ color: metricColor }}
                >
                  {detailsLoading ? "…" : formatFromStreamCount(daily)}
                </TableCell>
                <TableCell className="align-top" mono>
                  <div className="min-w-0 space-y-0.5">
                    <CopyableIsrc
                      isrc={r.isrc}
                      className="block font-mono text-[11px] opacity-70"
                      style={{ color: "var(--sb-muted)" }}
                    />
                    <div className="text-[10px] opacity-55" style={{ color: "var(--sb-muted)" }}>
                      {releaseRaw ? formatDateISO(releaseRaw) : "—"}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </GlassTable>
    </Modal>
  );
}
