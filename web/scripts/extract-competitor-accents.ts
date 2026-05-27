/**
 * Extract vibrant accent colors from competitor playlist thumbnails and store on competitor.labels.accent_hex.
 * When two labels land on visually similar colors, picks an alternate swatch or nudges hue (e.g. ATLAST toward pink vs selected. red).
 *
 * Usage:
 *   cd web && npm run extract-competitor-accents
 *   cd web && npm run extract-competitor-accents -- --force
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. from web/.env.local).
 */

import { createClient } from "@supabase/supabase-js";
import { Vibrant } from "node-vibrant/node";
import sharp from "sharp";

import {
  candidatesFromSwatches,
  harmonizeAccentBatch,
  rgbToHex,
  hslToRgb,
} from "../src/lib/competitorAccentPalette";

const FORCE = process.argv.includes("--force");

/** Brand-locked accents; never overwritten by extract/harmonize (even with --force). */
const PINNED_LABEL_ACCENTS: Record<string, string> = {
  selected: "db0c0c",
};

const PALETTE_KEYS = [
  "Vibrant",
  "LightVibrant",
  "DarkVibrant",
  "Muted",
  "LightMuted",
  "DarkMuted",
] as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function hashHue(labelKey: string): number {
  let h = 0;
  for (let i = 0; i < labelKey.length; i++) h = (h * 31 + labelKey.charCodeAt(i)) >>> 0;
  return h % 360;
}

function fallbackHex(labelKey: string): string {
  const [r, g, b] = hslToRgb(hashHue(labelKey), 0.55, 0.55);
  return rgbToHex(r, g, b);
}

function allSwatchRgbs(palette: Record<string, { rgb: [number, number, number] } | null | undefined>): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const key of PALETTE_KEYS) {
    const swatch = palette[key];
    if (swatch?.rgb) out.push(swatch.rgb);
  }
  return out;
}

async function imageBufferForVibrant(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${imageUrl}`);
  const raw = Buffer.from(await res.arrayBuffer());
  // node-vibrant does not support WebP; normalize via sharp.
  return sharp(raw).png().toBuffer();
}

async function extractCandidates(imageUrl: string, labelKey: string): Promise<string[]> {
  const buf = await imageBufferForVibrant(imageUrl);
  const palette = await Vibrant.from(buf).getPalette();
  const candidates = candidatesFromSwatches(allSwatchRgbs(palette));
  if (candidates.length) return candidates;
  return [fallbackHex(labelKey)];
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const svc = createClient(url, key, { auth: { persistSession: false } });

  const { data: labels, error: labelsErr } = await svc
    .schema("competitor")
    .from("labels")
    .select("label_key,display_name,accent_hex")
    .eq("is_active", true)
    .order("display_name", { ascending: true });

  if (labelsErr) throw new Error(labelsErr.message);

  const { data: playlists, error: plErr } = await svc
    .schema("competitor")
    .from("playlists")
    .select("label_key,spotify_playlist_image_url,display_order")
    .eq("is_active", true)
    .order("display_order", { ascending: true, nullsFirst: false });

  if (plErr) throw new Error(plErr.message);

  const imageByLabel = new Map<string, string>();
  for (const row of playlists ?? []) {
    const lk = String(row.label_key ?? "");
    const img = String(row.spotify_playlist_image_url ?? "").trim();
    if (lk && img && !imageByLabel.has(lk)) imageByLabel.set(lk, img);
  }

  type LabelRow = { label_key: string; display_name: string; accent_hex: string | null };
  const labelRows = (labels ?? []) as LabelRow[];

  const pending: Array<{
    labelKey: string;
    imageUrl: string;
    existing: string | null;
    candidates: string[];
  }> = [];

  for (const label of labelRows) {
    const labelKey = String(label.label_key);
    const imageUrl = imageByLabel.get(labelKey) ?? "";
    const existing = label.accent_hex ? String(label.accent_hex).replace(/^#/, "").toLowerCase() : null;

    if (!imageUrl) {
      pending.push({ labelKey, imageUrl: "", existing, candidates: [existing ?? fallbackHex(labelKey)] });
      continue;
    }

    if (existing && !FORCE) {
      pending.push({ labelKey, imageUrl, existing, candidates: [existing] });
      continue;
    }

    try {
      const candidates = await extractCandidates(imageUrl, labelKey);
      pending.push({ labelKey, imageUrl, existing, candidates });
    } catch (err) {
      console.warn(`${labelKey}: extract failed (${err instanceof Error ? err.message : err}), using fallback`);
      pending.push({ labelKey, imageUrl, existing, candidates: [fallbackHex(labelKey)] });
    }
  }

  const chosen = new Map<string, string>();

  for (const row of pending) {
    if (row.existing && !FORCE && row.candidates.length === 1 && row.candidates[0] === row.existing) {
      chosen.set(row.labelKey, row.existing);
      continue;
    }
    // Primary swatch per artwork first; harmonizeAccentBatch nudges clashes (e.g. ATLAST → pink vs selected. red).
    chosen.set(row.labelKey, row.candidates[0] ?? fallbackHex(row.labelKey));
  }

  const harmonized = harmonizeAccentBatch(chosen);
  for (const [labelKey, hex] of Object.entries(PINNED_LABEL_ACCENTS)) {
    harmonized.set(labelKey, hex.replace(/^#/, "").toLowerCase());
  }

  console.log("label_key\timage\taccent_hex\taction");
  for (const label of labelRows) {
    const labelKey = String(label.label_key);
    const imageUrl = imageByLabel.get(labelKey) ?? "";
    const existing = label.accent_hex ? String(label.accent_hex).replace(/^#/, "").toLowerCase() : null;
    const hex = harmonized.get(labelKey) ?? fallbackHex(labelKey);

    if (existing === hex && !FORCE) {
      console.log(`${labelKey}\t${imageUrl ? "yes" : "no"}\t${hex}\tskip`);
      continue;
    }

    const { error } = await svc
      .schema("competitor")
      .from("labels")
      .update({ accent_hex: hex })
      .eq("label_key", labelKey);
    if (error) throw new Error(error.message);

    const action =
      existing && existing !== hex
        ? "updated (distinct)"
        : FORCE
          ? "updated (force)"
          : "updated";
    console.log(`${labelKey}\t${imageUrl ? "yes" : "no"}\t${hex}\t${action}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
