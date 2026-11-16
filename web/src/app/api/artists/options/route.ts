import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, requireAdmin } from "@/lib/api/server";
import { isSchemaMissing } from "@/lib/supabase/schemaMissing";
import { fetchAllPages } from "@/lib/library/paging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requireAdmin(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService();
  const [{ data, error }, inHouseResult] = await Promise.all([
    fetchAllPages((from, to) => svc
      .from("spotify_artist_images")
      .select("artist_id,name,image_url")
      .order("name", { ascending: true })
      .order("artist_id", { ascending: true })
      .range(from, to))
      .then((rows) => ({ data: rows, error: null }))
      .catch((err: unknown) => ({ data: null, error: err as any })),
    fetchAllPages((from, to) => svc.from("artist_in_house_tags").select("artist_id,artist_name")
      .order("artist_id", { ascending: true }).range(from, to))
      .then((rows) => ({ data: rows, error: null }))
      .catch((err: unknown) => ({ data: null, error: err as any })),
  ]);

  if (error) {
    return apiJsonErr(error.message, 500);
  }
  const inHouseRows =
    inHouseResult.error && !isSchemaMissing(inHouseResult.error)
      ? []
      : ((inHouseResult.data ?? []) as Array<{ artist_id: string | null; artist_name: string | null }>);
  const inHouseArtistIds = new Set(
    inHouseRows
      .map((a) => a.artist_id)
      .filter((artistId): artistId is string => Boolean(artistId)),
  );

  const artistsById = new Map<string, { artist_id: string; name: string | null; image_url: string | null; in_house: boolean }>();

  for (const artist of (data ?? [])
    .map((a: { artist_id?: unknown; name?: unknown; image_url?: unknown }) => ({
      artist_id: String(a?.artist_id ?? ""),
      name: (a?.name ?? null) as string | null,
      image_url: (a?.image_url ?? null) as string | null,
      in_house: inHouseArtistIds.has(String(a?.artist_id ?? "")),
    }))
    .filter((a: { artist_id: string }) => a.artist_id)) {
    artistsById.set(artist.artist_id, artist);
  }

  for (const row of inHouseRows) {
    if (!row.artist_id || artistsById.has(row.artist_id)) continue;
    artistsById.set(row.artist_id, {
      artist_id: row.artist_id,
      name: row.artist_name,
      image_url: null,
      in_house: true,
    });
  }

  const artists = Array.from(artistsById.values()).sort((a, b) =>
    (a.name ?? a.artist_id).localeCompare(b.name ?? b.artist_id),
  );

  return apiJsonOk({ artists });
}
