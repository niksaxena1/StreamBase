"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, ArchiveRestore, ArrowLeftRight, Bell, BellRing, CheckCircle2, ChevronDown, ChevronUp, Copy, ExternalLink, Heart, Mail, Plus, Search, Trash2, User, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { PreviewableArtwork } from "@/components/ui/PreviewableArtwork";
import { Modal } from "@/components/ui/Modal";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { formatInt } from "@/lib/format";
import type { FollowerHistoryPoint } from "@/lib/playlistWatch/history";
import { spotifyUserUrl } from "@/lib/playlistWatch/spotifyUserUrl";
import { showToast } from "@/lib/toast";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";
import { formatTooltipDateDaily } from "@/components/charts/chartUtils";
import { buildAlertPreview } from "@/lib/playlistWatch/alertPreview";

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

function TrendValue({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <span title="Needs another daily snapshot for trend data" style={{ color: "var(--sb-muted)" }}>
        -
      </span>
    );
  }
  return <>{fmtDelta(value)}</>;
}

type PlaylistWatchSortKey = "followers" | "delta1d" | "delta7d" | "delta30d";
type PlaylistWatchFilter = "active" | "favorites" | "archived";
type ImportSummary = {
  added: number;
  alreadyTracked: number;
  failed: { input: string; error: string }[];
} | null;

type OwnerModalTab = "tracked" | "spotify";

type OwnerSpotifyPlaylistRow = {
  spotifyPlaylistId: string;
  displayName: string;
  imageUrl: string | null;
  spotifyUrl: string | null;
  followerCount: number | null;
  watchStatus: "active" | "archived" | null;
  isTracked: boolean;
};

type OwnerProfile = {
  displayName: string | null;
  imageUrl: string | null;
};

type PlaylistWatchAlertRule = {
  id: number;
  recipientEmail: string;
  ruleName: string;
  isActive: boolean;
  minAbsoluteJump: number | null;
  minPercentJump: number | null;
  comparisonWindowDays: number;
  playlistIds: string[];
};

type PlaylistWatchAlertEvent = {
  id: number;
  rule_id: number | null;
  recipient_email: string;
  spotify_playlist_id: string | null;
  run_date: string;
  baseline_count: number;
  current_count: number;
  absolute_jump: number;
  percent_jump: number | null;
  status: string;
  sent_at: string;
};

type AlertEditorState = {
  open: boolean;
  playlistId: string | null;
  editingRuleId: number | null;
  recipientEmail: string;
  ruleName: string;
  isActive: boolean;
  minAbsoluteJump: string;
  minPercentJump: string;
  comparisonWindowDays: string;
  scope: "all" | "playlist";
};

const emptyAlertEditor: AlertEditorState = {
  open: false,
  playlistId: null,
  editingRuleId: null,
  recipientEmail: "",
  ruleName: "Playlist follower spike",
  isActive: true,
  minAbsoluteJump: "500",
  minPercentJump: "25",
  comparisonWindowDays: "7",
  scope: "playlist",
};

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

function looksLikeSpotifyPlaylistInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return (
    /^[A-Za-z0-9]{16,40}$/.test(trimmed) ||
    /^https?:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{16,40}/i.test(trimmed) ||
    /^spotify:playlist:[A-Za-z0-9]{16,40}$/i.test(trimmed)
  );
}

function extractPlaylistIdForSummary(value: string) {
  const trimmed = value.trim();
  const urlMatch = trimmed.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]{16,40})/i);
  if (urlMatch) return urlMatch[1];
  const uriMatch = trimmed.match(/^spotify:playlist:([A-Za-z0-9]{16,40})$/i);
  if (uriMatch) return uriMatch[1];
  return /^[A-Za-z0-9]{16,40}$/.test(trimmed) ? trimmed : null;
}

