"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, ArchiveRestore, ArrowLeftRight, CheckCircle2, Copy, ExternalLink, Heart, Plus, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { ImagePreviewModal } from "@/components/ui/ImagePreviewModal";
import { Modal } from "@/components/ui/Modal";
import { formatInt } from "@/lib/format";
import type { FollowerHistoryPoint } from "@/lib/playlistWatch/history";
import { spotifyUserUrl } from "@/lib/playlistWatch/spotifyUserUrl";
import { showToast } from "@/lib/toast";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { formatTooltipDateDaily } from "@/components/charts/chartUtils";

export type PlaylistWatchRow = {
  spotifyPlaylistId: string;
  displayName: string;
  ownerSpotifyId: string | null;
  ownerName: string | null;
  spotifyUrl: string | null;
  imageUrl: string | null;
  watchStatus: "active" | "archived";
  lastCheckStatus: string | null;
  lastCheckMessage: string | null;
  latestFollowerCount: number | null;
  latestSnapshotDate: string | null;
  latestCheckedAt: string | null;
  isFavorite: boolean;
  delta1d: number | null;
  delta7d: number | null;
  delta30d: number | null;
  history: FollowerHistoryPoint[];
};

function fmtDelta(value: number | null) {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatInt(value)}`;
}

type PlaylistWatchSortKey = "followers" | "delta1d" | "delta7d" | "delta30d";

function compareNullableMetric(a: number | null, b: number | null, dir: "asc" | "desc") {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = a - b;
  return dir === "asc" ? cmp : -cmp;
}

function metricForSort(playlist: PlaylistWatchRow, key: PlaylistWatchSortKey): number | null {
  switch (key) {
    case "followers":
      return playlist.latestFollowerCount;
    case "delta1d":
      return playlist.delta1d;
    case "delta7d":
      return playlist.delta7d;
    case "delta30d":
      return playlist.delta30d;
  }
}

export function PlaylistWatchClient({
  playlists,
  isAdmin,
  includeArchived,
}: {
  playlists: PlaylistWatchRow[];
  isAdmin: boolean;
  includeArchived: boolean;
}) {
  const router = useRouter();
  const [playlistInput, setPlaylistInput] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [archiveCandidateId, setArchiveCandidateId] = useState<string | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<PlaylistWatchSortKey>("followers");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (!selectedPlaylistId) setCoverPreviewUrl(null);
  }, [selectedPlaylistId]);

  const favoriteCount = useMemo(() => playlists.filter((p) => p.isFavorite).length, [playlists]);
  const sortedPlaylists = useMemo(() => {
    return [...playlists].sort((a, b) =>
      compareNullableMetric(metricForSort(a, sortKey), metricForSort(b, sortKey), sortDir),
    );
  }, [playlists, sortKey, sortDir]);

  function toggleSort(key: PlaylistWatchSortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function sortIndicator(key: PlaylistWatchSortKey) {
    if (key !== sortKey) return null;
    return <span className="ml-1 opacity-60">{sortDir === "asc" ? "▲" : "▼"}</span>;
  }
  const selectedPlaylist = useMemo(
    () => playlists.find((p) => p.spotifyPlaylistId === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId],
  );
  const archiveCandidate = useMemo(
    () => playlists.find((p) => p.spotifyPlaylistId === archiveCandidateId) ?? null,
    [playlists, archiveCandidateId],
  );
  const selectedOwnerPlaylists = useMemo(
    () => playlists.filter((p) => p.ownerSpotifyId && p.ownerSpotifyId === selectedOwnerId),
    [playlists, selectedOwnerId],
  );
  const selectedOwnerName = selectedOwnerPlaylists[0]?.ownerName ?? selectedOwnerId;

  async function addPlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!playlistInput.trim()) return;
    setBusyKey("add");
    setMessage(null);
    try {
      const res = await fetch("/api/playlist-watch/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlist: playlistInput }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to add playlist");
      setPlaylistInput("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function patchPlaylist(playlistId: string, body: Record<string, unknown>) {
    setBusyKey(`${playlistId}:${body.action}`);
    setMessage(null);
    try {
      const res = await fetch(`/api/playlist-watch/playlists/${encodeURIComponent(playlistId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Update failed");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function copyPlaylistUrl(playlist: PlaylistWatchRow) {
    const url = playlist.spotifyUrl ?? `https://open.spotify.com/playlist/${playlist.spotifyPlaylistId}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Playlist URL copied to clipboard", "success");
    } catch {
      showToast("Could not copy playlist URL", "error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 md:gap-3">
        <div className="sb-card min-w-0 p-2 sm:p-4">
          <div className="truncate text-[9px] uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--sb-muted)" }}>Visible</div>
          <div className="mt-0.5 font-mono text-sm font-semibold leading-tight sm:mt-1 sm:text-2xl">{formatInt(playlists.length)}</div>
        </div>
        <div className="sb-card min-w-0 p-2 sm:p-4">
          <div className="truncate text-[9px] uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--sb-muted)" }}>Favorites</div>
          <div className="mt-0.5 font-mono text-sm font-semibold leading-tight sm:mt-1 sm:text-2xl">{formatInt(favoriteCount)}</div>
        </div>
        <div className="sb-card min-w-0 p-2 sm:p-4">
          <div className="truncate text-[9px] uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--sb-muted)" }}>Archived</div>
          <a href={includeArchived ? "/playlist-watch" : "/playlist-watch?archived=1"} className="mt-1 inline-flex text-[10px] font-medium hover:underline sm:mt-2 sm:text-xs">
            {includeArchived ? "Hide archived" : "Show archived"}
          </a>
        </div>
        {isAdmin ? (
          <form onSubmit={addPlaylist} className="sb-card flex items-center gap-2 p-3">
            <input
              value={playlistInput}
              onChange={(e) => setPlaylistInput(e.target.value)}
              placeholder="Spotify playlist URL or ID"
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none"
              style={{ color: "var(--sb-text)" }}
            />
            <button
              type="submit"
              title="Add playlist"
              disabled={busyKey === "add"}
              className="sb-ring grid h-9 w-9 place-items-center rounded-lg bg-black text-white transition disabled:opacity-40 dark:bg-white dark:text-black"
            >
              <Plus className="h-4 w-4" />
            </button>
          </form>
        ) : null}
      </div>

      {message ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
          {message}
        </div>
      ) : null}

      <GlassTable
        headers={[
          "Playlist",
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("followers")}>
                Followers{sortIndicator("followers")}
              </button>
            ),
            align: "right",
          },
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("delta1d")}>
                1d{sortIndicator("delta1d")}
              </button>
            ),
            align: "right",
          },
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("delta7d")}>
                7d{sortIndicator("delta7d")}
              </button>
            ),
            align: "right",
          },
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("delta30d")}>
                30d{sortIndicator("delta30d")}
              </button>
            ),
            align: "right",
          },
          { label: "", align: "right" },
        ]}
        maxBodyHeightClassName="max-h-[680px]"
      >
        {sortedPlaylists.length === 0 ? (
          <EmptyState colSpan={6} message={includeArchived ? "No playlists found." : "No active playlists found."} />
        ) : (
          sortedPlaylists.map((playlist) => (
            <TableRow key={playlist.spotifyPlaylistId}>
              <TableCell>
                <div className="flex min-w-[260px] items-center gap-3">
                  {playlist.imageUrl ? (
                    <Image src={playlist.imageUrl} alt={playlist.displayName} width={40} height={40} className="h-10 w-10 rounded-lg object-cover sb-ring" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-white/10 sb-ring" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <StatusIcon playlist={playlist} />
                      {playlist.isFavorite ? <Star className="h-3.5 w-3.5 fill-current text-amber-500" /> : null}
                      <button
                        type="button"
                        onClick={() => setSelectedPlaylistId(playlist.spotifyPlaylistId)}
                        className="truncate text-left font-medium hover:underline"
                      >
                        {playlist.displayName}
                      </button>
                    </div>
                    <div className="flex min-w-0 items-center gap-1 truncate text-[11px]" style={{ color: "var(--sb-muted)" }}>
                      {playlist.ownerSpotifyId ? (
                        <button
                          type="button"
                          className="truncate hover:underline"
                          title="Show other tracked playlists from this owner"
                          onClick={() => setSelectedOwnerId(playlist.ownerSpotifyId)}
                        >
                          {playlist.ownerName ?? "Unknown owner"}
                        </button>
                      ) : (
                        <span className="truncate">{playlist.ownerName ?? "Unknown owner"}</span>
                      )}
                      <span className="opacity-40">-</span>
                      {playlist.ownerSpotifyId ? (
                        <a
                          href={spotifyUserUrl(playlist.ownerSpotifyId) ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          title="Open Spotify user"
                          className="shrink-0 font-mono hover:underline"
                        >
                          {playlist.ownerSpotifyId}
                        </a>
                      ) : (
                        <span className="truncate">{playlist.spotifyPlaylistId}</span>
                      )}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell numeric>{formatInt(playlist.latestFollowerCount)}</TableCell>
              <TableCell numeric>{fmtDelta(playlist.delta1d)}</TableCell>
              <TableCell numeric>{fmtDelta(playlist.delta7d)}</TableCell>
              <TableCell numeric>{fmtDelta(playlist.delta30d)}</TableCell>
              <TableCell align="right">
                <div className="flex justify-end gap-1">
                  <button
                    title="Copy Spotify URL"
                    disabled={busyKey !== null}
                    onClick={() => copyPlaylistUrl(playlist)}
                    className="sb-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <a
                    title="Open in Spotify"
                    href={playlist.spotifyUrl ?? `https://open.spotify.com/playlist/${playlist.spotifyPlaylistId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="sb-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <div className="mx-1 h-8 w-px" style={{ background: "var(--sb-border)" }} />
                  <button
                    title={playlist.isFavorite ? "Remove favorite" : "Favorite"}
                    disabled={busyKey !== null}
                    onClick={() => patchPlaylist(playlist.spotifyPlaylistId, { action: "favorite", is_favorite: !playlist.isFavorite })}
                    className="sb-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                  >
                    <Heart className={["h-4 w-4", playlist.isFavorite ? "fill-current text-red-500" : ""].join(" ")} />
                  </button>
                  {isAdmin ? (
                    <button
                      title={playlist.watchStatus === "archived" ? "Unarchive" : "Archive"}
                      disabled={busyKey !== null}
                      onClick={() => {
                        if (playlist.watchStatus === "archived") {
                          patchPlaylist(playlist.spotifyPlaylistId, { action: "unarchive" });
                        } else {
                          setArchiveCandidateId(playlist.spotifyPlaylistId);
                        }
                      }}
                      className="sb-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                    >
                      {playlist.watchStatus === "archived" ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))
        )}
      </GlassTable>

      <Modal
        open={Boolean(selectedPlaylist)}
        onClose={() => setSelectedPlaylistId(null)}
        title={
          selectedPlaylist ? (
            <span className="flex min-w-0 items-center gap-3">
              {selectedPlaylist.imageUrl ? (
                <button
                  type="button"
                  onClick={() => setCoverPreviewUrl(selectedPlaylist.imageUrl)}
                  className="shrink-0 rounded-lg transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)]"
                  aria-label="View cover art"
                >
                  <Image
                    src={selectedPlaylist.imageUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-lg object-cover sb-ring"
                  />
                </button>
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-lg bg-white/10 sb-ring" aria-hidden />
              )}
              <span className="truncate">{selectedPlaylist.displayName}</span>
            </span>
          ) : (
            "Playlist"
          )
        }
        subtitle={
          selectedPlaylist ? (
            <span>
              {selectedPlaylist.ownerName ?? "Unknown owner"} - {selectedPlaylist.latestSnapshotDate ? formatTooltipDateDaily(selectedPlaylist.latestSnapshotDate) : "No snapshot yet"}
            </span>
          ) : undefined
        }
        maxWidthClassName="max-w-4xl"
        headerActions={
          selectedPlaylist ? (
            <a
              href={selectedPlaylist.spotifyUrl ?? `https://open.spotify.com/playlist/${selectedPlaylist.spotifyPlaylistId}`}
              target="_blank"
              rel="noreferrer"
              className="sb-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/60 px-2.5 text-xs font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
              style={{ color: "var(--sb-text)" }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Spotify
            </a>
          ) : null
        }
      >
        {selectedPlaylist ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
              <MetricTile label="Followers" value={formatInt(selectedPlaylist.latestFollowerCount)} />
              <MetricTile label="1d" value={fmtDelta(selectedPlaylist.delta1d)} />
              <MetricTile label="7d" value={fmtDelta(selectedPlaylist.delta7d)} />
              <MetricTile label="30d" value={fmtDelta(selectedPlaylist.delta30d)} />
            </div>

            <PlaylistFollowerChart
              key={selectedPlaylist.spotifyPlaylistId}
              history={selectedPlaylist.history}
            />
          </div>
        ) : null}
      </Modal>

      <ImagePreviewModal
        open={Boolean(coverPreviewUrl)}
        src={coverPreviewUrl}
        onClose={() => setCoverPreviewUrl(null)}
      />

      <Modal
        open={Boolean(selectedOwnerId)}
        onClose={() => setSelectedOwnerId(null)}
        title={selectedOwnerName ?? "Playlist owner"}
        subtitle={selectedOwnerId ? `Tracked playlists from Spotify user ${selectedOwnerId}` : undefined}
        maxWidthClassName="max-w-3xl"
        headerActions={
          selectedOwnerId && spotifyUserUrl(selectedOwnerId) ? (
            <a
              href={spotifyUserUrl(selectedOwnerId) ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="sb-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/60 px-2.5 text-xs font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
              style={{ color: "var(--sb-text)" }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Spotify user
            </a>
          ) : null
        }
      >
        <div className="space-y-2">
          {selectedOwnerPlaylists.map((playlist) => (
            <button
              key={playlist.spotifyPlaylistId}
              type="button"
              onClick={() => {
                setSelectedOwnerId(null);
                setSelectedPlaylistId(playlist.spotifyPlaylistId);
              }}
              className="sb-ring flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
              style={{ borderColor: "var(--sb-border)" }}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{playlist.displayName}</span>
                <span className="block truncate text-[11px]" style={{ color: "var(--sb-muted)" }}>
                  {playlist.spotifyPlaylistId}
                </span>
              </span>
              <span className="shrink-0 font-mono text-sm">{formatInt(playlist.latestFollowerCount)}</span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={Boolean(archiveCandidate)}
        onClose={() => setArchiveCandidateId(null)}
        title="Archive playlist?"
        subtitle={archiveCandidate?.displayName}
        maxWidthClassName="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm leading-6" style={{ color: "var(--sb-muted)" }}>
            This playlist will be hidden from the active watchlist and will not be tracked by the daily follower job until it is unarchived. Existing follower history will stay saved.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setArchiveCandidateId(null)}
              className="sb-ring rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!archiveCandidate || busyKey !== null}
              onClick={async () => {
                if (!archiveCandidate) return;
                await patchPlaylist(archiveCandidate.spotifyPlaylistId, { action: "archive" });
                setArchiveCandidateId(null);
              }}
              className="sb-ring rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40"
            >
              Archive
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

type FollowerChartMode = "daily" | "total";

function PlaylistFollowerChart({ history }: { history: FollowerHistoryPoint[] }) {
  const [mode, setMode] = useState<FollowerChartMode>("daily");
  const inactiveMode: FollowerChartMode = mode === "daily" ? "total" : "daily";

  const chartInput = useMemo(() => [...history].reverse(), [history]);
  const followerChartRows = useMemo(
    () =>
      chartInput.map((point) => ({
        date: point.date,
        followers: point.followers,
        dailyDelta: point.dailyDelta ?? 0,
        isBaselineDay: point.dailyDelta === null,
      })),
    [chartInput],
  );
  const totalData = useMemo(
    () =>
      followerChartRows.map((row) => ({
        date: row.date,
        value: row.followers,
        _followersTotal: row.followers,
        _followersDaily: row.dailyDelta,
        ...(row.isBaselineDay ? { _isBaselineDay: true as const } : {}),
      })),
    [followerChartRows],
  );
  // Same dates as total; first day uses 0 daily delta for axis alignment (see tooltip baseline note).
  const dailyData = useMemo(
    () =>
      followerChartRows.map((row) => ({
        date: row.date,
        value: row.dailyDelta,
        _followersTotal: row.followers,
        _followersDaily: row.dailyDelta,
        ...(row.isBaselineDay ? { _isBaselineDay: true as const } : {}),
      })),
    [followerChartRows],
  );

  const latest = history[history.length - 1];
  const headline =
    mode === "daily"
      ? fmtDelta(latest?.dailyDelta ?? null)
      : formatInt(latest?.followers ?? null);

  const dateRange =
    history.length >= 2
      ? `${formatTooltipDateDaily(history[0]?.date ?? "")} to ${formatTooltipDateDaily(history[history.length - 1]?.date ?? "")}`
      : "At least two daily snapshots are needed before the trend becomes meaningful.";

  const inactiveTitle = inactiveMode === "daily" ? "Daily followers" : "Total followers";
  const activeTitle = mode === "daily" ? "Daily followers" : "Total followers";

  return (
    <div className="sb-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => setMode((prev) => (prev === "daily" ? "total" : "daily"))}
            className="inline-flex items-center gap-1.5 text-left transition-opacity hover:opacity-80"
            title={`Switch to ${inactiveTitle}`}
            aria-label={`Switch to ${inactiveTitle} view`}
          >
            <span className="font-display text-base font-semibold">{activeTitle}</span>
            <ArrowLeftRight className="h-3.5 w-3.5 opacity-60" aria-hidden />
          </button>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            {dateRange}
            {history.length >= 2 ? (
              <span className="block mt-0.5">Hover a point, then click to copy the active metric</span>
            ) : null}
          </div>
        </div>
        {history.length >= 2 ? (
          <span className="font-mono text-lg font-semibold" style={{ color: "var(--sb-accent)" }}>
            {headline}
          </span>
        ) : null}
      </div>

      {history.length >= 2 ? (
        <div className="relative min-h-[280px]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.24] saturate-[0.85]"
          >
            {inactiveMode === "daily" ? (
              <DailyStreamsChart
                data={dailyData}
                valueLabel="Daily change"
                yTickFormat="int"
                heightPx={280}
                ghost
              />
            ) : (
              <DailyStreamsChart
                data={totalData}
                valueLabel="Followers"
                yTickFormat="int"
                heightPx={280}
                isCumulative
                ghost
              />
            )}
          </div>
          <div className="relative z-[1]">
            {mode === "daily" ? (
              <DailyStreamsChart
                data={dailyData}
                valueLabel="Daily change"
                yTickFormat="int"
                heightPx={280}
              />
            ) : (
              <DailyStreamsChart
                data={totalData}
                valueLabel="Followers"
                yTickFormat="int"
                heightPx={280}
                isCumulative
              />
            )}
          </div>
        </div>
      ) : (
        <div
          className="grid h-[220px] place-items-center rounded-lg border border-dashed"
          style={{ borderColor: "var(--sb-border)", color: "var(--sb-muted)" }}
        >
          <div className="text-center text-sm">
            <div className="font-medium">Not enough history yet</div>
            <div className="mt-1 text-xs">The next successful daily check will start the chart.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="min-w-0 rounded-lg border p-2 sm:p-3"
      style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
    >
      <div className="truncate text-[9px] uppercase tracking-wide sm:text-[11px]" style={{ color: "var(--sb-muted)" }}>
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-sm font-semibold leading-tight sm:mt-1 sm:text-lg">
        {value}
      </div>
    </div>
  );
}

function StatusIcon({ playlist }: { playlist: PlaylistWatchRow }) {
  if (playlist.watchStatus === "archived") {
    return (
      <Archive
        className="h-3.5 w-3.5 text-red-500"
        aria-label="Archived"
      >
        <title>Archived - not tracked until unarchived</title>
      </Archive>
    );
  }

  if (playlist.lastCheckStatus === "ok") {
    return (
      <CheckCircle2
        className="h-3.5 w-3.5 text-emerald-500"
        aria-label="Latest check ok"
      >
        <title>{`Latest check ok${playlist.latestSnapshotDate ? ` - ${playlist.latestSnapshotDate}` : ""}`}</title>
      </CheckCircle2>
    );
  }

  return (
    <AlertTriangle
      className="h-3.5 w-3.5 text-amber-500"
      aria-label="Latest check warning"
    >
      <title>{`${playlist.lastCheckStatus ?? "pending"}${playlist.lastCheckMessage ? ` - ${playlist.lastCheckMessage}` : ""}`}</title>
    </AlertTriangle>
  );
}
