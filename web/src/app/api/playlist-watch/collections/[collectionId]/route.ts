import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import { parseSpotifyPlaylistId } from "@/lib/playlistWatch/spotifyPlaylistId";
import {
  COLLECTION_COLOR_RE,
  validateCollectionName,
} from "@/app/(main-flat)/playlist-watch/collectionsModel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MEMBERSHIP_IDS = 500;

type Ctx = { params: Promise<{ collectionId: string }> };

async function readCollectionId(ctx: Ctx): Promise<string | null> {
  const { collectionId } = await ctx.params;
  return UUID_RE.test(collectionId) ? collectionId : null;
}

function parseIdList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_MEMBERSHIP_IDS) return null;
  const ids: string[] = [];
  for (const item of value) {
    const id = parseSpotifyPlaylistId(String(item ?? ""));
    if (!id) return null;
    ids.push(id);
  }
  return Array.from(new Set(ids));
}

export async function PATCH(req: Request, ctx: Ctx) {
  const collectionId = await readCollectionId(ctx);
  if (!collectionId) return apiJsonErr("invalid_collection_id", 400);

  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = validateCollectionName(body.name);
    if (!name.ok) return apiJsonErr(name.error, 400);
    update.name = name.name;
  }
  if (body.color !== undefined) {
    if (body.color === null || body.color === "") {
      update.color = null;
    } else if (typeof body.color === "string" && COLLECTION_COLOR_RE.test(body.color)) {
      update.color = body.color.toLowerCase();
    } else {
      return apiJsonErr("Color must look like #rrggbb.", 400);
    }
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return apiJsonErr("invalid_sort_order", 400);
    update.sort_order = n;
  }
  if (Object.keys(update).length === 0) return apiJsonErr("nothing_to_update", 400);
  update.updated_at = new Date().toISOString();

  const svc = supabaseService().schema("playlist_watch");
  const { data, error } = await svc
    .from("collections")
    .update(update)
    .eq("id", collectionId)
    .select("id,name,color,sort_order")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") return apiJsonErr(`A collection named "${String(update.name)}" already exists.`, 409);
    return apiJsonErr(error.message, 500);
  }
  if (!data) return apiJsonErr("not_found", 404);
  return apiJsonOk({ collection: data });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const collectionId = await readCollectionId(ctx);
  if (!collectionId) return apiJsonErr("invalid_collection_id", 400);

  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const svc = supabaseService().schema("playlist_watch");
  const { data, error } = await svc.from("collections").delete().eq("id", collectionId).select("id").maybeSingle();
  if (error) return apiJsonErr(error.message, 500);
  if (!data) return apiJsonErr("not_found", 404);
  return apiJsonOk({ id: collectionId });
}

/** Membership changes: body `{ add: string[], remove: string[] }` of Spotify playlist ids. */
export async function PUT(req: Request, ctx: Ctx) {
  const collectionId = await readCollectionId(ctx);
  if (!collectionId) return apiJsonErr("invalid_collection_id", 400);

  const sb = await supabaseServer();
  const auth = await requirePlaylistWatchAccess(sb);
  if (!auth.ok) return auth.response;

  const body = await readJsonBodyOptional(req);
  const add = parseIdList(body.add);
  const remove = parseIdList(body.remove);
  if (add === null || remove === null) return apiJsonErr("invalid_spotify_playlist", 400);
  if (add.length === 0 && remove.length === 0) return apiJsonErr("nothing_to_update", 400);

  const svc = supabaseService().schema("playlist_watch");
  const { data: collection, error: collectionErr } = await svc
    .from("collections")
    .select("id")
    .eq("id", collectionId)
    .maybeSingle();
  if (collectionErr) return apiJsonErr(collectionErr.message, 500);
  if (!collection) return apiJsonErr("not_found", 404);

  if (add.length > 0) {
    const { data: known, error: knownErr } = await svc
      .from("playlists")
      .select("spotify_playlist_id")
      .in("spotify_playlist_id", add);
    if (knownErr) return apiJsonErr(knownErr.message, 500);
    const knownIds = new Set(((known ?? []) as { spotify_playlist_id: string }[]).map((p) => p.spotify_playlist_id));
    if (add.some((id) => !knownIds.has(id))) return apiJsonErr("unknown_playlists", 400);

    const { error: addErr } = await svc
      .from("collection_playlists")
      .upsert(
        add.map((id) => ({ collection_id: collectionId, spotify_playlist_id: id })),
        { onConflict: "collection_id,spotify_playlist_id", ignoreDuplicates: true },
      );
    if (addErr) return apiJsonErr(addErr.message, 500);
  }

  if (remove.length > 0) {
    const { error: removeErr } = await svc
      .from("collection_playlists")
      .delete()
      .eq("collection_id", collectionId)
      .in("spotify_playlist_id", remove);
    if (removeErr) return apiJsonErr(removeErr.message, 500);
  }

  await svc.from("collections").update({ updated_at: new Date().toISOString() }).eq("id", collectionId);
  return apiJsonOk({ id: collectionId, added: add.length, removed: remove.length });
}
