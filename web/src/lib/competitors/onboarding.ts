/**
 * Parsing + validation for the /competitors "Add competitor" form.
 *
 * The form writes competitor.labels / competitor.playlists directly; the
 * competitor workflows regenerate config/competitor_playlists.csv from those
 * tables (scripts/export_competitor_config_from_db.py), so no migration or
 * CSV commit is needed to start tracking a new playlist.
 */

import { z } from "zod";

import {
  KEY_RE,
  normalizeAccentHex,
  parseSotDashboardUrl,
  parseSotPlaylistId,
  parseSpotifyPlaylistId,
  slugifyKey,
} from "./onboardingParsers";

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const onboardingRequestSchema = z
  .object({
    label: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), label_key: trimmed(64) }),
      z.object({
        mode: z.literal("new"),
        display_name: trimmed(120),
        label_key: z.string().trim().max(64).optional(),
        accent_hex: z.string().trim().max(9).optional().nullable(),
      }),
    ]),
    playlist: z.object({
      display_name: trimmed(200),
      playlist_key: z.string().trim().max(64).optional(),
      spotify_playlist: trimmed(300),
      sot_playlist: trimmed(300),
      sot_dashboard_url: trimmed(300),
      sot_dashboard_name: z.string().trim().max(200).optional(),
      min_rows: z.number().int().min(0).max(100000).optional(),
    }),
  })
  .strict();

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>;

export type NormalizedOnboarding = {
  label:
    | { mode: "existing"; label_key: string }
    | { mode: "new"; label_key: string; display_name: string; accent_hex: string | null };
  playlist: {
    playlist_key: string;
    label_key: string;
    display_name: string;
    spotify_playlist_id: string;
    sot_playlist_id: number;
    sot_dashboard_url: string;
    sot_dashboard_name: string;
    min_rows: number;
  };
};

export type NormalizeResult =
  | { ok: true; value: NormalizedOnboarding }
  | { ok: false; errors: Record<string, string> };

/** Validate the raw request body and derive keys/ids. Pure: no DB access. */
export function normalizeOnboardingRequest(body: unknown): NormalizeResult {
  const parsed = onboardingRequestSchema.safeParse(body);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join(".") || "body";
      errors[path] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const req = parsed.data;
  const errors: Record<string, string> = {};

  let label: NormalizedOnboarding["label"];
  let labelKey: string;
  if (req.label.mode === "existing") {
    labelKey = req.label.label_key;
    label = { mode: "existing", label_key: labelKey };
  } else {
    labelKey = req.label.label_key?.trim() || slugifyKey(req.label.display_name);
    if (!KEY_RE.test(labelKey)) errors["label.label_key"] = "Use lowercase letters, digits and underscores";
    const rawAccent = req.label.accent_hex?.trim() ?? "";
    const accent = normalizeAccentHex(rawAccent);
    if (rawAccent && !accent) errors["label.accent_hex"] = "Use a 6-digit hex color like #FF6B35";
    label = { mode: "new", label_key: labelKey, display_name: req.label.display_name, accent_hex: accent };
  }

  const p = req.playlist;
  const playlistKey = p.playlist_key?.trim() || slugifyKey(p.display_name);
  if (!KEY_RE.test(playlistKey)) errors["playlist.playlist_key"] = "Use lowercase letters, digits and underscores";
  const spotifyId = parseSpotifyPlaylistId(p.spotify_playlist);
  if (!spotifyId) errors["playlist.spotify_playlist"] = "Paste the Spotify playlist link or its 22-character id";
  const sotId = parseSotPlaylistId(p.sot_playlist);
  if (!sotId) errors["playlist.sot_playlist"] = "Paste the SpotOnTrack playlist link (…/playlists/spotify/<id>) or the id";
  const dashboardUrl = parseSotDashboardUrl(p.sot_dashboard_url);
  if (!dashboardUrl) errors["playlist.sot_dashboard_url"] = "Paste the SpotOnTrack dashboard link (…/dashboard/<n>)";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      label,
      playlist: {
        playlist_key: playlistKey,
        label_key: labelKey,
        display_name: p.display_name,
        spotify_playlist_id: spotifyId!,
        sot_playlist_id: sotId!,
        sot_dashboard_url: dashboardUrl!,
        sot_dashboard_name: p.sot_dashboard_name?.trim() || p.display_name,
        min_rows: p.min_rows ?? 1,
      },
    },
  };
}
