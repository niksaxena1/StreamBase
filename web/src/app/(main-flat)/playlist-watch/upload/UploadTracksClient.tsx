"use client";

import { ChevronDown, ChevronRight, ChevronUp, Search } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import { EmptyState, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { formatInt } from "@/lib/format";
import { MetricTile } from "../PlaylistWatchVisuals";
import { fmtDelta } from "../playlistWatchClientModel";
import {
  dailyGains,
  filterRows,
  formatFridayLabel,
  formatPercent,
  GROWTH_WINDOWS,
  growthFor,
  growthPercentFor,
  isNewlyAdded,
  isReleasedSince,
  latestSnapshotDateOf,
  referenceFriday,
  sortRows,
  splitRemoved,
  summarize,
  type GrowthMetric,
  type GrowthWindow,
  type SortDir,
  type UploadSortKey,
  type UploadTrackRow,
} from "./uploadTracksModel";
import { generateDemoHistory, normalizeSnapshots, type TrackHistory } from "./trackHistoryModel";
import { TrackHistoryPanel, type HistoryState } from "./TrackHistoryPanel";

const WINDOW_LABEL: Record<GrowthWindow, string> = {
  fri: "Since Fri",
  "1d": "1d",
  "7d": "7d",
  "28d": "28d",
  added: "Since added",
};

/** Dev-only: `?demoHistory=1` swaps the API call for synthetic history. Dead code in production builds. */
function demoHistoryEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return new URL(globalThis.location.href).searchParams.get("demoHistory") === "1";
  } catch {
    return false;
  }
}

