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
  const { data, error } = await svc
    .from("spotify_artist_images")
    .select("artist_id,name,image_url")
    .order("name", { ascending: true })
    .limit(5000);

  if (error) {
    return apiJsonErr(error.message, 500);
  }

  const artists = (data ?? [])
    .map((a: { artist_id?: unknown; name?: unknown; image_url?: unknown }) => ({
      artist_id: String(a?.artist_id ?? ""),
      name: (a?.name ?? null) as string | null,
      image_url: (a?.image_url ?? null) as string | null,
    }))
    .filter((a: { artist_id: string }) => a.artist_id);

  return apiJsonOk({ artists });
}
