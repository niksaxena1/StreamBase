import { ReactNode } from "react";

export function FilterBar(props: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "sb-ring sticky top-0 z-20 rounded-xl border border-lime-500/20 bg-lime-500/10 p-3 shadow-sm backdrop-blur-sm",
        "dark:bg-lime-400/10 dark:border-lime-400/20",
        props.className ?? "",
      ].filter(Boolean).join(" ")}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">{props.left}</div>
        <div className="flex flex-wrap items-center gap-2">{props.right}</div>
      </div>
    </div>
  );
}