async function fetchTrackHistory(row: UploadTrackRow, today: string): Promise<TrackHistory> {
  if (demoHistoryEnabled()) {
    return generateDemoHistory({
      trackId: row.spotifyTrackId,
      latestPlaycount: row.latestPlaycount,
      lastDate: row.latestDate ?? today,
      removedDate: row.removedDate,
    });
  }
  const res = await fetch(`/api/playlist-watch/upload/tracks/${encodeURIComponent(row.spotifyTrackId)}/history`, { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: Record<string, unknown> } | null;
  if (!res.ok || !json?.success || !json.data) throw new Error(json?.error ?? `HTTP ${res.status}`);
  const m = json.data.membership as TrackHistory["membership"] | null | undefined;
  return {
    track_id: row.spotifyTrackId,
    snapshots: normalizeSnapshots(json.data.snapshots),
    membership: m ?? null,
  };
}

const EMPTY_MESSAGE = "No stream data yet. The first snapshot runs daily at 18:20 Abu Dhabi.";

/** Full label for a window; "Since Fri" carries the concrete reference date. */
function windowLabel(window: GrowthWindow, refFriday: string | null): string {
  return window === "fri" ? `Since ${formatFridayLabel(refFriday)}` : WINDOW_LABEL[window];
}

function GainSparkline({ history }: { history: [string, number][] }) {
  const gains = dailyGains(history);
  if (gains.length < 2) return <span style={{ color: "var(--sb-muted)" }}>-</span>;
  const w = 72;
  const h = 22;
  const min = Math.min(...gains);
  const max = Math.max(...gains);
  const span = max - min || 1;
  const pts = gains.map((g, i) => {
    const x = (i / (gains.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((g - min) / span) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Daily stream gains">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--sb-accent)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function GrowthCell({
  row,
  window,
  metric,
  refFriday,
}: {
  row: UploadTrackRow;
  window: GrowthWindow;
  metric: GrowthMetric;
  refFriday: string | null;
}) {
  const growth = growthFor(row, window, refFriday);
  if (growth === null) {
    return (
      <span title="Needs another daily snapshot" style={{ color: "var(--sb-muted)" }}>
        -
      </span>
    );
  }
  const abs = fmtDelta(growth);
  const pct = formatPercent(growthPercentFor(row, window, refFriday));
  const primary = metric === "pct" ? pct : abs;
  const secondary = metric === "pct" ? abs : pct;
  return (
    <>
      <span className={growth > 0 ? "sb-positive" : growth < 0 ? "text-red-600 dark:text-red-400" : ""}>{primary}</span>
      {secondary !== "-" ? <span className="ml-1 text-[11px] opacity-70">({secondary})</span> : null}
    </>
  );
}

function SortHeader({
  label,
  k,
  sortKey,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  k: UploadSortKey;
  sortKey: UploadSortKey;
  dir: SortDir;
  onSort: (k: UploadSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      className={["inline-flex items-center gap-1 uppercase tracking-wider", align === "right" ? "flex-row-reverse" : ""].join(" ")}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      {active ? dir === "desc" ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronUp className="h-3 w-3" aria-hidden /> : null}
    </button>
  );
}

function TrackTable({
  rows,
  window,
  metric,
  refFriday,
  sortKey,
  dir,
  onSort,
  today,
  removed,
  hasRows,
  expandedId,
  onToggle,
  histories,
}: {
  expandedId: string | null;
  onToggle: (row: UploadTrackRow) => void;
  histories: Record<string, HistoryState>;
  hasRows: boolean;
  rows: UploadTrackRow[];
  window: GrowthWindow;
  metric: GrowthMetric;
  refFriday: string | null;
  sortKey: UploadSortKey;
  dir: SortDir;
  onSort: (k: UploadSortKey) => void;
  today: string;
  removed: boolean;
}) {
  const sh = { sortKey, dir, onSort };
  const headers = [
    { label: "#", align: "right" as const },
    "",
    <SortHeader key="t" label="Track" k="track" {...sh} />,
    <SortHeader key="a" label="Added" k="added" {...sh} />,
    ...(removed ? ["Removed on"] : []),
    { label: <SortHeader label="Total streams" k="streams" {...sh} align="right" />, align: "right" as const },
    { label: <SortHeader label={`Growth (${windowLabel(window, refFriday)})`} k="growth" {...sh} align="right" />, align: "right" as const },
    { label: "Daily gains", align: "right" as const },
  ];
  const colSpan = headers.length;
  return (
    <GlassTable headers={headers} maxBodyHeightClassName="max-h-[70vh]">
      {rows.length === 0 ? (
        <EmptyState colSpan={colSpan} message={hasRows ? "No tracks match your search." : EMPTY_MESSAGE} />
      ) : (
        rows.map((row, i) => {
          const open = expandedId === row.spotifyTrackId;
          const panelId = `track-history-${row.spotifyTrackId}`;
          return (
          <Fragment key={row.spotifyTrackId}>
          <TableRow
            className="cursor-pointer"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a, button:not([data-row-toggle])")) return;
              onToggle(row);
            }}
          >
            <TableCell align="right" className="font-mono">
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  data-row-toggle
                  aria-expanded={open}
                  aria-controls={open ? panelId : undefined}
                  aria-label={`${open ? "Hide" : "Show"} stream history for ${row.name}`}
                  className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)]"
                >
                  <ChevronRight className={["h-3.5 w-3.5 transition-transform", open ? "rotate-90" : ""].join(" ")} aria-hidden />
                </button>
                <span>{i + 1}</span>
              </div>
            </TableCell>
            <TableCell>
              {row.imageUrl ? (
                <PreviewableArtwork src={row.imageUrl} alt={row.name} width={36} height={36} className="h-9 w-9 rounded-md object-cover sb-ring" />
              ) : (
                <div className="h-9 w-9 rounded-md bg-white/10 sb-ring" aria-hidden />
              )}
            </TableCell>
            <TableCell>
              <div className="min-w-[200px] max-w-[360px]">
                <div className="flex items-center gap-2">
                  <a
                    href={`https://open.spotify.com/track/${row.spotifyTrackId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-semibold hover:underline"
                  >
                    {row.name}
                  </a>
                  {!removed && isReleasedSince(row.releaseDate, refFriday) ? (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--sb-accent)", color: "var(--sb-accent-text,#000)" }}
                      title={`Released on or after ${formatFridayLabel(refFriday)}`}
                    >
                      Released this week
                    </span>
                  ) : !removed && isNewlyAdded(row.addedDate, today) ? (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--sb-accent)", color: "var(--sb-accent-text,#000)" }}
                    >
                      New
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-[11px]" style={{ color: "var(--sb-muted)" }}>
                  {row.artists || "-"}
                </div>
              </div>
            </TableCell>
            <TableCell className="whitespace-nowrap font-mono">{row.addedDate ?? "-"}</TableCell>
            {removed ? <TableCell className="whitespace-nowrap font-mono">{row.removedDate ?? "-"}</TableCell> : null}
            <TableCell align="right" className="font-mono">
              {row.latestPlaycount === null ? <span style={{ color: "var(--sb-muted)" }}>-</span> : formatInt(row.latestPlaycount)}
            </TableCell>
            <TableCell align="right" className="whitespace-nowrap font-mono">
              <GrowthCell row={row} window={window} metric={metric} refFriday={refFriday} />
            </TableCell>
            <TableCell align="right">
              <div className="flex justify-end">
                <GainSparkline history={row.history} />
              </div>
            </TableCell>
          </TableRow>
          {open ? (
            <tr id={panelId}>
              <td colSpan={colSpan} className="px-3 pb-4 pt-2" style={{ background: "var(--sb-row-hover)" }}>
                <div className="max-w-full min-w-0">
                  <TrackHistoryPanel state={histories[row.spotifyTrackId]} latestPlaycount={row.latestPlaycount} />
                </div>
              </td>
            </tr>
          ) : null}
          </Fragment>
          );
        })
      )}
    </GlassTable>
  );
}

export function UploadTracksClient({
  rows,
  today,
  initialWindow,
  initialMetric,
}: {
  rows: UploadTrackRow[];
  today: string;
  initialWindow: GrowthWindow;
  initialMetric: GrowthMetric;
}) {
  const [window, setWindow] = useState<GrowthWindow>(initialWindow);
  const [metric, setMetric] = useState<GrowthMetric>(initialMetric);
  const [sortKey, setSortKey] = useState<UploadSortKey>("growth");
  const [dir, setDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [showRemoved, setShowRemoved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [histories, setHistories] = useState<Record<string, HistoryState>>({});

  const onToggle = useCallback(
    (row: UploadTrackRow) => {
      const id = row.spotifyTrackId;
      setExpandedId((cur) => (cur === id ? null : id));
      if (histories[id]?.status === "ready" || histories[id]?.status === "loading") return;
      setHistories((h) => ({ ...h, [id]: { status: "loading" } }));
      fetchTrackHistory(row, today)
        .then((history) => setHistories((h) => ({ ...h, [id]: { status: "ready", history } })))
        .catch((err: unknown) =>
          setHistories((h) => ({ ...h, [id]: { status: "error", message: err instanceof Error ? err.message : "unknown error" } })),
        );
    },
    [histories, today],
  );

  useEffect(() => {
    if (expandedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedId(null);
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [expandedId]);

  function syncUrl(nextWindow: GrowthWindow, nextMetric: GrowthMetric) {
    try {
      const url = new URL(globalThis.location.href);
      url.searchParams.set("window", nextWindow);
      url.searchParams.set("metric", nextMetric);
      globalThis.history.replaceState(null, "", url);
    } catch {
      // URL sync is a convenience only.
    }
  }

  function onSort(k: UploadSortKey) {
    if (k === sortKey) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(k);
      setDir(k === "track" ? "asc" : "desc");
    }
  }

  const { current, removed } = useMemo(() => splitRemoved(rows), [rows]);
  const refFriday = useMemo(() => referenceFriday(latestSnapshotDateOf(rows)), [rows]);
  const summary = useMemo(() => summarize(current, window, refFriday), [current, window, refFriday]);
  const sortedCurrent = useMemo(
    () => sortRows(filterRows(current, query), sortKey, dir, window, metric, refFriday),
    [current, query, sortKey, dir, window, metric, refFriday],
  );
  const sortedRemoved = useMemo(
    () => sortRows(filterRows(removed, query), sortKey, dir, window, metric, refFriday),
    [removed, query, sortKey, dir, window, metric, refFriday],
  );

  const top = summary.topGainer;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <MetricTile label="Tracks in playlist" value={formatInt(summary.trackCount)} />
        <MetricTile label="Total streams" value={formatInt(summary.totalStreams)} />
        <MetricTile
          label={`Streams gained (${windowLabel(window, refFriday)})`}
          value={summary.windowGrowth === null ? "-" : fmtDelta(summary.windowGrowth)}
          tone={summary.windowGrowth !== null && summary.windowGrowth > 0 ? "positive" : null}
        />
        <MetricTile
          label="Top gainer"
          value={top ? fmtDelta(top.growth) : "-"}
          subline={top ? top.row.name : undefined}
          tone={top ? "positive" : null}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup segmented aria-label="Growth window">
          {GROWTH_WINDOWS.map((w) => (
            <Chip
              key={w}
              segmented
              selected={window === w}
              title={w === "fri" ? `Growth since ${formatFridayLabel(refFriday)}; new releases start from 0` : undefined}
              onClick={() => {
                setWindow(w);
                syncUrl(w, metric);
              }}
            >
              {windowLabel(w, refFriday)}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup segmented aria-label="Growth metric">
          {(["abs", "pct"] as const).map((m) => (
            <Chip
              key={m}
              segmented
              selected={metric === m}
              onClick={() => {
                setMetric(m);
                syncUrl(window, m);
              }}
            >
              {m === "abs" ? "Absolute" : "%"}
            </Chip>
          ))}
        </ChipGroup>
        <div className="sb-ring flex h-9 min-w-0 items-center gap-2 rounded-lg bg-white/60 px-3 sm:w-[300px] dark:bg-white/10">
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--sb-muted)" }} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search track or artist"
            aria-label="Search tracks"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      <TrackTable
        rows={sortedCurrent}
        window={window}
        metric={metric}
        refFriday={refFriday}
        sortKey={sortKey}
        dir={dir}
        onSort={onSort}
        today={today}
        removed={false}
        hasRows={rows.length > 0}
        expandedId={expandedId}
        onToggle={onToggle}
        histories={histories}
      />

      {removed.length > 0 ? (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowRemoved((v) => !v)}
            aria-expanded={showRemoved}
            className="inline-flex items-center gap-2 text-sm font-semibold"
          >
            {showRemoved ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
            Removed <span className="font-mono opacity-70">{formatInt(removed.length)}</span>
          </button>
          {showRemoved ? (
            <>
              <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
                Still tracked for 30 days after removal.
              </p>
              <TrackTable
                rows={sortedRemoved}
                window={window}
                metric={metric}
                refFriday={refFriday}
                sortKey={sortKey}
                dir={dir}
                onSort={onSort}
                today={today}
                removed
                hasRows
                expandedId={expandedId}
                onToggle={onToggle}
                histories={histories}
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
