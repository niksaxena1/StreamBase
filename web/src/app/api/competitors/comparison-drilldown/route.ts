import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

type Kind = "playlists" | "tracks" | "artists";

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const kindRaw = body.kind;
  const kind: Kind =
    kindRaw === "playlists" || kindRaw === "tracks" || kindRaw === "artists" ? kindRaw : "tracks";

  const labelKey = String(body.label_key ?? "").trim();
  const run_date = String(body.run_date ?? "").trim();
  const offset = Math.max(0, Number(body.offset ?? 0) || 0);
  const limit = Math.max(1, Math.min(Number(body.limit ?? 200) || 200, 500));

  if (!labelKey) return apiJsonErr("missing label_key", 400);
  if (!isIsoDate(run_date)) return apiJsonErr("invalid run_date (expected YYYY-MM-DD)", 400);

  const svc = supabaseService();
  const comp = svc.schema("competitor");

  if (kind === "playlists") {
    const { data: playlists, error } = await comp
      .from("playlists")
      .select("playlist_key,display_name,spotify_playlist_image_url,display_order")
      .eq("label_key", labelKey)
      .eq("is_active", true)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true });

    if (error) return apiJsonErr(error.message, 500);

    const playlistRows = (playlists ?? []) as Array<Record<string, unknown>>;
    const keys = playlistRows.map((p) => String(p.playlist_key ?? "").trim()).filter(Boolean);

    const statsByKey = new Map<
      string,
      {
        track_count: number;
        total_streams_cumulative: number | null;
        daily_streams_net: number | null;
      }
    >();

    if (keys.length) {
      const { data: stats, error: statsErr } = await comp
        .from("playlist_daily_stats")
        .select("playlist_key,track_count,total_streams_cumulative,daily_streams_net")
        .eq("date", run_date)
        .in("playlist_key", keys);
      if (statsErr) return apiJsonErr(statsErr.message, 500);

      for (const s of (stats ?? []) as Array<Record<string, unknown>>) {
        const k = String(s?.playlist_key ?? "").trim();
        if (!k) continue;
        statsByKey.set(k, {
          track_count: Number(s?.track_count ?? 0),
          total_streams_cumulative:
            s?.total_streams_cumulative == null ? null : Number(s.total_streams_cumulative),
          daily_streams_net: s?.daily_streams_net == null ? null : Number(s.daily_streams_net),
        });
      }
    }

    const items = playlistRows
      .map((p) => {
        const key = String(p.playlist_key ?? "");
        const s = statsByKey.get(key) ?? null;
        const total = s?.total_streams_cumulative ?? 0;
        const daily = s?.daily_streams_net ?? 0;
        return {
          playlist_key: key,
          display_name: String(p.display_name ?? p.playlist_key ?? ""),
          spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
          playlist_type: null,
          track_count: s?.track_count ?? 0,
          total_streams_cumulative: s?.total_streams_cumulative ?? null,
          daily_streams_net: s?.daily_streams_net ?? null,
          est_revenue_total: null,
          est_revenue_daily_net: null,
        };
      })
      .filter((p) => p.playlist_key);

    return apiJsonOk({ ok: true as const, items, done: true as const });
  }

  if (kind === "tracks") {
    const { data, error } = await comp.rpc("label_tracks_paged", {
      p_label_key: labelKey,
      p_run_date: run_date,
      p_offset: offset,
      p_limit: limit,
    });
    if (error) return apiJsonErr(error.message, 500);

    const items = ((data ?? []) as Array<Record<string, unknown>>)
      .map((r) => ({
        isrc: String(r?.isrc ?? ""),
        name: (r?.name ?? null) as string | null,
        album_image_url: (r?.album_image_url ?? null) as string | null,
        artist_names: (r?.artist_names ?? null) as string[] | null,
        artist_ids: (r?.artist_ids ?? null) as string[] | null,
        total_streams_cumulative:
          r?.total_streams_cumulative == null ? null : Number(r.total_streams_cumulative),
        daily_streams_delta: r?.daily_streams_delta == null ? null : Number(r.daily_streams_delta),
      }))
      .filter((t) => t.isrc);

    return apiJsonOk({ ok: true as const, items, done: items.length < limit });
  }

  const { data, error } = await comp.rpc("label_artists_paged", {
    p_label_key: labelKey,
    p_run_date: run_date,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) return apiJsonErr(error.message, 500);

  const items = ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      artist_id: String(r?.artist_id ?? ""),
      name: (r?.name ?? null) as string | null,
      image_url: (r?.image_url ?? null) as string | null,
      track_count: r?.track_count == null ? 0 : Number(r.track_count),
      total_streams_cumulative:
        r?.total_streams_cumulative == null ? 0 : Number(r.total_streams_cumulative),
      daily_streams_delta: r?.daily_streams_delta == null ? 0 : Number(r.daily_streams_delta),
    }))
    .filter((a) => a.artist_id);

  return apiJsonOk({ ok: true as const, items, done: items.length < limit });
}
