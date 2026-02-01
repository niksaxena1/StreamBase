import { ButtonHTMLAttributes } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Chip(props: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  const selected = Boolean(props.selected);
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "sb-ring inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
        selected
          ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
          : "bg-white/70 text-black/70 hover:bg-white dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20",
        className,
      )}
    />
  );
}

export function ChipGroup(props: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "sb-ring inline-flex items-center gap-0.5 rounded-full bg-white/60 p-0.5 dark:bg-white/10",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

