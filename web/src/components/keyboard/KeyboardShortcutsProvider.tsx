"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

import { hasStreamBaseAccess, type AppAccess } from "@/lib/appAccess";
import { triggerRouteLoadingBarStart } from "@/lib/navigation/loadingBar";

type ShortcutHandler = () => void;

type KeyboardShortcutsContextValue = {
  /** Register a shortcut handler that can be unregistered later */
  registerShortcut: (key: string, handler: ShortcutHandler, description: string) => () => void;
  /** Check if shortcuts help modal is open */
  isHelpOpen: boolean;
  /** Open the shortcuts help modal */
  openHelp: () => void;
  /** Close the shortcuts help modal */
  closeHelp: () => void;
  /** All registered shortcuts for display */
  shortcuts: { key: string; description: string }[];
  /** Open search modal */
  openSearch: () => void;
  /** Register search opener (called by SearchBar) */
  setSearchOpener: (opener: (() => void) | null) => void;
};

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

export function useKeyboardShortcuts() {
  const ctx = useContext(KeyboardShortcutsContext);
  if (!ctx) {
    throw new Error("useKeyboardShortcuts must be used within KeyboardShortcutsProvider");
  }
  return ctx;
}

/** Safe version that returns null if not in provider (for optional usage) */
export function useKeyboardShortcutsSafe() {
  return useContext(KeyboardShortcutsContext);
}

// Navigation items matching SideRail
const NAV_ITEMS = [
  { key: "1", href: "/", label: "Home" },
  { key: "2", href: "/playlists", label: "Playlists" },
  { key: "3", href: "/catalog", label: "Catalog" },
  { key: "4", href: "/collectors", label: "Collectors" },
  { key: "5", href: "/health", label: "Health" },
];

export function KeyboardShortcutsProvider({
  children,
  appAccess,
}: {
  children: ReactNode;
  appAccess?: AppAccess;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  // IMPORTANT: Store the search opener in a ref so registering it does NOT
  // trigger provider re-renders (which can cause "maximum update depth exceeded"
  // if a child registers on each render/effect).
  const searchOpenerRef = useRef<(() => void) | null>(null);
  const [customShortcuts, setCustomShortcuts] = useState<Map<string, { handler: ShortcutHandler; description: string }>>(
    new Map()
  );
  const showStreamBaseShortcuts = appAccess ? hasStreamBaseAccess(appAccess) : false;

  const openHelp = useCallback(() => setIsHelpOpen(true), []);
  const closeHelp = useCallback(() => setIsHelpOpen(false), []);

  const openSearch = useCallback(() => {
    searchOpenerRef.current?.();
  }, []);

  const registerSearchOpener = useCallback((opener: (() => void) | null) => {
    searchOpenerRef.current = opener;
  }, []);

  const registerShortcut = useCallback(
    (key: string, handler: ShortcutHandler, description: string) => {
      setCustomShortcuts((prev) => {
        const next = new Map(prev);
        next.set(key, { handler, description });
        return next;
      });

      // Return unregister function
      return () => {
        setCustomShortcuts((prev) => {
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      };
    },
    []
  );

  // Build shortcuts list for display (memoized so context value stays stable)
  const shortcuts = useMemo(
    () => [
      ...(showStreamBaseShortcuts ? [{ key: "/", description: "Open search" }] : []),
      { key: "?", description: "Show keyboard shortcuts" },
      ...(showStreamBaseShortcuts
        ? [
            ...NAV_ITEMS.map((item) => ({ key: item.key, description: `Go to ${item.label}` })),
            { key: "g s", description: "Go to Settings" },
          ]
        : []),
      { key: "Esc", description: "Close modal / dialog" },
      ...Array.from(customShortcuts.entries()).map(([key, { description }]) => ({ key, description })),
    ],
    [customShortcuts, showStreamBaseShortcuts],
  );

  useEffect(() => {
    let gPressed = false;
    let gTimeout: ReturnType<typeof setTimeout> | null = null;

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // Allow Escape to work even in inputs (for closing modals)
      if (e.key === "Escape") {
        // Let the Modal component handle Escape - it already does
        // But we can close our help modal here
        if (isHelpOpen) {
          e.preventDefault();
          closeHelp();
          return;
        }
        return;
      }

      // Skip other shortcuts if in input
      if (isInput) return;

      // Don't interfere with Ctrl/Cmd shortcuts (like Ctrl+K for search)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // "/" to open search
      if (e.key === "/") {
        if (!showStreamBaseShortcuts) return;
        e.preventDefault();
        openSearch();
        return;
      }

      // "?" to show help
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        if (isHelpOpen) {
          closeHelp();
        } else {
          openHelp();
        }
        return;
      }

      // "g" prefix for go-to shortcuts
      if (e.key === "g" && !gPressed) {
        gPressed = true;
        gTimeout = setTimeout(() => {
          gPressed = false;
        }, 1000); // 1 second to press next key
        return;
      }

      // "g s" to go to settings
      if (gPressed && e.key === "s") {
        if (!showStreamBaseShortcuts) return;
        e.preventDefault();
        gPressed = false;
        if (gTimeout) clearTimeout(gTimeout);
        triggerRouteLoadingBarStart("/settings");
        router.push("/settings");
        return;
      }

      // Reset g prefix on any other key
      if (gPressed && e.key !== "g") {
        gPressed = false;
        if (gTimeout) clearTimeout(gTimeout);
      }

      // Number keys 1-5 for navigation
      if (showStreamBaseShortcuts) {
        const navItem = NAV_ITEMS.find((item) => item.key === e.key);
        if (navItem) {
          e.preventDefault();
          // Only navigate if not already on that page
          if (pathname !== navItem.href) {
            triggerRouteLoadingBarStart(navItem.href);
            router.push(navItem.href);
          }
          return;
        }
      }

      // Check custom shortcuts
      const custom = customShortcuts.get(e.key);
      if (custom) {
        e.preventDefault();
        custom.handler();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (gTimeout) clearTimeout(gTimeout);
    };
  }, [router, pathname, isHelpOpen, openHelp, closeHelp, openSearch, customShortcuts, showStreamBaseShortcuts]);

  const value: KeyboardShortcutsContextValue = useMemo(() => ({
    registerShortcut,
    isHelpOpen,
    openHelp,
    closeHelp,
    shortcuts,
    openSearch,
    setSearchOpener: registerSearchOpener,
  }), [registerShortcut, isHelpOpen, openHelp, closeHelp, shortcuts, openSearch, registerSearchOpener]);

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}
