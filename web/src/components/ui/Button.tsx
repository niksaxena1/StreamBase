import {
  ButtonHTMLAttributes,
  cloneElement,
  forwardRef,
  isValidElement,
  ReactElement,
  ReactNode,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
  secondary:
    "bg-white/70 text-black/80 hover:bg-white dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/15",
  ghost: "bg-transparent text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10",
  danger:
    "bg-red-600 text-white hover:bg-red-600/90 dark:bg-red-500 dark:text-white dark:hover:bg-red-500/90",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    asChild?: boolean;
  }
>(function Button(
  { className, variant = "secondary", size = "sm", leftIcon, rightIcon, asChild, children, ...props },
  ref,
) {
  const composedClassName = cx(
    "sb-ring inline-flex items-center justify-center gap-2 rounded-full font-medium transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    SIZE[size],
    VARIANT[variant],
    className,
  );

  if (asChild) {
    if (!isValidElement(children)) return null;
    const el = children as ReactElement<any>;
    return cloneElement(el, {
      ...props,
      className: cx(el.props?.className, composedClassName),
      children: (
        <>
          {leftIcon ? <span className="opacity-80">{leftIcon}</span> : null}
          {el.props?.children}
          {rightIcon ? <span className="opacity-80">{rightIcon}</span> : null}
        </>
      ),
    });
  }

  return (
    <button
      ref={ref}
      {...props}
      className={composedClassName}
    >
      {leftIcon ? <span className="opacity-80">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span className="opacity-80">{rightIcon}</span> : null}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Exclude<ButtonVariant, "primary" | "danger"> | "primary";
    size?: "sm" | "md";
    "aria-label": string;
    asChild?: boolean;
  }
>(function IconButton({ className, variant = "ghost", size = "sm", asChild, children, ...props }, ref) {
  const dim = size === "md" ? "h-9 w-9" : "h-8 w-8";
  const v =
    variant === "primary"
      ? "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
      : variant === "secondary"
      ? VARIANT.secondary
      : VARIANT.ghost;

  const composedClassName = cx(
    "sb-ring inline-flex items-center justify-center rounded-full transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    dim,
    v,
    className,
  );

  if (asChild) {
    if (!isValidElement(children)) return null;
    const el = children as ReactElement<any>;

    // Avoid passing button-only props to non-button children.
    // (e.g. `type`/`disabled` don't belong on <a>).
    // Keep a small, safe set and let callers decide semantics.
    const { type: _type, disabled: _disabled, ...rest } = props;

    return cloneElement(el, {
      ...rest,
      className: cx(el.props?.className, composedClassName),
      children: el.props?.children,
    });
  }

  return (
    <button
      ref={ref}
      {...props}
      className={composedClassName}
    >
      {children}
    </button>
  );
});

