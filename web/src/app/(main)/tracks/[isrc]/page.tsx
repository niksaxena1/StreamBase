import { redirect } from "next/navigation";

export default async function TrackDetailPage({ params }: { params: Promise<{ isrc: string }> }) {
  const { isrc } = await params;
  // Redirect to the catalog page with the track ISRC
  redirect(`/catalog?isrc=${encodeURIComponent(isrc)}`);
}
