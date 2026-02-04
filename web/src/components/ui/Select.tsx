import { forwardRef, SelectHTMLAttributes } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return (
    <select
      ref={ref}
      {...props}
      className={cx(
        "sb-ring w-full rounded-xl border bg-white/70 px-3 py-2 text-sm outline-none transition",
        "dark:bg-white/5 dark:text-white dark:border-white/10 dark:focus:border-white/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
        className,
      )}
      style={{
        borderColor: "var(--sb-border)",
        colorScheme: "light dark",
        ...(props.style ?? {}),
      }}
    />
  );
});

