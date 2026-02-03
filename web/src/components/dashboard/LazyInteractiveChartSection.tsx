"use client";

import dynamic from "next/dynamic";

import type { ComponentProps } from "react";
import { SpotlightCard } from "@/components/ui/SpotlightCard";

type Props = ComponentProps<typeof import("./InteractiveChartSection")["InteractiveChartSection"]>;

const InteractiveChartSectionLazy = dynamic(
  () =>
    import("./InteractiveChartSection").then((m) => m.InteractiveChartSection),
  {
    ssr: false,
    loading: () => (
      <SpotlightCard className="relative p-3 overflow-visible">
        <div className="flex items-center justify-between gap-2">
          <div className="h-3 w-40 animate-pulse rounded bg-white/30 dark:bg-white/10" />
          <div className="h-3 w-24 animate-pulse rounded bg-white/30 dark:bg-white/10" />
        </div>
        <div className="mt-3 h-[220px] w-full animate-pulse rounded-xl bg-white/20 dark:bg-white/5" />
      </SpotlightCard>
    ),
  },
);

export function LazyInteractiveChartSection(props: Props) {
  return <InteractiveChartSectionLazy {...props} />;
}

