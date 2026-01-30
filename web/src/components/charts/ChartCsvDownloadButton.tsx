"use client";

import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv";

export function ChartCsvDownloadButton(props: {
  filename: string;
  rows: Array<Record<string, unknown>>;
  headers?: string[];
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const isDisabled = props.disabled || !props.rows || props.rows.length === 0;

  return (
    <button
      type="button"
      onClick={() => {
        if (isDisabled) return;
        downloadCsv({
          filename: props.filename,
          rows: props.rows,
          headers: props.headers,
        });
      }}
      className={[
        "inline-flex items-center justify-center rounded p-1 transition-colors",
        "hover:bg-black/5 dark:hover:bg-white/10",
        isDisabled ? "cursor-not-allowed opacity-40" : "cursor-pointer",
        props.className ?? "",
      ].join(" ")}
      title={props.title ?? "Download CSV"}
      aria-label={props.title ?? "Download CSV"}
      style={{ color: "var(--sb-muted)" }}
      disabled={isDisabled}
    >
      <Download className="h-3.5 w-3.5" />
    </button>
  );
}
