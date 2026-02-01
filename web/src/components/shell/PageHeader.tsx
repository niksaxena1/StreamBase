import { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  actionsClassName?: string;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  actionsClassName,
  className,
}: PageHeaderProps) {
  const rootClassName = ["flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className]
    .filter((x): x is string => Boolean(x))
    .join(" ");
  const actionsWrapperClassName = ["flex items-center gap-2 flex-shrink-0", actionsClassName]
    .filter((x): x is string => Boolean(x))
    .join(" ");

  return (
    <div className={rootClassName}>
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
        <div className={actionsWrapperClassName}>
          {actions}
        </div>
      )}
    </div>
  );
}
