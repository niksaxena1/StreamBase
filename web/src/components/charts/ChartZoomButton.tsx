"use client";

import { ReactNode, useCallback, useState } from "react";
import { Maximize2 } from "lucide-react";

import { Modal } from "@/components/ui/Modal";
import { DailyStreamsChart } from "@/components/charts/DailyStreamsChart";

export function ChartZoomButton(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  chart: {
    data: Array<{ date: string; value: number }>;
    valueLabel: string;
    valueFormat: "int" | "usd";
    yTickFormat: "k" | "int" | "usd_compact";
  };
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className="sb-ring inline-flex items-center gap-2 rounded-full bg-white/60 px-3 py-2 text-xs font-medium transition hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15"
        style={{ color: "var(--sb-text)" }}
        onClick={() => setOpen(true)}
        aria-label="Expand chart"
      >
        <Maximize2 className="h-4 w-4 opacity-70" />
        Expand
      </button>

      <Modal open={open} onClose={close} title={props.title} subtitle={props.subtitle}>
        <DailyStreamsChart
          data={props.chart.data}
          valueLabel={props.chart.valueLabel}
          valueFormat={props.chart.valueFormat}
          yTickFormat={props.chart.yTickFormat}
          heightPx={560}
        />
      </Modal>
    </>
  );
}

