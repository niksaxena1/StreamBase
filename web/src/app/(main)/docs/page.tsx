import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

import { DocsClient } from "./DocsClient";
import { supabaseService } from "@/lib/supabase/service";
import { cachedQuery } from "@/lib/supabase/cache";

// This page lives under `(main)` which requires Supabase session cookies.
// Mark it dynamic so the auth guard in `web/src/app/(main)/layout.tsx` is evaluated per-request,
// rather than being statically rendered/cached as "logged out".
export const dynamic = "force-dynamic";

function filePath(): string {
  // `process.cwd()` is `web/` when running the Next app.
  return path.join(process.cwd(), "src", "app", "(main)", "docs", "docs.md");
}

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

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function splitIntoSections(md: string): { introMd: string; sections: DocSection[] } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");

  const starts: Array<{ idx: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+)\s*$/.exec(lines[i]);
    if (m) starts.push({ idx: i, title: m[1] });
  }

  // If no sections, treat all as intro.
  if (starts.length === 0) return { introMd: md, sections: [] };

  const introMd = lines.slice(0, starts[0].idx).join("\n").trimEnd();
  const sections: DocSection[] = [];

  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const endIdx = s + 1 < starts.length ? starts[s + 1].idx : lines.length;
    const body = lines.slice(start.idx + 1, endIdx).join("\n").trim();
    const baseId = slugify(start.title) || `section-${s + 1}`;
    const uniqueId =
      sections.some((x) => x.id === baseId) ? `${baseId}-${s + 1}` : baseId;
    sections.push({ id: uniqueId, title: start.title, md: body });
  }

  return { introMd, sections };
}

export default async function DocsPage() {
  let md = "";
  try {
    md = await readFile(filePath(), "utf8");
  } catch {
    md = [
      "# Docs not found",
      "",
      "Expected markdown file at:",
      "",
      `\`${filePath()}\``,
      "",
      "If you moved it, update `web/src/app/(main)/docs/page.tsx`.",
      "",
    ].join("\n");
  }

  const { introMd, sections } = splitIntoSections(md);

  const stats = await getSystemStatsBestEffort();
  const inventory = await getInventoryBestEffort();

  return (
    <DocsClient introMd={introMd} sections={sections} systemStats={stats} inventory={inventory} />
  );
}

async function getSystemStatsBestEffort(): Promise<SystemStats | null> {
  try {
    const svc = supabaseService();

    // Prefer a single RPC (fast + consistent) if the migration has been applied.
    // If it doesn't exist, fall back to a few cheap counts.
    const rpc = await cachedQuery(
      async () => await svc.rpc("spotibase_system_stats"),
      "docs-system-stats-rpc-v1",
      600,
    );

    if (rpc.data) {
      const j = rpc.data as any;
      return {
        asOfRunDate: j?.as_of_run_date ?? null,
        ingestionDays: j?.ingestion_days ?? null,
        tracks: j?.tracks ?? null,
        playlists: j?.playlists ?? null,
        artistsDistinct: j?.artists_distinct ?? null,
        trackDailyStreamsRowsEstimated: j?.track_daily_streams_rows_estimated ?? null,
      };
    }

    // Fallback: minimal cheap counts. Some values (like distinct artists) are not feasible without SQL.
    const [{ count: tracks }, { count: playlists }, { count: ingestionDays }, { data: latestRun }] =
      await Promise.all([
        svc.from("tracks").select("isrc", { count: "exact", head: true }),
        svc.from("playlists").select("playlist_key", { count: "exact", head: true }),
        svc.from("ingestion_runs").select("id", { count: "exact", head: true }),
        svc
          .from("ingestion_runs")
          .select("run_date")
          .order("run_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    return {
      asOfRunDate: (latestRun as any)?.run_date ?? null,
      ingestionDays: ingestionDays ?? null,
      tracks: tracks ?? null,
      playlists: playlists ?? null,
      artistsDistinct: null,
      trackDailyStreamsRowsEstimated: null,
    };
  } catch {
    return null;
  }
}

async function getInventoryBestEffort(): Promise<Inventory> {
  const repoMigrations = await getRepoMigrationsBestEffort();
  const { dbInventoryJson, dbInventorySummary } = await getDbInventoryBestEffort();
  return { repoMigrations, dbInventoryJson, dbInventorySummary };
}

async function getRepoMigrationsBestEffort(): Promise<string[]> {
  try {
    // Next runs from `web/`; migrations are at repo root.
    const dir = path.join(process.cwd(), "..", "migrations");
    const names = await readdir(dir);
    return names
      .filter((n) => n.toLowerCase().endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function getDbInventoryBestEffort(): Promise<{
  dbInventoryJson: string | null;
  dbInventorySummary: { tables: number | null; functions: number | null; views: number | null } | null;
}> {
  try {
    const svc = supabaseService();
    const res = await cachedQuery(
      async () => await svc.rpc("spotibase_docs_inventory"),
      "docs-db-inventory-v1",
      3600,
    );

    if (!res.data) return { dbInventoryJson: null, dbInventorySummary: null };
    const json = res.data as any;
    const summary = {
      tables: Array.isArray(json?.tables) ? json.tables.length : null,
      functions: Array.isArray(json?.functions) ? json.functions.length : null,
      views: Array.isArray(json?.views) ? json.views.length : null,
    };
    return { dbInventoryJson: JSON.stringify(json, null, 2), dbInventorySummary: summary };
  } catch {
    return { dbInventoryJson: null, dbInventorySummary: null };
  }
}

