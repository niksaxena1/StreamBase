import path from "node:path";
import { readFile } from "node:fs/promises";

import type { SaiCitation } from "./types";
import { embedTexts, embeddingsEnabled } from "./embeddings";
import { supabaseService } from "@/lib/supabase/service";

type DocChunk = {
  id: string;
  title: string;
  md: string;
  mdClean: string;
  tags: string[];
  sources: string[];
};

function normalize(s: string) {
  return (s ?? "").toLowerCase();
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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

async function readDocsMarkdown(): Promise<string> {
  // Next runs from `web/`
  // Canonical docs live under `(main-flat)` and are rendered at `/docs`.
  const p = path.join(process.cwd(), "src", "app", "(main-flat)", "docs", "docs.md");
  return await readFile(p, "utf8");
}

function splitIntoChunks(md: string): DocChunk[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const starts: Array<{ idx: number; title: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+)\s*$/.exec(lines[i]);
    if (m) starts.push({ idx: i, title: m[1] });
  }

  if (starts.length === 0) {
    const meta = parseMeta(md);
    return [
      {
        id: "docs",
        title: "Docs",
        md,
        mdClean: meta.mdClean,
        tags: meta.tags,
        sources: meta.sources,
      },
    ];
  }

  const chunks: DocChunk[] = [];
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const endIdx = s + 1 < starts.length ? starts[s + 1].idx : lines.length;
    const body = lines.slice(start.idx + 1, endIdx).join("\n").trim();
    const meta = parseMeta(body);
    const baseId = slugify(start.title) || `section-${s + 1}`;
    const id = chunks.some((c) => c.id === baseId) ? `${baseId}-${s + 1}` : baseId;
    chunks.push({
      id,
      title: start.title,
      md: body,
      mdClean: meta.mdClean,
      tags: meta.tags,
      sources: meta.sources,
    });
  }
  return chunks;
}

function tokenize(q: string): string[] {
  return normalize(q)
    .split(/[^a-z0-9]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 24);
}

function scoreChunk(chunk: DocChunk, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const hayTitle = normalize(chunk.title);
  const hayBody = normalize(chunk.mdClean);

  let score = 0;
  for (const t of tokens) {
    // title hits are weighted higher
    if (hayTitle.includes(t)) score += 6;
    // body hits
    const idx = hayBody.indexOf(t);
    if (idx >= 0) score += 2;
  }
  // prefer chunks with explicit tags/sources (usually more grounded)
  if (chunk.sources.length > 0) score += 1;
  if (chunk.tags.length > 0) score += 0.5;
  return score;
}

export type DocsRetrieveResult = {
  citations: SaiCitation[];
  contextText: string;
  confidence: "high" | "medium" | "low";
  method: "vector" | "lexical";
};

export async function retrieveDocs(query: string, opts?: { maxChunks?: number }): Promise<DocsRetrieveResult> {
  const max = Math.max(1, Math.min(8, opts?.maxChunks ?? 5));

  // Prefer vector retrieval if configured + DB supports it.
  if (embeddingsEnabled()) {
    try {
      const { vectors } = await embedTexts([query.slice(0, 2000)]);
      const v = vectors[0];
      if (Array.isArray(v) && v.length > 0) {
        const svc = supabaseService();
        const res = await svc.rpc("sai_docs_search", {
          query_embedding: v,
          match_count: max,
        });

        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
          const rows = res.data as any[];
          const citations: SaiCitation[] = rows.map((r) => ({
            source: "docs",
            chunkId: String(r.chunk_id),
            title: String(r.title),
            score: Number(r.score ?? 0),
            sources: Array.isArray(r.sources) ? r.sources : [],
          }));

          const contextText = rows
            .map((r) => {
              const header = `## ${String(r.title)} (chunk_id=${String(r.chunk_id)}, score=${Number(r.score ?? 0).toFixed(3)})`;
              return `${header}\n${String(r.content_text ?? "").trim()}`;
            })
            .join("\n\n---\n\n");

          const best = Number(rows[0]?.score ?? 0);
          const confidence = best >= 0.82 ? "high" : best >= 0.72 ? "medium" : "low";

          return { citations, contextText, confidence, method: "vector" };
        }
      }
    } catch {
      // Best-effort: fall back to lexical chunk scoring.
    }
  }

  const md = await readDocsMarkdown();
  const chunks = splitIntoChunks(md);
  const tokens = tokenize(query);

  const scored = chunks
    .map((c) => ({ c, score: scoreChunk(c, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  const citations: SaiCitation[] = scored.map((x) => ({
    source: "docs",
    chunkId: x.c.id,
    title: x.c.title,
    score: x.score,
    sources: x.c.sources,
  }));

  const contextText =
    scored.length === 0
      ? ""
      : scored
          .map((x) => {
            const header = `## ${x.c.title} (chunk_id=${x.c.id}, score=${x.score})`;
            const body = x.c.mdClean || x.c.md;
            return `${header}\n${body}`;
          })
          .join("\n\n---\n\n");

  const best = scored[0]?.score ?? 0;
  const confidence = best >= 18 ? "high" : best >= 10 ? "medium" : "low";

  return { citations, contextText, confidence, method: "lexical" };
}

