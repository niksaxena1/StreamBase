"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function ImagePreviewModal({
  open,
  src,
  onClose,
}: {
  open: boolean;
  src: string | null;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.documentElement.style.overflow = prev;
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!open || !src) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      {/* eslint-disable-next-line @next/next/no-img-element -- full-resolution source, no layout optimization */}
      <img
        src={src}
        alt=""
        className="relative z-10 max-h-[90vh] max-w-[90vw] h-auto w-auto object-contain"
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
