import { Activity } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function HealthLoading() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="System Health"
        subtitle="Loading ingestion status and warnings…"
        icon={
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring"
            style={{ background: "var(--sb-surface)" }}
          >
            <Activity className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
        actions={<Skeleton className="h-8 w-8 rounded-full" />}
      />
      <Skeleton className="h-24 w-full rounded-xl" />
      <TableSkeleton rows={5} cols={5} />
    </div>
  );
}
