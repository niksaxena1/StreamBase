import { useId, useRef, useState, type ReactNode } from "react";
import { Button, EmptyState } from "../ui";
export type ChartProps = {
  title: string;
  description?: string;
  ariaLabel?: string;
  "data-testid"?: string;
  actions?: ReactNode;
  height?: number;
};
export type CsvRow = Record<string, unknown>;
export function csvText(rows: CsvRow[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const quote = (value: unknown) => {
    let text =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (
      /^[=+@\t\r]/.test(text) ||
      (typeof value === "string" && text.startsWith("-"))
    )
      text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    columns.map(quote).join(","),
    ...rows.map((row) => columns.map((key) => quote(row[key])).join(",")),
  ].join("\r\n");
}
export function downloadChartCSV(rows: CsvRow[], filename: string) {
  const blob = new Blob(["\uFEFF", csvText(rows)], {
      type: "text/csv;charset=utf-8",
    }),
    url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ChartFrame({
  title,
  description,
  ariaLabel,
  "data-testid": testId = "chart-frame",
  actions,
  children,
  rows,
  empty = false,
  captureRef,
}: ChartProps & {
  children: ReactNode;
  rows: CsvRow[];
  empty?: boolean;
  captureRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const id = useId(),
    root = useRef<HTMLDivElement>(null),
    [status, setStatus] = useState(""),
    [copying, setCopying] = useState(false);
  async function copyPNG() {
    if (!root.current) return;
    setCopying(true);
    setStatus("");
    try {
      if (!navigator.clipboard?.write || !window.ClipboardItem)
        throw new Error("PNG clipboard is unavailable in this browser");
      const { toBlob } = await import("html-to-image");
      const image = await toBlob(root.current, {
        backgroundColor: getComputedStyle(root.current)
          .getPropertyValue("--sb-bg")
          .trim(),
        pixelRatio: 2,
        filter: (node) =>
          !(
            node instanceof HTMLElement && node.dataset.captureIgnore === "true"
          ),
      });
      if (!image) throw new Error("Could not render the chart");
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": image }),
      ]);
      setStatus("PNG copied");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not copy PNG");
    } finally {
      setCopying(false);
    }
  }
  return (
    <section
      className="card chart-frame"
      aria-label={ariaLabel ?? title}
      aria-describedby={description ? id : undefined}
      data-testid={testId}
    >
      <div ref={root}>
        <header className="row spread chart-header">
          <div>
            <h2>{title}</h2>
            {description && (
              <p id={id} className="muted small">
                {description}
              </p>
            )}
          </div>
          <div className="row chart-actions" data-capture-ignore="true">
            {actions}
            <Button
              disabled={!rows.length}
              onClick={() =>
                downloadChartCSV(
                  rows,
                  `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
                )
              }
            >
              Download CSV
            </Button>
            <Button disabled={empty || copying} onClick={() => void copyPNG()}>
              Copy PNG
            </Button>
          </div>
        </header>
        <div ref={captureRef}>
          {empty ? (
            <EmptyState
              title="No chart data"
              description="No observations are available for this series."
            />
          ) : (
            children
          )}
        </div>
      </div>
      <div className="small muted" role="status" data-capture-ignore="true">
        {status}
      </div>
    </section>
  );
}
