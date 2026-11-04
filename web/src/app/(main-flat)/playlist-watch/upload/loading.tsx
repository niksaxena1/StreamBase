import { Radio } from "lucide-react";

import { PageHeader } from "@/components/shell/PageHeader";
import { TableSkeleton } from "@/components/ui/Skeleton";

export default function UploadTracksLoading() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Upload tracks"
        subtitle="Loading stream counts…"
        icon={
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg sb-ring"
            style={{ background: "var(--sb-surface)" }}
          >
            <Radio className="h-6 w-6" style={{ color: "var(--sb-accent)" }} />
          </div>
        }
      />
      <TableSkeleton rows={12} cols={7} />
    </div>
  );
}
