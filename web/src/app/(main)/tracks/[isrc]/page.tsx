import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Track",
};

export default async function TrackDetailPage({ params }: { params: Promise<{ isrc: string }> }) {
  const { isrc } = await params;
  // Redirect to the catalog page with the track ISRC
  redirect(`/catalog?isrc=${encodeURIComponent(isrc)}`);
}
