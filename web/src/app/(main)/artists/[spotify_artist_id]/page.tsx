import { redirect } from "next/navigation";

export default function ArtistDetailPage({ params }: { params: { spotify_artist_id: string } }) {
  // Redirect to the catalog page with the artist ID
  redirect(`/catalog?artist_id=${encodeURIComponent(params.spotify_artist_id)}`);
}
