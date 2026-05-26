import { Activity } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { ChartSkeleton, Skeleton, StatCardSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Home"
        subtitle="Preparing the latest catalog snapshot"
        icon={
          <div className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring" style={{ background: "var(--sb-surface)" }}>
            <Activity className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
        actions={<Skeleton className="h-9 w-40 rounded-lg" />}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <ChartSkeleton height={260} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartSkeleton height={220} />
        <ChartSkeleton height={220} />
      </div>
    </div>
  );
}
