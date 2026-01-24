import { ReactNode, ComponentProps } from "react";

interface GlassTableProps {
  headers: string[];
  children: ReactNode;
  className?: string;
}

export function GlassTable({ headers, children, className }: GlassTableProps) {
  return (
    <div className={["sb-card overflow-hidden rounded-[28px]", className].filter(Boolean).join(" ")}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead
            className="text-left text-xs uppercase tracking-wider"
            style={{ color: "var(--sb-muted)" }}
          >
            <tr className="border-b" style={{ borderColor: "var(--sb-border)" }}>
              {headers.map((h, i) => (
                <th key={i} className="px-6 py-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--sb-border)" }}>
            {children}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TableRow({ children, className, ...props }: { children: ReactNode; className?: string } & ComponentProps<"tr">) {
  return (
    <tr
      className={[
        "group transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]",
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
        "px-6 py-4",
        mono ? "font-mono text-xs" : "",
        className,
      ].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </td>
  );
}
