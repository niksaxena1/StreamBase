/**
 * Shared vocabulary for roster-movement analytics (competitor labels and
 * own-catalog distro playlists). Server-safe: imported by both the movement
 * builders and the client flow diagram.
 */

/** Sentinel node name for tracks entering/leaving the tracked set entirely. */
export const OUTSIDE_TRACKED_SET = "Outside tracked set";

export type RosterFlow = { source: string; target: string; track_count: number };

export type RosterMovement = {
  isrc: string;
  name: string;
  artist_names: string[] | null;
  album_image_url: string | null;
  source: string;
  target: string;
  event_date: string;
};
