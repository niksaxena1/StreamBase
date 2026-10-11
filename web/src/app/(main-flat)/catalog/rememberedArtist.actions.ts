"use server";

import { getRequestAppContext } from "@/lib/requestAppContext.server";

/** Validate long-tail own artists that are outside the capped dropdown before navigating. */
export async function isRememberedOwnArtistValid(artistId: string): Promise<boolean> {
  try {
    const { user, isAdmin, shellContext, svc } = await getRequestAppContext();
    if (!user || !isAdmin || shellContext.datasetMode !== "own" || !artistId.trim()) return false;
    const { data, error } = await svc.from("tracks").select("isrc")
      .contains("spotify_artist_ids", [artistId]).limit(1).maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
