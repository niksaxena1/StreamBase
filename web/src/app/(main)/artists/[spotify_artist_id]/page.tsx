import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Artist",
};

export default async function ArtistDetailPage({ params }: { params: Promise<{ spotify_artist_id: string }> }) {
  const { spotify_artist_id } = await params;
  // Redirect to the catalog page with the artist ID
  redirect(`/catalog?artist_id=${encodeURIComponent(spotify_artist_id)}`);
}
