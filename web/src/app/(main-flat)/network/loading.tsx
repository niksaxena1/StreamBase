import { Network } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { ChartSkeleton, Skeleton, StatCardSkeleton } from "@/components/ui/Skeleton";

export default function NetworkLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <PageHeader title="Network" subtitle="Building the artist collaboration graph" icon={<div className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring"><Network className="h-6 w-6" style={{ color: "var(--sb-accent)" }} /></div>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Loading graph controls">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <ChartSkeleton height={560} />
    </div>
  );
}
