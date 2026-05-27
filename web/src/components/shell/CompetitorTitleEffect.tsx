"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Legacy suffix from older title templates. */
const LEGACY_STREAMBASE_SUFFIX_RE = /\s\|\sStreamBase$/;
/** Competitor label suffix (`· Label` or `· Competitors`). */
const COMPETITOR_TITLE_SUFFIX_RE = /\s(?:\u00b7|[-\u2014])\s.+$/;

function baseTitle(title: string) {
  return title
    .replace(LEGACY_STREAMBASE_SUFFIX_RE, "")
    .replace(COMPETITOR_TITLE_SUFFIX_RE, "")
    .replace(LEGACY_STREAMBASE_SUFFIX_RE, "")
    .trim() || "StreamBase";
}

export function CompetitorTitleEffect({
  datasetMode,
  competitorDisplayName,
}: {
  datasetMode: "own" | "competitor";
  competitorDisplayName: string | null;
}) {
  const pathname = usePathname();

  useEffect(() => {
    const applyTitle = () => {
      const title = baseTitle(document.title);
      const nextTitle =
        datasetMode !== "competitor"
          ? title
          : `${title} \u00b7 ${competitorDisplayName ?? "Competitors"}`;

      if (document.title !== nextTitle) {
        document.title = nextTitle;
      }
    };

    applyTitle();

    const titleEl = document.querySelector("title");
    const observer = titleEl ? new MutationObserver(applyTitle) : null;
    observer?.observe(titleEl!, { childList: true });
    const timeout = window.setTimeout(applyTitle, 250);

    return () => {
      observer?.disconnect();
      window.clearTimeout(timeout);
    };
  }, [datasetMode, competitorDisplayName, pathname]);

  return null;
}
