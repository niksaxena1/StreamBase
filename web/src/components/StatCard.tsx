import { ReactNode } from "react";

export function StatCard(props: {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium text-zinc-500">{props.title}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">
        {props.value}
      </div>
      {props.subtitle ? (
        <div className="mt-1 text-xs text-zinc-500">{props.subtitle}</div>
      ) : null}
    </div>
  );
}

