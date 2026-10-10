import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBody, requireAdmin } from "@/lib/api/server";
import { normalizeOnboardingRequest, type NormalizedOnboarding } from "@/lib/competitors/onboarding";
import { cacheTagForKey } from "@/lib/supabase/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIGRATION_ERROR_CODES = new Set(["42703", "42883", "PGRST202", "PGRST204"]);
const ERROR_FIELDS = new Set([
  "body", "label.label_key", "playlist.playlist_key", "playlist.spotify_playlist",
  "playlist.sot_playlist", "playlist.sot_dashboard_url",
]);

/** Error envelope plus per-field messages the form shows inline. */
function fieldErrors(fields: Record<string, string>, status: number): NextResponse {
  const error = Object.values(fields)[0] ?? "Invalid request";
  return NextResponse.json({ success: false, error, fields }, { status });
}

/**
 * Add a competitor label and/or playlist from the /competitors page.
 *
 * Writes competitor.labels + competitor.playlists only. The competitor
 * workflows regenerate their CSV config from these tables on every run, so
 * the new playlist is picked up by the next refresh -> dashboard sync ->
 * export without a migration or commit.
 */
export async function POST(request: Request) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const normalized = normalizeOnboardingRequest(json.body);
  if (!normalized.ok) {
    return fieldErrors(normalized.errors, 400);
  }
  const { label, playlist } = normalized.value;
  try {
    return await onboard(label, playlist);
  } catch {
    return apiJsonErr("Could not save competitor configuration. Please retry.", 500);
  }
}

async function onboard(
  label: NormalizedOnboarding["label"],
  playlist: NormalizedOnboarding["playlist"],
) {
  const comp = supabaseService().schema("competitor");

  const { data, error } = await comp.rpc("onboard_competitor", {
    p_label_mode: label.mode,
    p_label_key: label.label_key,
    p_label_display_name: label.mode === "new" ? label.display_name : null,
    p_accent_hex: label.mode === "new" ? label.accent_hex : null,
    p_playlist_key: playlist.playlist_key,
    p_playlist_display_name: playlist.display_name,
    p_spotify_playlist_id: playlist.spotify_playlist_id,
    p_sot_playlist_id: playlist.sot_playlist_id,
    p_sot_dashboard_url: playlist.sot_dashboard_url,
    p_sot_dashboard_name: playlist.sot_dashboard_name,
    p_min_rows: playlist.min_rows,
  });
  if (error) {
    if (MIGRATION_ERROR_CODES.has(error.code)) {
      return apiJsonErr(
        "Database is missing competitor onboarding configuration/function. Apply supabase/migrations/20261010205727_add_competitor_onboarding_config_columns.sql, then retry.",
        503,
      );
    }
    const status = error.code === "23505" ? 409 : error.code === "22023" ? 400 : 500;
    if (ERROR_FIELDS.has(error.details)) return fieldErrors({ [error.details]: error.message }, status);
    return apiJsonErr(error.message, status);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)
      || data.label_key !== label.label_key || data.playlist_key !== playlist.playlist_key
      || typeof data.already_exists !== "boolean" || typeof data.created_label !== "boolean"
      || !data.label || !data.playlist) {
    return apiJsonErr("Invalid competitor onboarding result. Please retry.", 500);
  }

  // Refresh the ops page and selector immediately, without invalidating the
  // generic Supabase cache tag used by own-catalog analytics.
  revalidatePath("/competitors");
  revalidateTag(cacheTagForKey("competitor-shell-labels-v2"), { expire: 0 });

  return apiJsonOk(data, { status: data.already_exists ? 200 : 201 });
}
