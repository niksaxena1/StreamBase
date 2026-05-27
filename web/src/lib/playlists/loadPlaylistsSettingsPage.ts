import { redirect } from "next/navigation";

import { CACHE_TTL_1H } from "@/lib/constants";
import { cachedQuery } from "@/lib/supabase/cache";
import { supabaseServer } from "@/lib/supabase/server";

export type PlaylistSettingsRow = {
  playlist_key: string;
  display_name: string;
  spotify_playlist_id: string | null;
  spotify_playlist_image_url: string | null;
  display_order: number | null;
  collector: string | null;
  playlist_type: string | null;
  entity_playlist_key: string | null;
};

function mapRows(data: unknown[] | null): PlaylistSettingsRow[] {
  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      playlist_key: String(row.playlist_key ?? ""),
      display_name: String(row.display_name ?? ""),
      spotify_playlist_id: (row.spotify_playlist_id as string | null) ?? null,
      spotify_playlist_image_url: (row.spotify_playlist_image_url as string | null) ?? null,
      display_order: (row.display_order as number | null) ?? null,
      collector: (row.collector as string | null) ?? null,
      playlist_type: (row.playlist_type as string | null) ?? null,
      entity_playlist_key: (row.entity_playlist_key as string | null) ?? null,
    };
  });
}

export async function loadPlaylistsSettingsPage(): Promise<{
  playlists: PlaylistSettingsRow[];
  errorMessage: string | null;
}> {
  const sb = await supabaseServer();

  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) redirect("/login");

  const [{ data: isAdmin, error: adminError }, cached] = await Promise.all([
    sb.rpc("is_admin"),
    cachedQuery(
      async () => {
        const result = await sb
          .from("playlists")
          .select(
            "playlist_key,display_name,spotify_playlist_id,spotify_playlist_image_url,display_order,collector,playlist_type,entity_playlist_key",
          )
          .order("display_order", { ascending: true, nullsFirst: false })
          .order("display_name", { ascending: true });

        return {
          data: result.error ? null : { playlists: mapRows((result.data ?? []) as unknown[]) },
          error: result.error,
        };
      },
      "playlists-settings",
      CACHE_TTL_1H,
    ),
  ]);

  if (adminError) throw new Error(adminError.message);
  if (!isAdmin) redirect("/");

  return {
    playlists: cached.data?.playlists ?? [],
    errorMessage: cached.error?.message ?? null,
  };
}
