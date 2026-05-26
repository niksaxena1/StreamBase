import { NextRequest } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { ALL_COMPETITORS_KEY } from "@/lib/competitorContext";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const labelKey = req.nextUrl.searchParams.get("label_key")?.trim() ?? "";

  const comp = supabaseService().schema("competitor");
  let query = comp
    .from("playlists")
    .select("playlist_key,display_name,spotify_playlist_image_url,label_key")
    .eq("is_active", true)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true });

  if (labelKey && labelKey !== ALL_COMPETITORS_KEY) {
    query = query.eq("label_key", labelKey);
  }

  const { data, error } = await query;
  if (error) return apiJsonErr(error.message, 500);

  const playlists = (data ?? []).map(
    (p: {
      playlist_key?: unknown;
      display_name?: unknown;
      spotify_playlist_image_url?: unknown;
    }) => ({
      playlist_key: String(p.playlist_key ?? ""),
      display_name: String(p.display_name ?? p.playlist_key ?? "").trim(),
      spotify_playlist_image_url: (p.spotify_playlist_image_url ?? null) as string | null,
    }),
  );

  return apiJsonOk({ playlists });
}
