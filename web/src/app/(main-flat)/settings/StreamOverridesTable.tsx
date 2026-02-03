"use client";

import { useState, useMemo } from "react";
import { Download } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { IconButton } from "@/components/ui/Button";
import { downloadCsv, todayIsoDate } from "@/lib/csv";

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

export function StreamOverridesTable({
  overrides,
  tracks,
  removeStreamOverride,
  onDownloadClick,
}: StreamOverridesTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const isrcToTrack = useMemo(() => {
    const map = new Map<string, Track>();
    tracks.forEach((t) => map.set(t.isrc, t));
    return map;
  }, [tracks]);

  const filteredAndSorted = useMemo(() => {
    let filtered = overrides.filter((o) => {
      const track = isrcToTrack.get(o.isrc);
      const name = track?.name ?? "";
      const isrc = String(o.isrc ?? "").trim().toUpperCase();
      const searchLower = searchTerm.toLowerCase();

      // Search across isrc, track name, and note
      const matchesSearch =
        isrc.includes(searchLower) ||
        name.toLowerCase().includes(searchLower) ||
        (o.note ?? "").toLowerCase().includes(searchLower);

      // Filter by date if specified
      const matchesDate = !filterDate || o.date === filterDate;

      return matchesSearch && matchesDate;
    });

    // Sort
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

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortOrder("asc");
    }
  };

  const handleDownloadCSV = () => {
    onDownloadClick?.();
    const rows = filteredAndSorted.map((o) => {
      const track = isrcToTrack.get(o.isrc);
      const name = track?.name ?? "";
      return {
        date: o.date,
        isrc: o.isrc,
        track_name: name,
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

  const getSortIndicator = (column: SortColumn) => {
    if (sortColumn !== column) return "";
    return sortOrder === "asc" ? " ↑" : " ↓";
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input
          type="text"
          placeholder="Search ISRC, track name, or note..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <Select
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
        >
          <option value="">All dates</option>
          {uniqueDates.map((date) => (
            <option key={date} value={date}>
              {date}
            </option>
          ))}
        </Select>

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
                Date{getSortIndicator("date")}
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
            {filteredAndSorted.length > 0 ? (
              filteredAndSorted.map((o) => {
                const isrc = String(o.isrc ?? "").trim().toUpperCase();
                const track = isrcToTrack.get(o.isrc);
                const name = track?.name ?? isrc;
                const imageUrl = track?.spotify_album_image_url ?? null;

                return (
                  <tr
                    key={`ov-${o.id}`}
                    className="border-b hover:bg-black/2 dark:hover:bg-white/2 transition-colors"
                    style={{ borderColor: "var(--sb-border)" }}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{o.date}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={imageUrl}
                            alt={name}
                            className="h-8 w-8 rounded-lg object-cover sb-ring flex-shrink-0"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{name}</div>
                          <div className="font-mono text-[11px] truncate" style={{ color: "var(--sb-muted)" }}>
                            {isrc}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {Intl.NumberFormat().format(Number(o.streams_cumulative_override ?? 0))}
                    </td>
                    <td className="px-4 py-3 text-sm truncate max-w-xs">{o.note ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <form
                        action={removeStreamOverride}
                        onSubmit={(e) => {
                          if (!confirm("Remove this override?")) {
                            e.preventDefault();
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
