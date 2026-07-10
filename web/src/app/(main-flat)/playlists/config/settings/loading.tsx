import { Settings } from "lucide-react";

import { Skeleton } from "@/components/ui/Skeleton";

export default function PlaylistSettingsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Playlist Settings
          </h1>
          <p className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            Loading playlist configuration…
          </p>
        </div>
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <div className="sb-card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 dark:border-white/5">
          <Settings className="h-4 w-4 opacity-40" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
