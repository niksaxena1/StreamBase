import { ReactNode } from "react";

export function SectionHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["flex items-end justify-between gap-3 px-1", props.className].filter(Boolean).join(" ")}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{props.title}</h2>
        {props.subtitle ? (
          <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
            {props.subtitle}
          </div>
        ) : null}
      </div>
      {props.actions ? <div className="flex flex-shrink-0 items-center gap-2">{props.actions}</div> : null}
    </div>
  );
}

