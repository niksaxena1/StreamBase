import { useEffect, useId, useRef } from "react";
import { SHORTCUT_HELP } from "../lib/shortcuts";

/** The small "?" button and its non-modal shortcuts list. Controlled so the `?` key can toggle it. */
export function ShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open, onOpenChange]);
  return (
    <div className="shortcuts-help" ref={root}>
      <button
        type="button"
        className="shortcuts-toggle"
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="Keyboard shortcuts (?)"
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange(false);
        }}
      >
        ?
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Keyboard shortcuts"
          className="shortcuts-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onOpenChange(false);
            }
          }}
        >
          <h2>Keyboard shortcuts</h2>
          <dl>
            {SHORTCUT_HELP.map((item) => (
              <div key={item.keys}>
                <dt>
                  {item.keys.split("  ").map((part) => (
                    <kbd key={part}>{part}</kbd>
                  ))}
                </dt>
                <dd>{item.text}</dd>
              </div>
            ))}
          </dl>
          <p className="muted small">Shortcuts pause while you type in a field.</p>
        </div>
      )}
    </div>
  );
}
