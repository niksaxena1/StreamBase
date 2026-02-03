"use client";

import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";

type DocSection = {
  id: string;
  title: string;
  md: string;
};

type SystemStats = {
  asOfRunDate: string | null;
  ingestionDays: number | null;
  tracks: number | null;
  playlists: number | null;
  artistsDistinct: number | null;
  trackDailyStreamsRowsEstimated: number | null;
};

type Inventory = {
  repoMigrations: string[];
  dbInventoryJson: string | null;
  dbInventorySummary: { tables: number | null; functions: number | null; views: number | null } | null;
};

type ParsedSection = DocSection & {
  tags: string[];
  sources: string[];
  mdClean: string;
};

function normalize(s: string) {
  return (s ?? "").toLowerCase();
}

function parseMeta(md: string): { tags: string[]; sources: string[]; mdClean: string } {
  const tags: string[] = [];
  const sources: string[] = [];

  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const tagMatch = /^\s*<!--\s*tags:\s*(.+?)\s*-->\s*$/.exec(line);
    if (tagMatch) {
      for (const t of tagMatch[1].split(",").map((x) => x.trim()).filter(Boolean)) tags.push(t);
      continue;
    }

    const srcMatch = /^\s*<!--\s*sources:\s*(.+?)\s*-->\s*$/.exec(line);
    if (srcMatch) {
      for (const s of srcMatch[1].split(",").map((x) => x.trim()).filter(Boolean)) sources.push(s);
      continue;
    }

    kept.push(line);
  }

  const uniq = (arr: string[]) => Array.from(new Set(arr));
  return { tags: uniq(tags).sort(), sources: uniq(sources).sort(), mdClean: kept.join("\n").trim() };
}

function matchSection(sec: ParsedSection, q: string, selectedTags: string[]) {
  const nq = normalize(q.trim());

  const textOk =
    nq.length === 0 ||
    normalize(sec.title).includes(nq) ||
    normalize(sec.mdClean).includes(nq);

  if (!textOk) return false;

  const tagOk =
    selectedTags.length === 0 || selectedTags.every((t) => sec.tags.includes(t));

  return tagOk;
}

