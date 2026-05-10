"use client";

import { useEffect } from "react";

import { formatPageTitle } from "@/lib/pageTitle";

export function DocumentTitle({ title }: { title?: string | null }) {
  useEffect(() => {
    document.title = formatPageTitle(title);
  }, [title]);

  return null;
}
