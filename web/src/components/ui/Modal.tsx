"use client";

import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClassName,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "Modal"}
      onMouseDown={() => onClose()}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className={[
          "relative w-full overflow-hidden sb-glass shadow-2xl",
          maxWidthClassName ?? "max-w-5xl",
        ].join(" ")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--sb-border)" }}>
            <div>
              {title ? (
                <div className="font-display text-base font-semibold tracking-tight" style={{ color: "var(--sb-text)" }}>
                  {title}
                </div>
              ) : null}
              {subtitle ? (
                <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                  {subtitle}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="sb-ring rounded-full bg-white/60 px-2.5 py-1.5 text-xs font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
              style={{ color: "var(--sb-text)" }}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}

        <div className="px-4 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

