"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { COLLECTOR_ORDER } from "@/app/(main-flat)/collectors/collectorsTypes";
import { COLLECTOR_COLORS } from "@/components/charts/CollectorComparisonChart";

export type PlaylistOption = {
  playlist_key: string;
  display_name: string;
  spotify_playlist_image_url: string | null;
};

type FilterMode = "all" | "artist" | "collector" | "playlist";
type ExpandedSection = "collector" | "playlist" | "artist" | null;

const PICKER_PANEL_STYLE = {
  backgroundColor: "var(--sb-card)",
  borderColor: "var(--sb-border-2)",
  backdropFilter: "blur(var(--sb-blur))",
  WebkitBackdropFilter: "blur(var(--sb-blur))",
} as const;

const PICKER_ITEM_CLS = "flex items-center gap-2 w-full text-left px-2 py-1.5 text-xs rounded transition-colors";
const PICKER_ITEM_ACTIVE = "bg-black/5 dark:bg-white/10 font-semibold";
const PICKER_ITEM_IDLE = "hover:bg-black/5 dark:hover:bg-white/10";

export function ConcentrationFilterPicker({
  artists,
  playlists,
  filterMode,
  artistId,
  collectorId,
  playlistKey,
  onSelectAll,
  onSelectArtist,
  onSelectCollector,
  onSelectPlaylist,
}: {
  artists: { id: string; name: string; imageUrl: string | null }[];
  playlists: PlaylistOption[];
  filterMode: FilterMode;
  artistId: string | null;
  collectorId: string | null;
  playlistKey: string | null;
  onSelectAll: () => void;
  onSelectArtist: (id: string) => void;
  onSelectCollector: (collector: string) => void;
  onSelectPlaylist: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedSection>(null);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Auto-expand the section matching the current filter when opening
  useEffect(() => {
    if (open) {
      if (filterMode === "collector") setExpanded("collector");
      else if (filterMode === "playlist") setExpanded("playlist");
      else if (filterMode === "artist") setExpanded("artist");
      else setExpanded(null);
      setSearch("");
    }
  }, [open]);

  // Focus search input when artist section expands
  useEffect(() => {
    if (expanded === "artist") {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [expanded]);

  const selectedArtist = artistId ? artists.find((a) => a.id === artistId) ?? null : null;
  const selectedPlaylist = playlistKey ? playlists.find((p) => p.playlist_key === playlistKey) ?? null : null;

  const filteredArtists = search.trim()
    ? artists.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()))
    : artists;

  // Trigger button appearance
  let buttonLabel: string;
  let buttonThumb: React.ReactNode;
  if (filterMode === "artist" && selectedArtist) {
    buttonLabel = selectedArtist.name;
    buttonThumb = selectedArtist.imageUrl
      ? <Image src={selectedArtist.imageUrl} alt={buttonLabel} width={16} height={16} className="h-4 w-4 rounded-sm object-cover flex-shrink-0" />
      : <div className="h-4 w-4 rounded-sm flex-shrink-0" style={{ backgroundColor: "var(--sb-surface)" }} />;
  } else if (filterMode === "collector" && collectorId) {
    buttonLabel = `Collector ${collectorId}`;
    buttonThumb = <span className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: COLLECTOR_COLORS[collectorId] ?? "var(--sb-muted)" }} />;
  } else if (filterMode === "playlist" && selectedPlaylist) {
    buttonLabel = selectedPlaylist.display_name;
    buttonThumb = selectedPlaylist.spotify_playlist_image_url
      ? <Image src={selectedPlaylist.spotify_playlist_image_url} alt={buttonLabel} width={16} height={16} className="h-4 w-4 rounded-sm object-cover flex-shrink-0" />
      : <div className="h-4 w-4 rounded-sm flex-shrink-0" style={{ backgroundColor: "var(--sb-surface)" }} />;
  } else {
    buttonLabel = "All Catalog";
    buttonThumb = <div className="h-4 w-4 rounded-sm bg-white/30 dark:bg-white/20 flex-shrink-0" />;
  }

  function toggleSection(section: ExpandedSection) {
    setExpanded((prev) => prev === section ? null : section);
    setSearch("");
  }

  const sectionHeaderCls = "flex items-center justify-between gap-2 w-full text-left px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider rounded transition-colors";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex items-center gap-1.5 text-xs px-2 py-1.5 rounded",
          "bg-white/20 dark:bg-white/10",
          "border border-white/10",
          "outline-none focus:outline-none",
          "max-w-[200px] min-w-[120px]",
          "transition-colors hover:bg-white/30 dark:hover:bg-white/15",
        ].join(" ")}
        style={{ color: "var(--sb-text)" }}
      >
        {buttonThumb}
        <span className="truncate flex-1 text-left">{buttonLabel}</span>
        <span className="opacity-40 flex-shrink-0">▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 w-60 rounded-[var(--sb-radius)] border p-1 shadow-lg overflow-hidden"
          style={PICKER_PANEL_STYLE}
        >
          <div className="max-h-80 overflow-y-auto">
            {/* All Catalog */}
            <button
              type="button"
              onClick={() => { onSelectAll(); setOpen(false); }}
              className={[PICKER_ITEM_CLS, filterMode === "all" ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
              style={{ color: "var(--sb-text)" }}
            >
              <div className="h-6 w-6 rounded-sm flex-shrink-0 flex items-center justify-center text-[9px]" style={{ backgroundColor: "var(--sb-surface)", color: "var(--sb-muted)" }}>★</div>
              All Catalog
            </button>

            {/* Divider */}
            <div className="my-1 border-t" style={{ borderColor: "var(--sb-border)" }} />

            {/* --- By Collector --- */}
            <button
              type="button"
              onClick={() => toggleSection("collector")}
              className={sectionHeaderCls}
              style={{ color: expanded === "collector" ? "var(--sb-text)" : "var(--sb-muted)" }}
            >
              <span>By Collector</span>
              <span className="text-[9px] opacity-50">{expanded === "collector" ? "▴" : "▾"}</span>
            </button>
            {expanded === "collector" && (
              <div className="pl-2">
                {COLLECTOR_ORDER.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { onSelectCollector(c); setOpen(false); }}
                    className={[PICKER_ITEM_CLS, filterMode === "collector" && collectorId === c ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
                    style={{ color: "var(--sb-text)" }}
                  >
                    <span className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: COLLECTOR_COLORS[c] ?? "var(--sb-muted)" }} />
                    <span className="font-medium">{c}</span>
                  </button>
                ))}
              </div>
            )}

            {/* --- By Playlist --- */}
            <button
              type="button"
              onClick={() => toggleSection("playlist")}
              className={sectionHeaderCls}
              style={{ color: expanded === "playlist" ? "var(--sb-text)" : "var(--sb-muted)" }}
            >
              <span>By Playlist</span>
              <span className="text-[9px] opacity-50">{expanded === "playlist" ? "▴" : "▾"}</span>
            </button>
            {expanded === "playlist" && (
              <div className="pl-2">
                {playlists.map((p) => (
                  <button
                    key={p.playlist_key}
                    type="button"
                    onClick={() => { onSelectPlaylist(p.playlist_key); setOpen(false); }}
                    className={[PICKER_ITEM_CLS, filterMode === "playlist" && playlistKey === p.playlist_key ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
                    style={{ color: "var(--sb-text)" }}
                  >
                    {p.spotify_playlist_image_url ? (
                      <Image src={p.spotify_playlist_image_url} alt={p.display_name} width={24} height={24} className="h-6 w-6 rounded-sm object-cover flex-shrink-0" />
                    ) : (
                      <div className="h-6 w-6 rounded-sm flex-shrink-0" style={{ backgroundColor: "var(--sb-surface)" }} />
                    )}
                    <span className="truncate">{p.display_name}</span>
                  </button>
                ))}
                {playlists.length === 0 && (
                  <div className="px-2 py-1.5 text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>Loading…</div>
                )}
              </div>
            )}

            {/* --- By Artist --- */}
            <button
              type="button"
              onClick={() => toggleSection("artist")}
              className={sectionHeaderCls}
              style={{ color: expanded === "artist" ? "var(--sb-text)" : "var(--sb-muted)" }}
            >
              <span>By Artist</span>
              <span className="text-[9px] opacity-50">{expanded === "artist" ? "▴" : "▾"}</span>
            </button>
            {expanded === "artist" && (
              <div className="pl-2">
                <div className="pb-1">
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search artists…"
                    className={[
                      "w-full text-xs px-2 py-1.5 rounded",
                      "bg-black/5 dark:bg-white/10",
                      "outline-none focus:outline-none",
                    ].join(" ")}
                    style={{ color: "var(--sb-text)" }}
                  />
                </div>
                {filteredArtists.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => { onSelectArtist(a.id); setOpen(false); }}
                    className={[PICKER_ITEM_CLS, filterMode === "artist" && artistId === a.id ? PICKER_ITEM_ACTIVE : PICKER_ITEM_IDLE].join(" ")}
                    style={{ color: "var(--sb-text)" }}
                  >
                    {a.imageUrl ? (
                      <Image src={a.imageUrl} alt={a.name} width={24} height={24} className="h-6 w-6 rounded-sm object-cover flex-shrink-0" />
                    ) : (
                      <div className="h-6 w-6 rounded-sm flex-shrink-0" style={{ backgroundColor: "var(--sb-surface)" }} />
                    )}
                    <span className="truncate">{a.name}</span>
                  </button>
                ))}
                {filteredArtists.length === 0 && (
                  <div className="px-2 py-1.5 text-xs opacity-40" style={{ color: "var(--sb-muted)" }}>No artists found</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