function formatCheckedAt(value: string | null) {
  if (!value) return "Never checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never checked";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
  const [bulkPlaylistInput, setBulkPlaylistInput] = useState("");
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [archiveCandidateId, setArchiveCandidateId] = useState<string | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [ownerModalTab, setOwnerModalTab] = useState<OwnerModalTab>("tracked");
  const [ownerSpotifyPlaylists, setOwnerSpotifyPlaylists] = useState<OwnerSpotifyPlaylistRow[] | null>(null);
  const [ownerSpotifyTruncated, setOwnerSpotifyTruncated] = useState(false);
  const [ownerSpotifyLoading, setOwnerSpotifyLoading] = useState(false);
  const [ownerSpotifyError, setOwnerSpotifyError] = useState<string | null>(null);
  const [ownerProfile, setOwnerProfile] = useState<OwnerProfile | null>(null);
  const [sortKey, setSortKey] = useState<PlaylistWatchSortKey>("followers");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<PlaylistWatchFilter>(includeArchived ? "archived" : "active");
  const [alertRules, setAlertRules] = useState<PlaylistWatchAlertRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<PlaylistWatchAlertEvent[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertEditor, setAlertEditor] = useState<AlertEditorState>(emptyAlertEditor);
  const [tableMode, setTableMode] = useState<"playlists" | "alerts">("playlists");

  useEffect(() => {
    void loadAlertRules();
  }, []);

  useEffect(() => {
    if (!selectedOwnerId) {
      setOwnerModalTab("tracked");
      setOwnerSpotifyPlaylists(null);
      setOwnerSpotifyTruncated(false);
      setOwnerSpotifyError(null);
      setOwnerSpotifyLoading(false);
      setOwnerProfile(null);
      return;
    }
    setOwnerModalTab("tracked");
    setOwnerSpotifyPlaylists(null);
    setOwnerSpotifyTruncated(false);
    setOwnerSpotifyError(null);
    setOwnerSpotifyLoading(false);
    setOwnerProfile(null);
  }, [selectedOwnerId]);

  useEffect(() => {
    if (!selectedOwnerId) return;

    let cancelled = false;
    fetch(`/api/playlist-watch/owners/${encodeURIComponent(selectedOwnerId)}/profile`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) return null;
        return (json.data as { owner?: OwnerProfile | null })?.owner ?? null;
      })
      .then((profile) => {
        if (!cancelled && profile) setOwnerProfile(profile);
      })
      .catch(() => {
        /* avatar is optional */
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOwnerId]);

  useEffect(() => {
    if (!selectedOwnerId || ownerModalTab !== "spotify") return;

    let cancelled = false;
    setOwnerSpotifyLoading(true);
    setOwnerSpotifyError(null);

    fetch(`/api/playlist-watch/owners/${encodeURIComponent(selectedOwnerId)}/playlists`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "Failed to load Spotify playlists");
        }
        return json.data as {
          playlists: OwnerSpotifyPlaylistRow[];
          truncated?: boolean;
          owner?: OwnerProfile | null;
        };
      })
      .then((data) => {
        if (cancelled) return;
        setOwnerSpotifyPlaylists(data?.playlists ?? []);
        setOwnerSpotifyTruncated(Boolean(data?.truncated));
        setOwnerProfile(data?.owner ?? null);
      })
      .catch((error) => {
        if (cancelled) return;
        setOwnerSpotifyPlaylists([]);
        setOwnerSpotifyError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setOwnerSpotifyLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedOwnerId, ownerModalTab]);

  async function addPlaylistFromOwnerTab(playlistId: string) {
    setBusyKey(`add-${playlistId}`);
    setMessage(null);
    try {
      await postPlaylist(playlistId);
      showToast("Playlist added to watchlist", "success");
      setOwnerSpotifyPlaylists((rows) =>
        rows
          ? rows.map((row) =>
              row.spotifyPlaylistId === playlistId
                ? { ...row, isTracked: true, watchStatus: "active" as const }
                : row,
            )
          : rows,
      );
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyKey(null);
    }
  }

  const activeCount = useMemo(() => playlists.filter((p) => p.watchStatus !== "archived").length, [playlists]);
  const favoriteCount = useMemo(() => playlists.filter((p) => p.isFavorite && p.watchStatus !== "archived").length, [playlists]);
  const archivedCount = useMemo(() => playlists.filter((p) => p.watchStatus === "archived").length, [playlists]);
  const filteredPlaylists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const byMode =
      filter === "favorites"
        ? playlists.filter((p) => p.isFavorite && p.watchStatus !== "archived")
        : filter === "archived"
          ? playlists.filter((p) => p.watchStatus === "archived")
          : playlists.filter((p) => p.watchStatus !== "archived");
    if (!q) return byMode;
    return byMode.filter((p) =>
      [
        p.displayName,
        p.ownerName,
        p.ownerSpotifyId,
        p.spotifyPlaylistId,
        p.lastCheckStatus,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [filter, playlists, searchQuery]);
  const sortedPlaylists = useMemo(() => {
    return [...filteredPlaylists].sort((a, b) =>
      compareNullableMetric(metricForSort(a, sortKey), metricForSort(b, sortKey), sortDir),
    );
  }, [filteredPlaylists, sortKey, sortDir]);

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
    return sortDir === "asc" ? (
      <ChevronUp className="ml-1 inline h-3 w-3 opacity-60" aria-hidden />
    ) : (
      <ChevronDown className="ml-1 inline h-3 w-3 opacity-60" aria-hidden />
    );
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
  const selectedOwnerStats = useMemo(() => {
    const totalFollowers = selectedOwnerPlaylists.reduce((sum, playlist) => sum + (playlist.latestFollowerCount ?? 0), 0);
    const topPlaylist = [...selectedOwnerPlaylists].sort((a, b) => (b.latestFollowerCount ?? 0) - (a.latestFollowerCount ?? 0))[0] ?? null;
    return {
      totalFollowers,
      tracked: selectedOwnerPlaylists.length,
      favorites: selectedOwnerPlaylists.filter((playlist) => playlist.isFavorite).length,
      topPlaylist,
    };
  }, [selectedOwnerPlaylists]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleIds = useMemo(() => sortedPlaylists.map((playlist) => playlist.spotifyPlaylistId), [sortedPlaylists]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));
  const selectedPlaylists = useMemo(
    () => playlists.filter((playlist) => selectedSet.has(playlist.spotifyPlaylistId)),
    [playlists, selectedSet],
  );

  useEffect(() => {
    setSelectedIds((ids) => ids.filter((id) => playlists.some((playlist) => playlist.spotifyPlaylistId === id)));
  }, [playlists]);

  async function postPlaylist(input: string) {
    const res = await fetch("/api/playlist-watch/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlist: input }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to add playlist");
  }

  async function addPlaylists(e?: React.FormEvent) {
    e?.preventDefault();
    const rawInput = bulkPlaylistInput;
    const entries = rawInput
      .split(/[\n,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    const uniqueEntries = Array.from(new Set(entries));

    if (uniqueEntries.length === 0) return;
    const invalidEntry = uniqueEntries.find((entry) => !looksLikeSpotifyPlaylistInput(entry));
    if (invalidEntry) {
      setMessage("Paste a Spotify playlist URL, URI, or playlist ID.");
      return;
    }

    setBusyKey("add");
    setMessage(null);
    setImportSummary(null);
    try {
      const existingIds = new Set(playlists.map((playlist) => playlist.spotifyPlaylistId));
      const summary: ImportSummary = { added: 0, alreadyTracked: 0, failed: [] };

      for (const entry of uniqueEntries) {
        const playlistId = extractPlaylistIdForSummary(entry);
        if (playlistId && existingIds.has(playlistId)) {
          summary.alreadyTracked += 1;
          continue;
        }
        try {
          await postPlaylist(entry);
          summary.added += 1;
        } catch (error) {
          summary.failed.push({
            input: entry,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      setImportSummary(summary);
      if (summary.failed.length === 0) {
        setBulkPlaylistInput("");
      }
      showToast(
        `${summary.added} added, ${summary.alreadyTracked} already tracked, ${summary.failed.length} failed`,
        summary.failed.length ? "warning" : "success",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function patchPlaylist(playlistId: string, body: Record<string, unknown>, refresh = true) {
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
      if (refresh) router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function patchSelected(bodyForPlaylist: (playlist: PlaylistWatchRow) => Record<string, unknown>, successMessage: string) {
    if (selectedPlaylists.length === 0) return;
    setBusyKey("bulk");
    setMessage(null);
    try {
      for (const playlist of selectedPlaylists) {
        await patchPlaylist(playlist.spotifyPlaylistId, bodyForPlaylist(playlist), false);
      }
      showToast(successMessage, "success");
      setSelectedIds([]);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  function toggleSelected(playlistId: string) {
    setSelectedIds((ids) =>
      ids.includes(playlistId) ? ids.filter((id) => id !== playlistId) : [...ids, playlistId],
    );
  }

  function toggleVisibleSelection() {
    setSelectedIds((ids) => {
      if (allVisibleSelected) return ids.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...ids, ...visibleIds]));
    });
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

  function selectFilter(nextFilter: PlaylistWatchFilter) {
    setFilter(nextFilter);
    if (nextFilter === "archived" && !includeArchived) {
      router.push("/playlist-watch?archived=1");
    } else if (nextFilter !== "archived" && includeArchived) {
      router.push("/playlist-watch");
    }
  }

  async function loadAlertRules() {
    setAlertsLoading(true);
    try {
      const res = await fetch("/api/playlist-watch/alerts", { method: "GET" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to load alert settings");
      setAlertRules(json.data?.rules ?? []);
      setAlertEvents(json.data?.events ?? []);
      setAlertsLoaded(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAlertsLoading(false);
    }
  }

  function playlistAlertRules(playlistId: string) {
    return alertRules.filter((rule) => rule.playlistIds.includes(playlistId));
  }

  function recentPlaylistAlert(playlistId: string) {
    return alertEvents.find((event) => event.spotify_playlist_id === playlistId && event.status === "sent") ?? null;
  }

  function openAlertEditor(playlistId: string | null, rule?: PlaylistWatchAlertRule) {
    const playlist = playlistId ? playlists.find((row) => row.spotifyPlaylistId === playlistId) : null;
    setAlertEditor({
      open: true,
      playlistId,
      editingRuleId: rule?.id ?? null,
      recipientEmail: rule?.recipientEmail ?? "",
      ruleName: rule?.ruleName ?? (playlist ? `${playlist.displayName} spike alert` : "Playlist follower spike"),
      isActive: rule?.isActive ?? true,
      minAbsoluteJump: rule?.minAbsoluteJump ? String(rule.minAbsoluteJump) : "500",
      minPercentJump: rule?.minPercentJump ? String(rule.minPercentJump) : "25",
      comparisonWindowDays: String(rule?.comparisonWindowDays ?? 7),
      scope: playlistId ? "playlist" : "all",
    });
    if (!alertsLoaded && !alertsLoading) void loadAlertRules();
  }

  async function saveAlertRule(e?: React.FormEvent) {
    e?.preventDefault();
    const recipientEmail = alertEditor.recipientEmail.trim();
    const minAbsoluteJump = alertEditor.minAbsoluteJump.trim() ? Number(alertEditor.minAbsoluteJump) : null;
    const minPercentJump = alertEditor.minPercentJump.trim() ? Number(alertEditor.minPercentJump) : null;
    const comparisonWindowDays = Math.max(1, Math.min(30, Math.round(Number(alertEditor.comparisonWindowDays) || 7)));
    if (!recipientEmail) {
      setMessage("Add a recipient email for the alert.");
      return;
    }
    if (!minAbsoluteJump && !minPercentJump) {
      setMessage("Add at least one follower jump threshold.");
      return;
    }

    setBusyKey("alert-save");
    setMessage(null);
    try {
      const playlistIds =
        alertEditor.scope === "playlist" && alertEditor.playlistId ? [alertEditor.playlistId] : [];
      const endpoint = alertEditor.editingRuleId
        ? `/api/playlist-watch/alerts/${alertEditor.editingRuleId}`
        : "/api/playlist-watch/alerts";
      const res = await fetch(endpoint, {
        method: alertEditor.editingRuleId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail,
          ruleName: alertEditor.ruleName,
          isActive: alertEditor.isActive,
          minAbsoluteJump,
          minPercentJump,
          comparisonWindowDays,
          playlistIds,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to save alert");
      await loadAlertRules();
      setAlertEditor(emptyAlertEditor);
      showToast("Alert settings saved", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteAlertRule(ruleId: number) {
    setBusyKey(`alert-delete-${ruleId}`);
    setMessage(null);
    try {
      const res = await fetch(`/api/playlist-watch/alerts/${ruleId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to delete alert");
      await loadAlertRules();
      showToast("Alert deleted", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  async function sendTestAlertEmail() {
    const recipientEmail = alertEditor.recipientEmail.trim();
    if (!recipientEmail) {
      setMessage("Add an email address before sending a test.");
      return;
    }
    setBusyKey("alert-test");
    setMessage(null);
    try {
      const res = await fetch("/api/playlist-watch/alerts/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? "Failed to send test email");
      showToast("Test email sent", "success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyKey(null);
    }
  }

  const alertPreview = useMemo(() => {
    if (!alertEditor.playlistId) return null;
    const playlist = playlists.find((row) => row.spotifyPlaylistId === alertEditor.playlistId);
    if (!playlist) return null;
    const minAbsoluteJump = alertEditor.minAbsoluteJump.trim() ? Number(alertEditor.minAbsoluteJump) : null;
    const minPercentJump = alertEditor.minPercentJump.trim() ? Number(alertEditor.minPercentJump) : null;
    if (!minAbsoluteJump && !minPercentJump) return null;
    return buildAlertPreview({
      history: playlist.history,
      minAbsoluteJump,
      minPercentJump,
      comparisonWindowDays: Number(alertEditor.comparisonWindowDays) || 7,
    });
  }, [
    alertEditor.comparisonWindowDays,
    alertEditor.minAbsoluteJump,
    alertEditor.minPercentJump,
    alertEditor.playlistId,
    playlists,
  ]);

  return (
    <div className="space-y-4 [&_a]:cursor-pointer [&_button:not(:disabled)]:cursor-pointer [&_button:disabled]:cursor-not-allowed [&_input[type='checkbox']]:cursor-pointer">
      <div className="sb-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <ChipGroup segmented aria-label="Playlist watch filters">
            <Chip segmented selected={filter === "active"} onClick={() => selectFilter("active")}>
              Active <span className="font-mono opacity-70">{formatInt(activeCount)}</span>
            </Chip>
            <Chip segmented selected={filter === "favorites"} onClick={() => selectFilter("favorites")}>
              Favorites <span className="font-mono opacity-70">{formatInt(favoriteCount)}</span>
            </Chip>
            <Chip segmented selected={filter === "archived"} onClick={() => selectFilter("archived")}>
              Archived {includeArchived ? <span className="font-mono opacity-70">{formatInt(archivedCount)}</span> : null}
            </Chip>
          </ChipGroup>
          {filter === "archived" ? (
            <div className="hidden text-xs sm:block" style={{ color: "var(--sb-muted)" }}>
              Archived playlists keep their history but are not tracked.
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTableMode((mode) => (mode === "alerts" ? "playlists" : "alerts"));
              if (!alertsLoaded && !alertsLoading) void loadAlertRules();
            }}
            className="sb-ring inline-flex h-9 items-center gap-2 rounded-lg bg-white/60 px-3 text-sm font-semibold hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
            style={{ color: "var(--sb-text)" }}
            title={tableMode === "alerts" ? "Show playlist table" : "Show alert history"}
          >
            <BellRing className="h-4 w-4" aria-hidden />
            <span>{tableMode === "alerts" ? "Playlists" : "Alert history"}</span>
            {alertRules.length > 0 ? (
              <span className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-[10px] dark:bg-white/15">
                {formatInt(alertRules.filter((rule) => rule.isActive).length)}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => openAlertEditor(null)}
            className="sb-ring grid h-9 w-9 place-items-center rounded-lg bg-white/60 hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
            style={{ color: "var(--sb-text)" }}
            title="Create notification alert"
            aria-label="Create notification alert"
          >
            <Bell className="h-4 w-4" aria-hidden />
          </button>
        {isAdmin ? (
          <button
            type="button"
            disabled={busyKey === "add"}
            onClick={() => {
              setImportSummary(null);
              if (message) setMessage(null);
              setBulkAddOpen(true);
            }}
            className="sb-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] disabled:opacity-40"
            style={{
              background: "var(--sb-accent)",
              color: "var(--sb-accent-text,#000)",
              boxShadow: "var(--sb-shadow-compact)",
            }}
          >
            <Plus className="h-4 w-4 shrink-0" aria-hidden />
            <span>{busyKey === "add" ? "Adding..." : "Add playlists"}</span>
          </button>
        ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
          {message}
        </div>
      ) : null}

      {filter === "archived" ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-100">
          Archived playlists keep their saved history, but the daily follower job skips them until they are unarchived.
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="sb-ring flex h-9 min-w-0 items-center gap-2 rounded-lg bg-white/60 px-3 sm:w-[360px] dark:bg-white/10">
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--sb-muted)" }} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search playlist, owner, ID, or status"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-black/35 dark:placeholder:text-white/35"
            style={{ color: "var(--sb-text)" }}
          />
          {searchQuery ? (
            <button type="button" title="Clear search" onClick={() => setSearchQuery("")} className="opacity-70 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span style={{ color: "var(--sb-muted)" }}>{selectedIds.length} selected</span>
            <button
              type="button"
              disabled={busyKey !== null}
              onClick={() => patchSelected((playlist) => ({ action: "favorite", is_favorite: !playlist.isFavorite }), "Favorites updated")}
              className="sb-ring rounded-lg px-2.5 py-1.5 font-medium hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
            >
              Toggle favorite
            </button>
            {isAdmin ? (
              filter === "archived" ? (
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => patchSelected(() => ({ action: "unarchive" }), "Selected playlists unarchived")}
                  className="sb-ring rounded-lg px-2.5 py-1.5 font-medium hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                >
                  Unarchive
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => patchSelected(() => ({ action: "archive" }), "Selected playlists archived")}
                  className="sb-ring rounded-lg px-2.5 py-1.5 font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-40"
                >
                  Archive
                </button>
              )
            ) : null}
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="sb-ring rounded-lg px-2.5 py-1.5 font-medium hover:bg-black/5 dark:hover:bg-white/10"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <Modal
        open={bulkAddOpen}
        onClose={() => setBulkAddOpen(false)}
        title="Add playlists"
        subtitle="Paste one Spotify playlist URL, URI, or ID per line. Commas work too."
        maxWidthClassName="max-w-2xl"
        headerActions={
          <button
            type="button"
            disabled={busyKey === "add" || !bulkPlaylistInput.trim()}
            onClick={() => addPlaylists()}
            className="sb-ring rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/85"
          >
            {busyKey === "add" ? "Adding..." : "Add"}
          </button>
        }
      >
        <form onSubmit={addPlaylists} className="space-y-3">
          <textarea
            autoFocus
            value={bulkPlaylistInput}
            onChange={(event) => {
              setBulkPlaylistInput(event.target.value);
              if (message) setMessage(null);
            }}
            placeholder={[
              "https://open.spotify.com/playlist/...",
              "spotify:playlist:...",
              "37i9dQZF1DXcBWIGoYBM5M",
            ].join("\n")}
            className="sb-ring min-h-56 w-full resize-y rounded-lg bg-white/60 px-3 py-3 font-mono text-sm outline-none transition placeholder:text-black/35 focus:ring-2 focus:ring-[var(--sb-accent)] dark:bg-white/10 dark:placeholder:text-white/35"
            style={{ color: "var(--sb-text)" }}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
              {bulkPlaylistInput.split(/[\n,]+/).filter((entry) => entry.trim()).length || 0} playlist
              {bulkPlaylistInput.split(/[\n,]+/).filter((entry) => entry.trim()).length === 1 ? "" : "s"} ready
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBulkAddOpen(false)}
                className="sb-ring rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busyKey === "add" || !bulkPlaylistInput.trim()}
                className="sb-ring rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/85"
              >
                {busyKey === "add" ? "Adding..." : "Add playlists"}
              </button>
            </div>
          </div>
          {importSummary ? (
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}>
              <div className="font-medium">Import result</div>
              <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                {importSummary.added} added, {importSummary.alreadyTracked} already tracked, {importSummary.failed.length} failed.
              </div>
              {importSummary.failed.length > 0 ? (
                <div className="mt-2 max-h-28 space-y-1 overflow-auto text-xs">
                  {importSummary.failed.map((failure) => (
                    <div key={failure.input} className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1">
                      <span className="font-mono">{failure.input}</span>
                      <span className="ml-2 text-red-700 dark:text-red-200">{failure.error}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </Modal>

      {tableMode === "alerts" ? (
        <GlassTable
          headers={[
            "Date",
            "Playlist",
            { label: "Jump", align: "right" },
            { label: "Baseline", align: "right" },
            { label: "Current", align: "right" },
            "Recipient",
            "Status",
          ]}
          maxBodyHeightClassName="max-h-[680px]"
        >
          {alertEvents.length === 0 ? (
            <EmptyState
              colSpan={7}
              message="No alert history yet."
              description="Triggered Playlist Watch notifications will appear here after the daily job runs."
            />
          ) : (
            alertEvents.map((event) => {
              const playlist = playlists.find((row) => row.spotifyPlaylistId === event.spotify_playlist_id);
              return (
                <TableRow key={event.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{event.run_date}</span>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      disabled={!event.spotify_playlist_id}
                      onClick={() => event.spotify_playlist_id && setSelectedPlaylistId(event.spotify_playlist_id)}
                      className="max-w-[280px] truncate text-left text-sm font-medium hover:underline disabled:hover:no-underline"
                    >
                      {playlist?.displayName ?? event.spotify_playlist_id ?? "Unknown playlist"}
                    </button>
                  </TableCell>
                  <TableCell numeric>
                    +{formatInt(event.absolute_jump)}
                    {event.percent_jump !== null ? (
                      <span className="ml-1 text-[11px]" style={{ color: "var(--sb-muted)" }}>
                        {Number(event.percent_jump).toFixed(1)}%
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell numeric>{formatInt(event.baseline_count)}</TableCell>
                  <TableCell numeric>{formatInt(event.current_count)}</TableCell>
                  <TableCell>
                    <span className="block max-w-[220px] truncate text-xs">{event.recipient_email}</span>
                  </TableCell>
                  <TableCell>
                    <span className={event.status === "sent" ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}>
                      {event.status}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </GlassTable>
      ) : (
      <GlassTable
        headers={[
          {
            label: (
              <input
                type="checkbox"
                aria-label="Select visible playlists"
                checked={allVisibleSelected}
                onChange={toggleVisibleSelection}
                className="h-3.5 w-3.5 accent-[var(--sb-accent)]"
              />
            ),
            className: "w-8",
          },
          "Playlist",
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("followers")}>
                FOLLOWERS{sortIndicator("followers")}
              </button>
            ),
            align: "right",
          },
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("delta1d")}>
                1D{sortIndicator("delta1d")}
              </button>
            ),
            align: "right",
          },
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("delta7d")}>
                7D{sortIndicator("delta7d")}
              </button>
            ),
            align: "right",
          },
          {
            label: (
              <button type="button" className="sb-link-hover" onClick={() => toggleSort("delta30d")}>
                30D{sortIndicator("delta30d")}
              </button>
            ),
            align: "right",
          },
          { label: "Sparkline (14d)", align: "center" },
          { label: "", align: "right" },
        ]}
        maxBodyHeightClassName="max-h-[680px]"
      >
        {sortedPlaylists.length === 0 ? (
          <EmptyState
            colSpan={8}
            message={
              filter === "favorites"
                ? "No favorite playlists yet."
                : filter === "archived"
                  ? "No archived playlists found."
                  : "No active playlists found."
            }
            description={filter === "archived" ? "Archived playlists appear here after you choose Archive on a row." : undefined}
          />
        ) : (
          sortedPlaylists.map((playlist) => (
            (() => {
              const recentAlert = recentPlaylistAlert(playlist.spotifyPlaylistId);
              return (
            <TableRow
              key={playlist.spotifyPlaylistId}
              className={[
                "cursor-pointer",
                playlist.watchStatus === "archived" ? "opacity-75" : "",
              ].filter(Boolean).join(" ")}
              style={playlist.watchStatus === "archived" ? { boxShadow: "inset 3px 0 0 rgba(239, 68, 68, 0.65)" } : undefined}
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("[data-row-action]")) return;
                setSelectedPlaylistId(playlist.spotifyPlaylistId);
              }}
            >
              <TableCell align="center">
                <input
                  type="checkbox"
                  aria-label={`Select ${playlist.displayName}`}
                  checked={selectedSet.has(playlist.spotifyPlaylistId)}
                  data-row-action
                  onChange={() => toggleSelected(playlist.spotifyPlaylistId)}
                  className="h-3.5 w-3.5 accent-[var(--sb-accent)]"
                />
              </TableCell>
              <TableCell>
                <div className="flex min-w-[260px] items-center gap-3">
                  {playlist.imageUrl ? (
                    <PreviewableArtwork src={playlist.imageUrl} alt={playlist.displayName} width={40} height={40} className="h-10 w-10 rounded-lg object-cover sb-ring" />
                  ) : (
                    <div className="h-10 w-10 rounded-lg bg-white/10 sb-ring" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <StatusIcon playlist={playlist} />
                      {playlist.isFavorite ? <Heart className="h-3.5 w-3.5 fill-current text-red-500" /> : null}
                      {recentAlert ? (
                        <button
                          type="button"
                          data-row-action
                          title={`Latest alert ${recentAlert.run_date}: +${formatInt(recentAlert.absolute_jump)} followers`}
                          onClick={() => setTableMode("alerts")}
                          className="sb-ring inline-flex h-5 items-center gap-1 rounded bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-500/25 dark:text-amber-200"
                        >
                          <BellRing className="h-3 w-3" />
                          +{formatInt(recentAlert.absolute_jump)}
                        </button>
                      ) : null}
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
                          data-row-action
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
                          data-row-action
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
              <TableCell numeric><TrendValue value={playlist.delta1d} /></TableCell>
              <TableCell numeric><TrendValue value={playlist.delta7d} /></TableCell>
              <TableCell numeric><TrendValue value={playlist.delta30d} /></TableCell>
              <TableCell align="center">
                <FollowerSparkline history={playlist.history} />
              </TableCell>
              <TableCell align="right">
                <div className="flex justify-end gap-1">
                  <button
                    title="Copy Spotify URL"
                    disabled={busyKey !== null}
                    data-row-action
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
                    data-row-action
                    className="sb-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <div className="mx-1 h-8 w-px" style={{ background: "var(--sb-border)" }} />
                  <button
                    title={playlistAlertRules(playlist.spotifyPlaylistId).some((rule) => rule.isActive) ? "Edit playlist alerts" : "Add playlist alert"}
                    disabled={busyKey !== null}
                    data-row-action
                    onClick={() => openAlertEditor(playlist.spotifyPlaylistId, playlistAlertRules(playlist.spotifyPlaylistId)[0])}
                    className="sb-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                  >
                    {playlistAlertRules(playlist.spotifyPlaylistId).some((rule) => rule.isActive) ? (
                      <BellRing className="h-4 w-4 text-amber-500" />
                    ) : (
                      <Bell className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    title={playlist.isFavorite ? "Remove favorite" : "Favorite"}
                    disabled={busyKey !== null}
                    data-row-action
                    onClick={() => patchPlaylist(playlist.spotifyPlaylistId, { action: "favorite", is_favorite: !playlist.isFavorite })}
                    className="sb-ring grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
                  >
                    <Heart className={["h-4 w-4", playlist.isFavorite ? "fill-current text-red-500" : ""].join(" ")} />
                  </button>
                  {isAdmin ? (
                    <button
                      title={playlist.watchStatus === "archived" ? "Unarchive" : "Archive"}
                      disabled={busyKey !== null}
                      data-row-action
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
              );
            })()
          ))
        )}
      </GlassTable>
      )}

      <Modal
        open={Boolean(selectedPlaylist)}
        onClose={() => setSelectedPlaylistId(null)}
        title={
          selectedPlaylist ? (
            <span className="flex min-w-0 items-center gap-3">
              {selectedPlaylist.imageUrl ? (
                <PreviewableArtwork
                  src={selectedPlaylist.imageUrl}
                  alt={selectedPlaylist.displayName}
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg object-cover sb-ring"
                />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-lg bg-white/10 sb-ring" aria-hidden />
              )}
              <span className="flex min-w-0 items-center gap-2">
                <StatusIcon playlist={selectedPlaylist} />
                <span className="truncate">{selectedPlaylist.displayName}</span>
              </span>
            </span>
          ) : (
            "Playlist"
          )
        }
        subtitle={
          selectedPlaylist ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{selectedPlaylist.ownerName ?? "Unknown owner"}</span>
              <span className="opacity-40">-</span>
              <span>
                Snapshot {selectedPlaylist.latestSnapshotDate ? formatTooltipDateDaily(selectedPlaylist.latestSnapshotDate) : "not available"}
              </span>
              <span className="opacity-40">-</span>
              <span>Last checked {formatCheckedAt(selectedPlaylist.latestCheckedAt)}</span>
            </span>
          ) : undefined
        }
        maxWidthClassName="max-w-4xl"
        headerActions={
          selectedPlaylist ? (
            <>
              <button
                type="button"
                title="Notification settings"
                onClick={() => openAlertEditor(selectedPlaylist.spotifyPlaylistId, playlistAlertRules(selectedPlaylist.spotifyPlaylistId)[0])}
                className="sb-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/60 px-2.5 text-xs font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
                style={{ color: "var(--sb-text)" }}
              >
                {playlistAlertRules(selectedPlaylist.spotifyPlaylistId).some((rule) => rule.isActive) ? (
                  <BellRing className="h-3.5 w-3.5 text-amber-500" />
                ) : (
                  <Bell className="h-3.5 w-3.5" />
                )}
                Alerts
              </button>
              <button
                type="button"
                title="Copy Spotify URL"
                onClick={() => copyPlaylistUrl(selectedPlaylist)}
                className="sb-ring grid h-8 w-8 place-items-center rounded-lg bg-white/60 hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
                style={{ color: "var(--sb-text)" }}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
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
            </>
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

            <div
              className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {playlistAlertRules(selectedPlaylist.spotifyPlaylistId).some((rule) => rule.isActive) ? (
                    <BellRing className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Bell className="h-4 w-4 opacity-70" />
                  )}
                  <span>Notifications</span>
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                  {playlistAlertRules(selectedPlaylist.spotifyPlaylistId).length > 0
                    ? playlistAlertRules(selectedPlaylist.spotifyPlaylistId)
                        .map((rule) => `${rule.isActive ? "On" : "Off"}: ${rule.minAbsoluteJump ? `+${formatInt(rule.minAbsoluteJump)} followers` : ""}${rule.minAbsoluteJump && rule.minPercentJump ? " and " : ""}${rule.minPercentJump ? `+${rule.minPercentJump}%` : ""}`)
                        .join(" / ")
                    : "No playlist-specific alert yet."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => openAlertEditor(selectedPlaylist.spotifyPlaylistId, playlistAlertRules(selectedPlaylist.spotifyPlaylistId)[0])}
                className="sb-ring inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-black px-3 text-sm font-semibold text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/85"
              >
                <Bell className="h-4 w-4" />
                {playlistAlertRules(selectedPlaylist.spotifyPlaylistId).length > 0 ? "Adjust alert" : "Add alert"}
              </button>
            </div>

            <PlaylistFollowerChart
              key={selectedPlaylist.spotifyPlaylistId}
              history={selectedPlaylist.history}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={alertEditor.open}
        onClose={() => setAlertEditor(emptyAlertEditor)}
        title={alertEditor.playlistId ? "Playlist notifications" : "Notification alerts"}
        subtitle={
          alertEditor.playlistId
            ? playlists.find((row) => row.spotifyPlaylistId === alertEditor.playlistId)?.displayName
            : "Follower spike rules for Playlist Watch"
        }
        maxWidthClassName="max-w-3xl"
        headerActions={
          <button
            type="button"
            disabled={busyKey === "alert-save"}
            onClick={() => saveAlertRule()}
            className="sb-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-black px-3 text-xs font-semibold text-white hover:bg-black/80 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-white/85"
          >
            {busyKey === "alert-save" ? "Saving..." : "Save alert"}
          </button>
        }
      >
        <div className="space-y-4">
          <form onSubmit={saveAlertRule} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
              <label className="block">
                <span className="mb-1 block text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
                  Email recipient
                </span>
                <span className="sb-ring flex h-10 items-center gap-2 rounded-lg bg-white/60 px-3 dark:bg-white/10">
                  <Mail className="h-4 w-4 opacity-60" aria-hidden />
                  <input
                    type="email"
                    value={alertEditor.recipientEmail}
                    onChange={(event) => setAlertEditor((state) => ({ ...state, recipientEmail: event.target.value }))}
                    placeholder="you@example.com"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-black/35 dark:placeholder:text-white/35"
                    style={{ color: "var(--sb-text)" }}
                  />
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
                  Status
                </span>
                <button
                  type="button"
                  onClick={() => setAlertEditor((state) => ({ ...state, isActive: !state.isActive }))}
                  className="sb-ring flex h-10 w-full items-center justify-between rounded-lg bg-white/60 px-3 text-sm font-semibold dark:bg-white/10"
                >
                  <span>{alertEditor.isActive ? "On" : "Off"}</span>
                  {alertEditor.isActive ? <BellRing className="h-4 w-4 text-amber-500" /> : <Bell className="h-4 w-4 opacity-60" />}
                </button>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
                Rule name
              </span>
              <input
                value={alertEditor.ruleName}
                onChange={(event) => setAlertEditor((state) => ({ ...state, ruleName: event.target.value }))}
                className="sb-ring h-10 w-full rounded-lg bg-white/60 px-3 text-sm outline-none dark:bg-white/10"
                style={{ color: "var(--sb-text)" }}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
                  Follower jump
                </span>
                <input
                  type="number"
                  min="1"
                  value={alertEditor.minAbsoluteJump}
                  onChange={(event) => setAlertEditor((state) => ({ ...state, minAbsoluteJump: event.target.value }))}
                  className="sb-ring h-10 w-full rounded-lg bg-white/60 px-3 font-mono text-sm outline-none dark:bg-white/10"
                  style={{ color: "var(--sb-text)" }}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
                  Percent jump
                </span>
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={alertEditor.minPercentJump}
                  onChange={(event) => setAlertEditor((state) => ({ ...state, minPercentJump: event.target.value }))}
                  className="sb-ring h-10 w-full rounded-lg bg-white/60 px-3 font-mono text-sm outline-none dark:bg-white/10"
                  style={{ color: "var(--sb-text)" }}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
                  Average window
                </span>
                <select
                  value={alertEditor.comparisonWindowDays}
                  onChange={(event) => setAlertEditor((state) => ({ ...state, comparisonWindowDays: event.target.value }))}
                  className="sb-ring h-10 w-full rounded-lg bg-white/60 px-3 text-sm outline-none dark:bg-white/10"
                  style={{ color: "var(--sb-text)" }}
                >
                  <option value="1">Yesterday</option>
                  <option value="3">3-day average</option>
                  <option value="7">7-day average</option>
                  <option value="14">14-day average</option>
                  <option value="30">30-day average</option>
                </select>
              </label>
            </div>

            {alertEditor.playlistId ? (
              <ChipGroup segmented aria-label="Alert scope">
                <Chip segmented selected={alertEditor.scope === "playlist"} onClick={() => setAlertEditor((state) => ({ ...state, scope: "playlist" }))}>
                  This playlist
                </Chip>
                <Chip segmented selected={alertEditor.scope === "all"} onClick={() => setAlertEditor((state) => ({ ...state, scope: "all" }))}>
                  All active playlists
                </Chip>
              </ChipGroup>
            ) : null}

            {alertEditor.playlistId ? (
              <div className="rounded-lg border p-3" style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <BellRing className="h-4 w-4 text-amber-500" />
                  <span>Recent trigger preview</span>
                </div>
                <div className="mt-1 text-xs leading-5" style={{ color: "var(--sb-muted)" }}>
                  {alertPreview?.needsMoreHistory ? (
                    "This playlist does not have enough history for the selected average window yet."
                  ) : alertPreview ? (
                    alertPreview.triggerCount > 0 ? (
                      <>
                        This rule would have triggered {alertPreview.triggerCount} time{alertPreview.triggerCount === 1 ? "" : "s"} across {alertPreview.checkedDays} checked day{alertPreview.checkedDays === 1 ? "" : "s"}.
                        {alertPreview.latestTrigger ? (
                          <span className="block">
                            Latest: {formatTooltipDateDaily(alertPreview.latestTrigger.date)} at +{formatInt(alertPreview.latestTrigger.absoluteJump)} followers
                            {alertPreview.latestTrigger.percentJump !== null ? ` (${alertPreview.latestTrigger.percentJump.toFixed(1)}%).` : "."}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      `This rule would not have triggered across ${alertPreview.checkedDays} checked day${alertPreview.checkedDays === 1 ? "" : "s"}.`
                    )
                  ) : (
                    "Add at least one threshold to preview recent matches."
                  )}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busyKey === "alert-test" || !alertEditor.recipientEmail.trim()}
                onClick={sendTestAlertEmail}
                className="sb-ring inline-flex h-9 items-center gap-2 rounded-lg bg-white/60 px-3 text-sm font-semibold hover:bg-white/80 disabled:opacity-40 dark:bg-white/10 dark:hover:bg-white/15"
                style={{ color: "var(--sb-text)" }}
              >
                <Mail className="h-4 w-4" />
                {busyKey === "alert-test" ? "Sending..." : "Send test"}
              </button>
              <button
                type="submit"
                disabled={busyKey === "alert-save"}
                className="sb-ring inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--sb-accent)", color: "var(--sb-accent-text,#000)" }}
              >
                <Bell className="h-4 w-4" />
                {busyKey === "alert-save" ? "Saving..." : "Save alert"}
              </button>
            </div>
          </form>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border p-3" style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--sb-muted)" }}>
                Existing rules
              </div>
              {alertsLoading ? (
                <p className="text-sm" style={{ color: "var(--sb-muted)" }}>Loading alert rules...</p>
              ) : alertRules.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--sb-muted)" }}>No alert rules yet.</p>
              ) : (
                <div className="space-y-2">
                  {alertRules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/50 px-2 py-2 text-sm dark:bg-white/5">
                      <button
                        type="button"
                        onClick={() => openAlertEditor(rule.playlistIds[0] ?? null, rule)}
                        className="min-w-0 text-left"
                      >
                        <span className="block truncate font-medium">{rule.ruleName}</span>
                        <span className="block truncate text-[11px]" style={{ color: "var(--sb-muted)" }}>
                          {rule.playlistIds.length ? `${rule.playlistIds.length} playlist${rule.playlistIds.length === 1 ? "" : "s"}` : "All active playlists"} to {rule.recipientEmail}
                        </span>
                      </button>
                      <button
                        type="button"
                        title="Delete alert"
                        disabled={busyKey === `alert-delete-${rule.id}`}
                        onClick={() => deleteAlertRule(rule.id)}
                        className="sb-ring grid h-8 w-8 shrink-0 place-items-center rounded-lg text-red-600 hover:bg-red-500/10 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border p-3" style={{ borderColor: "var(--sb-border)", background: "var(--sb-surface)" }}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--sb-muted)" }}>
                Recent notifications
              </div>
              {alertEvents.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--sb-muted)" }}>No notifications sent yet.</p>
              ) : (
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {alertEvents.map((event) => (
                    <div key={event.id} className="rounded-lg bg-white/50 px-2 py-2 text-xs dark:bg-white/5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono">{event.run_date}</span>
                        <span className={event.status === "sent" ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}>
                          {event.status}
                        </span>
                      </div>
                      <div className="mt-1 truncate" style={{ color: "var(--sb-muted)" }}>
                        {event.spotify_playlist_id ?? "playlist"}: +{formatInt(event.absolute_jump)} followers
                        {event.percent_jump !== null ? ` (${Number(event.percent_jump).toFixed(1)}%)` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedOwnerId)}
        onClose={() => setSelectedOwnerId(null)}
        title={
          <span className="flex min-w-0 items-center gap-3">
            {ownerProfile?.imageUrl ? (
              <PreviewableArtwork
                src={ownerProfile.imageUrl}
                alt={ownerProfile.displayName ?? "Owner"}
                width={44}
                height={44}
                className="h-11 w-11 shrink-0 rounded-full object-cover sb-ring"
              />
            ) : (
              <div
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full sb-ring"
                style={{ background: "var(--sb-surface)" }}
                aria-hidden
              >
                <User className="h-5 w-5 opacity-50" />
              </div>
            )}
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-semibold tracking-tight">
                {ownerProfile?.displayName ?? selectedOwnerName ?? "Playlist owner"}
              </span>
              {selectedOwnerId ? (
                <span className="block truncate text-xs font-normal" style={{ color: "var(--sb-muted)" }}>
                  {selectedOwnerId}
                </span>
              ) : null}
            </span>
          </span>
        }
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
              Spotify profile
            </a>
          ) : null
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile label="Tracked" value={formatInt(selectedOwnerStats.tracked)} />
            <MetricTile label="Followers" value={formatInt(selectedOwnerStats.totalFollowers)} />
            <MetricTile label="Favorites" value={formatInt(selectedOwnerStats.favorites)} />
            <MetricTile label="Top playlist" value={selectedOwnerStats.topPlaylist ? formatInt(selectedOwnerStats.topPlaylist.latestFollowerCount) : "-"} />
          </div>

          <ChipGroup segmented aria-label="Owner playlist views">
            <Chip segmented selected={ownerModalTab === "tracked"} onClick={() => setOwnerModalTab("tracked")}>
              Tracked <span className="font-mono opacity-70">{formatInt(selectedOwnerStats.tracked)}</span>
            </Chip>
            <Chip segmented selected={ownerModalTab === "spotify"} onClick={() => setOwnerModalTab("spotify")}>
              On Spotify
            </Chip>
          </ChipGroup>

          {ownerModalTab === "tracked" ? (
            selectedOwnerPlaylists.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
                No tracked playlists for this owner yet.
              </p>
            ) : (
              selectedOwnerPlaylists.map((playlist) => (
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
                  <span className="min-w-0 flex items-center gap-2.5">
                    {playlist.imageUrl ? (
                      <PreviewableArtwork
                        src={playlist.imageUrl}
                        alt={playlist.displayName}
                        width={40}
                        height={40}
                        interactive="inline"
                        className="h-10 w-10 shrink-0 rounded object-cover sb-ring"
                      />
                    ) : (
                      <div className="h-10 w-10 shrink-0 rounded bg-white/10 sb-ring" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{playlist.displayName}</span>
                      <span className="block truncate text-[11px]" style={{ color: "var(--sb-muted)" }}>
                        {playlist.spotifyPlaylistId}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-sm">{formatInt(playlist.latestFollowerCount)}</span>
                </button>
              ))
            )
          ) : ownerSpotifyLoading ? (
            <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
              Loading playlists from Spotify...
            </p>
          ) : ownerSpotifyError ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
              {ownerSpotifyError}
            </div>
          ) : ownerSpotifyPlaylists && ownerSpotifyPlaylists.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--sb-muted)" }}>
              No public playlists found for this user on Spotify.
            </p>
          ) : (
            <>
              {ownerSpotifyTruncated ? (
                <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
                  Showing the first playlists returned by Spotify. Open their profile for the full list.
                </p>
              ) : null}
              <div className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
                {ownerSpotifyPlaylists?.map((playlist) => {
                  const isActive = playlist.watchStatus === "active";
                  const isArchived = playlist.watchStatus === "archived";
                  const adding = busyKey === `add-${playlist.spotifyPlaylistId}`;
                  return (
                    <div
                      key={playlist.spotifyPlaylistId}
                      className="sb-ring flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      style={{ borderColor: "var(--sb-border)" }}
                    >
                      <span className="min-w-0 flex items-center gap-2.5">
                        {playlist.imageUrl ? (
                          <PreviewableArtwork
                            src={playlist.imageUrl}
                            alt={playlist.displayName}
                            width={40}
                            height={40}
                            interactive="inline"
                            className="h-10 w-10 shrink-0 rounded object-cover sb-ring"
                          />
                        ) : (
                          <div className="h-10 w-10 shrink-0 rounded bg-white/10 sb-ring" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{playlist.displayName}</span>
                          <span className="block truncate font-mono text-[11px]" style={{ color: "var(--sb-muted)" }}>
                            {playlist.followerCount !== null
                              ? `${formatInt(playlist.followerCount)} followers`
                              : "Followers unavailable"}
                          </span>
                        </span>
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        {isActive ? (
                          <span className="text-[11px] font-medium" style={{ color: "var(--sb-muted)" }}>
                            Tracking
                          </span>
                        ) : isArchived ? (
                          <span className="text-[11px] font-medium text-orange-600 dark:text-orange-300">Archived</span>
                        ) : isAdmin ? (
                          <button
                            type="button"
                            disabled={busyKey !== null}
                            onClick={() => addPlaylistFromOwnerTab(playlist.spotifyPlaylistId)}
                            className="sb-ring inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition hover:opacity-90 disabled:opacity-40"
                            style={{
                              background: "var(--sb-accent)",
                              color: "var(--sb-accent-text,#000)",
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden />
                            {adding ? "Adding..." : "Track"}
                          </button>
                        ) : null}
                        {isActive ? (
                          <button
                            type="button"
                            title="Open playlist details"
                            onClick={() => {
                              setSelectedOwnerId(null);
                              setSelectedPlaylistId(playlist.spotifyPlaylistId);
                            }}
                            className="sb-ring rounded-lg px-2 py-1.5 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10"
                          >
                            View
                          </button>
                        ) : playlist.spotifyUrl ? (
                          <a
                            href={playlist.spotifyUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open in Spotify"
                            aria-label="Open in Spotify"
                            className="sb-ring grid h-8 w-8 place-items-center rounded-lg bg-white/60 hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
                            style={{ color: "var(--sb-text)" }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
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

function FollowerSparkline({ history }: { history: FollowerHistoryPoint[] }) {
  const points = history.slice(-14);
  if (points.length < 2) {
    return (
      <span className="text-[11px]" style={{ color: "var(--sb-muted)" }} title="Needs at least two snapshots">
        -
      </span>
    );
  }

  const values = points.map((point) => point.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 92;
  const height = 28;
  const path = values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = max === min ? height / 2 : height - ((value - min) / (max - min)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const delta = values[values.length - 1] - values[0];
  const color = delta >= 0 ? "var(--sb-positive)" : "rgb(239 68 68)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mx-auto h-7 w-[92px]"
      role="img"
      aria-label={`14 day follower trend ${fmtDelta(delta)}`}
    >
      <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={width} cy={path.split("L").at(-1)?.split(",").at(1) ?? height / 2} r="2.5" fill={color} />
    </svg>
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
