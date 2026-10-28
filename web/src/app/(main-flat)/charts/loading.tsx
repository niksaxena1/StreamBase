import { ChartSkeleton, StatCardSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/shell/PageHeader";

export default function ChartsLoading() {
  return (
    <div className="space-y-4">
      <PageHeader title="Charts" subtitle="Loading chart snapshot…" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <TableSkeleton rows={12} cols={8} />
      <ChartSkeleton height={160} />
    </div>
  );
}
