import type { Metadata } from "next";
import Link from "next/link";
import nextDynamic from "next/dynamic";

import { PageHeader } from "@/components/shell/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { formatInt, formatDisplayDate } from "@/lib/format";
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
  collection?: string;
  status?: string;
};

export default async function PlaylistWatchPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const includeArchived = sp.archived === "1";

  const { rows, collections, isAdmin, latestRun } = await loadPlaylistWatchPage(includeArchived);

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <Link
            href="/playlist-watch/upload"
            className="sb-ring inline-flex h-9 items-center rounded-lg bg-white/60 px-3 text-sm font-semibold hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
            style={{ color: "var(--sb-text)" }}
          >
            Upload tracks
          </Link>
        }
        title="Playlist Watch"
        subtitle={
          latestRun?.run_date
            ? `Latest run ${formatDisplayDate(latestRun.run_date)} (${latestRun.status ?? "unknown"}): ${formatInt(latestRun.success_count ?? 0)} ok, ${formatInt(latestRun.failure_count ?? 0)} failed`
            : "Track daily follower counts for independent Spotify playlists."
        }
      />
      <PlaylistWatchClient
        playlists={rows}
        collections={collections}
        initialCollection={sp.collection ?? null}
        initialStatus={sp.status ?? null}
        isAdmin={isAdmin}
        includeArchived={includeArchived}
      />
    </div>
  );
}
