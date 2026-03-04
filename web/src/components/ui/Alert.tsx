import { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

type AlertVariant = "info" | "success" | "warning" | "error";

const VARIANT_STYLES: Record<
  AlertVariant,
  { wrap: string; icon: ReactNode; iconColor: string; titleColor: string; bodyColor: string }
> = {
  info: {
    wrap: "border-blue-300/60 bg-blue-50/70 dark:border-blue-900/30 dark:bg-blue-900/10",
    icon: <Info className="h-4 w-4" />,
    iconColor: "text-blue-800 dark:text-blue-200",
    titleColor: "text-blue-950 dark:text-blue-100",
    bodyColor: "text-blue-950/80 dark:text-blue-200/80",
  },
  success: {
    wrap: "border-lime-300/60 bg-lime-50/70 dark:border-lime-900/30 dark:bg-lime-900/10",
    icon: <CheckCircle2 className="h-4 w-4" />,
    iconColor: "text-lime-800 dark:text-lime-200",
    titleColor: "text-lime-950 dark:text-lime-100",
    bodyColor: "text-lime-950/80 dark:text-lime-200/80",
  },
  warning: {
    wrap: "border-amber-300/60 bg-amber-50/70 dark:border-amber-900/30 dark:bg-amber-900/10",
    icon: <AlertTriangle className="h-4 w-4" />,
    iconColor: "text-amber-800 dark:text-amber-200",
    titleColor: "text-amber-950 dark:text-amber-100",
    bodyColor: "text-amber-950/80 dark:text-amber-200/80",
  },
  error: {
    wrap: "border-red-300/60 bg-red-50/70 dark:border-red-900/30 dark:bg-red-900/10",
    icon: <XCircle className="h-4 w-4" />,
    iconColor: "text-red-800 dark:text-red-200",
    titleColor: "text-red-950 dark:text-red-100",
    bodyColor: "text-red-950/80 dark:text-red-200/80",
  },
};

export function Alert(props: {
  variant?: AlertVariant;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const v = props.variant ?? "info";
  const s = VARIANT_STYLES[v];

  return (
    <div
      className={["sb-ring rounded-2xl border p-3", s.wrap, props.className].filter(Boolean).join(" ")}
      role={v === "error" || v === "warning" ? "alert" : undefined}
      aria-live={v === "info" || v === "success" ? "polite" : undefined}
    >
      <div className="flex items-start gap-2">
        <div className={["mt-0.5 flex-shrink-0", s.iconColor].join(" ")} aria-hidden="true">
          {s.icon}
        </div>
        <div className="min-w-0 flex-1">
          {props.title ? (
            <div className={["text-sm font-semibold", s.titleColor].join(" ")}>{props.title}</div>
          ) : null}
          {props.children ? (
            <div className={["mt-1 text-xs", s.bodyColor].join(" ")}>{props.children}</div>
          ) : null}
        </div>
        {props.actions ? <div className="flex-shrink-0">{props.actions}</div> : null}
      </div>
    </div>
  );
}

