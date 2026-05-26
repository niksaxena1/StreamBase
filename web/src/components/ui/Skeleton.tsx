import { ComponentProps } from "react";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={[
        "sb-skeleton rounded-md",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

/**
 * Loading spinner component with consistent styling.
 * Uses CSS-based animation for smooth performance.
 */
export function Spinner({ 
  size = "md", 
  className 
}: { 
  size?: "sm" | "md" | "lg"; 
  className?: string;
}) {
  const sizeClass = size === "sm" ? "sb-spinner-sm" : size === "lg" ? "sb-spinner-lg" : "";
  return (
    <div
      className={["sb-spinner", sizeClass, className].filter(Boolean).join(" ")}
      role="status"
      aria-label="Loading"
    />
  );
}

/**
 * Full-page or section loading state with spinner and optional message.
 */
export function LoadingState({ 
  message = "Loading...",
  size = "md",
  className,
}: { 
  message?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div className={["flex flex-col items-center justify-center gap-3 py-12", className].filter(Boolean).join(" ")}>
      <Spinner size={size} />
      <p className="text-sm" style={{ color: "var(--sb-muted)" }}>{message}</p>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="sb-card overflow-hidden p-3">
      <div className="flex min-h-[92px] flex-col justify-between">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="mb-2 h-3 w-24" />
            <Skeleton className="mb-2 h-7 w-28" />
          </div>
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex items-end gap-1">
            <Skeleton className="h-4 w-2 rounded-sm" />
            <Skeleton className="h-7 w-2 rounded-sm" />
            <Skeleton className="h-5 w-2 rounded-sm" />
            <Skeleton className="h-8 w-2 rounded-sm" />
            <Skeleton className="h-6 w-2 rounded-sm" />
          </div>
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const headerWidths = ["w-10", "w-24", "w-20", "w-16", "w-24", "w-14"];

  return (
    <div className="sb-card">
      <div className="max-h-[440px] overflow-auto">
        <table className="min-w-full text-xs">
          <thead
            className="sticky top-0 z-10 text-left text-[11px] uppercase tracking-wider backdrop-blur-xl"
            style={{
              color: "var(--sb-muted)",
              background: "var(--sb-surface)",
              boxShadow: "0 1px 0 0 var(--sb-border)",
            }}
          >
            <tr>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="px-3 py-2 font-medium">
                  <Skeleton className={["h-3", headerWidths[i % headerWidths.length]].join(" ")} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="sb-skeleton-table-body">
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: cols }).map((_, j) => (
                  <td key={j} className="px-3 py-2">
                    {j === 0 ? (
                      <Skeleton className="h-8 w-8 rounded-lg" />
                    ) : j === 1 ? (
                      <div className="space-y-1.5">
                        <Skeleton className={["h-3.5", i % 3 === 0 ? "w-44" : i % 3 === 1 ? "w-36" : "w-52"].join(" ")} />
                        <Skeleton className={["h-2.5", i % 2 === 0 ? "w-24" : "w-32"].join(" ")} />
                      </div>
                    ) : (
                      <Skeleton className={["h-4", j >= cols - 2 ? "ml-auto w-20" : "w-full"].join(" ")} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  const bars = [42, 54, 36, 65, 58, 74, 49, 68, 82, 62, 77, 70];

  return (
    <div className="sb-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-2.5 w-24" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-6 w-12 rounded-full" />
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
      </div>
      <div className="sb-skeleton-chart relative overflow-hidden rounded-lg border p-3" style={{ height: `${height}px` }}>
        <div className="absolute inset-x-3 top-1/4 border-t" />
        <div className="absolute inset-x-3 top-1/2 border-t" />
        <div className="absolute inset-x-3 top-3/4 border-t" />
        <div className="relative flex h-full items-end gap-2">
          {bars.map((bar, i) => (
            <Skeleton
              key={i}
              className="min-w-2 flex-1 rounded-t-md rounded-b-sm"
              style={{ height: `${bar}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
