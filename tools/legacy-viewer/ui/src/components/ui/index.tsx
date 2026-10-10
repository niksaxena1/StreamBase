import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { percent, signedDelta } from "../../lib/format";
import { Num } from "./Num";
export { Artwork, ArtworkPreviewProvider } from "./Artwork";
export { AnimatedNumber } from "./AnimatedNumber";
export { Num } from "./Num";

export type Variant = "neutral" | "accent" | "warning" | "error" | "info";
export function Button({
  variant = "secondary",
  loading,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`button button-${variant} ${className}`}
    >
      {loading ? "Working…" : children}
    </button>
  );
}
export function IconButton(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string },
) {
  return (
    <Button {...props} className={`icon-button ${props.className ?? ""}`} />
  );
}
export function Chip({
  variant = "neutral",
  children,
}: {
  variant?: Variant;
  children: ReactNode;
}) {
  return <span className={`chip chip-${variant}`}>{children}</span>;
}
export const Badge = Chip;
export function Card({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />;
}
export function Skeleton({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div aria-hidden="true" className={`skeleton ${className}`} {...props} />
  );
}
export function StatCard({
  label,
  value,
  sublabel,
  delta,
  sparkline,
  loading = false,
}: {
  label: string;
  value: number | string | null;
  sublabel?: ReactNode;
  delta?: number | null;
  sparkline?: (number | null)[];
  loading?: boolean;
}) {
  const values =
    sparkline?.filter((n): n is number => n !== null && Number.isFinite(n)) ??
    [];
  const min = Math.min(...values),
    span = Math.max(1, Math.max(...values) - min);
  let penDown = false;
  const path = sparkline
    ?.map((n, i) => {
      if (n === null || !Number.isFinite(n)) {
        penDown = false;
        return "";
      }
      const command = penDown ? "L" : "M";
      penDown = true;
      return `${command}${(i / Math.max(1, sparkline.length - 1)) * 100},${28 - ((n - min) / span) * 24}`;
    })
    .join(" ");
  return (
    <Card className="stat-card" aria-busy={loading}>
      <div className="muted">{label}</div>
      {loading ? (
        <Skeleton style={{ height: 36, width: "65%" }} />
      ) : (
        <div className="stat-value mono">
          {typeof value === "number" ? <Num value={value} /> : (value ?? "—")}
        </div>
      )}
      <div className="row spread">
        <div className="muted small">
          {sublabel}
          {delta != null && (
            <div
              className={`mono ${delta < 0 ? "negative" : delta > 0 ? "positive" : ""}`}
            >
              {signedDelta(delta)}
            </div>
          )}
        </div>
        {path && (
          <svg
            viewBox="0 0 100 32"
            width="100"
            height="32"
            role="img"
            aria-label={`${label} trend`}
          >
            <path
              d={path}
              fill="none"
              stroke="var(--sb-positive)"
              strokeWidth="2"
            />
          </svg>
        )}
      </div>
    </Card>
  );
}
export type Option<T extends string = string> = {
  value: T;
  label: string;
  title?: string;
};
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((option, i) => (
        <button
          type="button"
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          tabIndex={option.value === value ? 0 : -1}
          className={option.value === value ? "selected" : ""}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
              ? 1
              : ["ArrowLeft", "ArrowUp"].includes(event.key)
                ? -1
                : 0;
            if (direction || event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const index =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (i + direction + options.length) % options.length;
              onChange(options[index].value);
              (
                event.currentTarget.parentElement?.children[
                  index
                ] as HTMLElement
              )?.focus();
            }
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`select ${className}`} {...props} />;
}
export { Combobox } from "./Combobox";
export function EmptyState({
  title = "No data available",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        ▤
      </span>
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div role="alert" className="error-state">
      <strong>Couldn’t load this section</strong>
      <p>{message}</p>
      {retry && <Button onClick={retry}>Retry</Button>}
    </div>
  );
}
export function LoadingState({ message = "Loading…" }: { message?: string }) {
  return (
    <div role="status" className="loading-state">
      <Skeleton style={{ height: 18, width: 140 }} />
      {message}
    </div>
  );
}
export function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <details
      className="collapsible"
      open={open ?? (defaultOpen || undefined)}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>
        <span aria-hidden="true" className="chevron">
          ▸
        </span>{" "}
        {title}
        {description && <span className="muted small"> — {description}</span>}
      </summary>
      <div className="section-content">{children}</div>
    </details>
  );
}
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="row spread">
      <div>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar row">{children}</div>;
}
export function Tabs({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string; content: ReactNode }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="tabs" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            type="button"
            key={item.value}
            role="tab"
            id={`${id}-tab-${item.value}`}
            aria-selected={value === item.value}
            aria-controls={`${id}-panel-${item.value}`}
            tabIndex={value === item.value ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (direction || event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : (index + direction + items.length) % items.length;
                onChange(items[next].value);
                (
                  event.currentTarget.parentElement?.children[
                    next
                  ] as HTMLElement
                )?.focus();
              }
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.value}
          role="tabpanel"
          hidden={value !== item.value}
          id={`${id}-panel-${item.value}`}
          aria-labelledby={`${id}-tab-${item.value}`}
          tabIndex={0}
          className="tab-panel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  const id = useId(),
    [dismissed, setDismissed] = useState(false);
  return (
    <span
      className={`tooltip-anchor ${dismissed ? "dismissed" : ""}`}
      tabIndex={0}
      aria-describedby={id}
      onFocus={() => setDismissed(false)}
      onMouseEnter={() => setDismissed(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setDismissed(true);
      }}
    >
      {children}
      <span id={id} role="tooltip" className="ui-tooltip">
        {text}
      </span>
    </span>
  );
}
export function Modal({
  open,
  onClose,
  title,
  children,
  drawer = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId(),
    callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    const dialog = ref.current,
      prior = document.activeElement as HTMLElement | null;
    if (open) dialog?.showModal();
    else dialog?.close();
    return () => {
      if (dialog?.open) dialog.close();
      if (open) prior?.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={drawer ? "modal drawer" : "modal"}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        callback.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            callback.current();
        }
      }}
    >
      <header className="row spread">
        <h2 id={titleId}>{title}</h2>
        <IconButton aria-label="Close dialog" onClick={onClose}>
          ×
        </IconButton>
      </header>
      <div className="section-content">{children}</div>
    </dialog>
  );
}
export function Drawer(props: Omit<Parameters<typeof Modal>[0], "drawer">) {
  return <Modal {...props} drawer />;
}
export function ConfidenceMeter({
  value,
  label = "Confidence",
}: {
  value: number | null;
  label?: string;
}) {
  const valid = value !== null && Number.isFinite(value),
    clamped = valid ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <div className="confidence">
      <span>{label}</span>
      <meter aria-label={label} min={0} max={1} value={clamped} />{" "}
      <span className="mono">{valid ? percent(clamped) : "Unknown"}</span>
    </div>
  );
}
export function KeyValueList({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="key-values">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="muted">{item.label}</dt>
          <dd className="mono">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function CopyableText({
  text,
  label = "identifier",
}: {
  text: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <span className="row">
      <code>{text}</code>
      <IconButton
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setStatus("Copied");
          } catch {
            setStatus("Copy unavailable. Select the text to copy.");
          }
        }}
      >
        ⧉
      </IconButton>
      <span role="status" className="small">
        {status}
      </span>
    </span>
  );
}
