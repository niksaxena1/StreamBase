"use client";

import { Layers } from "lucide-react";
import { useMemo } from "react";

import { Chip, ChipGroup } from "@/components/ui/Chip";
import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { formatInt } from "@/lib/format";
import { ColorDot } from "./CollectionsDialogs";
import {
  buildCombinedSeries,
  buildCompareRows,
  COLLECTION_ALL,
  COLLECTION_UNASSIGNED,
  combinedToHistory,
  computeTotals,
  effectiveStatusFilter,
  growingWithoutAds,
  rowsForView,
  statusCounts,
  unassignedPlaylistIds,
  visibleCollections,
  type CollectionSelection,
  type PlaylistWatchCollection,
  type StatusFilter,
} from "./collectionsModel";
import { MetricTile, PlaylistFollowerChart } from "./PlaylistWatchVisuals";
import { fmtDelta, type PlaylistWatchRow } from "./playlistWatchClientModel";

const MISSING = "—";

function toneFor(value: number | null): "positive" | "negative" | null {
  if (value === null || value === 0) return null;
  return value > 0 ? "positive" : "negative";
}

function deltaText(value: number | null) {
  return value === null ? MISSING : fmtDelta(value);
}

function DeltaCell({ value }: { value: number | null }) {
  const tone = toneFor(value);
  return (
    <span className={tone === "positive" ? "sb-positive" : tone === "negative" ? "text-red-600 dark:text-red-400" : ""}>
      {deltaText(value)}
    </span>
  );
}

export function CollectionChips({
  rows,
  collections,
  selection,
  onSelect,
  onManage,
}: {
  rows: PlaylistWatchRow[];
  collections: PlaylistWatchCollection[];
  selection: CollectionSelection;
  onSelect: (selection: CollectionSelection) => void;
  onManage: () => void;
}) {
  const live = useMemo(() => rows.filter((r) => r.watchStatus !== "archived"), [rows]);
  const unassignedCount = useMemo(() => unassignedPlaylistIds(live, collections).size, [live, collections]);
  // Empty collections (no non-archived member) get no chip.
  const shown = useMemo(() => visibleCollections(live, collections), [live, collections]);
  const counts = useMemo(() => {
    const liveIds = new Set(live.map((r) => r.spotifyPlaylistId));
    return new Map(shown.map((c) => [c.id, c.playlistIds.filter((id) => liveIds.has(id)).length]));
  }, [live, shown]);

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Collections">
      <Chip selected={selection === COLLECTION_ALL} onClick={() => onSelect(COLLECTION_ALL)}>
        All <span className="font-mono opacity-70">{formatInt(live.length)}</span>
      </Chip>
      {shown.map((collection) => (
        <Chip key={collection.id} selected={selection === collection.id} onClick={() => onSelect(collection.id)}>
          <ColorDot color={collection.color} />
          <span className="max-w-[160px] truncate">{collection.name}</span>
          <span className="font-mono opacity-70">{formatInt(counts.get(collection.id) ?? 0)}</span>
        </Chip>
      ))}
      {collections.length > 0 && unassignedCount > 0 ? (
        <Chip selected={selection === COLLECTION_UNASSIGNED} onClick={() => onSelect(COLLECTION_UNASSIGNED)}>
          Unassigned <span className="font-mono opacity-70">{formatInt(unassignedCount)}</span>
        </Chip>
      ) : null}
      {collections.length === 0 ? (
        <button
          type="button"
          onClick={onManage}
          className="text-xs underline-offset-2 hover:underline"
          style={{ color: "var(--sb-muted)" }}
        >
          Create a collection
        </button>
      ) : (
        <button
          type="button"
          onClick={onManage}
          className="sb-ring inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold hover:bg-black/5 dark:hover:bg-white/10"
          style={{ color: "var(--sb-text)" }}
          title="Create, rename, recolor, reorder or delete collections"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden />
          Collections
        </button>
      )}
    </div>
  );
}

const STATUS_SEGMENTS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "stopped", label: "Stopped" },
];

