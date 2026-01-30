import path from "node:path";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

import { NextRequest, NextResponse } from "next/server";

import { supabaseService } from "@/lib/supabase/service";
import { embedTexts, embeddingsEnabled, embeddingDims } from "@/lib/sai/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

type Chunk = {
  chunk_id: string;
  title: string;
  content_md: string;
  content_text: string;
  tags: string[];
  sources: string[];
  content_sha256: string;
};

function splitIntoChunks(md: string): Chunk[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const starts: Array<{ idx: number; title: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+)\s*$/.exec(lines[i]);
    if (m) starts.push({ idx: i, title: m[1] });
  }

  if (starts.length === 0) {
    const meta = parseMeta(md);
    const clean = meta.mdClean || md;
    return [
      {
        chunk_id: "docs",
        title: "Docs",
        content_md: md,
        content_text: clean,
        tags: meta.tags,
        sources: meta.sources,
        content_sha256: crypto.createHash("sha256").update(clean).digest("hex"),
      },
    ];
  }

  const chunks: Chunk[] = [];
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const endIdx = s + 1 < starts.length ? starts[s + 1].idx : lines.length;
    const body = lines.slice(start.idx + 1, endIdx).join("\n").trim();
    const meta = parseMeta(body);
    const clean = meta.mdClean || body;
    const baseId = slugify(start.title) || `section-${s + 1}`;
    const chunk_id = chunks.some((c) => c.chunk_id === baseId) ? `${baseId}-${s + 1}` : baseId;
    chunks.push({
      chunk_id,
      title: start.title,
      content_md: body,
      content_text: clean,
      tags: meta.tags,
      sources: meta.sources,
      content_sha256: crypto.createHash("sha256").update(clean).digest("hex"),
    });
  }
  return chunks;
}

async function readDocsMarkdown(): Promise<string> {
  const p = path.join(process.cwd(), "src", "app", "(main)", "docs", "docs.md");
  return await readFile(p, "utf8");
}

function requireAdmin(req: NextRequest): string | null {
  const token = process.env.SAI_ADMIN_TOKEN ?? "";
  if (!token) return "SAI_ADMIN_TOKEN not configured";
  const got = req.headers.get("x-sai-admin-token") ?? "";
  if (got !== token) return "invalid admin token";
  return null;
}

export async function POST(req: NextRequest) {
  const err = requireAdmin(req);
  if (err) return NextResponse.json({ error: err }, { status: 401 });
  if (!embeddingsEnabled()) return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 400 });

  // Sanity check: migration and dims must align.
  const dims = embeddingDims();
  if (dims !== 1536) {
    return NextResponse.json(
      { error: `SAI_EMBED_DIMS=${dims} but DB migration uses vector(1536). Update migration + code together.` },
      { status: 400 },
    );
  }

  const md = await readDocsMarkdown();
  const chunks = splitIntoChunks(md);

  const svc = supabaseService();
  const docPath = "web/src/app/(main)/docs/docs.md";

  // Embed in batches
  const BATCH = 32;
  let upserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const inputs = batch.map((c) => {
      // Keep the embedding input bounded.
      const s = `Title: ${c.title}\n\n${c.content_text}`;
      return s.slice(0, 6000);
    });

    const { vectors } = await embedTexts(inputs);
    if (vectors.length !== batch.length) {
      return NextResponse.json(
        { error: `embedding count mismatch: got ${vectors.length}, expected ${batch.length}` },
        { status: 500 },
      );
    }

    const rows = batch.map((c, idx) => ({
      doc_path: docPath,
      chunk_id: c.chunk_id,
      title: c.title,
      content_md: c.content_md,
      content_text: c.content_text,
      tags: c.tags,
      sources: c.sources,
      content_sha256: c.content_sha256,
      embedding: vectors[idx],
    }));

    const { error } = await svc.from("sai_doc_chunks").upsert(rows, { onConflict: "doc_path,chunk_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    upserted += rows.length;
  }

  // Optional cleanup: delete stale chunks for this doc path that no longer exist.
  const liveIds = new Set(chunks.map((c) => c.chunk_id));
  const { data: existing } = await svc.from("sai_doc_chunks").select("chunk_id,content_sha256").eq("doc_path", docPath).limit(5000);
  const stale = (existing ?? []).filter((r: any) => !liveIds.has(String(r.chunk_id))).map((r: any) => String(r.chunk_id));
  if (stale.length > 0) {
    await svc.from("sai_doc_chunks").delete().eq("doc_path", docPath).in("chunk_id", stale);
  }

  return NextResponse.json(
    {
      ok: true,
      docPath,
      chunks: chunks.length,
      upserted,
      deletedStale: stale.length,
    },
    { status: 200 },
  );
}

