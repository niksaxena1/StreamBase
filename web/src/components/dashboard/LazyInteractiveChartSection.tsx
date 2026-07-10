"use client";

import dynamic from "next/dynamic";

import type { ComponentProps } from "react";
import { ChartSkeleton } from "@/components/ui/Skeleton";

type Props = ComponentProps<typeof import("./InteractiveChartSection")["InteractiveChartSection"]>;

const InteractiveChartSectionLazy = dynamic(
  () =>
    import("./InteractiveChartSection").then((m) => m.InteractiveChartSection),
  {
    ssr: false,
    loading: () => <ChartSkeleton height={220} />,
  },
);

export function LazyInteractiveChartSection(props: Props) {
  return <InteractiveChartSectionLazy {...props} />;
}

