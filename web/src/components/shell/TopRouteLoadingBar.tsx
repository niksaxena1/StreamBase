"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import {
  SB_ROUTE_LOADING_BAR_DONE_EVENT,
  SB_ROUTE_LOADING_BAR_START_EVENT,
} from "@/lib/navigation/loadingBar";

const SHOW_DELAY_MS = 120;
const MIN_VISIBLE_MS = 180;

const BAR_HEIGHT_PX = 2;
const Z_INDEX = 10050; // above sb-mobile-nav (9999)

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function findAnchor(el: EventTarget | null): HTMLAnchorElement | null {
  let node = el as Element | null;
  while (node) {
    if (node instanceof HTMLAnchorElement) return node;
    node = node.parentElement;
  }
  return null;
}

function shouldStartForAnchorClick(a: HTMLAnchorElement, e: MouseEvent) {
  if (e.defaultPrevented) return false;
  if (e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (a.target && a.target !== "_self") return false;
  if (a.hasAttribute("download")) return false;
  if (a.dataset.sbNoTopLoader === "true") return false;

  const href = a.getAttribute("href");
  if (!href) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
    return false;
  }

  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    // Only show for route changes (pathname differs).
    if (url.pathname === window.location.pathname) return false;
  } catch {
    // If URL parsing fails, be conservative and do nothing.
    return false;
  }

  return true;
}

export function TopRouteLoadingBar() {
  const pathname = usePathname();

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  const progressRef = useRef(0);
  const visibleRef = useRef(false);
  const activeRef = useRef(false);
  const shownAtRef = useRef<number | null>(null);
  const lastPathnameRef = useRef<string | null>(null);

  const showDelayTimerRef = useRef<number | null>(null);
  const creepTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  }, []);

  function setProgressSafe(next: number) {
    const clamped = Math.max(0, Math.min(1, next));
    progressRef.current = clamped;
    setProgress(clamped);
  }

  function clearTimers() {
    if (showDelayTimerRef.current) window.clearTimeout(showDelayTimerRef.current);
    if (creepTimerRef.current) window.clearInterval(creepTimerRef.current);
    if (finishTimerRef.current) window.clearTimeout(finishTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    showDelayTimerRef.current = null;
    creepTimerRef.current = null;
    finishTimerRef.current = null;
    rafRef.current = null;
  }

  function animateTo(target: number, durationMs: number) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const from = progressRef.current;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = easeOutCubic(t);
      setProgressSafe(from + (target - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }

  function start() {
    activeRef.current = true;

    // If we're already visible, just bump progress a bit and keep going.
    if (visibleRef.current) {
      const bumped = Math.min(0.6, Math.max(progressRef.current, 0.18));
      setProgressSafe(bumped);
      return;
    }

    // Reset any previous finish state.
    if (finishTimerRef.current) {
      window.clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }

    // Prepare progress (even if we never show due to quick nav).
    setProgressSafe(Math.max(progressRef.current, 0.12));

    if (showDelayTimerRef.current) window.clearTimeout(showDelayTimerRef.current);
    showDelayTimerRef.current = window.setTimeout(() => {
      showDelayTimerRef.current = null;
      if (!activeRef.current) return;

      visibleRef.current = true;
      shownAtRef.current = performance.now();
      setVisible(true);

      if (prefersReducedMotion) {
        // Keep it simple: jump close to done and let `done()` finish.
        setProgressSafe(0.7);
        return;
      }

      // Quick run-up, then slow creep.
      animateTo(0.6, 420);
      creepTimerRef.current = window.setInterval(() => {
        const p = progressRef.current;
        if (!activeRef.current || !visibleRef.current) return;
        if (p >= 0.9) return;
        const delta = 0.006 + Math.random() * 0.018; // perceived progress
        setProgressSafe(Math.min(0.9, p + delta));
      }, 240);
    }, SHOW_DELAY_MS);
  }

  function done() {
    activeRef.current = false;

    // If we never became visible (fast nav), cancel entirely: no flicker.
    if (!visibleRef.current) {
      if (showDelayTimerRef.current) {
        window.clearTimeout(showDelayTimerRef.current);
        showDelayTimerRef.current = null;
      }
      setProgressSafe(0);
      return;
    }

    const shownAt = shownAtRef.current ?? performance.now();
    const elapsedVisible = performance.now() - shownAt;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsedVisible);

    if (finishTimerRef.current) window.clearTimeout(finishTimerRef.current);
    finishTimerRef.current = window.setTimeout(() => {
      finishTimerRef.current = null;
      if (creepTimerRef.current) {
        window.clearInterval(creepTimerRef.current);
        creepTimerRef.current = null;
      }

      if (prefersReducedMotion) {
        setProgressSafe(1);
      } else {
        animateTo(1, 220);
      }

      // Hide shortly after completion.
      window.setTimeout(() => {
        visibleRef.current = false;
        shownAtRef.current = null;
        setVisible(false);
        setProgressSafe(0);
      }, prefersReducedMotion ? 80 : 180);
    }, wait);
  }

  // Mark current route and finish any active bar when the pathname changes.
  useEffect(() => {
    const prev = lastPathnameRef.current;
    lastPathnameRef.current = pathname;
    if (prev === null) return; // initial mount
    if (prev !== pathname) done();
  }, [pathname]);

  // Start on internal <a> clicks that change pathname (including <Link> output).
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      const a = findAnchor(e.target);
      if (!a) return;
      if (!shouldStartForAnchorClick(a, e)) return;
      start();
    };

    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  // Start on browser back/forward when pathname changes.
  useEffect(() => {
    const onPopState = () => {
      const last = lastPathnameRef.current;
      const next = window.location.pathname;
      if (last && last !== next) start();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Start on explicit programmatic navigation triggers (router.push wrappers, etc.).
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener(SB_ROUTE_LOADING_BAR_START_EVENT, onStart as EventListener);
    return () =>
      window.removeEventListener(SB_ROUTE_LOADING_BAR_START_EVENT, onStart as EventListener);
  }, []);

  // Complete on explicit programmatic completion triggers (e.g. after router.refresh()).
  useEffect(() => {
    const onDone = () => done();
    window.addEventListener(SB_ROUTE_LOADING_BAR_DONE_EVENT, onDone as EventListener);
    return () =>
      window.removeEventListener(SB_ROUTE_LOADING_BAR_DONE_EVENT, onDone as EventListener);
  }, []);

  // Cleanup on unmount.
  useEffect(() => clearTimers, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: "env(safe-area-inset-top, 0px)",
        left: 0,
        right: 0,
        height: BAR_HEIGHT_PX,
        zIndex: Z_INDEX,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 120ms ease-out",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          transformOrigin: "0 0",
          transform: `scaleX(${progress})`,
          background: "var(--sb-accent-stroke)",
          boxShadow: "0 0 10px var(--sb-accent-20)",
          willChange: "transform",
        }}
      />
    </div>
  );
}

