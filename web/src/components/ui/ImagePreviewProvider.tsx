"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ImagePreviewModal } from "@/components/ui/ImagePreviewModal";

type ImagePreviewContextValue = {
  openPreview: (src: string) => void;
  closePreview: () => void;
};

const ImagePreviewContext = createContext<ImagePreviewContextValue | null>(null);

export function ImagePreviewProvider({ children }: { children: ReactNode }) {
  const [src, setSrc] = useState<string | null>(null);

  const openPreview = useCallback((next: string) => {
    if (!next.trim()) return;
    setSrc(next);
  }, []);

  const closePreview = useCallback(() => setSrc(null), []);

  const value = useMemo(
    () => ({ openPreview, closePreview }),
    [openPreview, closePreview],
  );

  return (
    <ImagePreviewContext.Provider value={value}>
      {children}
      <ImagePreviewModal open={Boolean(src)} src={src} onClose={closePreview} />
    </ImagePreviewContext.Provider>
  );
}

export function useImagePreview() {
  const ctx = useContext(ImagePreviewContext);
  if (!ctx) {
    throw new Error("useImagePreview must be used within ImagePreviewProvider");
  }
  return ctx;
}
