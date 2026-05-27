import type { Metadata } from "next";
import nextDynamic from "next/dynamic";

import { PageHeader } from "@/components/shell/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { formatInt } from "@/lib/format";
import { loadPlaylistWatchPage } from "@/lib/playlistWatch/loadPlaylistWatchPage";

const PlaylistWatchClient = nextDynamic(
  () => import("./PlaylistWatchClient").then((m) => ({ default: m.PlaylistWatchClient })),
  { loading: () => <TableSkeleton rows={10} cols={8} /> },
);

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Playlist Watch",
};

type SearchParams = {
  archived?: string;
};

export default async function PlaylistWatchPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const includeArchived = sp.archived === "1";

  const { rows, isAdmin, latestRun } = await loadPlaylistWatchPage(includeArchived);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Playlist Watch"
        subtitle={
          latestRun?.run_date
            ? `Latest run ${latestRun.run_date} (${latestRun.status ?? "unknown"}): ${formatInt(latestRun.success_count ?? 0)} ok, ${formatInt(latestRun.failure_count ?? 0)} failed`
            : "Track daily follower counts for independent Spotify playlists."
        }
      />
      <PlaylistWatchClient playlists={rows} isAdmin={isAdmin} includeArchived={includeArchived} />
    </div>
  );
}
