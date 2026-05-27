"use server";

import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import { cacheTagForKey } from "@/lib/supabase/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

function revalidatePlaylistCaches() {
  revalidateTag(cacheTagForKey("playlists-settings"), "max");
  revalidateTag(cacheTagForKey("playlists-config"), "max");
  revalidateTag(cacheTagForKey("playlists-config-stats"), "max");
}

function parseSpotifyPlaylistId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  if (/^[A-Za-z0-9]{22}$/.test(raw)) return raw;

  const uriMatch = raw.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];

  const urlMatch = raw.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]{22})/);
  if (urlMatch) return urlMatch[1];

  return null;
}

async function requireAdmin() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/login");

  const { data: isAdmin, error } = await sb.rpc("is_admin");
  if (error) throw new Error(error.message);
  if (!isAdmin) redirect("/");

  return { sb };
}

export async function updateCollector(formData: FormData) {
  await requireAdmin();
  const playlistKey = String(formData.get("playlist_key") ?? "");
  const raw = String(formData.get("collector") ?? "").trim().toUpperCase();

  const allowed = new Set(["A", "K", "N", "PL", "TG", "NL"]);
  const collector = raw ? (allowed.has(raw) ? raw : null) : null;
  if (raw && !collector) throw new Error(`Invalid collector: ${raw}`);

  const svc = supabaseService();
  const { error: upErr } = await svc
    .from("playlists")
    .update({ collector })
    .eq("playlist_key", playlistKey);

  if (upErr) throw new Error(upErr.message);
  revalidatePlaylistCaches();
}

export async function updatePlaylistType(formData: FormData) {
  await requireAdmin();
  const playlistKey = String(formData.get("playlist_key") ?? "");
  const raw = String(formData.get("playlist_type") ?? "").trim();

  const allowed = new Set(["Catalog", "Label", "Entity", "Distro"]);
  const playlistType = raw ? (allowed.has(raw) ? raw : null) : null;
  if (raw && !playlistType) throw new Error(`Invalid playlist type: ${raw}`);

  const svc = supabaseService();
  const { error: upErr } = await svc
    .from("playlists")
    .update({ playlist_type: playlistType })
    .eq("playlist_key", playlistKey);

  if (upErr) throw new Error(upErr.message);
  revalidatePlaylistCaches();
}

export async function updateEntityPlaylist(formData: FormData) {
  await requireAdmin();
  const playlistKey = String(formData.get("playlist_key") ?? "");
  const raw = String(formData.get("entity_playlist_key") ?? "").trim();
  const entityPlaylistKey = raw || null;

  if (entityPlaylistKey) {
    const svc = supabaseService();
    const { data: target, error: lookupErr } = await svc
      .from("playlists")
      .select("playlist_key,playlist_type")
      .eq("playlist_key", entityPlaylistKey)
      .single();

    if (lookupErr || !target) throw new Error(`Entity playlist not found: ${entityPlaylistKey}`);
    if (target.playlist_type !== "Entity")
      throw new Error(`Playlist "${entityPlaylistKey}" is not an Entity playlist`);
  }

  const svc = supabaseService();
  const { error: upErr } = await svc
    .from("playlists")
    .update({ entity_playlist_key: entityPlaylistKey })
    .eq("playlist_key", playlistKey);

  if (upErr) throw new Error(upErr.message);
  revalidatePlaylistCaches();
}

export async function updatePlaylist(formData: FormData) {
  await requireAdmin();
  const playlistKey = String(formData.get("playlist_key") ?? "");
  const raw = String(formData.get("spotify_playlist_id") ?? "");
  const parsed = parseSpotifyPlaylistId(raw);

  const svc = supabaseService();
  const { error: upErr } = await svc
    .from("playlists")
    .update({
      spotify_playlist_id: parsed,
      spotify_playlist_name: null,
      spotify_playlist_image_url: null,
      spotify_last_fetched_at: null,
    })
    .eq("playlist_key", playlistKey);

  if (upErr) throw new Error(upErr.message);
  revalidatePlaylistCaches();
}

export async function reorderPlaylists(updates: { playlist_key: string; display_order: number }[]) {
  await requireAdmin();
  const svc = supabaseService();

  try {
    await Promise.all(
      updates.map((update) =>
        svc
          .from("playlists")
          .update({ display_order: update.display_order })
          .eq("playlist_key", update.playlist_key),
      ),
    );
  } catch (error) {
    throw new Error(
      `Failed to update playlist order: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  revalidatePlaylistCaches();
}
