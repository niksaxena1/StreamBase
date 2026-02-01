"use client";

import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { IconButton } from "@/components/ui/Button";

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
    <IconButton
      type="button"
      onClick={() => {
        if (isDisabled) return;
        downloadCsv({
          filename: props.filename,
          rows: props.rows,
          headers: props.headers,
        });
      }}
      title={props.title ?? "Download CSV"}
      aria-label={props.title ?? "Download CSV"}
      disabled={isDisabled}
      className={props.className}
    >
      <Download className="h-3.5 w-3.5" />
    </IconButton>
  );
}
