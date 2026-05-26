import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { buildCatalogDeepLinkPath } from "@/lib/catalogDeepLink.server";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Artist",
};

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ spotify_artist_id: string }>;
}) {
  const { spotify_artist_id } = await params;
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const href = user
    ? await buildCatalogDeepLinkPath({ userId: user.id, artistId: spotify_artist_id })
    : `/catalog?artist_id=${encodeURIComponent(spotify_artist_id)}`;

  redirect(href);
}
