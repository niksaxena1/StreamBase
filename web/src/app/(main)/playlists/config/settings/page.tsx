import { redirect } from "next/navigation";
import { Music } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { PlaylistSettingsTable } from "./PlaylistSettingsTable";

export const revalidate = 86400; // 24h ISR - admin config changes are infrequent

function parseSpotifyPlaylistId(input: string): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // Accept ID directly (Spotify IDs are typically 22 chars base62)
  if (/^[A-Za-z0-9]{22}$/.test(raw)) return raw;

  // Accept spotify URI: spotify:playlist:<id>
  const uriMatch = raw.match(/^spotify:playlist:([A-Za-z0-9]{22})$/);
  if (uriMatch) return uriMatch[1];

  // Accept URL: https://open.spotify.com/playlist/<id>?...
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

export default async function PlaylistSettingsPage() {
  await requireAdmin();
  const sb = await supabaseServer();

  const { data, error } = await sb
    .from("playlists")
    .select(
      "playlist_key,display_name,spotify_playlist_id,spotify_playlist_image_url,display_order,collector,playlist_type",
    )
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true });

  async function updateCollector(formData: FormData) {
    "use server";

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
  }

  async function updatePlaylistType(formData: FormData) {
    "use server";

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
  }

  async function updatePlaylist(formData: FormData) {
    "use server";

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
  }

  async function reorderPlaylists(updates: { playlist_key: string; display_order: number }[]) {
    "use server";

    await requireAdmin();
    const svc = supabaseService();

    try {
      await Promise.all(
        updates.map((update) =>
          svc
            .from("playlists")
            .update({ display_order: update.display_order })
            .eq("playlist_key", update.playlist_key)
        )
      );
    } catch (error) {
      throw new Error(`Failed to update playlist order: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Playlist Settings
          </h1>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Paste a Spotify playlist URL/URI/ID to enable playlist thumbnails in SpotiBase.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {error.message}
        </div>
      )}

      <PlaylistSettingsTable
        playlists={data ?? []}
        updatePlaylist={updatePlaylist}
        updateCollector={updateCollector}
        updatePlaylistType={updatePlaylistType}
        reorderPlaylists={reorderPlaylists}
      />
    </div>
  );
}
