"use client";

import { useEffect } from "react";

/** Adds a scroll-state attribute without causing React renders on scroll. */
export function ShellScrollState() {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".sb-app-shell");
    if (!shell) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      shell.dataset.scrolled = window.scrollY > 12 ? "true" : "false";
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
