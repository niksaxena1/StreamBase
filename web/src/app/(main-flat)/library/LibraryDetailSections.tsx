"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import { groupFiles, roleLabel, totalBytes } from "@/lib/library/files";
import {
  dropboxHomeUrl,
  fileNameFromPath,
  formatAudioSpec,
  formatDuration,
  formatExactTime,
  formatMVersion,
  formatMegabytes,
  formatRelativeTime,
} from "@/lib/library/format";
import { diffChangeLog, fieldLabel } from "@/lib/library/history";
import type { LibraryCode, LibraryFile, LibraryHistoryEntry } from "@/lib/library/types";

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--sb-muted)" }}>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs" style={{ color: "var(--sb-muted)" }}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Codes

function CodeList({ label, codes, fallback }: { label: string; codes: LibraryCode[]; fallback: string | null }) {
  const list: LibraryCode[] = codes.length ? codes : fallback ? [{ code: fallback, is_primary: true, source: null }] : [];
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{label}</div>
      {list.length === 0 ? (
        <Muted>None</Muted>
      ) : (
        <ul className="space-y-1">
          {list.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-[11px]">{c.code}</span>
              <span style={{ color: "var(--sb-muted)" }}>
                {c.is_primary ? "primary" : "alternate"}
                {c.source ? ` · ${c.source}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CodesSection({
  isrcs,
  upcs,
  fallbackIsrc,
  fallbackUpc,
}: {
  isrcs: LibraryCode[];
  upcs: LibraryCode[];
  fallbackIsrc: string | null;
  fallbackUpc: string | null;
}) {
  return (
    <Section title="Codes">
      <div className="grid gap-3 sm:grid-cols-2">
        <CodeList label="ISRC" codes={isrcs} fallback={fallbackIsrc} />
        <CodeList label="UPC" codes={upcs} fallback={fallbackUpc} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Files

function DropboxLink({ path }: { path: string | null }) {
  if (!path) return null;
  return (
    <a
      href={dropboxHomeUrl(path)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1 text-[11px] underline-offset-2 hover:underline"
      style={{ color: "var(--sb-info)" }}
    >
      Dropbox
      <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

function FileLine({ file, meta }: { file: LibraryFile; meta: string[] }) {
  const name = fileNameFromPath(file.rel_path);
  const details = meta.filter(Boolean).join(" · ");
  return (
    <li className="flex items-start justify-between gap-3 py-1.5 text-xs">
      <div className="min-w-0">
        <div className="truncate font-medium" title={file.rel_path}>
          {name}
        </div>
        <div style={{ color: "var(--sb-muted)" }}>
          {roleLabel(file.role)}
          {details ? ` · ${details}` : ""}
        </div>
      </div>
      <DropboxLink path={file.dropbox_path} />
    </li>
  );
}

function audioMeta(f: LibraryFile): string[] {
  return [formatMVersion(f.m_version), f.duration_s !== null ? formatDuration(f.duration_s) : "", formatAudioSpec(f), formatMegabytes(f.bytes)];
}

function artworkMeta(f: LibraryFile): string[] {
  const dims = f.width && f.height ? `${f.width}×${f.height}` : "";
  return f.role === "artwork_source" ? [formatMegabytes(f.bytes)] : [dims, formatMegabytes(f.bytes)];
}

function plainMeta(f: LibraryFile): string[] {
  return [formatMegabytes(f.bytes)];
}

function FileGroup({ title, files, meta }: { title: string; files: LibraryFile[]; meta: (f: LibraryFile) => string[] }) {
  if (files.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium">{title}</div>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <FileLine key={f.id} file={f} meta={meta(f)} />
        ))}
      </ul>
    </div>
  );
}

function CollapsedGroup({ title, files, meta }: { title: string; files: LibraryFile[]; meta: (f: LibraryFile) => string[] }) {
  if (files.length === 0) return null;
  const size = formatMegabytes(totalBytes(files));
  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-xs font-medium">
        {title} ({files.length}
        {size ? `, ${size}` : ""})
      </summary>
      <ul className="mt-1 space-y-0.5">
        {files.map((f) => (
          <FileLine key={f.id} file={f} meta={meta(f)} />
        ))}
      </ul>
    </details>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="sb-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/60 hover:bg-white/90 dark:bg-white/10 dark:hover:bg-white/20"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked; the path is still visible to select by hand.
        }
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function DriveFolder({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2">
      <code
        className="min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-[11px]"
        style={{ background: "var(--sb-code-bg)" }}
        title={path}
      >
        {path}
      </code>
      <CopyButton text={path} label="Copy drive folder path" />
    </div>
  );
}

export function FilesSection({ files, sourceFolder }: { files: LibraryFile[]; sourceFolder: string | null }) {
  const groups = groupFiles(files);
  return (
    <Section title="Files">
      <div className="space-y-3">
        {sourceFolder ? <DriveFolder path={sourceFolder} /> : null}
        <FileGroup title="Audio" files={groups.audio} meta={audioMeta} />
        <FileGroup title="Artwork" files={groups.artwork} meta={artworkMeta} />
        <FileGroup title="Contracts" files={groups.contracts} meta={plainMeta} />
        <CollapsedGroup title="Stems" files={groups.stems} meta={plainMeta} />
        <CollapsedGroup title="Other" files={groups.other} meta={plainMeta} />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// History

function ChangeLine({ field, before, after }: { field: string; before: string; after: string }) {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-xs">
      <span className="font-medium">{fieldLabel(field)}:</span>
      <span className="max-w-[12rem] truncate" style={{ color: "var(--sb-muted)" }} title={before}>
        {before}
      </span>
      <span aria-hidden="true">→</span>
      <span className="max-w-[14rem] truncate" title={after}>
        {after}
      </span>
    </li>
  );
}

export function HistorySection({ history }: { history: LibraryHistoryEntry[] }) {
  return (
    <Section title="History">
      {history.length === 0 ? (
        <Muted>No changes logged.</Muted>
      ) : (
        <ol className="space-y-3">
          {history.map((entry) => {
            const changes = diffChangeLog(entry.before, entry.after);
            return (
              <li key={entry.id} className="space-y-1 border-l pl-3" style={{ borderColor: "color-mix(in srgb, var(--sb-border) 45%, transparent)" }}>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px]" style={{ color: "var(--sb-muted)" }}>
                  <time dateTime={entry.at} title={formatExactTime(entry.at)}>
                    {formatRelativeTime(entry.at)}
                  </time>
                  <span>{entry.actor ?? "unknown"}</span>
                  {entry.action ? <span className="font-mono">{entry.action}</span> : null}
                </div>
                {changes.length ? (
                  <ul className="space-y-0.5">
                    {changes.map((c) => (
                      <ChangeLine key={c.field} {...c} />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
