import {
  ButtonHTMLAttributes,
  cloneElement,
  forwardRef,
  isValidElement,
  ReactElement,
  ReactNode,
} from "react";
import { cx } from "@/lib/cx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type ButtonSize = "xs" | "sm" | "md" | "lg";

// Liquid Glass (glisse, see app/glass.css): primary/accent are the filled accent button,
// secondary is clear glass, danger is a filled destructive button. Ghost stays flat.
// Colours for the glass variants come from glisse, so they carry no Tailwind colour classes.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "lg-glass lg-button",
  secondary: "lg-glass lg-button",
  ghost: "bg-transparent text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10",
  danger: "lg-glass lg-button",
  accent: "lg-glass lg-button",
};

/** The glisse data attributes that pick a glass button's look. */
function glassAttrs(variant: ButtonVariant) {
  if (variant === "primary" || variant === "accent") return { "data-variant": "filled" };
  if (variant === "danger") return { "data-variant": "filled", "data-destructive": "" };
  return {};
}

const SIZE: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11px]",
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    asChild?: boolean;
    loading?: boolean;
  }
>(function Button(
  { className, variant = "secondary", size = "sm", leftIcon, rightIcon, asChild, loading = false, children, ...props },
  ref,
) {
  const composedClassName = cx(
    "sb-ring sb-control inline-flex items-center justify-center gap-2 rounded-full font-medium transition",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sb-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--sb-bg)]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    SIZE[size],
    VARIANT[variant],
    className,
  );

  const spinner = (
    <svg
      className="h-4 w-4 animate-spin"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        fill="currentColor"
      />
    </svg>
  );

  if (asChild) {
    if (!isValidElement(children)) return null;
    const el = children as ReactElement<any>;
    return cloneElement(el, {
      ...props,
      ...glassAttrs(variant),
      disabled: loading || props.disabled,
      "aria-busy": loading ? "true" : undefined,
      className: cx(el.props?.className, composedClassName),
      children: (
        <>
          {loading ? spinner : leftIcon ? <span className="opacity-80">{leftIcon}</span> : null}
          <span className={loading ? "opacity-50" : ""}>{el.props?.children}</span>
          {rightIcon ? <span className="opacity-80">{rightIcon}</span> : null}
        </>
      ),
    });
  }

  return (
    <button
      ref={ref}
      {...props}
      {...glassAttrs(variant)}
      disabled={loading || props.disabled}
      aria-busy={loading ? "true" : undefined}
      className={composedClassName}
    >
      {loading ? spinner : leftIcon ? <span className="opacity-80">{leftIcon}</span> : null}
      <span className={loading ? "opacity-50" : ""}>{children}</span>
      {rightIcon ? <span className="opacity-80">{rightIcon}</span> : null}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Exclude<ButtonVariant, "danger"> | "primary" | "accent";
    size?: "xs" | "sm" | "md" | "lg";
    "aria-label": string;
    asChild?: boolean;
  }
>(function IconButton({ className, variant = "ghost", size = "sm", asChild, children, ...props }, ref) {
  const dim = size === "lg" ? "h-11 w-11" : size === "md" ? "h-9 w-9" : size === "xs" ? "h-6 w-6" : "h-8 w-8";
  const v = VARIANT[variant];
  const glass = glassAttrs(variant);

  const composedClassName = cx(
    "sb-ring sb-control inline-flex items-center justify-center rounded-full transition",
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
      ...glass,
      className: cx(el.props?.className, composedClassName),
      children: el.props?.children,
    });
  }

  return (
    <button
      ref={ref}
      {...props}
      {...glass}
      className={composedClassName}
    >
      {children}
    </button>
  );
});
