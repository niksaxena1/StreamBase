"use client";

import dynamic from "next/dynamic";

const SAIWidget = dynamic(
  () => import("@/components/sai/SAIWidget").then(m => ({ default: m.SAIWidget })),
  { ssr: false }
);

export function LazyAIWidget() {
  return <SAIWidget />;
}
