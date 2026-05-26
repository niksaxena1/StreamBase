import { buildCatalogDeepLinkPathFromResolved } from "@/lib/catalogDeepLink";
import { normalizeDatasetMode } from "@/lib/datasetMode";
import { supabaseService } from "@/lib/supabase/service";

type CatalogDeepLinkArgs = {
  userId: string;
  isrc?: string;
  artistId?: string;
  range?: string;
};

/**
 * Build a /catalog URL for the user's active dataset (own vs competitor).
 */
export async function buildCatalogDeepLinkPath(args: CatalogDeepLinkArgs): Promise<string> {
  const isrc = (args.isrc ?? "").trim();
  const artistId = (args.artistId ?? "").trim();
  const range = (args.range ?? "").trim();

  if (artistId) {
    return buildCatalogDeepLinkPathFromResolved({ artistId, isrc, range });
  }

  if (!isrc) {
    return buildCatalogDeepLinkPathFromResolved({ range });
  }

  const svc = supabaseService();
  const { data: settings } = await svc
    .from("user_settings")
    .select("dataset_mode")
    .eq("user_id", args.userId)
    .maybeSingle();
  const datasetMode = normalizeDatasetMode(settings?.dataset_mode);
  const tracksClient = datasetMode === "competitor" ? svc.schema("competitor") : svc;

  const { data: trackRow } = await tracksClient
    .from("tracks")
    .select("spotify_artist_ids")
    .eq("isrc", isrc)
    .maybeSingle();
  const ids = (trackRow as { spotify_artist_ids?: string[] | null } | null)?.spotify_artist_ids;
  const primaryArtistId = Array.isArray(ids) ? String(ids[0] ?? "").trim() : "";

  return buildCatalogDeepLinkPathFromResolved({
    isrc,
    range,
    primaryArtistIdFromTrack: primaryArtistId || null,
  });
}
