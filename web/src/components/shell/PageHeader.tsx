import { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={["flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className].filter(Boolean).join(" ")}>
      <div className="flex items-center gap-4 min-w-0">
        {icon && (
          <div className="flex-shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight truncate" style={{ color: "var(--sb-text)" }}>
            {title}
          </h1>
          {subtitle && (
            <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>
      
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}
