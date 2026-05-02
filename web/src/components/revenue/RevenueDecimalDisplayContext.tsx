"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "sb:revenue:mute-decimals";
const UPDATED_EVENT = "sb:revenue-decimal-display-updated";
const WRAP_CLASS = "sb-revenue-decimal-part";
const WRAPPED_ATTR = "data-sb-revenue-decimal";
const SOURCE_ATTR = "data-sb-revenue-decimal-source";

export type RevenueDecimalDisplayMode = "normal" | "muted" | "hidden";

type RevenueDecimalDisplayState = {
  revenueDecimalDisplayMode: RevenueDecimalDisplayMode;
  muteRevenueDecimals: boolean;
  hideRevenueDecimals: boolean;
  setRevenueDecimalDisplayMode: (next: RevenueDecimalDisplayMode) => void;
  setMuteRevenueDecimals: (next: boolean) => void;
};

const RevenueDecimalDisplayContext = createContext<RevenueDecimalDisplayState | null>(null);

function parseStoredSetting(raw: string | null): RevenueDecimalDisplayMode {
  if (raw === "hidden") return "hidden";
  if (raw === "muted" || raw === "1") return "muted";
  return "normal";
}

function readStoredSetting(): RevenueDecimalDisplayMode {
  if (typeof window === "undefined") return "normal";
  try {
    return parseStoredSetting(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "normal";
  }
}

function writeStoredSetting(next: RevenueDecimalDisplayMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // ignore storage failures
  }
}

function subscribeToStoredSetting(onStoreChange: () => void) {
  window.addEventListener(UPDATED_EVENT, onStoreChange);
  return () => window.removeEventListener(UPDATED_EVENT, onStoreChange);
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest(`[${WRAPPED_ATTR}]`)) return true;
  if (parent.closest("script, style, textarea, input, [contenteditable='true']")) return true;
  return false;
}

function wrapHtmlTextNode(node: Text) {
  if (shouldSkipTextNode(node)) return;
  const text = node.nodeValue ?? "";
  if (!/[.$]|AED\s/i.test(text)) return;

  const re = /(\$[\d,]+|AED\s+[\d,]+)(\.\d{2})([KMB])?/g;
  if (!re.test(text)) return;
  re.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const [full, prefix, decimals, suffix = ""] = match;
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    fragment.appendChild(document.createTextNode(prefix));
    const span = document.createElement("span");
    span.className = WRAP_CLASS;
    span.setAttribute(WRAPPED_ATTR, "html");
    span.textContent = decimals;
    fragment.appendChild(span);
    if (suffix) fragment.appendChild(document.createTextNode(suffix));
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  node.parentNode?.replaceChild(fragment, node);
}

function wrapSvgTextElement(el: SVGTextElement) {
  if (el.hasAttribute(SOURCE_ATTR)) return;
  const text = el.textContent ?? "";
  if (!/[.$]|AED\s/i.test(text)) return;

  const re = /(\$[\d,]+|AED\s+[\d,]+)(\.\d{2})([KMB])?/g;
  if (!re.test(text)) return;
  re.lastIndex = 0;

  el.setAttribute(SOURCE_ATTR, text);
  el.textContent = "";

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const [full, prefix, decimals, suffix = ""] = match;
    if (match.index > lastIndex) {
      const plain = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      plain.textContent = text.slice(lastIndex, match.index);
      el.appendChild(plain);
    }

    const prefixEl = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    prefixEl.textContent = prefix;
    el.appendChild(prefixEl);

    const decimalEl = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    decimalEl.setAttribute("class", WRAP_CLASS);
    decimalEl.setAttribute(WRAPPED_ATTR, "svg");
    decimalEl.textContent = decimals;
    el.appendChild(decimalEl);

    if (suffix) {
      const suffixEl = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      suffixEl.textContent = suffix;
      el.appendChild(suffixEl);
    }
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    const tail = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    tail.textContent = text.slice(lastIndex);
    el.appendChild(tail);
  }
}

function applyMutedRevenueDecimals(root: ParentNode = document.body) {
  root.querySelectorAll?.("svg text").forEach((el) => {
    if (el instanceof SVGTextElement) wrapSvgTextElement(el);
  });

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkipTextNode(node as Text)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  nodes.forEach(wrapHtmlTextNode);
}

function removeMutedRevenueDecimals() {
  document.querySelectorAll<HTMLElement>(`span[${WRAPPED_ATTR}="html"]`).forEach((span) => {
    span.replaceWith(document.createTextNode(span.textContent ?? ""));
  });

  document.querySelectorAll<SVGTextElement>(`svg text[${SOURCE_ATTR}]`).forEach((el) => {
    el.textContent = el.getAttribute(SOURCE_ATTR) ?? el.textContent ?? "";
    el.removeAttribute(SOURCE_ATTR);
  });
}

export function RevenueDecimalDisplayProvider({ children }: { children: ReactNode }) {
  const revenueDecimalDisplayMode = useSyncExternalStore(
    subscribeToStoredSetting,
    readStoredSetting,
    () => "normal" as const,
  );
  const muteRevenueDecimals = revenueDecimalDisplayMode === "muted";
  const hideRevenueDecimals = revenueDecimalDisplayMode === "hidden";

  useEffect(() => {
    document.documentElement.dataset.revenueDecimalDisplay = revenueDecimalDisplayMode;
    document.documentElement.dataset.revenueDecimalsMuted = muteRevenueDecimals ? "true" : "false";

    removeMutedRevenueDecimals();

    if (revenueDecimalDisplayMode === "normal") {
      removeMutedRevenueDecimals();
      return;
    }

    applyMutedRevenueDecimals();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              wrapHtmlTextNode(node as Text);
            } else if (node instanceof Element) {
              applyMutedRevenueDecimals(node);
            }
          });
        } else if (mutation.type === "characterData") {
          wrapHtmlTextNode(mutation.target as Text);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [revenueDecimalDisplayMode, muteRevenueDecimals]);

  const setRevenueDecimalDisplayMode = useCallback((next: RevenueDecimalDisplayMode) => {
    writeStoredSetting(next);
    window.dispatchEvent(new Event(UPDATED_EVENT));
  }, []);

  const setMuteRevenueDecimals = useCallback((next: boolean) => {
    setRevenueDecimalDisplayMode(next ? "muted" : "normal");
  }, [setRevenueDecimalDisplayMode]);

  const value = useMemo<RevenueDecimalDisplayState>(
    () => ({
      revenueDecimalDisplayMode,
      muteRevenueDecimals,
      hideRevenueDecimals,
      setRevenueDecimalDisplayMode,
      setMuteRevenueDecimals,
    }),
    [
      revenueDecimalDisplayMode,
      muteRevenueDecimals,
      hideRevenueDecimals,
      setRevenueDecimalDisplayMode,
      setMuteRevenueDecimals,
    ],
  );

  return (
    <RevenueDecimalDisplayContext.Provider value={value}>
      {children}
    </RevenueDecimalDisplayContext.Provider>
  );
}

export function useRevenueDecimalDisplay() {
  const ctx = useContext(RevenueDecimalDisplayContext);
  if (!ctx) throw new Error("useRevenueDecimalDisplay must be used within RevenueDecimalDisplayProvider");
  return ctx;
}