/** Segmented All / Live / Stopped switch with counts. Hidden for the Unassigned chip. */
export function StatusSwitch({
  rows,
  collections,
  selection,
  status,
  onChange,
}: {
  rows: PlaylistWatchRow[];
  collections: PlaylistWatchCollection[];
  selection: CollectionSelection;
  status: StatusFilter;
  onChange: (status: StatusFilter) => void;
}) {
  const counts = useMemo(() => statusCounts(rows, collections, selection), [rows, collections, selection]);
  if (selection === COLLECTION_UNASSIGNED) return null;
  return (
    <ChipGroup segmented aria-label="Ad status">
      {STATUS_SEGMENTS.map((segment) => (
        <Chip key={segment.value} segmented selected={status === segment.value} onClick={() => onChange(segment.value)}>
          {segment.label} <span className="font-mono opacity-70">{formatInt(counts[segment.value])}</span>
        </Chip>
      ))}
    </ChipGroup>
  );
}

export function CollectionAnalytics({
  rows,
  collections,
  selection,
  status,
}: {
  rows: PlaylistWatchRow[];
  collections: PlaylistWatchCollection[];
  selection: CollectionSelection;
  status: StatusFilter;
}) {
  const effectiveStatus = effectiveStatusFilter(status, selection);
  const selectedRows = useMemo(
    () => rowsForView(rows, collections, selection, effectiveStatus),
    [rows, collections, selection, effectiveStatus],
  );
  const totals = useMemo(() => computeTotals(selectedRows), [selectedRows]);
  const growing = useMemo(() => growingWithoutAds(selectedRows), [selectedRows]);
  const series = useMemo(() => buildCombinedSeries(selectedRows), [selectedRows]);
  const history = useMemo(() => combinedToHistory(series), [series]);
  const shownCollections = useMemo(() => visibleCollections(rows, collections), [rows, collections]);
  const compareRows = useMemo(
    () => buildCompareRows(rows, shownCollections, effectiveStatus),
    [rows, shownCollections, effectiveStatus],
  );
  const showGrowing = effectiveStatus === "stopped";

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 gap-2 ${showGrowing ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
        <MetricTile label="Playlists" value={formatInt(totals.playlistCount)} />
        <MetricTile label="Followers" value={totals.followers === null ? MISSING : formatInt(totals.followers)} />
        <MetricTile label="Today" value={deltaText(totals.today)} tone={toneFor(totals.today)} />
        <MetricTile label="7 days" value={deltaText(totals.delta7d)} tone={toneFor(totals.delta7d)} />
        <MetricTile label="30 days" value={deltaText(totals.delta30d)} tone={toneFor(totals.delta30d)} />
        {showGrowing ? (
          <MetricTile
            label="Growing without ads"
            value={formatInt(growing.count)}
            subline={`${fmtDelta(growing.gain7d)} followers in 7 days`}
            tone={growing.count > 0 ? "positive" : null}
          />
        ) : null}
      </div>

      {selectedRows.length > 0 ? (
        <div>
          <PlaylistFollowerChart key={selection} history={history} />
          <p className="mt-1.5 px-1 text-[11px]" style={{ color: "var(--sb-muted)" }}>
            Combined across {formatInt(selectedRows.length)} playlists. Days where a tracked playlist is missing its snapshot are left out, and
            playlists added later join from their first day without counting as growth.
          </p>
        </div>
      ) : null}

      {shownCollections.length >= 2 ? (
        <div className="space-y-2">
          <h2 className="font-display text-sm font-semibold">Compare collections</h2>
          <GlassTable
            headers={[
              "Collection",
              { label: "Playlists", align: "right" },
              { label: "Followers", align: "right" },
              { label: "Today", align: "right" },
              { label: "7d", align: "right" },
              { label: "30d", align: "right" },
            ]}
            maxBodyHeightClassName="max-h-[360px]"
          >
            {compareRows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="flex min-w-[120px] items-center gap-2">
                    <ColorDot color={row.color} />
                    <span className="truncate font-medium">{row.name}</span>
                  </span>
                </TableCell>
                <TableCell numeric>{formatInt(row.playlistCount)}</TableCell>
                <TableCell numeric>{row.followers === null ? MISSING : formatInt(row.followers)}</TableCell>
                <TableCell numeric><DeltaCell value={row.today} /></TableCell>
                <TableCell numeric><DeltaCell value={row.delta7d} /></TableCell>
                <TableCell numeric><DeltaCell value={row.delta30d} /></TableCell>
              </TableRow>
            ))}
          </GlassTable>
        </div>
      ) : null}
    </div>
  );
}
