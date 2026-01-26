import Link from "next/link";
import { ArrowLeft, Settings } from "lucide-react";

import { supabaseServer } from "@/lib/supabase/server";
import { GlassTable, TableRow, TableCell } from "@/components/ui/GlassTable";
import { supabaseService } from "@/lib/supabase/service";
import { getPlaylist } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type PlaylistRow = {
  playlist_key: string;
  display_name: string;
  is_catalog: boolean;
  playlist_type: string | null;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  spotify_last_fetched_at: string | null;
};

export default async function PlaylistsConfigPage() {
  const sb = await supabaseServer();
  const { data: isAdmin } = await sb.rpc("is_admin");

  const { data, error } = await sb
    .from("playlists")
    .select(
      "playlist_key,display_name,is_catalog,playlist_type,spotify_playlist_id,spotify_playlist_image_url,spotify_last_fetched_at",
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href="/playlists"
            className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
            aria-label="Back to playlists dashboard"
            title="Back to playlists dashboard"
          >
            <ArrowLeft className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
          </Link>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Playlists
            </h1>
            <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Tracked playlists from configuration.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Link
              href="/playlists/config/settings"
              className="sb-ring grid h-8 w-8 place-items-center rounded-full bg-white/70 text-xs font-medium transition hover:bg-white dark:bg-white/10 dark:hover:bg-white/15"
              aria-label="Playlist settings"
              title="Playlist settings"
            >
              <Settings className="h-4 w-4" style={{ color: "var(--sb-text)" }} />
            </Link>
          ) : null}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-200">
          Query error: {error.message}
        </div>
      )}

      <GlassTable headers={["", "Key", "Name", "Type"]}>
        {playlists.map((p) => (
          <TableRow key={p.playlist_key}>
            <TableCell>
              {p.spotify_playlist_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.spotify_playlist_image_url}
                  alt="Playlist cover"
                  className="h-8 w-8 rounded-lg object-cover sb-ring"
                />
              ) : (
                <div className="h-8 w-8 rounded-lg sb-ring bg-white/60" />
              )}
            </TableCell>
            <TableCell mono>
              <Link
                className="transition-colors hover:text-lime-600 dark:hover:text-lime-400 font-medium"
                href={`/playlists?playlist_key=${encodeURIComponent(p.playlist_key)}`}
              >
                {p.playlist_key}
              </Link>
            </TableCell>
            <TableCell>
              <span className="font-medium">{p.display_name}</span>
            </TableCell>
            <TableCell>
              {(() => {
                const type = p.playlist_type || (p.is_catalog ? "Catalog" : "Standard");
                const typeColors: Record<string, { bg: string; text: string }> = {
                  Catalog: {
                    bg: "bg-lime-400/20",
                    text: "text-lime-800 dark:text-lime-300",
                  },
                  Label: {
                    bg: "bg-blue-400/20",
                    text: "text-blue-800 dark:text-blue-300",
                  },
                  Entity: {
                    bg: "bg-purple-400/20",
                    text: "text-purple-800 dark:text-purple-300",
                  },
                  Distro: {
                    bg: "bg-orange-400/20",
                    text: "text-orange-800 dark:text-orange-300",
                  },
                };
                const colors = typeColors[type] || {
                  bg: "bg-black/10",
                  text: "text-black/80 dark:text-white/60",
                };
                return (
                  <span className={`inline-flex items-center rounded-full ${colors.bg} px-2.5 py-0.5 text-xs font-medium ${colors.text}`}>
                    {type}
                  </span>
                );
              })()}
            </TableCell>
          </TableRow>
        ))}
        {!playlists.length && (
          <TableRow>
            <TableCell className="py-8 text-center opacity-50" colSpan={4}>
              No playlists found.
            </TableCell>
          </TableRow>
        )}
      </GlassTable>
    </div>
  );
}

