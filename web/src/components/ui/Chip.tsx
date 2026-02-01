import { ButtonHTMLAttributes } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Chip(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; segmented?: boolean },
) {
  const selected = Boolean(props.selected);
  const segmented = Boolean(props.segmented);
  const { className, ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
        segmented
          ? selected
            ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
            : "bg-transparent text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
          : cx(
              "sb-ring",
              selected
                ? "bg-black text-white shadow-sm dark:bg-white dark:text-black"
                : "bg-white/70 text-black/70 hover:bg-white dark:bg-white/10 dark:text-white/70 dark:hover:bg-white/20",
            ),
        className,
      )}
    />
  );
}

export function ChipGroup(props: { className?: string; children: React.ReactNode; segmented?: boolean }) {
  return (
    <div
      className={cx(
        "sb-ring inline-flex items-center rounded-full bg-white/60 p-0.5 dark:bg-white/10",
        props.segmented ? "gap-0" : "gap-0.5",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

