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
    <div className="sb-card flex min-h-[92px] flex-col justify-center gap-3 p-3">
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className="h-6 w-28" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number; cols?: number }) {
  const visibleRows = Math.min(rows, 5);
  return (
    <div className="sb-card overflow-hidden p-2">
      <div className="px-2 py-1.5">
        <Skeleton className="h-2.5 w-24" />
      </div>
      <div className="space-y-1">
        {Array.from({ length: visibleRows }).map((_, index) => (
          <div
            key={index}
            className="flex h-10 items-center justify-between gap-6 rounded-lg px-2"
            style={{ background: "color-mix(in srgb, var(--sb-muted) 2.5%, transparent)" }}
          >
            <Skeleton className="h-3 w-full max-w-52" />
            <Skeleton className="h-3 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="sb-card p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="w-full rounded-lg" style={{ height: `${height}px` }} />
    </div>
  );
}
