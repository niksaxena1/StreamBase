import { ArrowLeft, Disc3 } from "lucide-react";

import { Skeleton, TableSkeleton } from "@/components/ui/Skeleton";

function ConfigSectionSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className={["h-7", titleWidth].join(" ")} />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-36 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-8 w-32 rounded-lg" />
        </div>
      </div>
      <TableSkeleton rows={8} cols={9} />
    </section>
  );
}

export default function CatalogConfigLoading() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg sb-ring" style={{ background: "var(--sb-surface)" }}>
          <Disc3 className="h-5 w-5" style={{ color: "var(--sb-accent)" }} />
        </div>
        <div className="min-w-0">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-1.5 h-3 w-64" />
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <ArrowLeft className="h-4 w-4 opacity-30" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
      </div>

      <ConfigSectionSkeleton titleWidth="w-32" />
      <ConfigSectionSkeleton titleWidth="w-28" />
    </div>
  );
}
