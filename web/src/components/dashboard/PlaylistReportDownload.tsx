"use client";

import { useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { addDaysISO } from "@/lib/sotDates";
import { lastTwoTuesdays, reportRunDates } from "@/lib/playlistReportRange";

export function PlaylistReportDownload({ latestDate }: { latestDate: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function open() {
    if (!start && latestDate) {
      setStart(addDaysISO(latestDate, -6));
      setEnd(latestDate);
    }
    setError("");
    dialog.current?.showModal();
  }
  async function download() {
    try {
      reportRunDates(start, end);
      if (latestDate && end > latestDate) throw new Error("End date exceeds the latest available data.");
      setError("");
      setBusy(true);
      const response = await fetch(`/api/reports/playlist-streams-7d?${new URLSearchParams({ start, end })}`);
      if (!response.ok) throw new Error("Could not download the report. Check the dates and try again.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `playlist_streams_${start}_to_${end}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      dialog.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy(false);
    }
  }
  return <>
    <a href="/api/reports/playlist-streams-7d"
      className="inline-flex items-center justify-center rounded p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/10 opacity-30 hover:opacity-100"
      style={{ color: "var(--sb-muted)" }}
      title="Download last 7 days (XLSX). Right-click for custom dates."
      aria-label="Download playlist streams report"
      onContextMenu={(event) => { event.preventDefault(); open(); }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); open();
        }
      }}><Download className="h-4 w-4" /></a>
    <dialog ref={dialog} aria-labelledby="playlist-report-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border p-5 backdrop:bg-black/50"
      style={{ background: "var(--sb-surface)", color: "var(--sb-text)", borderColor: "var(--sb-border)" }}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id="playlist-report-title" className="text-base font-semibold">Export playlist streams</h2>
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close" title="Close" className="p-1"><X size={18} /></button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void download(); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs min-w-0">Start date (inclusive)
            <input aria-label="Start date" type="date" required value={start} max={end || latestDate || undefined} onChange={e => setStart(e.target.value)} className="mt-1 w-full min-w-0 rounded border p-2 bg-transparent" />
          </label>
          <label className="text-xs min-w-0">End date (inclusive)
            <input aria-label="End date" type="date" required value={end} min={start || undefined} max={latestDate || undefined} onChange={e => setEnd(e.target.value)} className="mt-1 w-full min-w-0 rounded border p-2 bg-transparent" />
          </label>
        </div>
        <button type="button" disabled={!latestDate || busy} className="text-xs underline disabled:opacity-50" onClick={() => {
          if (latestDate) { const range = lastTwoTuesdays(latestDate); setStart(range.start); setEnd(range.end); }
        }}>Last two Tuesdays</button>
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        <button type="submit" disabled={busy} className="flex items-center justify-center gap-2 w-full rounded p-2 text-sm disabled:opacity-50" style={{ background: "var(--sb-accent)", color: "black" }}>
          <Download size={16} />{busy ? "Exporting..." : "Download XLSX"}
        </button>
      </form>
    </dialog>
  </>;
}
