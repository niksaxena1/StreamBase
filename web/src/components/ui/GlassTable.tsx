import { ReactNode, ComponentProps } from "react";
import { Music } from "lucide-react";

type HeaderCell =
  | string
  | ReactNode
  | {
      label: ReactNode;
      align?: "left" | "right" | "center";
      className?: string;
    };

interface GlassTableProps {
  headers: HeaderCell[];
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  maxBodyHeightClassName?: string;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  tableLayout?: "auto" | "fixed";
}

function headerAlignClass(align?: "left" | "right" | "center") {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

export function GlassTable({ 
  headers, 
  children, 
  className,
  bodyClassName,
  maxBodyHeightClassName,
  tableLayout = "auto",
}: GlassTableProps) {
  return (
    <div className={["sb-card relative overflow-hidden", className].filter(Boolean).join(" ")}>
      {/* Horizontal scroll indicator for mobile */}
      <div className="absolute bottom-0 right-0 top-0 w-4 bg-gradient-to-l from-black/10 to-transparent pointer-events-none sm:hidden z-20" />
      
      <div
        className={[
          maxBodyHeightClassName ?? "max-h-[440px]",
          "overflow-auto",
          bodyClassName ?? "",
        ].filter(Boolean).join(" ")}
      >
        <table className={["min-w-full text-xs", tableLayout === "fixed" ? "table-fixed" : "table-auto"].join(" ")}>
          <thead
            className="sticky top-0 z-10 text-left text-[11px] uppercase tracking-wider backdrop-blur-xl"
            style={{ 
              color: "var(--sb-muted)",
              // Use a stronger frosted glass effect matching the main surface
              background: "var(--sb-surface)",
              boxShadow: "0 1px 0 0 var(--sb-border)"
            }}
          >
            <tr>
              {headers.map((h, i) => {
                const obj =
                  typeof h === "object" && h !== null && Object.prototype.hasOwnProperty.call(h, "label")
                    ? (h as { label: ReactNode; align?: unknown; className?: unknown })
                    : null;

                const label = obj ? obj.label : (h as ReactNode);

                const alignRaw = obj?.align;
                const align =
                  alignRaw === "left" || alignRaw === "right" || alignRaw === "center"
                    ? alignRaw
                    : undefined;

                const extra = typeof obj?.className === "string" ? obj.className : "";

                return (
                  <th
                    key={i}
                    className={[
                      "px-3 py-2 font-medium",
                      headerAlignClass(align),
                      extra,
                    ].filter(Boolean).join(" ")}
                  >
                    {label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="">
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EmptyState({ 
  colSpan, 
  message = "No data found",
  description,
  icon,
  action,
}: { 
  colSpan: number; 
  message?: string;
  /** Optional secondary description text */
  description?: string;
  icon?: ReactNode;
  /** Optional action button/link */
  action?: ReactNode;
}) {
  return (
    <TableRow>
      <TableCell className="py-12 text-center" colSpan={colSpan}>
        <div className="flex flex-col items-center justify-center gap-3">
          {icon || (
            <div className="rounded-full p-4" style={{ background: "var(--sb-row-hover)" }}>
              <Music className="h-6 w-6" style={{ color: "var(--sb-muted)" }} />
            </div>
          )}
          <div className="space-y-1">
            <div className="text-sm font-medium" style={{ color: "var(--sb-muted)" }}>
              {message}
            </div>
            {description && (
              <div className="text-xs" style={{ color: "var(--sb-muted)", opacity: 0.7 }}>
                {description}
              </div>
            )}
          </div>
          {action && <div className="mt-2">{action}</div>}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Standalone empty state component (not for tables).
 * Use this for full-page or section empty states.
 */
export function EmptyStateCard({
  title = "No data found",
  description,
  icon,
  action,
  className,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["sb-card p-8 text-center", className].filter(Boolean).join(" ")}>
      <div className="flex flex-col items-center justify-center gap-4">
        {icon || (
          <div className="rounded-full p-4" style={{ background: "var(--sb-row-hover)" }}>
            <Music className="h-8 w-8" style={{ color: "var(--sb-muted)" }} />
          </div>
        )}
        <div className="space-y-2">
          <h3 className="text-base font-semibold" style={{ color: "var(--sb-text)" }}>
            {title}
          </h3>
          {description && (
            <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--sb-muted)" }}>
              {description}
            </p>
          )}
        </div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export function TableRow({ children, className, style, ...props }: { children: ReactNode; className?: string; style?: React.CSSProperties } & ComponentProps<"tr">) {
  return (
    <tr
      className={[
        "group transition-colors",
        // Zebra striping and hover now use CSS variables for theme-aware contrast
        "odd:sb-row-odd hover:sb-row-hover",
        className,
      ].filter(Boolean).join(" ")}
      style={style}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TableCell({
  children,
  className,
  mono,
  numeric,
  align,
  empty,
  emptyFallback,
  ...props
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
  numeric?: boolean;
  align?: "left" | "right" | "center";
  empty?: boolean;
  emptyFallback?: ReactNode;
} & ComponentProps<"td">) {
  const isEmpty =
    empty ||
    children === null ||
    children === undefined ||
    (typeof children === "string" && children.trim() === "");

  const alignClass =
    align === "center"
      ? "text-center"
      : align === "right" || numeric
      ? "text-right"
      : "text-left";

  return (
    <td
      className={[
        "px-3 py-2 align-middle",
        mono ? "font-mono text-[11px]" : "",
        numeric ? "tabular-nums whitespace-nowrap" : "",
        alignClass,
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {isEmpty ? (
        <span className="opacity-40" style={{ color: "var(--sb-muted)" }}>
          {emptyFallback ?? "—"}
        </span>
      ) : (
        children
      )}
    </td>
  );
}
