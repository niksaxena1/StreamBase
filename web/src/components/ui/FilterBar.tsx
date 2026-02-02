import { ReactNode } from "react";

export function FilterBar(props: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** Use "accent" for lime-tinted, "neutral" for plain glass */
  variant?: "accent" | "neutral";
}) {
  const { variant = "accent" } = props;
  
  return (
    <div
      className={[
        "sb-ring sticky top-0 z-20 rounded-xl p-3 shadow-sm",
        variant === "accent" 
          ? "sb-filter-bar" 
          : "sb-glass",
        props.className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {props.left ? <div className="min-w-0">{props.left}</div> : null}
        {props.right ? <div className="flex flex-wrap items-center gap-2">{props.right}</div> : null}
      </div>
    </div>
  );
}

