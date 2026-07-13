import { findTrackByIsrc } from "@/lib/spotify";
import { apiJsonErr, apiJsonOk, requireUser } from "@/lib/api/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const auth = await requireUser(sb);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const isrc = (url.searchParams.get("isrc") ?? "").trim().toUpperCase();
  if (!isrc) {
    return apiJsonErr("missing isrc", 400);
  }

  try {
    const res = await findTrackByIsrc(isrc);
    return apiJsonOk({ isrc, albumImageUrl: res?.albumImageUrl ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "spotify lookup failed";
    return apiJsonErr(msg, 500);
  }
}
