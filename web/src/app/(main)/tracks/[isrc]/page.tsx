import { redirect } from "next/navigation";

export default function TrackDetailPage({ params }: { params: { isrc: string } }) {
  // Redirect to the catalog page with the track ISRC
  redirect(`/catalog?isrc=${encodeURIComponent(params.isrc)}`);
}
