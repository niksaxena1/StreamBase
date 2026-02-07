"use client";

import Link from "next/link";
import { ArrowLeft, Download, Settings } from "lucide-react";
import { useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { PlaylistFilters } from "./PlaylistFilters";

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  playlist_type: string | null;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
  display_order: number | null;
};

type PlaylistStats = {
  track_count: number | null;
  daily_tracks_net: number | null;
  total_streams_cumulative: number | null;
  daily_streams_net: number | null;
};

export function PlaylistsConfigClient(props: {
  playlists: PlaylistRow[];
  statsMap: Record<string, PlaylistStats>;
  isAdmin: boolean;
  errorMessage?: string | null;
}) {
  const [exportCsv, setExportCsv] = useState<null | (() => void)>(null);

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="relative z-10 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link
            href="/playlists"
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            aria-label="Back to playlists dashboard"
            title="Back to playlists dashboard"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </Link>
          <div className="flex items-center gap-2">
            <div>
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                Playlists
              </h1>
              <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                Tracked playlists from configuration.
              </p>
            </div>

            <button
              type="button"
              onClick={() => exportCsv?.()}
              disabled={!exportCsv}
              className="inline-flex items-center justify-center p-0 transition-colors hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              title="Download as CSV"
              aria-label="Download as CSV"
              style={{ color: "var(--sb-muted)" }}
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {props.isAdmin ? (
            <Link
              href="/playlists/config/settings"
              className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
              aria-label="Playlist settings"
              title="Playlist settings"
            >
              <Settings className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
            </Link>
          ) : null}
        </div>
      </div>

      {props.errorMessage ? (
        <Alert variant="error" title="Query error">
          {props.errorMessage}
        </Alert>
      ) : null}

      <div className="flex-1 min-h-0">
        <PlaylistFilters
          playlists={props.playlists}
          statsMap={props.statsMap}
          registerExport={(fn) => setExportCsv(() => fn)}
        />
      </div>
    </div>
  );
}

