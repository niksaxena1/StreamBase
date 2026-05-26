import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { buildCatalogDeepLinkPath } from "@/lib/catalogDeepLink.server";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Track",
};

export default async function TrackDetailPage({ params }: { params: Promise<{ isrc: string }> }) {
  const { isrc } = await params;
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  const href = user
    ? await buildCatalogDeepLinkPath({ userId: user.id, isrc })
    : `/catalog?isrc=${encodeURIComponent(isrc)}`;

  redirect(href);
}
