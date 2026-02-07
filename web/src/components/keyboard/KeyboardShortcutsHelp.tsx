"use client";

import { useKeyboardShortcutsSafe } from "./KeyboardShortcutsProvider";
import { Modal } from "@/components/ui/Modal";
import { Keyboard } from "lucide-react";

function KeyboardKey({ children }: { children: string }) {
  return (
    <kbd
      className="inline-flex min-w-[24px] items-center justify-center rounded-md border px-2 py-1 text-xs font-medium"
      style={{
        background: "var(--sb-surface)",
        borderColor: "var(--sb-border)",
        color: "var(--sb-text)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
      }}
    >
      {children}
    </kbd>
  );
}

function ShortcutRow({ shortcut, description }: { shortcut: string; description: string }) {
  // Handle multi-key shortcuts like "g s"
  const keys = shortcut.split(" ");

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm" style={{ color: "var(--sb-text)" }}>
        {description}
      </span>
      <div className="flex items-center gap-1">
        {keys.map((key, idx) => (
          <span key={idx} className="flex items-center gap-1">
            <KeyboardKey>{key}</KeyboardKey>
            {idx < keys.length - 1 && (
              <span className="text-xs" style={{ color: "var(--sb-muted)" }}>
                then
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

export function KeyboardShortcutsHelp() {
  const ctx = useKeyboardShortcutsSafe();

  if (!ctx) return null;

  const { isHelpOpen, closeHelp, shortcuts } = ctx;

  // Group shortcuts by category
  const navigationShortcuts = shortcuts.filter(
    (s) => s.key.match(/^[1-5]$/) || s.key.startsWith("g ")
  );
  const actionShortcuts = shortcuts.filter(
    (s) => !s.key.match(/^[1-5]$/) && !s.key.startsWith("g ")
  );

  return (
    <Modal
      open={isHelpOpen}
      onClose={closeHelp}
      title={
        <span className="flex items-center gap-2">
          <Keyboard className="h-4 w-4" />
          Keyboard Shortcuts
        </span>
      }
      subtitle="Press ? anytime to show this help"
      maxWidthClassName="max-w-md"
    >
      <div className="space-y-4">
        {/* Actions */}
        <div>
          <h3
            className="mb-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--sb-muted)" }}
          >
            Actions
          </h3>
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--sb-border)" }}
          >
            {actionShortcuts.map((s, idx) => (
              <div 
                key={s.key} 
                className="px-3"
                style={idx > 0 ? { borderTop: "1px solid var(--sb-border)" } : undefined}
              >
                <ShortcutRow shortcut={s.key} description={s.description} />
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div>
          <h3
            className="mb-2 text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--sb-muted)" }}
          >
            Navigation
          </h3>
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--sb-border)" }}
          >
            {navigationShortcuts.map((s, idx) => (
              <div 
                key={s.key} 
                className="px-3"
                style={idx > 0 ? { borderTop: "1px solid var(--sb-border)" } : undefined}
              >
                <ShortcutRow shortcut={s.key} description={s.description} />
              </div>
            ))}
          </div>
        </div>

        {/* Tip */}
        <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
          Tip: You can also use <KeyboardKey>Ctrl</KeyboardKey> <KeyboardKey>K</KeyboardKey> or{" "}
          <KeyboardKey>⌘</KeyboardKey> <KeyboardKey>K</KeyboardKey> to open search.
        </p>
      </div>
    </Modal>
  );
}
