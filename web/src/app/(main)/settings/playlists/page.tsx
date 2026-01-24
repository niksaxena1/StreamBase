import Link from "next/link";
import { redirect } from "next/navigation";

import { GlassTable, TableCell, TableRow } from "@/components/ui/GlassTable";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

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
      "playlist_key,display_name,spotify_playlist_id,spotify_playlist_image_url",
    )
    .order("display_name", { ascending: true });

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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs" style={{ color: "var(--sb-muted)" }}>
            <Link className="hover:underline" href="/playlists">
              Playlists
            </Link>{" "}
            / <span className="font-mono opacity-70">Settings</span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">
            Playlist Settings
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--sb-muted)" }}>
            Paste a Spotify playlist URL/URI/ID to enable playlist thumbnails in SpotiBase.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {error.message}
        </div>
      )}

      <GlassTable headers={["", "Playlist", "Spotify playlist (URL/URI/ID)", ""]}>
        {(data ?? []).map((p) => (
          <TableRow key={p.playlist_key}>
            <TableCell>
              {p.spotify_playlist_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.spotify_playlist_image_url}
                  alt="Playlist cover"
                  className="h-9 w-9 rounded-xl object-cover sb-ring"
                />
              ) : (
                <div className="h-9 w-9 rounded-xl sb-ring bg-white/60" />
              )}
            </TableCell>
            <TableCell>
              <div className="font-medium">{p.display_name}</div>
              <div className="font-mono text-xs opacity-60">{p.playlist_key}</div>
            </TableCell>
            <TableCell>
              <form action={updatePlaylist} className="flex items-center gap-2">
                <input type="hidden" name="playlist_key" value={p.playlist_key} />
                <input
                  name="spotify_playlist_id"
                  defaultValue={p.spotify_playlist_id ?? ""}
                  placeholder="https://open.spotify.com/playlist/…"
                  className="sb-ring w-full rounded-2xl bg-white/70 px-3 py-2 text-sm outline-none placeholder:text-black/40"
                />
                <button
                  type="submit"
                  className="sb-ring rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white"
                >
                  Save
                </button>
              </form>
            </TableCell>
            <TableCell>
              <Link
                href={`/playlists/${p.playlist_key}`}
                className="text-sm underline"
              >
                View
              </Link>
            </TableCell>
          </TableRow>
        ))}
        {!data?.length && (
          <TableRow>
            <TableCell className="text-center opacity-50 py-8" colSpan={4}>
              No playlists found.
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
    </div>
  );
}

