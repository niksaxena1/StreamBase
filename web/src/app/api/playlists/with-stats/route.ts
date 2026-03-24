import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();

  const playlistsRes = await svc
    .from("playlists")
    .select("playlist_key,display_name,is_catalog,playlist_type,collector,spotify_playlist_image_url")
    .order("display_name", { ascending: true })
    .limit(2000);

  if (playlistsRes.error) {
    return apiJsonErr(playlistsRes.error.message, 500);
  }

  const playlistKeys = (playlistsRes.data ?? []).map((p: { playlist_key?: unknown }) => String(p.playlist_key ?? "")).filter(Boolean);

  const { data: latestDateRow } = await svc
    .from("playlist_daily_stats")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestDate = (latestDateRow as { date: string } | null)?.date ?? null;

  const latestStats = new Map<string, { track_count: number; total_streams: number; daily_streams: number | null }>();

  if (latestDate && playlistKeys.length > 0) {
    const { data: statsRows, error: statsErr } = await svc
      .from("playlist_daily_stats")
      .select("playlist_key,track_count,total_streams_cumulative,daily_streams_net")
      .eq("date", latestDate)
      .in("playlist_key", playlistKeys);

    if (statsErr) {
      return apiJsonErr(statsErr.message, 500);
    }

    for (const s of statsRows ?? []) {
      const row = s as {
        playlist_key?: unknown;
        track_count?: unknown;
        total_streams_cumulative?: unknown;
        daily_streams_net?: unknown;
      };
      const pk = String(row.playlist_key ?? "");
      if (!pk) continue;
      latestStats.set(pk, {
        track_count: Number(row.track_count ?? 0),
        total_streams: Number(row.total_streams_cumulative ?? 0),
        daily_streams: row.daily_streams_net != null ? Number(row.daily_streams_net) : null,
      });
    }
  }

  const playlists = (playlistsRes.data ?? []).map((p: Record<string, unknown>) => {
    const pk = String(p.playlist_key ?? "");
    const stats = latestStats.get(pk);
    return {
      playlist_key: pk,
      display_name: String(p.display_name ?? pk).trim(),
      is_catalog: Boolean(p.is_catalog),
      playlist_type: (p.playlist_type ?? null) as string | null,
      collector: (p.collector ?? null) as string | null,
      spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
      track_count: stats?.track_count ?? 0,
      total_streams: stats?.total_streams ?? 0,
      daily_streams: stats?.daily_streams ?? null,
    };
  });

  return apiJsonOk({ playlists });
}
