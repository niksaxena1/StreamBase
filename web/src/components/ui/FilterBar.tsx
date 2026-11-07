import { ReactNode } from "react";
import { Glass } from "glisse";

export function FilterBar(props: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** Use "accent" for lime-tinted, "neutral" for plain glass */
  variant?: "accent" | "neutral";
}) {
  const { variant = "accent" } = props;
  
  // Real Liquid Glass (glisse) so the content scrolling under the sticky bar bends;
  // the bar keeps its own lime/neutral colour from globals.css.
  return (
    <Glass
      className={[
        "sb-ring sb-glass-bar sticky top-0 z-20 rounded-xl p-3 shadow-sm",
        variant === "accent" 
          ? "sb-filter-bar" 
          : "sb-glass",
        props.className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        {props.left ? <div className="min-w-0">{props.left}</div> : null}
        {props.right ? (
          <div className="flex w-full flex-shrink-0 flex-wrap items-center justify-end gap-2 lg:w-auto">
            {props.right}
          </div>
        ) : null}
      </div>
    </Glass>
  );
}

