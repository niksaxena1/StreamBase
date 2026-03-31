import { supabaseServer } from "@/lib/supabase/server";
import { logError } from "@/lib/logger";
import { apiJsonErr, apiJsonOk, requireSessionUser } from "@/lib/api/server";

export const revalidate = 86400;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isrc = searchParams.get("isrc");

  if (!isrc) {
    return apiJsonErr("missing isrc", 400);
  }

  try {
    const sb = await supabaseServer();
    const auth = await requireSessionUser(sb);
    if (!auth.ok) return auth.response;

    const { data: track } = await sb
      .from("tracks")
      .select("name,spotify_artist_names")
      .eq("isrc", isrc)
      .maybeSingle();

    if (!track) {
      return apiJsonOk({ trackLabel: isrc });
    }

    const trackName = track.name ?? isrc;
    const artistNames = track.spotify_artist_names;

    let trackLabel: string;
    if (artistNames && artistNames.length > 0) {
      trackLabel = `${artistNames[0]} - ${trackName}`;
    } else {
      trackLabel = `${trackName} (${isrc})`;
    }

    return apiJsonOk({ trackLabel });
  } catch (error) {
    logError("Breadcrumb track error", error);
    return apiJsonOk({ trackLabel: isrc });
  }
}
