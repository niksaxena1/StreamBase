"use client";

const imageCache = new Map<string, HTMLImageElement | "loading" | "error">();

export function getImage(url: string): HTMLImageElement | null {
  const cached = imageCache.get(url);
  if (cached === "loading" || cached === "error") return null;
  if (cached) return cached;

  imageCache.set(url, "loading");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  img.onload = () => imageCache.set(url, img);
  img.onerror = () => imageCache.set(url, "error");
  return null;
}
