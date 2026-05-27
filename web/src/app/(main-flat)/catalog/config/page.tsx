import type { Metadata } from "next";

import { loadCatalogConfigArtists } from "@/lib/catalog/loadCatalogConfig";

import { CatalogConfigPageClient } from "./CatalogConfigPageClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Catalog Config",
};

export default async function CatalogConfigPage() {
  const { artists, errorMessage } = await loadCatalogConfigArtists();

  return <CatalogConfigPageClient artists={artists} artistsError={errorMessage} />;
}
