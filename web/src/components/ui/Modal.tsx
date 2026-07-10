"use client";

import { ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerCenter,
  headerActions,
  children,
  maxWidthClassName,
  showCloseButton = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  headerCenter?: ReactNode;
  /** Rendered to the left of the Close control (e.g. CSV export). */
  headerActions?: ReactNode;
  children: ReactNode;
  maxWidthClassName?: string;
  showCloseButton?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  // Keep a stable ref to onClose so the focus-trap effect doesn't re-run when
  // callers pass an inline function (which gets a new reference every render).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus trap and keyboard handling — depends only on `open`, not `onClose`,
  // to prevent the effect re-running (and re-focusing) on every re-render while
  // the modal is open (e.g. when the user types into a search input inside it).
  useEffect(() => {
    if (!open) return;

    // Save the element that had focus before the modal opened
    previousActiveElement.current = document.activeElement as HTMLElement;

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    function getFocusableElements(): HTMLElement[] {
      if (!dialogRef.current) return [];
      return Array.from(dialogRef.current.querySelectorAll(focusableSelector));
    }

    // Move focus into the modal on open
    setTimeout(() => {
      const focusables = getFocusableElements();
      if (focusables.length > 0) {
        focusables[0].focus();
      }
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;

      const focusables = getFocusableElements();
      if (focusables.length === 0) return;

      const currentIndex = focusables.indexOf(document.activeElement as HTMLElement);
      let nextIndex: number;

      if (e.shiftKey) {
        nextIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
      } else {
        nextIndex = currentIndex < 0 || currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1;
      }

      e.preventDefault();
      focusables[nextIndex].focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore focus and handle overflow
  useEffect(() => {
    if (!open) {
      // Restore focus to the element that opened the modal
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
      return;
    }

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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 animate-[modal-fade-in_180ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "Modal"}
      onMouseDown={() => onClose()}
      ref={dialogRef}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      <div
        className={[
          "relative w-full max-h-full flex flex-col overflow-hidden sb-glass shadow-2xl animate-[modal-scale-in_180ms_var(--sb-ease-out)]",
          maxWidthClassName ?? "max-w-5xl",
        ].join(" ")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || subtitle || headerCenter || headerActions) && (
          <div className="relative flex-none flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--sb-border)" }}>
            <div className="min-w-0 flex-1 pr-2">
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
            {headerCenter ? (
              <div className="absolute left-1/2 -translate-x-1/2">{headerCenter}</div>
            ) : null}
            {(headerActions || showCloseButton) && (
              <div className="flex flex-shrink-0 items-center gap-2">
                {headerActions}
                {showCloseButton ? (
                  <button
                    type="button"
                    className="sb-ring sb-control rounded-full bg-white/60 px-2.5 py-1.5 text-xs font-medium hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
                    style={{ color: "var(--sb-text)" }}
                    onClick={onClose}
                  >
                    Close
                  </button>
                ) : null}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
