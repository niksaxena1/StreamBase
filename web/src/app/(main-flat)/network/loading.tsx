import { Skeleton } from "@/components/ui/Skeleton";

export default function NetworkLoading() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <Skeleton className="h-[min(70vh,720px)] w-full rounded-xl" />
    </div>
  );
}
