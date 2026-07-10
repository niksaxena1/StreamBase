"use client";

import { Fragment, useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { MenuSelect } from "@/components/ui/MenuSelect";
import { IconButton } from "@/components/ui/Button";
import { InlineDatePicker } from "@/components/ui/InlineDatePicker";
import { downloadCsv, todayIsoDate } from "@/lib/csv";
import { CopyableIsrc } from "@/components/ui/CopyableIsrc";
import { showToast } from "@/lib/toast";

interface StreamOverride {
  id: number;
  date: string;
  isrc: string;
  streams_cumulative_override: number;
  note: string | null;
  created_by: string | null;
  created_at: string | null;
}

interface Track {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
}

interface StreamOverridesTableProps {
  overrides: StreamOverride[];
  tracks: Track[];
  removeStreamOverride: (formData: FormData) => Promise<void>;
  onDownloadClick?: () => void;
}

type SortColumn = "date" | "name" | "isrc" | "streams" | "created_at";
type SortOrder = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function formatDateDisplay(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const dd = String(date.getDate()).padStart(2, "0");
  const mon = date.toLocaleString("en-US", { month: "short" });
  return `${dd} ${mon} ${date.getFullYear()}`;
}

export function StreamOverridesTable({
  overrides,
  tracks,
  removeStreamOverride,
}: StreamOverridesTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);

  const isrcToTrack = useMemo(() => {
    const map = new Map<string, Track>();
    tracks.forEach((t) => map.set(t.isrc, t));
    return map;
  }, [tracks]);

  const filteredAndSorted = useMemo(() => {
    const filtered = overrides.filter((o) => {
      const track = isrcToTrack.get(o.isrc);
      const name = track?.name ?? "";
      const isrc = String(o.isrc ?? "").trim().toUpperCase();
      const searchLower = searchTerm.toLowerCase();

      const matchesSearch =
        isrc.toLowerCase().includes(searchLower) ||
        name.toLowerCase().includes(searchLower) ||
        (o.note ?? "").toLowerCase().includes(searchLower);

      const matchesDate = !filterDate || o.date === filterDate;

      return matchesSearch && matchesDate;
    });

    filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case "date":
          aVal = a.date;
          bVal = b.date;
          break;
        case "name": {
          const nameA = isrcToTrack.get(a.isrc)?.name ?? a.isrc;
          const nameB = isrcToTrack.get(b.isrc)?.name ?? b.isrc;
          aVal = nameA.toLowerCase();
          bVal = nameB.toLowerCase();
          break;
        }
        case "isrc":
          aVal = a.isrc.toLowerCase();
          bVal = b.isrc.toLowerCase();
          break;
        case "streams":
          aVal = a.streams_cumulative_override;
          bVal = b.streams_cumulative_override;
          break;
        case "created_at":
          aVal = a.created_at ?? "";
          bVal = b.created_at ?? "";
          break;
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [overrides, isrcToTrack, searchTerm, filterDate, sortColumn, sortOrder]);

  const uniqueDates = useMemo(() => {
    return Array.from(new Set(overrides.map((o) => o.date))).sort().reverse();
  }, [overrides]);

  // Reset to first page when filters/sort change
  const totalFiltered = filteredAndSorted.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  if (safePage !== page) setPage(safePage);

  const pageSlice = filteredAndSorted.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Summary stats
  const uniqueFilteredDates = useMemo(
    () => new Set(filteredAndSorted.map((o) => o.date)).size,
    [filteredAndSorted],
  );
  const uniqueFilteredTracks = useMemo(
    () => new Set(filteredAndSorted.map((o) => o.isrc)).size,
    [filteredAndSorted],
  );

  // Date grouping: build a set of dates that start a new group within the current page
  const dateGroupCounts = useMemo(() => {
    if (sortColumn !== "date") return null;
    const counts = new Map<string, number>();
    for (const o of filteredAndSorted) {
      counts.set(o.date, (counts.get(o.date) ?? 0) + 1);
    }
    return counts;
  }, [filteredAndSorted, sortColumn]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortOrder("asc");
    }
    setPage(0);
  };

  function handleSearchChange(val: string) {
    setSearchTerm(val);
    setPage(0);
  }

  function handleDateFilterChange(val: string) {
    setFilterDate(val);
    setPage(0);
  }

  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return "";
    return sortOrder === "asc" ? " ↑" : " ↓";
  };

  // Track which dates already had a group header rendered on this page
  let lastGroupDate = "";

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: "var(--sb-muted)" }}>
        <span>
          <span className="font-semibold" style={{ color: "var(--sb-text)" }}>
            {Intl.NumberFormat().format(overrides.length)}
          </span>{" "}
          override{overrides.length !== 1 ? "s" : ""} total
        </span>
        {(searchTerm || filterDate) && totalFiltered !== overrides.length ? (
          <span>
            <span className="font-semibold" style={{ color: "var(--sb-text)" }}>
              {Intl.NumberFormat().format(totalFiltered)}
            </span>{" "}
            matching
          </span>
        ) : null}
        <span>
          <span className="font-semibold" style={{ color: "var(--sb-text)" }}>
            {uniqueFilteredDates}
          </span>{" "}
          date{uniqueFilteredDates !== 1 ? "s" : ""}
        </span>
        <span>
          <span className="font-semibold" style={{ color: "var(--sb-text)" }}>
            {uniqueFilteredTracks}
          </span>{" "}
          track{uniqueFilteredTracks !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          type="text"
          placeholder="Search ISRC, track name, or note..."
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
        />

        <InlineDatePicker
          value={filterDate}
          onChange={handleDateFilterChange}
          onClear={() => handleDateFilterChange("")}
          placeholder="All dates"
          clearLabel="All dates"
          markedDates={uniqueDates}
          restrictToMarked
          min={uniqueDates.length ? uniqueDates[uniqueDates.length - 1] : undefined}
          max={uniqueDates.length ? uniqueDates[0] : undefined}
        />

        <div />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
              <th
                onClick={() => handleSort("date")}
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                style={{ color: "var(--sb-muted)" }}
              >
                Run Date{getSortIndicator("date")}
              </th>
              <th
                onClick={() => handleSort("name")}
                className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                style={{ color: "var(--sb-muted)" }}
              >
                Track{getSortIndicator("name")}
              </th>
              <th
                onClick={() => handleSort("streams")}
                className="px-4 py-3 text-right font-medium cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                style={{ color: "var(--sb-muted)" }}
              >
                Streams{getSortIndicator("streams")}
              </th>
              <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--sb-muted)" }}>
                Note
              </th>
              <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--sb-muted)" }}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.length > 0 ? (
              pageSlice.map((o) => {
                const isrc = String(o.isrc ?? "").trim().toUpperCase();
                const track = isrcToTrack.get(o.isrc);
                const name = track?.name ?? isrc;
                const imageUrl = track?.spotify_album_image_url ?? null;

                // Date group separator
                let groupRow: React.ReactNode = null;
                if (dateGroupCounts && o.date !== lastGroupDate) {
                  lastGroupDate = o.date;
                  const groupCount = dateGroupCounts.get(o.date) ?? 0;
                  groupRow = (
                    <tr key={`grp-${o.date}`}>
                      <td
                        colSpan={5}
                        className="px-4 py-1.5 text-[11px] font-semibold"
                        style={{ color: "var(--sb-muted)", background: "var(--sb-bg)" }}
                      >
                        {formatDateDisplay(o.date)}
                        <span className="ml-2 font-normal opacity-70">
                          — {groupCount} override{groupCount !== 1 ? "s" : ""}
                        </span>
                      </td>
                    </tr>
                  );
                }

                return (
                  <Fragment key={`ov-${o.id}`}>
                    {groupRow}
                    <tr
                      className="border-b hover:bg-black/2 dark:hover:bg-white/2 transition-colors"
                      style={{ borderColor: "var(--sb-border)" }}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{formatDateDisplay(o.date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link href={`/tracks/${isrc}`} className="flex shrink-0 items-center group">
                            {imageUrl ? (
                              <PreviewableArtwork
                                src={imageUrl}
                                alt={name}
                                width={32}
                                height={32}
                                interactive="inline"
                                className="h-8 w-8 rounded-lg object-cover sb-ring flex-shrink-0"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                            )}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link href={`/tracks/${isrc}`} className="block group">
                              <div className="truncate text-sm font-medium group-hover:underline">{name}</div>
                            </Link>
                            <CopyableIsrc
                              isrc={isrc}
                              className="mt-0.5 block truncate font-mono text-[11px]"
                              style={{ color: "var(--sb-muted)" }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {Intl.NumberFormat().format(Number(o.streams_cumulative_override ?? 0))}
                      </td>
                      <td className="px-4 py-3 text-sm truncate max-w-xs">{o.note ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (!confirm("Remove this override?")) return;
                            const fd = new FormData(e.currentTarget);
                            try {
                              await removeStreamOverride(fd);
                              showToast("Override removed");
                            } catch {
                              showToast("Failed to remove override", "error");
                            }
                          }}
                        >
                          <input type="hidden" name="id" value={String(o.id)} />
                          <input type="hidden" name="date" value={String(o.date)} />
                          <button type="submit" className="text-xs underline opacity-70 hover:opacity-100 transition-opacity">
                            remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center" style={{ color: "var(--sb-muted)" }}>
                  {overrides.length === 0 ? "No manual overrides yet." : "No overrides match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalFiltered > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-3 text-xs" style={{ color: "var(--sb-muted)" }}>
            <span>Rows per page</span>
            <MenuSelect
              value={String(pageSize)}
              options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
              onChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
              ariaLabel="Rows per page"
              matchTriggerWidth={false}
              openUp
            />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums" style={{ color: "var(--sb-muted)" }}>
              {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, totalFiltered)} of{" "}
              {Intl.NumberFormat().format(totalFiltered)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="sb-ring grid h-7 w-7 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                style={{ color: "var(--sb-text)" }}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="sb-ring grid h-7 w-7 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                style={{ color: "var(--sb-text)" }}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface StreamOverridesTableDownloadButtonProps {
  overrides: StreamOverride[];
  tracks: Track[];
  onDownload?: () => void;
}

export function StreamOverridesTableDownloadButton(props: StreamOverridesTableDownloadButtonProps) {
  const isrcToTrack = useMemo(() => {
    const map = new Map<string, Track>();
    props.tracks.forEach((t) => map.set(t.isrc, t));
    return map;
  }, [props.tracks]);

  const handleClick = () => {
    props.onDownload?.();
    const rows = props.overrides.map((o) => {
      const track = isrcToTrack.get(o.isrc);
      const name = track?.name ?? "";
      const artistNames = track?.spotify_artist_names ?? [];
      const artistsStr = Array.isArray(artistNames) ? artistNames.join(" | ") : "";

      return {
        date: o.date,
        isrc: o.isrc,
        track_name: name,
        artist_names: artistsStr,
        streams: o.streams_cumulative_override,
        note: o.note ?? "",
        created_at: o.created_at ?? "",
      };
    });

    downloadCsv({
      filename: `stream_overrides_${todayIsoDate()}.csv`,
      rows,
    });
  };

  return (
    <IconButton
      type="button"
      onClick={handleClick}
      disabled={!props.overrides || props.overrides.length === 0}
      title="Download stream overrides as CSV"
      aria-label="Download stream overrides as CSV"
      variant="ghost"
      size="sm"
    >
      <Download className="h-3.5 w-3.5" />
    </IconButton>
  );
}
