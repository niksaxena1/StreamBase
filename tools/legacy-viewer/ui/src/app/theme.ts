import { useEffect, useSyncExternalStore } from "react";
type Theme = "light" | "dark";
const media = window.matchMedia("(prefers-color-scheme: dark)");
let manual: Theme | null = null;
try {
  const stored = localStorage.getItem("sb:archive:theme");
  if (stored === "light" || stored === "dark") manual = stored;
} catch {
  /* Storage can be unavailable in private windows. */
}
const listeners = new Set<() => void>();
const snapshot = (): Theme => manual ?? (media.matches ? "dark" : "light");
function notify() {
  // Change foreground and background together; colour transitions can briefly fail contrast.
  document.documentElement.dataset.themeChanging = "true";
  document.documentElement.dataset.theme = snapshot();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      delete document.documentElement.dataset.themeChanging;
    }),
  );
  listeners.forEach((fn) => fn());
}
media.addEventListener("change", notify);
export function setTheme(theme: Theme | null) {
  manual = theme;
  try {
    if (theme) localStorage.setItem("sb:archive:theme", theme);
    else localStorage.removeItem("sb:archive:theme");
  } catch {
    /* In-memory toggle still works. */
  }
  notify();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    notify();
  }, []);
  return {
    theme,
    setTheme,
    toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
  };
}
