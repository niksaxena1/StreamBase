import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBody, requireAdmin } from "@/lib/api/server";
import { normalizeOnboardingRequest, type NormalizedOnboarding } from "@/lib/competitors/onboarding";
import { cacheTagForKey } from "@/lib/supabase/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MISSING_COLUMN_CODE = "42703";

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

  const [labelRes, keyRes, spotifyRes, sotRes, dashboardRes, orderRes] = await Promise.all([
    comp.from("labels").select("label_key,is_active").eq("label_key", playlist.label_key).maybeSingle(),
    comp.from("playlists").select("playlist_key").eq("playlist_key", playlist.playlist_key).maybeSingle(),
    comp
      .from("playlists")
      .select("playlist_key")
      .eq("spotify_playlist_id", playlist.spotify_playlist_id)
      .limit(1),
    comp.from("playlists").select("playlist_key").eq("sot_playlist_id", playlist.sot_playlist_id).limit(1),
    comp
      .from("playlists")
      .select("playlist_key")
      .eq("sot_dashboard_url", playlist.sot_dashboard_url)
      .limit(1),
    comp
      .from("playlists")
      .select("display_order")
      .eq("label_key", playlist.label_key)
      .order("display_order", { ascending: false, nullsFirst: false })
      .limit(1),
  ]);
  const lookupError = [labelRes, keyRes, spotifyRes, sotRes, dashboardRes, orderRes].find((r) => r.error)?.error;
  if (lookupError) return apiJsonErr(lookupError.message, 500);

  if (label.mode === "existing" && !labelRes.data) {
    return fieldErrors({ "label.label_key": "Unknown label" }, 400);
  }
  if (label.mode === "new" && labelRes.data) {
    return fieldErrors({ "label.label_key": `Label key "${label.label_key}" already exists; pick it as an existing label` }, 409);
  }
  if (keyRes.data) {
    return fieldErrors({ "playlist.playlist_key": `Playlist key "${playlist.playlist_key}" already exists` }, 409);
  }
  const spotifyDupe = (spotifyRes.data as Array<{ playlist_key: string }> | null)?.[0];
  if (spotifyDupe) {
    return fieldErrors({ "playlist.spotify_playlist": `Already tracked as "${spotifyDupe.playlist_key}"` }, 409);
  }
  const dashboardDupe = (dashboardRes.data as Array<{ playlist_key: string }> | null)?.[0];
  const sotDupe = (sotRes.data as Array<{ playlist_key: string }> | null)?.[0];
  if (sotDupe) {
    return fieldErrors({ "playlist.sot_playlist": `Already tracked as "${sotDupe.playlist_key}"` }, 409);
  }
  if (dashboardDupe) {
    return fieldErrors({ "playlist.sot_dashboard_url": `Dashboard already used by "${dashboardDupe.playlist_key}"` }, 409);
  }

  const now = new Date().toISOString();
  if (label.mode === "new") {
    const { error } = await comp.from("labels").insert({
      label_key: label.label_key,
      display_name: label.display_name,
      accent_hex: label.accent_hex,
      is_active: true,
    });
    if (error) return apiJsonErr(error.message, error.code === "23505" ? 409 : 500);
  } else if ((labelRes.data as { is_active?: boolean } | null)?.is_active === false) {
    const { error } = await comp
      .from("labels")
      .update({ is_active: true, updated_at: now })
      .eq("label_key", label.label_key);
    if (error) return apiJsonErr(error.message, 500);
  }

  const lastOrder = (orderRes.data as Array<{ display_order: number | null }> | null)?.[0]?.display_order;
  async function rollbackNewLabel() {
    if (label.mode !== "new") return;
    const { error } = await comp.from("labels").delete().eq("label_key", label.label_key);
    if (error) throw new Error("Could not roll back new label");
  }
  let playlistErr;
  try {
    const result = await comp.from("playlists").insert({
      ...playlist,
      display_order: typeof lastOrder === "number" ? lastOrder + 1 : 1,
      is_active: true,
    });
    playlistErr = result.error;
  } catch (error) {
    await rollbackNewLabel();
    throw error;
  }
  if (playlistErr) {
    await rollbackNewLabel();
    if (playlistErr.code === MISSING_COLUMN_CODE || playlistErr.code === "PGRST204") {
      return apiJsonErr(
        "Database is missing competitor.playlists.sot_dashboard_name/min_rows. Apply migrations/add_competitor_onboarding_config_columns.sql, then retry.",
        503,
      );
    }
    return apiJsonErr(playlistErr.message, playlistErr.code === "23505" ? 409 : 500);
  }

  // Refresh the ops page and selector immediately, without invalidating the
  // generic Supabase cache tag used by own-catalog analytics.
  revalidatePath("/competitors");
  revalidateTag(cacheTagForKey("competitor-shell-labels-v2"), { expire: 0 });

  return apiJsonOk({
    label_key: playlist.label_key,
    playlist_key: playlist.playlist_key,
    created_label: label.mode === "new",
  }, { status: 201 });
}
