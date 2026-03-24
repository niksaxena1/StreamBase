import { findTrackByIsrc } from "@/lib/spotify";
import { apiJsonErr, apiJsonOk } from "@/lib/api/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
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
