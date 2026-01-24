import Link from "next/link";
import { ListMusic } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
};

export default async function PlaylistsPage() {
  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");
  const missingEnv: string[] = [];
  if (!process.env.SPOTIFY_CLIENT_ID) missingEnv.push("SPOTIFY_CLIENT_ID");
  if (!process.env.SPOTIFY_CLIENT_SECRET) missingEnv.push("SPOTIFY_CLIENT_SECRET");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY");

  const { data, error } = await sb
    .from("playlists")
    .select(
      "playlist_key,display_name,is_catalog,spotify_playlist_id,spotify_playlist_image_url,spotify_last_fetched_at",
    )
    .order("is_catalog", { ascending: false })
    .order("display_name", { ascending: true });

  const playlists = (data ?? []) as PlaylistRow[];

  // Best-effort thumbnail refresh for rows that have spotify_playlist_id but no image (or stale).
  // We keep this conservative to avoid spamming Spotify requests.
  try {
    const candidates = playlists.filter(
      (p) => Boolean(p.spotify_playlist_id) && !p.spotify_playlist_image_url,
    );

    if (candidates.length) {
      const svc = supabaseService();
      // refresh up to 3 per request
      for (const p of candidates.slice(0, 3)) {
        const id = p.spotify_playlist_id;
        if (!id) continue;
        const meta = await getPlaylist(id);
        await svc
          .from("playlists")
          .update({
            spotify_playlist_name: meta.name,
            spotify_playlist_image_url: meta.imageUrl,
            spotify_last_fetched_at: new Date().toISOString(),
          })
          .eq("playlist_key", p.playlist_key);
        p.spotify_playlist_image_url = meta.imageUrl;
      }
    }
  } catch {
    // ignore refresh errors
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Playlists</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--sb-muted)" }}>
            Tracked playlists from configuration.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Link
              href="/settings/playlists"
              className="sb-ring rounded-full bg-white/60 px-4 py-2 text-sm font-medium transition hover:bg-white/80"
            >
              Settings
            </Link>
          ) : null}
          <div className="rounded-full bg-white/50 p-3 backdrop-blur-md dark:bg-white/5">
            <ListMusic className="h-6 w-6 opacity-70" />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {error.message}
        </div>
      )}

      {isAdmin && missingEnv.length ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-200">
          Spotify playlist thumbnails are disabled: missing{" "}
          <span className="font-mono">{missingEnv.join(", ")}</span> in Vercel env vars.
        </div>
      ) : null}

      <GlassTable headers={["", "Key", "Name", "Type"]}>
        {playlists.map((p) => (
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
            <TableCell mono>
              <Link 
                className="transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium" 
                href={`/playlists/${p.playlist_key}`}
              >
                {p.playlist_key}
              </Link>
            </TableCell>
            <TableCell>
              <span className="font-medium">{p.display_name}</span>
            </TableCell>
            <TableCell>
              {p.is_catalog ? (
                <span className="inline-flex items-center rounded-full bg-lime-400/20 px-2.5 py-0.5 text-xs font-medium text-lime-800 dark:text-lime-300">
                  Catalog
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                  Standard
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
        {!playlists.length && (
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
