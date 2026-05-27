import { Users } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { ChartSkeleton, Skeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function CompetitorsLoading() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Competitors"
        subtitle="Loading competitor comparison and catalog intel"
        icon={
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring"
            style={{ background: "var(--sb-surface)" }}
          >
            <Users className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
        actions={<Skeleton className="h-4 w-48 rounded" />}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <div className="sb-card space-y-4 p-4">
        <ChartSkeleton height={260} />
        <TableSkeleton rows={6} cols={7} />
      </div>
      <div className="space-y-6">
        <TableSkeleton rows={8} cols={5} />
        <TableSkeleton rows={6} cols={5} />
      </div>
    </div>
  );
}
