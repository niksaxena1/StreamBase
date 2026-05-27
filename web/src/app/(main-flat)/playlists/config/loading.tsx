import { ListMusic } from "lucide-react";

import { Skeleton } from "@/components/ui/Skeleton";

export default function PlaylistsConfigLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Playlists</h1>
            <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              Loading playlist configuration…
            </p>
          </div>
        </div>
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-32 rounded-full" />
      </div>
      <div className="sb-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 dark:border-white/5">
          <ListMusic className="h-4 w-4 opacity-40" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-2 p-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
