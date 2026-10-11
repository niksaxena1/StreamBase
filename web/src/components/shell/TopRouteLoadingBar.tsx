"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SB_ROUTE_LOADING_BAR_DONE_EVENT, SB_ROUTE_LOADING_BAR_START_EVENT, triggerRouteLoadingBarDone, triggerRouteLoadingBarStart } from "@/lib/navigation/loadingBar";

function RouteCompletion() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const previous = useRef(`${pathname}?${search}`);
  useEffect(() => {
    const route = `${pathname}?${search}`;
    if (previous.current !== route && document.documentElement.dataset.sbDatasetTransition !== "true") triggerRouteLoadingBarDone();
    previous.current = route;
  }, [pathname, search]);
  return null;
}

export function TopRouteLoadingBar() {
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = false;
    let currentRoute = window.location.pathname + window.location.search;
    let progress = 0;
    let shownAt = 0;
    let creep: ReturnType<typeof setInterval> | undefined;
    let finish: ReturnType<typeof setTimeout> | undefined;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const clear = () => { clearInterval(creep); clearTimeout(finish); clearTimeout(hide); };
    const setProgress = (value: number) => {
      progress = value;
      if (fill.current) fill.current.style.transform = `scaleX(${value})`;
    };
    const start = () => {
      clear();
      if (!active) { shownAt = performance.now(); setProgress(0.2); }
      active = true;
      // Paint outside the suspended route's React transition, with no show delay.
      if (bar.current) bar.current.style.opacity = "1";
      if (!reducedMotion) creep = setInterval(() => setProgress(Math.min(0.9, progress + (1 - progress) * 0.08)), 180);
    };
    const done = () => {
      currentRoute = window.location.pathname + window.location.search;
      if (!active) return;
      active = false;
      clearInterval(creep);
      finish = setTimeout(() => {
        setProgress(1);
        hide = setTimeout(() => {
          if (bar.current) bar.current.style.opacity = "0";
          setProgress(0);
        }, reducedMotion ? 0 : 150);
      }, Math.max(0, 180 - (performance.now() - shownAt)));
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self") || anchor.dataset.sbNoTopLoader === "true") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const target = new URL(href, window.location.href);
      if (target.origin === window.location.origin && target.pathname + target.search !== window.location.pathname + window.location.search) triggerRouteLoadingBarStart(href);
    };
    const pop = () => {
      if (window.location.pathname + window.location.search !== currentRoute) triggerRouteLoadingBarStart();
    };
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop);
    window.addEventListener(SB_ROUTE_LOADING_BAR_START_EVENT, start);
    window.addEventListener(SB_ROUTE_LOADING_BAR_DONE_EVENT, done);
    return () => {
      clear();
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop);
      window.removeEventListener(SB_ROUTE_LOADING_BAR_START_EVENT, start);
      window.removeEventListener(SB_ROUTE_LOADING_BAR_DONE_EVENT, done);
    };
  }, []);

  return (
    <>
      <Suspense fallback={null}><RouteCompletion /></Suspense>
      <div ref={bar} aria-hidden="true" style={{ position: "fixed", top: "env(safe-area-inset-top, 0px)", left: 0, right: 0, height: 3, zIndex: 10050, pointerEvents: "none", opacity: 0 }}>
        <div ref={fill} style={{ height: "100%", transformOrigin: "0 0", transform: "scaleX(0)", background: "var(--sb-accent-stroke, #d4ff4d)", boxShadow: "0 0 10px var(--sb-accent-20)", transition: "transform 150ms ease-out" }} />
      </div>
    </>
  );
}
