import type { SupabaseClient, User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { apiJsonErr, requireUser } from "@/lib/api/server";

type AccessResult = { ok: true; user: User } | { ok: false; response: NextResponse };

export async function requirePlaylistWatchAccess(sb: SupabaseClient): Promise<AccessResult> {
  const auth = await requireUser(sb);
  if (!auth.ok) return auth;
  const { data, error } = await sb.rpc("can_access_playlist_watch");
  if (error) return { ok: false, response: apiJsonErr(error.message, 500) };
  if (!data) return { ok: false, response: apiJsonErr("forbidden", 403) };
  return auth;
}

export async function requirePlaylistWatchAdmin(sb: SupabaseClient): Promise<AccessResult> {
  const auth = await requireUser(sb);
  if (!auth.ok) return auth;
  const { data, error } = await sb.rpc("is_playlist_watch_admin");
  if (error) return { ok: false, response: apiJsonErr(error.message, 500) };
  if (!data) return { ok: false, response: apiJsonErr("forbidden", 403) };
  return auth;
}
