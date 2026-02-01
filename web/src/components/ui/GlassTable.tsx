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
}: GlassTableProps) {
  return (
    <div className={["sb-card relative overflow-hidden", className].filter(Boolean).join(" ")}>
      <div
        className={[
          maxBodyHeightClassName ?? "max-h-[440px]",
          "overflow-auto",
          bodyClassName ?? "",
        ].filter(Boolean).join(" ")}
      >
        <table className="min-w-full text-xs">
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
  icon
}: { 
  colSpan: number; 
  message?: string;
  icon?: ReactNode;
}) {
  return (
    <TableRow>
      <TableCell className="py-12 text-center" colSpan={colSpan}>
        <div className="flex flex-col items-center justify-center gap-3">
          {icon || (
            <div className="rounded-full bg-black/5 p-4 dark:bg-white/5">
              <Music className="h-6 w-6" style={{ color: "var(--sb-muted)" }} />
            </div>
          )}
          <div className="text-sm font-medium" style={{ color: "var(--sb-muted)" }}>
            {message}
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function TableRow({ children, className, ...props }: { children: ReactNode; className?: string } & ComponentProps<"tr">) {
  return (
    <tr
      className={[
        "group transition-colors",
        "odd:bg-black/[0.02] dark:odd:bg-white/[0.02]", // Zebra striping
        "hover:bg-black/[0.04] dark:hover:bg-white/[0.04]", // Slightly darker hover to be visible on zebra rows
        className,
      ].filter(Boolean).join(" ")}
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
