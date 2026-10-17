"use client";

import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button, IconButton } from "@/components/ui/Button";

/** Library toolbar dropdown, sharing dismissal/focus behavior between facets and attention. */
export function LibraryToolbarPopover({
  label, trigger, children, warning = false, compact = false, active = false,
}: {
  label: string;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  warning?: boolean;
  compact?: boolean;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!root.current || !button.current || !panel.current) return;
      const anchor = button.current.getBoundingClientRect();
      const width = panel.current.getBoundingClientRect().width;
      const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
      panel.current.style.left = `${compact ? left : left - root.current.getBoundingClientRect().left}px`;
      panel.current.style.right = "auto";
      if (compact) panel.current.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - panel.current.getBoundingClientRect().height - 8))}px`;
    }
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, compact]);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current && document.activeElement === document.body) button.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    panel.current?.querySelector<HTMLElement>("select, input, button")?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  function close() {
    setOpen(false);
  }

  const Trigger = compact ? IconButton : Button;
  const content = open ? (
    <div
      ref={panel}
      id={id}
      role="dialog"
      aria-label={label}
      className={`${compact ? "fixed z-[100]" : "absolute right-0 top-full z-30 mt-1"} max-h-[65dvh] w-[min(24rem,calc(100vw-3rem))] overflow-auto rounded-xl border p-3 text-xs font-normal normal-case tracking-normal shadow-xl`}
      style={{ background: "linear-gradient(var(--sb-surface), var(--sb-surface)), var(--sb-bg)", borderColor: "var(--sb-border)", color: "var(--sb-text)" }}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget) && !panel.current?.contains(event.relatedTarget)) setOpen(false);
      }}
      onClick={(event) => event.stopPropagation()}
    >
      {children(close)}
    </div>
  ) : null;

  return (
    <div ref={root} className="relative shrink-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget) && !panel.current?.contains(event.relatedTarget)) setOpen(false);
    }}>
      <Trigger
        ref={button}
        variant="ghost"
        className={compact ? `h-5 w-5 shrink-0 ${active || open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}` : "h-7 gap-1 px-2 text-[11px] whitespace-nowrap"}
        style={active ? { color: "var(--sb-accent)" } : warning ? { color: "var(--sb-warning)" } : undefined}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Trigger>
      {compact && content ? createPortal(content, document.body) : content}
    </div>
  );
}
