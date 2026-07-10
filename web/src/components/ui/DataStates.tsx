import type { ReactNode } from "react";
import { AlertCircle, Database, RefreshCw } from "lucide-react";

import { Alert } from "@/components/ui/Alert";

export function FreshnessLabel({
  date,
  prefix = "Data through",
  className,
}: {
  date: string | null | undefined;
  prefix?: string;
  className?: string;
}) {
  if (!date) return null;
  return (
    <span
      className={["sb-freshness-label inline-flex items-center gap-1.5 text-xs", className]
        .filter(Boolean)
        .join(" ")}
      style={{ color: "var(--sb-muted)" }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-emerald-400"
        aria-hidden="true"
      />
      {prefix}{" "}
      <time dateTime={date} className="font-mono">
        {date}
      </time>
    </span>
  );
}

export function SectionEmptyState({
  title = "No data available",
  description,
  action,
  icon,
}: {
  title?: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="sb-card flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
      <div
        className="rounded-full p-3"
        style={{ background: "var(--sb-row-hover)", color: "var(--sb-muted)" }}
      >
        {icon ?? <Database className="h-5 w-5" />}
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p
          className="mt-1 max-w-md text-xs"
          style={{ color: "var(--sb-muted)" }}
        >
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}

export function SectionErrorState({
  title = "Couldn’t load this section",
  message,
  retry,
}: {
  title?: string;
  message: string;
  retry?: () => void;
}) {
  return (
    <Alert
      variant="error"
      title={title}
      actions={
        retry ? (
          <button
            type="button"
            onClick={retry}
            className="sb-button-secondary inline-flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        ) : undefined
      }
    >
      <span className="inline-flex items-start gap-1.5">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {message}
      </span>
    </Alert>
  );
}
