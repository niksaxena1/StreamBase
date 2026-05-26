import { Disc3 } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { ChartSkeleton, Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function CatalogLoading() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Catalog"
        subtitle="Loading artist and track analytics"
        icon={
          <div className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring" style={{ background: "var(--sb-surface)" }}>
            <Disc3 className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
        actions={
          <>
            <Skeleton className="h-9 w-44 rounded-lg" />
            <Skeleton className="hidden h-9 w-28 rounded-lg sm:block" />
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton height={220} />
        <ChartSkeleton height={220} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <TableSkeleton rows={6} cols={6} />
        <TableSkeleton rows={6} cols={6} />
      </div>
    </div>
  );
}
