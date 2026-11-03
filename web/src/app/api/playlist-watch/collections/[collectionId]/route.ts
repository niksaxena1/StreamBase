import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { apiJsonErr, apiJsonOk, readJsonBodyOptional } from "@/lib/api/server";
import { requirePlaylistWatchAccess } from "@/lib/playlistWatch/access";
import { parseSpotifyPlaylistId } from "@/lib/playlistWatch/spotifyPlaylistId";
import {
  COLLECTION_COLOR_RE,
  parseStatusUpdates,
  validateCollectionName,
  type AdStatus,
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

/**
 * Membership and ad-status changes. Body: `{ add?: string[], remove?: string[], status?: [{ playlist, ad_status }] }`
 * (Spotify playlist ids; `ad_status` is 'live' | 'stopped' | null). A status target must already be a
 * member or be in `add` in the same request. `ad_status_changed_at` only moves when the status changes.
 */
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
  const statusUpdates = parseStatusUpdates(body.status);
  if (statusUpdates === null) return apiJsonErr("invalid_status_update", 400);
  if (add.length === 0 && remove.length === 0 && statusUpdates.length === 0) return apiJsonErr("nothing_to_update", 400);
  const removeSet = new Set(remove);
  if (statusUpdates.some((u) => removeSet.has(u.playlistId))) return apiJsonErr("status_for_removed_playlist", 400);

  const svc = supabaseService().schema("playlist_watch");
  const { data: collection, error: collectionErr } = await svc
    .from("collections")
    .select("id")
    .eq("id", collectionId)
    .maybeSingle();
  if (collectionErr) return apiJsonErr(collectionErr.message, 500);
  if (!collection) return apiJsonErr("not_found", 404);

  // Validate status targets before any write, and remember the current statuses for change detection.
  const currentStatus = new Map<string, AdStatus | null>();
  if (statusUpdates.length > 0) {
    const { data: existing, error: existingErr } = await svc
      .from("collection_playlists")
      .select("spotify_playlist_id,ad_status")
      .eq("collection_id", collectionId)
      .in("spotify_playlist_id", statusUpdates.map((u) => u.playlistId));
    if (existingErr) return apiJsonErr(existingErr.message, 500);
    for (const m of (existing ?? []) as { spotify_playlist_id: string; ad_status: AdStatus | null }[]) {
      currentStatus.set(m.spotify_playlist_id, m.ad_status);
    }
    const addSet = new Set(add);
    if (statusUpdates.some((u) => !currentStatus.has(u.playlistId) && !addSet.has(u.playlistId))) {
      return apiJsonErr("not_a_member", 400);
    }
  }

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

  // Only rows whose status really changes are touched; new members start at null.
  const changed = statusUpdates.filter((u) => (currentStatus.get(u.playlistId) ?? null) !== u.adStatus);
  const now = new Date().toISOString();
  for (const target of ["live", "stopped", null] as const) {
    const ids = changed.filter((u) => u.adStatus === target).map((u) => u.playlistId);
    if (ids.length === 0) continue;
    const { error: statusErr } = await svc
      .from("collection_playlists")
      .update({ ad_status: target, ad_status_changed_at: target === null ? null : now })
      .eq("collection_id", collectionId)
      .in("spotify_playlist_id", ids);
    if (statusErr) return apiJsonErr(statusErr.message, 500);
  }

  await svc.from("collections").update({ updated_at: now }).eq("id", collectionId);
  return apiJsonOk({ id: collectionId, added: add.length, removed: remove.length, statusChanged: changed.length });
}
