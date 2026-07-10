import { Settings } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Loading admin settings…"
        icon={
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring"
            style={{ background: "var(--sb-surface)" }}
          >
            <Settings className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
