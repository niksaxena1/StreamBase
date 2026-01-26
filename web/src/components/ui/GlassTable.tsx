import { ReactNode, ComponentProps } from "react";
import { Music } from "lucide-react";

interface GlassTableProps {
  headers: (string | ReactNode)[];
  children: ReactNode;
  className?: string;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

export function GlassTable({ 
  headers, 
  children, 
  className
}: GlassTableProps) {
  return (
    <div className={["sb-card relative overflow-hidden", className].filter(Boolean).join(" ")}>
      <div className="max-h-[440px] overflow-auto">
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
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
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
  ...props
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
} & ComponentProps<"td">) {
  return (
    <td
      className={[
        "px-3 py-2 align-middle",
        mono ? "font-mono text-[11px]" : "",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </td>
  );
}
