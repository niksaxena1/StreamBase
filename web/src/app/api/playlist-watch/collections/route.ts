import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import {
  COLLECTION_COLOR_RE,
  validateCollectionName,
} from "@/app/(main-flat)/playlist-watch/collectionsModel";

type CollectionDbRow = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
};

export async function GET() {
  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService().schema("playlist_watch");
  const [{ data: collections, error: collectionsErr }, { data: members, error: membersErr }] = await Promise.all([
    svc
      .from("collections")
      .select("id,name,color,sort_order")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    svc.from("collection_playlists").select("collection_id,spotify_playlist_id").limit(20000),
  ]);
  if (collectionsErr) return apiJsonErr(collectionsErr.message, 500);
  if (membersErr) return apiJsonErr(membersErr.message, 500);

  const byCollection = new Map<string, string[]>();
  for (const m of (members ?? []) as { collection_id: string; spotify_playlist_id: string }[]) {
    const bucket = byCollection.get(m.collection_id) ?? [];
    bucket.push(m.spotify_playlist_id);
    byCollection.set(m.collection_id, bucket);
  }

  return apiJsonOk({
    collections: ((collections ?? []) as CollectionDbRow[]).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      sortOrder: c.sort_order,
      playlistIds: byCollection.get(c.id) ?? [],
    })),
  });
}

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const name = validateCollectionName(body.name);
  if (!name.ok) return apiJsonErr(name.error, 400);

  let color: string | null = null;
  if (body.color !== undefined && body.color !== null && body.color !== "") {
    if (typeof body.color !== "string" || !COLLECTION_COLOR_RE.test(body.color)) {
      return apiJsonErr("Color must look like #rrggbb.", 400);
    }
    color = body.color.toLowerCase();
  }

  const svc = supabaseService().schema("playlist_watch");
  const { data: last, error: lastErr } = await svc
    .from("collections")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) return apiJsonErr(lastErr.message, 500);
  const sortOrder = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;

  const { data, error } = await svc
    .from("collections")
    .insert({ name: name.name, color, sort_order: sortOrder, created_by: auth.user.id })
    .select("id,name,color,sort_order")
    .single();
  if (error) {
    if (error.code === "23505") return apiJsonErr(`A collection named "${name.name}" already exists.`, 409);
    return apiJsonErr(error.message, 500);
  }

  const created = data as CollectionDbRow;
  return apiJsonOk(
    { collection: { id: created.id, name: created.name, color: created.color, sortOrder: created.sort_order, playlistIds: [] } },
    { status: 201 },
  );
}
