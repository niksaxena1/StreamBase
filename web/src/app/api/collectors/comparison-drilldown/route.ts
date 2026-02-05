import { NextRequest, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function addDaysIso(dateIso: string, deltaDays: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateIso;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

type Kind = "playlists" | "tracks" | "artists";

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) return NextResponse.json({ ok: false, error: adminErr.message }, { status: 500 });
  if (!isAdmin) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const rawBody: unknown = await req.json().catch(() => ({}));
  const body =
    rawBody && typeof rawBody === "object" ? (rawBody as Record<string, unknown>) : ({} as Record<string, unknown>);

  const kindRaw = body.kind;
  const kind: Kind =
    kindRaw === "playlists" || kindRaw === "tracks" || kindRaw === "artists" ? kindRaw : "tracks";

  const collector = String(body.collector ?? "").trim().toUpperCase();
  const run_date = String(body.run_date ?? "").trim();
  const offset = Math.max(0, Number(body.offset ?? 0) || 0);
  const limit = Math.max(1, Math.min(Number(body.limit ?? 200) || 200, 500));

  if (!collector) {
    return NextResponse.json({ ok: false, error: "missing collector" }, { status: 400 });
  }
  if (!isIsoDate(run_date)) {
    return NextResponse.json({ ok: false, error: "invalid run_date (expected YYYY-MM-DD)" }, { status: 400 });
  }

  const svc = supabaseService();

  if (kind === "playlists") {
    const { data: playlists, error } = await svc
      .from("playlists")
      .select("playlist_key,display_name,spotify_playlist_image_url,playlist_type,display_order")
      .eq("collector", collector)
      .order("display_order", { ascending: true, nullsFirst: false })
      .order("playlist_key", { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const playlistRows = (playlists ?? []) as Array<Record<string, unknown>>;
    const keys = playlistRows.map((p) => String(p.playlist_key ?? "").trim()).filter(Boolean);

    const statsByKey = new Map<
      string,
      {
        track_count: number;
        total_streams_cumulative: number | null;
        daily_streams_net: number | null;
        est_revenue_total: number | null;
        est_revenue_daily_net: number | null;
      }
    >();

    if (keys.length) {
      const { data: stats, error: statsErr } = await svc
        .from("playlist_daily_stats")
        .select("playlist_key,track_count,total_streams_cumulative,daily_streams_net,est_revenue_total,est_revenue_daily_net")
        .eq("date", run_date)
        .in("playlist_key", keys);
      if (statsErr) return NextResponse.json({ ok: false, error: statsErr.message }, { status: 500 });

      for (const s of (stats ?? []) as any[]) {
        const k = String(s?.playlist_key ?? "").trim();
        if (!k) continue;
        statsByKey.set(k, {
          track_count: Number(s?.track_count ?? 0),
          total_streams_cumulative: s?.total_streams_cumulative == null ? null : Number(s.total_streams_cumulative),
          daily_streams_net: s?.daily_streams_net == null ? null : Number(s.daily_streams_net),
          est_revenue_total: s?.est_revenue_total == null ? null : Number(s.est_revenue_total),
          est_revenue_daily_net: s?.est_revenue_daily_net == null ? null : Number(s.est_revenue_daily_net),
        });
      }
    }

    const items = playlistRows
      .map((p) => {
        const key = String(p.playlist_key ?? "");
        const s = statsByKey.get(key) ?? null;
        return {
          playlist_key: key,
          display_name: String(p.display_name ?? p.playlist_key ?? ""),
          spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
          playlist_type: (p.playlist_type ?? null) as string | null,
          track_count: s?.track_count ?? 0,
          total_streams_cumulative: s?.total_streams_cumulative ?? null,
          daily_streams_net: s?.daily_streams_net ?? null,
          est_revenue_total: s?.est_revenue_total ?? null,
          est_revenue_daily_net: s?.est_revenue_daily_net ?? null,
        };
      })
      .filter((p) => p.playlist_key);

    return NextResponse.json({ ok: true, items, done: true }, { status: 200 });
  }

  if (kind === "tracks") {
    const prev_date = addDaysIso(run_date, -1);
    const { data, error } = await svc.rpc("collector_tracks_paged", {
      collector,
      run_date,
      prev_date,
      offset_rows: offset,
      limit_rows: limit,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const rows = (data ?? []) as any[];
    const items = rows.map((r) => ({
      isrc: String(r?.isrc ?? ""),
      name: (r?.name ?? null) as string | null,
      album_image_url: (r?.album_image_url ?? null) as string | null,
      artist_names: (r?.artist_names ?? null) as string[] | null,
      artist_ids: (r?.artist_ids ?? null) as string[] | null,
      total_streams_cumulative: r?.total_streams_cumulative == null ? null : Number(r.total_streams_cumulative),
      daily_streams_delta: r?.daily_streams_delta == null ? null : Number(r.daily_streams_delta),
    })).filter((t: any) => t.isrc);

    return NextResponse.json({ ok: true, items, done: items.length < limit }, { status: 200 });
  }

  // artists (includes track_count + total/daily streams)
  const { data, error } = await svc.rpc("collector_artists_stats_paged", {
    collector,
    run_date,
    offset_rows: offset,
    limit_rows: limit,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (data ?? []) as any[];
  const items = rows
    .map((r) => ({
      artist_id: String(r?.artist_id ?? ""),
      name: (r?.name ?? null) as string | null,
      image_url: (r?.image_url ?? null) as string | null,
      track_count: r?.track_count == null ? 0 : Number(r.track_count),
      total_streams_cumulative: r?.total_streams_cumulative == null ? 0 : Number(r.total_streams_cumulative),
      daily_streams_delta: r?.daily_streams_delta == null ? 0 : Number(r.daily_streams_delta),
    }))
    .filter((a) => a.artist_id);

  return NextResponse.json({ ok: true, items, done: items.length < limit }, { status: 200 });
}

