import { ListMusic } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { ChartSkeleton, Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function PlaylistsLoading() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Playlists"
        subtitle="Loading playlist movement and track history"
        icon={
          <div className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring" style={{ background: "var(--sb-surface)" }}>
            <ListMusic className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
        actions={
          <>
            <Skeleton className="h-9 w-48 rounded-lg" />
            <Skeleton className="hidden h-9 w-32 rounded-lg sm:block" />
          </>
        }
      />
      <Skeleton className="h-9 w-full max-w-md rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton height={220} />
        <TableSkeleton rows={5} cols={6} />
      </div>
    </div>
  );
}
