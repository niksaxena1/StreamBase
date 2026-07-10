import type { FollowerHistoryPoint } from "@/lib/playlistWatch/history";
import { formatInt } from "@/lib/format";

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
export type PlaylistWatchSortKey =
  | "followers"
  | "delta1d"
  | "delta7d"
  | "delta30d";
export type PlaylistWatchFilter = "active" | "favorites" | "archived";
export type ImportSummary = {
  added: number;
  alreadyTracked: number;
  failed: { input: string; error: string }[];
} | null;
export type OwnerModalTab = "tracked" | "spotify";
export type OwnerSpotifyPlaylistRow = {
  spotifyPlaylistId: string;
  displayName: string;
  imageUrl: string | null;
  spotifyUrl: string | null;
  followerCount: number | null;
  watchStatus: "active" | "archived" | null;
  isTracked: boolean;
};
export type OwnerProfile = {
  displayName: string | null;
  imageUrl: string | null;
};
export type PlaylistWatchAlertRule = {
  id: number;
  recipientEmail: string;
  ruleName: string;
  isActive: boolean;
  minAbsoluteJump: number | null;
  minPercentJump: number | null;
  comparisonWindowDays: number;
  playlistIds: string[];
};
export type PlaylistWatchAlertEvent = {
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
export type AlertEditorState = {
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

export const emptyAlertEditor: AlertEditorState = {
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
export function fmtDelta(value: number | null) {
  if (value === null) return "-";
  return `${value > 0 ? "+" : ""}${formatInt(value)}`;
}
export function compareNullableMetric(
  a: number | null,
  b: number | null,
  dir: "asc" | "desc",
) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = a - b;
  return dir === "asc" ? cmp : -cmp;
}
export function metricForSort(
  playlist: PlaylistWatchRow,
  key: PlaylistWatchSortKey,
): number | null {
  return key === "followers" ? playlist.latestFollowerCount : playlist[key];
}
export function looksLikeSpotifyPlaylistInput(value: string) {
  const trimmed = value.trim();
  return (
    !trimmed ||
    /^[A-Za-z0-9]{16,40}$/.test(trimmed) ||
    /^https?:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{16,40}/i.test(
      trimmed,
    ) ||
    /^spotify:playlist:[A-Za-z0-9]{16,40}$/i.test(trimmed)
  );
}
export function extractPlaylistIdForSummary(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]{16,40})/i)?.[1] ??
    trimmed.match(/^spotify:playlist:([A-Za-z0-9]{16,40})$/i)?.[1] ??
    (/^[A-Za-z0-9]{16,40}$/.test(trimmed) ? trimmed : null)
  );
}
export function formatCheckedAt(value: string | null) {
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
