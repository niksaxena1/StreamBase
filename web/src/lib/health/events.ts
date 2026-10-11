import { buildCatalogDeepLinkPathFromResolved } from "@/lib/catalogDeepLink";
import { addDaysISO } from "@/lib/sotDates";

export const EVENT_TYPES = ["takedown", "restoration", "new_track", "playlist_add", "playlist_remove", "override", "ingestion", "movement"] as const;
export type HealthEventType = (typeof EVENT_TYPES)[number];
export type EventTrack = { isrc: string; name: string | null; spotify_artist_ids?: string[] | null };
export type MembershipEventRow = { id: number; playlist_key: string; isrc: string; valid_from: string; valid_to: string | null; tracks: EventTrack | null };
export type HealthEvent = {
  id: string;
  date: string;
  type: HealthEventType;
  description: string;
  count: number;
  href?: string;
  failed?: boolean;
  tracks?: Array<{ isrc: string; name: string; href: string }>;
};
export type EventWindow = { start: string; end: string; until: string; streamsStart: string };
export function eventWindow(days: 7 | 30 | 90, today = new Date().toISOString().slice(0, 10)): EventWindow {
  const start = addDaysISO(today, 1 - days);
  return { start, end: today, until: addDaysISO(today, 1), streamsStart: addDaysISO(start, -8) };
}

export function overrideNotePrefix(note: string | null): string {
  const value = note?.trim() || "manual override";
  if (value.startsWith("stale-fix:")) return value.split(":").slice(0, 2).join(":").trim().replace(/\s+auto$/, "");
  return value.split(":")[0].trim();
}

export type DailyTotal = { date: string; streams: number | null };
/** Require seven consecutive, finite prior days. Missing data is never zero-filled. */
export function detectLargeMovements(totals: DailyTotal[], start: string, end: string): HealthEvent[] {
  const byDate = new Map(totals.map((row) => [row.date, row.streams]));
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).flatMap(([date, streams]) => {
    if (date < start || date > end || streams == null || !Number.isFinite(streams)) return [];
    const trailing = Array.from({ length: 7 }, (_, i) => byDate.get(addDaysISO(date, -i - 1)));
    if (trailing.some((n) => n == null || !Number.isFinite(n))) return [];
    const median = (trailing as number[]).sort((a, b) => a - b)[3];
    if (median <= 0) return [];
    const change = (streams - median) / median;
    if (Math.abs(change) <= 0.35) return [];
    return [{ id: `movement:${date}`, date, type: "movement" as const, count: 1,
      description: `Daily streams ${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}% vs trailing 7-day median (${streams.toLocaleString("en-US")} vs ${median.toLocaleString("en-US")})` }];
  });
}

export function assembleHealthEvents(input: {
  window: EventWindow;
  availability?: Array<{ id: number; isrc: string; event: string; detected_at: string; suppressed_reason: string | null; tracks: EventTrack | null }>;
  newTracks: Array<EventTrack & { first_seen: string | null }>;
  additions: MembershipEventRow[];
  removals: MembershipEventRow[];
  playlists: Array<{ playlist_key: string; display_name: string }>;
  overrides: Array<{ date: string; note: string | null }>;
  runs: Array<{ id: number; run_date: string; status: string; logs_url: string | null }>;
  dailyTotals: DailyTotal[];
}): HealthEvent[] {
  const inside = (date: string) => date.slice(0, 10) >= input.window.start && date.slice(0, 10) <= input.window.end;
  const link = (track: EventTrack) => buildCatalogDeepLinkPathFromResolved({ isrc: track.isrc, primaryArtistIdFromTrack: track.spotify_artist_ids?.[0] });
  const events: HealthEvent[] = [];
  for (const row of input.availability ?? []) {
    if (!inside(row.detected_at)) continue;
    const track = row.tracks ?? { isrc: row.isrc, name: null };
    const restored = row.event === "restored";
    events.push({ id: `availability:${row.id}`, date: row.detected_at, type: restored ? "restoration" : "takedown", count: 1,
      description: `${track.name || row.isrc} ${restored ? "restored on" : "taken down from"} Spotify${row.suppressed_reason ? " · already dead in StreamBase" : ""}`, href: link(track) });
  }
  for (const track of input.newTracks) {
    if (!track.first_seen || !inside(track.first_seen)) continue;
    events.push({ id: `new:${track.isrc}`, date: track.first_seen, type: "new_track", description: `${track.name || track.isrc} first appeared`, count: 1, href: link(track) });
  }
  const playlistNames = new Map(input.playlists.map((p) => [p.playlist_key, p.display_name]));
  for (const [type, rows, column] of [["playlist_add", input.additions, "valid_from"], ["playlist_remove", input.removals, "valid_to"]] as const) {
    const groups = new Map<string, HealthEvent>();
    for (const row of rows) {
      const date = row[column]?.slice(0, 10);
      if (!date || !inside(date)) continue;
      const key = JSON.stringify([type, date, row.playlist_key]);
      let group = groups.get(key);
      if (!group) {
        group = { id: key, date, type, count: 0, description: `${type === "playlist_add" ? "Tracks added to" : "Tracks removed from"} ${playlistNames.get(row.playlist_key) || row.playlist_key}`, href: `/playlists?playlist_key=${encodeURIComponent(row.playlist_key)}`, tracks: [] };
        groups.set(key, group);
      }
      if (group.tracks!.some((t) => t.isrc === row.isrc)) continue;
      const track = row.tracks ?? { isrc: row.isrc, name: null };
      group.tracks!.push({ isrc: row.isrc, name: track.name || row.isrc, href: link(track) });
      group.count++;
    }
    events.push(...groups.values());
  }
  const overrideGroups = new Map<string, HealthEvent>();
  for (const row of input.overrides) {
    if (!inside(row.date)) continue;
    const prefix = overrideNotePrefix(row.note);
    const key = JSON.stringify(["override", row.date, prefix]);
    const group = overrideGroups.get(key) ?? { id: key, date: row.date, type: "override", description: `Stream overrides: ${prefix}`, count: 0 };
    group.count++;
    overrideGroups.set(key, group);
  }
  events.push(...overrideGroups.values());
  for (const run of input.runs) {
    if (!inside(run.run_date)) continue;
    events.push({ id: `run:${run.id}`, date: run.run_date, type: "ingestion", count: 1, description: `Ingestion run: ${run.status}`, failed: run.status === "failed", href: run.logs_url || undefined });
  }
  events.push(...detectLargeMovements(input.dailyTotals, input.window.start, input.window.end));
  return events.sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
