import { forwardRef, InputHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      {...props}
      className={cx(
        "sb-ring w-full rounded-xl bg-white/70 px-3 py-2 text-sm outline-none",
        "placeholder:text-black/40 dark:bg-white/5 dark:placeholder:text-white/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
        className,
      )}
    />
  );
});

