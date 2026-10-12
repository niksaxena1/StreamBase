import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SectionErrorState } from "@/components/ui/DataStates";
import { loadLibrary } from "@/lib/library/loadLibrary";
import { loadLibraryStreams } from "@/lib/library/loadLibraryStreams";
import { getRequestAppContext } from "@/lib/requestAppContext.server";

import { LibraryNotConnected } from "./LibraryNotConnected";
import { LibraryPageClient } from "./LibraryPageClient";

// Uses Supabase session cookies; this route must be dynamic in Next 16.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Library",
};

export default async function LibraryPage() {
  const { user, isAdmin } = await getRequestAppContext();
  if (!user) redirect("/login");
  if (!isAdmin) redirect("/");

  // Streams are cached separately and never fail the page: without them the columns show "—".
  const [data, streams] = await Promise.all([loadLibrary(), loadLibraryStreams()]);

  if (data.status === "not_configured") return <LibraryNotConnected envVars={data.envVars} />;
  if (data.status === "error") {
    return <SectionErrorState title="Couldn't load the library" message={data.message} />;
  }

  // Release dates are calendar dates, so "today" is fixed on the server and passed down.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <LibraryPageClient
      rows={data.rows}
      entities={data.entities}
      distributors={data.distributors}
      streams={streams}
      today={today}
    />
  );
}