export function DocsClient(props: {
  introMd: string;
  sections: DocSection[];
  systemStats?: SystemStats | null;
  inventory?: Inventory;
}) {
  const [q, setQ] = useState("");
  const [openMode, setOpenMode] = useState<"auto" | "all" | "none">("auto");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const parsed = useMemo(() => {
    return props.sections.map((s) => {
      const meta = parseMeta(s.md);
      return { ...s, tags: meta.tags, sources: meta.sources, mdClean: meta.mdClean } satisfies ParsedSection;
    });
  }, [props.sections]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of parsed) for (const t of s.tags) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [parsed]);

  const filtered = useMemo(() => parsed.filter((s) => matchSection(s, q, selectedTags)), [parsed, q, selectedTags]);

  const isSearching = q.trim().length > 0;
  const nonDocSectionOpen = openMode === "all" ? true : openMode === "none" ? false : false;

  return (
    <div className="-mx-4 space-y-4 sm:-mx-5">
      <div className="sb-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm font-semibold">Docs</div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search docs…"
              className="sm:w-80"
            />

            <ChipGroup segmented className="text-[11px]">
              <Chip segmented selected={openMode === "auto"} onClick={() => setOpenMode("auto")} title="Open matching sections while searching">
                Auto
              </Chip>
              <Chip segmented selected={openMode === "all"} onClick={() => setOpenMode("all")} title="Expand all sections">
                Expand all
              </Chip>
              <Chip segmented selected={openMode === "none"} onClick={() => setOpenMode("none")} title="Collapse all sections">
                Collapse all
              </Chip>
            </ChipGroup>
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <div className="text-[11px] font-medium opacity-60">Tags:</div>
            {allTags.map((t) => {
              const active = selectedTags.includes(t);
              return (
                <Chip
                  key={t}
                  onClick={() => {
                    setSelectedTags((prev) => (active ? prev.filter((x) => x !== t) : [...prev, t]));
                  }}
                  selected={active}
                  title={active ? "Remove tag filter" : "Filter by this tag"}
                >
                  {t}
                </Chip>
              );
            })}
            {selectedTags.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="ml-1 rounded-full px-2 py-1 text-[11px] underline opacity-60 hover:opacity-90"
              >
                clear
              </button>
            )}
          </div>
        )}

        <div className="mt-3 text-xs" style={{ color: "var(--sb-muted)" }}>
          Showing <span className="font-mono">{filtered.length}</span> of{" "}
          <span className="font-mono">{props.sections.length}</span> sections
          {isSearching ? (
            <>
              {" "}
              for <span className="font-mono">{JSON.stringify(q.trim())}</span>
            </>
          ) : null}
          .
        </div>
      </div>

      {props.systemStats ? (
        <details
          open={nonDocSectionOpen}
          className="rounded-xl border sb-panel p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <summary className="cursor-pointer select-none">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">System stats</div>
                <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                  Best-effort snapshot for scale/health checks.
                </div>
              </div>
              <div className="text-[11px] font-mono opacity-60">
                as_of_run_date={props.systemStats.asOfRunDate ?? "—"}
              </div>
            </div>
          </summary>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Ingestion days" value={props.systemStats.ingestionDays} />
            <Stat label="Tracks" value={props.systemStats.tracks} />
            <Stat label="Playlists" value={props.systemStats.playlists} />
            <Stat label="Artists (distinct)" value={props.systemStats.artistsDistinct} />
            <Stat label="track_daily_streams (est.)" value={props.systemStats.trackDailyStreamsRowsEstimated} />
          </div>
          <div className="mt-2 text-[11px]" style={{ color: "var(--sb-muted)" }}>
            Note: some stats require the optional DB function <span className="font-mono">spotibase_system_stats()</span>.
          </div>
        </details>
      ) : null}

      {props.inventory ? (
        <details
          open={nonDocSectionOpen}
          className="rounded-xl border sb-panel p-4"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <summary className="cursor-pointer select-none">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Inventory</div>
                <div className="mt-1 text-xs" style={{ color: "var(--sb-muted)" }}>
                  Repo migrations list + optional DB schema/RPC inventory.
                </div>
              </div>
            </div>
          </summary>

          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            <div className="rounded-xl border sb-panel p-3" style={{ borderColor: "var(--sb-border)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] opacity-60">Repo migrations</div>
                <CopyChip value={(props.inventory.repoMigrations ?? []).join("\n")} label="Copy list" />
              </div>
              <div className="mt-1 font-mono text-sm">
                {Intl.NumberFormat().format(props.inventory.repoMigrations?.length ?? 0)} files
              </div>
              <div className="mt-2 text-[11px] opacity-60">
                Tip: this is what exists in the repo; it may not match what has been applied in your Supabase project.
              </div>
            </div>

            <div className="rounded-xl border sb-panel p-3" style={{ borderColor: "var(--sb-border)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] opacity-60">DB inventory (optional)</div>
                {props.inventory.dbInventoryJson ? (
                  <CopyChip value={props.inventory.dbInventoryJson} label="Copy JSON" />
                ) : (
                  <span className="text-[11px] opacity-50">—</span>
                )}
              </div>

              {props.inventory.dbInventorySummary ? (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <MiniStat label="tables" value={props.inventory.dbInventorySummary.tables} />
                  <MiniStat label="views" value={props.inventory.dbInventorySummary.views} />
                  <MiniStat label="functions" value={props.inventory.dbInventorySummary.functions} />
                </div>
              ) : (
                <div className="mt-2 text-[11px]" style={{ color: "var(--sb-muted)" }}>
                  To enable: run the migration that adds <span className="font-mono">spotibase_docs_inventory()</span>.
                </div>
              )}
            </div>
          </div>
        </details>
      ) : null}

      <article className="p-4 text-black/80 dark:text-white/75">
        <div className="space-y-3 text-sm leading-relaxed">
          <Markdown md={props.introMd} />

          <div className="mt-4 space-y-2">
            {filtered.map((sec) => {
              const open =
                openMode === "all"
                  ? true
                  : openMode === "none"
                    ? false
                    : isSearching
                      ? true
                      : false;

              return (
                <details
                  key={sec.id}
                  id={sec.id}
                  open={open}
                  className="rounded-xl border sb-panel p-3"
                  style={{ borderColor: "var(--sb-border)" }}
                >
                  <summary className="cursor-pointer select-none text-sm font-semibold">
                    {sec.title}
                  </summary>
                  <div className="mt-3 space-y-3">
                    {(sec.tags.length > 0 || sec.sources.length > 0) && (
                      <div
                        className="flex flex-col gap-2 rounded-lg border sb-panel p-2 text-xs"
                        style={{ borderColor: "var(--sb-border)" }}
                      >
                        {sec.tags.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium opacity-60">Tags</span>
                            {sec.tags.map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setSelectedTags((prev) => (prev.includes(t) ? prev : [...prev, t]))}
                                className="sb-ring rounded-full bg-white/70 px-2 py-1 text-[11px] transition hover:opacity-80 dark:bg-white/10"
                                title="Add this tag to filters"
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        )}
                        {sec.sources.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <span className="font-medium opacity-60">Sources (click to copy)</span>
                            <div className="flex flex-wrap gap-1">
                              {sec.sources.map((s) => (
                                <CopyChip key={s} value={s} label={s} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <Markdown md={sec.mdClean} />
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </article>
    </div>
  );
}

function Stat(props: { label: string; value: number | null | undefined }) {
  const v = props.value;
  const text = v == null ? "—" : Intl.NumberFormat().format(v);
  return (
    <div className="rounded-xl border sb-panel p-3" style={{ borderColor: "var(--sb-border)" }}>
      <div className="text-[11px] opacity-60">{props.label}</div>
      <div className="mt-1 font-mono text-sm">{text}</div>
    </div>
  );
}

function MiniStat(props: { label: string; value: number | null | undefined }) {
  const v = props.value;
  const text = v == null ? "—" : Intl.NumberFormat().format(v);
  return (
    <div className="rounded-lg border bg-white/70 px-2 py-2 dark:bg-white/10" style={{ borderColor: "var(--sb-border)" }}>
      <div className="text-[10px] opacity-60">{props.label}</div>
      <div className="mt-0.5 font-mono text-[12px]">{text}</div>
    </div>
  );
}

function CopyChip(props: { value: string; label?: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value);
    } catch {
      // ignore
    }
  }

  return (
    <Chip onClick={copy} title="Copy">
      {props.label ?? "Copy"}
    </Chip>
  );
}

function Markdown(props: { md: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children, ...p }) => (
          <h1 {...p} className="font-display text-2xl font-semibold tracking-tight text-black dark:text-white">
            {children}
          </h1>
        ),
        h2: ({ children, ...p }) => (
          <h2 {...p} className="pt-2 text-lg font-semibold text-black dark:text-white">
            {children}
          </h2>
        ),
        h3: ({ children, ...p }) => (
          <h3 {...p} className="pt-2 text-base font-semibold text-black dark:text-white">
            {children}
          </h3>
        ),
        p: ({ children, ...p }) => (
          <p {...p} className="text-black/80 dark:text-white/75">
            {children}
          </p>
        ),
        a: ({ children, ...p }) => (
          <a
            {...p}
            className="underline underline-offset-2 transition-opacity hover:opacity-80"
            style={{ color: "var(--sb-accent)", textDecorationColor: "var(--sb-accent)" }}
          >
            {children}
          </a>
        ),
        code: ({ children, ...p }) => (
          <code
            {...p}
            className="rounded bg-black/5 px-1 py-0.5 font-mono text-[12px] dark:bg-white/10"
          >
            {children}
          </code>
        ),
        pre: ({ children, ...p }) => (
          <pre
            {...p}
            className="overflow-x-auto rounded-lg border sb-code-bg p-3 font-mono text-[12px] leading-relaxed"
            style={{ borderColor: "var(--sb-border)" }}
          >
            {children}
          </pre>
        ),
        ul: ({ children, ...p }) => (
          <ul {...p} className="list-disc space-y-1 pl-6 text-black/80 dark:text-white/75">
            {children}
          </ul>
        ),
        ol: ({ children, ...p }) => (
          <ol {...p} className="list-decimal space-y-1 pl-6 text-black/80 dark:text-white/75">
            {children}
          </ol>
        ),
        li: ({ children, ...p }) => (
          <li {...p} className="text-black/80 dark:text-white/75">
            {children}
          </li>
        ),
        blockquote: ({ children, ...p }) => (
          <blockquote
            {...p}
            className="rounded-lg border-l-4 sb-blockquote-bg p-3 text-sm"
            style={{ borderColor: "var(--sb-accent)" }}
          >
            {children}
          </blockquote>
        ),
        hr: (p) => (
          <hr {...p} className="my-4" style={{ borderColor: "var(--sb-border)" }} />
        ),
        table: ({ children, ...p }) => (
          <div className="overflow-x-auto">
            <table
              {...p}
              className="w-full border-collapse text-sm"
              style={{ borderColor: "var(--sb-border)" }}
            >
              {children}
            </table>
          </div>
        ),
        th: ({ children, ...p }) => (
          <th
            {...p}
            className="border px-2 py-1 text-left text-xs font-semibold"
            style={{ borderColor: "var(--sb-border)" }}
          >
            {children}
          </th>
        ),
        td: ({ children, ...p }) => (
          <td
            {...p}
            className="border px-2 py-1 align-top text-xs"
            style={{ borderColor: "var(--sb-border)" }}
          >
            {children}
          </td>
        ),
      }}
    >
      {props.md}
    </ReactMarkdown>
  );
}

