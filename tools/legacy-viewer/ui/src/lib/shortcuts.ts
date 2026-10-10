/** Track-lookup keyboard shortcuts: pure matching so it can be unit-tested without a DOM. */
export type ShortcutAction =
  | "focus-artist"
  | "focus-track"
  | "from-back"
  | "from-forward"
  | "to-back"
  | "to-forward"
  | "copy"
  | "help";
export type ShortcutEvent = {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  defaultPrevented?: boolean;
  target: EventTarget | null;
};
const TYPING_ROLES = new Set([
  "combobox",
  "textbox",
  "searchbox",
  "spinbutton",
  "listbox",
]);
/** Inputs, text areas, selects, editable regions and ARIA text roles swallow plain keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  } | null;
  if (!element || typeof element.tagName !== "string") return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName.toUpperCase()))
    return true;
  if (element.isContentEditable) return true;
  const role = element.getAttribute?.("role");
  return !!role && TYPING_ROLES.has(role);
}
/**
 * Which lookup shortcut does this key press trigger? Never while typing, while a dialog/palette is
 * open (`blocked`), with Ctrl/Cmd/Alt held, or for auto-repeat of the focus keys.
 * Brackets use event.code so Shift+[ works on every keyboard layout.
 */
export function shortcutAction(
  event: ShortcutEvent,
  blocked = false,
): ShortcutAction | null {
  if (blocked || event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  if (event.code === "BracketLeft")
    return event.shiftKey ? "to-back" : "from-back";
  if (event.code === "BracketRight")
    return event.shiftKey ? "to-forward" : "from-forward";
  if (event.repeat) return null;
  if (event.key === "/") return "focus-artist";
  if (event.key === "?") return "help";
  if (!event.shiftKey && event.key.toLowerCase() === "t") return "focus-track";
  if (!event.shiftKey && event.key.toLowerCase() === "c") return "copy";
  return null;
}
export const SHORTCUT_HELP: { keys: string; text: string }[] = [
  { keys: "Ctrl K", text: "Quick jump to any track or artist" },
  { keys: "/", text: "Focus the artist picker" },
  { keys: "T", text: "Focus the track picker" },
  { keys: "[  ]", text: "Move From back / forward one day" },
  { keys: "Shift [  ]", text: "Move To back / forward one day" },
  { keys: "C", text: "Copy the result" },
  { keys: "?", text: "Show or hide this list" },
];
