import { Library } from "lucide-react";

import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

export default function LibraryLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg sb-ring"
          style={{ background: "var(--sb-surface)" }}
        >
          <Library className="h-5 w-5" style={{ color: "var(--sb-accent)" }} />
        </div>
        <div className="min-w-0">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="mt-1.5 h-3 w-40" />
        </div>
        <Skeleton className="ml-auto h-8 w-28 rounded-full" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-7 w-14 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>

      <Skeleton className="h-20 w-full rounded-xl" />
      <TableSkeleton rows={12} cols={10} />
    </div>
  );
}
