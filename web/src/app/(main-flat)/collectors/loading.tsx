import { Layers } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { ChartSkeleton, Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function CollectorsLoading() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Collectors"
        subtitle="Loading collector comparison and playlist analytics"
        icon={
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring"
            style={{ background: "var(--sb-surface)" }}
          >
            <Layers className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
        actions={
          <>
            <Skeleton className="h-9 w-36 rounded-lg" />
            <Skeleton className="hidden h-9 w-28 rounded-lg sm:block" />
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="sb-card space-y-4 p-4">
        <ChartSkeleton height={260} />
        <TableSkeleton rows={6} cols={7} />
      </div>
      <TableSkeleton rows={10} cols={6} />
    </div>
  );
}
