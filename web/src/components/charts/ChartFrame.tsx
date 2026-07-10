import type { ReactNode } from "react";

import { FreshnessLabel } from "@/components/ui/DataStates";

export function ChartFrame({ title, description, dataDate, actions, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  dataDate?: string | null;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["sb-card sb-deferred-section p-3", className].filter(Boolean).join(" ")} aria-label={typeof title === "string" ? title : undefined}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? <div className="mt-0.5 text-xs" style={{ color: "var(--sb-muted)" }}>{description}</div> : null}
          <FreshnessLabel date={dataDate} />
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
