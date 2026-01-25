import { ComponentProps } from "react";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={[
        "animate-pulse rounded-md bg-black/5 dark:bg-white/5",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export function StatCardSkeleton() {
  return (
    <div className="sb-card p-3">
      <div className="flex h-full flex-col justify-between">
        <div>
          <Skeleton className="h-3 w-20 mb-2" />
          <Skeleton className="h-8 w-24 mb-2" />
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-20" />
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
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
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--sb-border)" }}>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: cols }).map((_, j) => (
                  <td key={j} className="px-3 py-2">
                    <Skeleton className="h-4 w-full" />
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
  return (
    <div className="sb-card p-3">
      <div className="flex items-center justify-between mb-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="w-full" style={{ height: `${height}px` }} />
    </div>
  );
}
