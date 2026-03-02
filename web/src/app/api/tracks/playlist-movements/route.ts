import { NextResponse, NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

type MembershipRecord = {
  playlist_key: string;
  valid_from: string;
  valid_to: string | null;
};

/**
 * Returns ISRCs that have been in 2+ different playlists of the same type
 * (Distro or Entity), indicating a movement between playlists.
 *
 * Body: { type: "Distro" | "Entity", start_date?: string, end_date?: string }
 *
 * Response: { movements: Record<string, { playlists: string[] }> }
 *   - Key is ISRC
 *   - playlists is ordered chronologically (oldest first, newest last)
 *     so playlists[0] is the "from" and playlists[last] is the current/latest "to"
 *   - playlist values are display_name strings
 */
export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: userData } = await sb.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: isAdmin, error: adminErr } = await sb.rpc("is_admin");
  if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const type = (body as any)?.type;
  const startDate = (body as any)?.start_date ?? null;
  const endDate = (body as any)?.end_date ?? null;

  if (type !== "Distro" && type !== "Entity") {
    return NextResponse.json({ error: 'type must be "Distro" or "Entity"' }, { status: 400 });
  }
  if (startDate != null && !isIsoDate(startDate)) {
    return NextResponse.json({ error: "invalid start_date" }, { status: 400 });
  }
  if (endDate != null && !isIsoDate(endDate)) {
    return NextResponse.json({ error: "invalid end_date" }, { status: 400 });
  }

  const svc = supabaseService();

  // Step 1: Get all playlists of the requested type (key + name)
  const { data: playlists, error: plErr } = await svc
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url")
    .eq("playlist_type", type);

  if (plErr) return NextResponse.json({ error: plErr.message }, { status: 500 });
  const playlistKeys = (playlists ?? []).map((p: any) => String(p.playlist_key));
  if (playlistKeys.length === 0) {
    return NextResponse.json({ movements: {} }, { status: 200 });
  }

  const nameMap = new Map<string, string>();
  const imageMap = new Map<string, string | null>();
  for (const p of playlists ?? []) {
    const pk = String(p.playlist_key);
    nameMap.set(pk, String(p.display_name ?? pk));
    imageMap.set(pk, (p.spotify_playlist_image_url as string) ?? null);
  }

  // Step 2: Fetch membership records with dates for chronological ordering
  const pageSize = 1000;
  const hardCap = 500_000;
  const isrcRecords = new Map<string, MembershipRecord[]>();

  for (let from = 0; from < hardCap; from += pageSize) {
    const to = from + pageSize - 1;

    let query = svc
      .from("playlist_memberships")
      .select("isrc,playlist_key,valid_from,valid_to")
      .in("playlist_key", playlistKeys);

    if (startDate) query = query.gte("valid_from", startDate);
    if (endDate) query = query.lte("valid_from", endDate);

    query = query
      .order("isrc", { ascending: true })
      .order("valid_from", { ascending: true })
      .range(from, to);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as any[];
    if (!rows.length) break;

    for (const r of rows) {
      const isrc = String(r?.isrc ?? "").trim().toUpperCase();
      const pk = String(r?.playlist_key ?? "").trim();
      if (!isrc || !pk) continue;

      let records = isrcRecords.get(isrc);
      if (!records) {
        records = [];
        isrcRecords.set(isrc, records);
      }
      records.push({
        playlist_key: pk,
        valid_from: String(r.valid_from ?? ""),
        valid_to: r.valid_to ? String(r.valid_to) : null,
      });
    }

    if (rows.length < pageSize) break;
  }

  // Step 3: Build movements — only for ISRCs in 2+ distinct playlists
  const movements: Record<string, { playlists: { name: string; imageUrl: string | null }[] }> = {};

  for (const [isrc, records] of isrcRecords) {
    const distinctKeys = new Set(records.map((r) => r.playlist_key));
    if (distinctKeys.size < 2) continue;

    records.sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    const ordered: { name: string; imageUrl: string | null }[] = [];
    let lastKey = "";
    for (const r of records) {
      if (r.playlist_key !== lastKey) {
        ordered.push({
          name: nameMap.get(r.playlist_key) ?? r.playlist_key,
          imageUrl: imageMap.get(r.playlist_key) ?? null,
        });
        lastKey = r.playlist_key;
      }
    }

    movements[isrc] = { playlists: ordered };
  }

  return NextResponse.json({ movements }, { status: 200 });
}
