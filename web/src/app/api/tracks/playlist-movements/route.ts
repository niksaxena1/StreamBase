import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional, requireAdmin } from "@/lib/api/server";

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

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const type = body.type;
  const startDate = body.start_date ?? null;
  const endDate = body.end_date ?? null;

  if (type !== "Distro" && type !== "Entity") {
    return apiJsonErr('type must be "Distro" or "Entity"', 400);
  }
  if (startDate != null && !isIsoDate(startDate)) {
    return apiJsonErr("invalid start_date", 400);
  }
  if (endDate != null && !isIsoDate(endDate)) {
    return apiJsonErr("invalid end_date", 400);
  }

  const svc = supabaseService();

  const { data: playlists, error: plErr } = await svc
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url")
    .eq("playlist_type", type);

  if (plErr) return apiJsonErr(plErr.message, 500);
  const playlistKeys = (playlists ?? []).map((p: { playlist_key?: unknown }) => String(p.playlist_key));
  if (playlistKeys.length === 0) {
    return apiJsonOk({ movements: {} as Record<string, { playlists: { name: string; imageUrl: string | null }[] }> });
  }

  const nameMap = new Map<string, string>();
  const imageMap = new Map<string, string | null>();
  for (const p of playlists ?? []) {
    const row = p as { playlist_key?: unknown; display_name?: unknown; spotify_playlist_image_url?: unknown };
    const pk = String(row.playlist_key);
    nameMap.set(pk, String(row.display_name ?? pk));
    imageMap.set(pk, (row.spotify_playlist_image_url as string) ?? null);
  }

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

    query = query.order("isrc", { ascending: true }).order("valid_from", { ascending: true }).range(from, to);

    const { data, error } = await query;
    if (error) return apiJsonErr(error.message, 500);

    const rows = (data ?? []) as Array<{
      isrc?: unknown;
      playlist_key?: unknown;
      valid_from?: unknown;
      valid_to?: unknown;
    }>;
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

  return apiJsonOk({ movements });
}
