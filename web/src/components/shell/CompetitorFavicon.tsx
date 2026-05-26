"use client";

import { useEffect } from "react";

export function CompetitorFavicon({ accentHex }: { accentHex: string | null }) {
  useEffect(() => {
    if (!accentHex || typeof document === "undefined") return;

    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = `#${accentHex.replace(/^#/, "")}`;
    ctx.beginPath();
    ctx.arc(16, 16, 14, 0, Math.PI * 2);
    ctx.fill();

    const dataUrl = canvas.toDataURL("image/png");
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel='icon']"));
    const originals = links.map((el) => ({ el, href: el.href }));

    for (const link of links) {
      link.href = dataUrl;
    }

    return () => {
      for (const { el, href } of originals) {
        el.href = href;
      }
    };
  }, [accentHex]);

  return null;
}
