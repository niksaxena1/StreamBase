"use client";

import type { ReactNode } from "react";

import { ImagePreviewProvider } from "@/components/ui/ImagePreviewProvider";

/** Client-only providers shared across authed and public pages. */
export function AppProviders({ children }: { children: ReactNode }) {
  return <ImagePreviewProvider>{children}</ImagePreviewProvider>;
}
