import { NextRequest } from "next/server";

import { apiJsonErr, apiJsonOk, readJsonBody, requireAdmin } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArtistInHouseRow = {
  artist_id: string;
  artist_name: string | null;
};

function normalizeArtistId(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const { data, error } = await svc
    .from("artist_in_house_tags")
    .select("artist_id,artist_name")
    .order("artist_name", { ascending: true });

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonOk({ artists: [], configured: false as const });
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({
    artists: ((data ?? []) as ArtistInHouseRow[]).filter((a) => a.artist_id),
    configured: true as const,
  });
}

export async function PATCH(request: NextRequest) {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body as Record<string, unknown>;
  const artistId = normalizeArtistId(body.artist_id);
  const artistName = typeof body.artist_name === "string" ? body.artist_name.trim() : null;
  const inHouse = Boolean(body.in_house);

  if (!artistId) return apiJsonErr("artist_id is required", 400);

  const svc = supabaseService();

  if (inHouse) {
    const { data, error } = await svc
      .from("artist_in_house_tags")
      .upsert(
        {
          artist_id: artistId,
          artist_name: artistName,
          created_by: auth.user.id,
        },
        { onConflict: "artist_id" },
      )
      .select("artist_id,artist_name")
      .maybeSingle();

    if (error) {
      if (isSchemaMissing(error)) {
        return apiJsonErr(
          "Artist in-house tagging is not configured yet. Run the add_artist_in_house_tags migration, then retry.",
          409,
        );
      }
      return apiJsonErr(error.message, 500);
    }

    return apiJsonOk({ artist: data, in_house: true });
  }

  const { error } = await svc
    .from("artist_in_house_tags")
    .delete()
    .eq("artist_id", artistId);

  if (error) {
    if (isSchemaMissing(error)) {
      return apiJsonErr(
        "Artist in-house tagging is not configured yet. Run the add_artist_in_house_tags migration, then retry.",
        409,
      );
    }
    return apiJsonErr(error.message, 500);
  }

  return apiJsonOk({ artist_id: artistId, in_house: false });
}
