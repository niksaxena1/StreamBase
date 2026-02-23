"use client";

import { useState, useMemo, type ReactNode } from "react";
import Image from "next/image";
import { GlassTable, TableCell, TableRow, EmptyState } from "@/components/ui/GlassTable";
import { TrackExclusionForm } from "./TrackExclusionForm";
import { showToast } from "@/lib/toast";

type Exclusion = {
  id: number;
  playlist_key: string | null;
  isrc: string;
  note: string | null;
  created_at: string | null;
};

type Track = {
  isrc: string;
  name: string | null;
  spotify_album_image_url: string | null;
  spotify_artist_names: string[] | null;
};

type Playlist = {
  playlist_key: string;
  display_name: string;
};

export type ExclusionTabConfig = {
  key: string;
  label: string;
  description: ReactNode;
  exclusions: Exclusion[];
  addAction: (formData: FormData) => Promise<void>;
  removeAction: (formData: FormData) => Promise<void>;
  formTracks: Track[];
  notePlaceholder: string;
  allowMulti?: boolean;
  submitLabel?: string;
};

interface HealthExclusionsSectionProps {
  tabs: ExclusionTabConfig[];
  playlists: Playlist[];
  allTracks: Track[];
}

export function HealthExclusionsSection({
  tabs,
  playlists,
  allTracks,
}: HealthExclusionsSectionProps) {
  const [activeKey, setActiveKey] = useState(tabs[0]?.key ?? "");

  const trackMap = useMemo(() => {
    const m = new Map<string, Track>();
    for (const t of allTracks) m.set(t.isrc, t);
    return m;
  }, [allTracks]);

  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  if (!active) return null;

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => {
          const isActive = tab.key === active.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveKey(tab.key)}
              className={[
                "sb-ring inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium transition",
                isActive
                  ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                  : "bg-white/70 text-black/70 hover:bg-white dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20",
              ].join(" ")}
            >
              {tab.label}
              <span
                className={[
                  "tabular-nums rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold",
                  isActive
                    ? "bg-white/20 dark:bg-black/20"
                    : "bg-black/5 dark:bg-white/10",
                ].join(" ")}
              >
                {tab.exclusions.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Description */}
      <div className="text-xs px-1" style={{ color: "var(--sb-muted)" }}>
        {active.description}
      </div>

      {/* Form */}
      <TrackExclusionForm
        addHealthExclusion={active.addAction}
        tracks={active.formTracks}
        playlists={playlists}
        notePlaceholder={active.notePlaceholder}
        allowMulti={active.allowMulti}
        submitLabel={active.submitLabel}
      />

      {/* Table */}
      <GlassTable headers={["Scope", "Track", "Note", ""]}>
        {active.exclusions.map((e) => {
          const isrc = String(e.isrc ?? "").trim().toUpperCase();
          const track = trackMap.get(isrc);
          const name = track?.name ?? isrc;
          const imageUrl = track?.spotify_album_image_url ?? null;
          return (
            <TableRow key={`${active.key}-${e.id}`}>
              <TableCell mono className="text-xs">
                {e.playlist_key ?? "all"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {imageUrl ? (
                    <Image
                      src={imageUrl}
                      alt={name}
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-lg object-cover sb-ring flex-shrink-0"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-lg sb-ring bg-white/60 dark:bg-white/10 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{name}</div>
                    <div className="font-mono text-[10px] opacity-60 truncate">{isrc}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-xs">{e.note ?? "—"}</TableCell>
              <TableCell className="text-right">
                <form
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    if (!confirm(`Remove this ${active.label.toLowerCase()} exclusion?`)) return;
                    const fd = new FormData(ev.currentTarget);
                    try {
                      await active.removeAction(fd);
                      showToast("Exclusion removed");
                    } catch {
                      showToast("Failed to remove exclusion", "error");
                    }
                  }}
                >
                  <input type="hidden" name="id" value={String(e.id)} />
                  <button type="submit" className="text-xs underline opacity-70 hover:opacity-100">
                    remove
                  </button>
                </form>
              </TableCell>
            </TableRow>
          );
        })}
        {!active.exclusions.length && (
          <EmptyState colSpan={4} message={`No ${active.label.toLowerCase()} yet.`} />
        )}
      </GlassTable>
    </div>
  );
}
