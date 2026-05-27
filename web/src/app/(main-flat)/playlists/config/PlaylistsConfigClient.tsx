"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { fetchApiJson } from "@/lib/api";
import { triggerRouteLoadingBarStart } from "@/lib/navigation/loadingBar";
import type { PlaylistsConfigStats } from "@/lib/playlists/loadPlaylistsConfigPage";

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

export function PlaylistsConfigClient(props: {
  playlists: PlaylistRow[];
  isAdmin: boolean;
  errorMessage?: string | null;
}) {
  const router = useRouter();
  const [exportCsv, setExportCsv] = useState<null | (() => void)>(null);
  const [statsMap, setStatsMap] = useState<Record<string, PlaylistsConfigStats>>({});
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const registerExport = useCallback((fn: () => void) => {
    setExportCsv(() => fn);
  }, []);

  useEffect(() => {
    if (props.isAdmin) {
      router.prefetch("/playlists/config/settings");
    }
  }, [props.isAdmin, router]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchApiJson<{ statsMap: Record<string, PlaylistsConfigStats> }>(
          "/api/playlists/config/stats",
        );
        if (!cancelled) {
          setStatsMap(data.statsMap ?? {});
          setStatsError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setStatsError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              triggerRouteLoadingBarStart("/playlists");
              router.push("/playlists");
            }}
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15 cursor-pointer"
            aria-label="Back to playlists dashboard"
            title="Back to playlists dashboard"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </button>
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
            <button
              type="button"
              onClick={() => {
                triggerRouteLoadingBarStart("/playlists/config/settings");
                router.push("/playlists/config/settings");
              }}
              className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15 cursor-pointer"
              aria-label="Playlist settings"
              title="Playlist settings"
            >
              <Settings className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
            </button>
          ) : null}
        </div>
      </div>

      {props.errorMessage ? (
        <Alert variant="error" title="Query error">
          {props.errorMessage}
        </Alert>
      ) : null}

      {statsError ? (
        <Alert variant="error" title="Stats unavailable">
          {statsError}
        </Alert>
      ) : null}

      <PlaylistFilters
        playlists={props.playlists}
        statsMap={statsMap}
        statsLoading={statsLoading}
        registerExport={registerExport}
      />
    </div>
  );
}
