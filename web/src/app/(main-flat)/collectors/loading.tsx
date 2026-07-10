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
      <Skeleton className="h-9 w-full max-w-md rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton height={260} />
        <TableSkeleton rows={5} cols={7} />
      </div>
    </div>
  );
}
