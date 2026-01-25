import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TracksPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; page?: string; view?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  
  // Backwards-compat: old query-driven list view
  if ((sp.view ?? "").trim().toLowerCase() === "list") {
    redirect("/tracks/config");
  }

  // Default: redirect to config page (tracks doesn't have a dashboard like playlists/artists)
  const params = new URLSearchParams();
  if (sp.q) params.set("q", String(sp.q));
  if (sp.page) params.set("page", String(sp.page));
  redirect(`/tracks/config${params.toString() ? `?${params.toString()}` : ""}`);
}

