import { ReactNode } from "react";

export function StatCard(props: {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[28px] sb-card p-5">
      {props.accent ? (
        <div
          className="pointer-events-none absolute -right-12 -top-10 h-40 w-40 rounded-full opacity-70"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgba(199,243,60,.9), rgba(199,243,60,0) 70%)",
          }}
        />
      ) : null}
      <div className="text-xs font-medium" style={{ color: "var(--sb-muted)" }}>
        {props.title}
      </div>
      <div className="mt-2 text-[28px] font-semibold tracking-tight">
        {props.value}
      </div>
      {props.subtitle ? (
        <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
          {props.subtitle}
        </div>
      ) : null}
    </div>
  );
}

