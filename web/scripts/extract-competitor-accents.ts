/**
 * Extract vibrant accent colors from competitor playlist thumbnails and store on competitor.labels.accent_hex.
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

const FORCE = process.argv.includes("--force");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return [r, g, b]
    .map((c) => clamp(c).toString(16).padStart(2, "0"))
    .join("");
}

function relativeLuminance(r: number, g: number, b: number): number {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
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

function adjustForContrast(hex: string): string {
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4, 6), 16);
  let y = relativeLuminance(r, g, b);
  let guard = 0;
  while (guard < 24) {
    if (y >= 0.15 && y <= 0.85) break;
    if (y < 0.15) {
      r = Math.min(255, r * 1.12 + 8);
      g = Math.min(255, g * 1.12 + 8);
      b = Math.min(255, b * 1.12 + 8);
    } else {
      r = Math.max(0, r * 0.88);
      g = Math.max(0, g * 0.88);
      b = Math.max(0, b * 0.88);
    }
    y = relativeLuminance(r, g, b);
    guard++;
  }
  return rgbToHex(r, g, b);
}

function pickSwatchRgb(palette: {
  Vibrant?: { rgb: [number, number, number] } | null;
  LightVibrant?: { rgb: [number, number, number] } | null;
  Muted?: { rgb: [number, number, number] } | null;
  DarkVibrant?: { rgb: [number, number, number] } | null;
  LightMuted?: { rgb: [number, number, number] } | null;
}): [number, number, number] | null {
  const swatch =
    palette.Vibrant ?? palette.LightVibrant ?? palette.Muted ?? palette.DarkVibrant ?? palette.LightMuted;
  if (!swatch) return null;
  return swatch.rgb;
}

async function imageBufferForVibrant(imageUrl: string): Promise<Buffer> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${imageUrl}`);
  const raw = Buffer.from(await res.arrayBuffer());
  // node-vibrant does not support WebP; normalize via sharp.
  return sharp(raw).png().toBuffer();
}

async function extractHex(imageUrl: string, labelKey: string): Promise<string> {
  const buf = await imageBufferForVibrant(imageUrl);
  const palette = await Vibrant.from(buf).getPalette();
  const rgb = pickSwatchRgb(palette);
  if (!rgb) return fallbackHex(labelKey);
  let [r, g, b] = rgb;
  const [, s] = rgbToHsl(r, g, b);
  if (s < 0.25) return fallbackHex(labelKey);
  let hex = adjustForContrast(rgbToHex(r, g, b));
  return hex.toLowerCase();
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

  console.log("label_key\timage\taccent_hex\taction");
  for (const label of labels ?? []) {
    const labelKey = String(label.label_key);
    const imageUrl = imageByLabel.get(labelKey) ?? "";
    const existing = label.accent_hex ? String(label.accent_hex).replace(/^#/, "").toLowerCase() : null;

    if (!imageUrl) {
      const hex = existing ?? fallbackHex(labelKey);
      if (!existing || FORCE) {
        const { error } = await svc
          .schema("competitor")
          .from("labels")
          .update({ accent_hex: hex })
          .eq("label_key", labelKey);
        if (error) throw new Error(error.message);
        console.log(`${labelKey}\t(no image)\t${hex}\tfallback`);
      } else {
        console.log(`${labelKey}\t(no image)\t${existing}\tskip`);
      }
      continue;
    }

    if (existing && !FORCE) {
      console.log(`${labelKey}\tyes\t${existing}\tskip`);
      continue;
    }

    try {
      const hex = await extractHex(imageUrl, labelKey);
      const { error } = await svc
        .schema("competitor")
        .from("labels")
        .update({ accent_hex: hex })
        .eq("label_key", labelKey);
      if (error) throw new Error(error.message);
      console.log(`${labelKey}\tyes\t${hex}\tupdated`);
    } catch (err) {
      const hex = fallbackHex(labelKey);
      const { error } = await svc
        .schema("competitor")
        .from("labels")
        .update({ accent_hex: hex })
        .eq("label_key", labelKey);
      if (error) throw new Error(error.message);
      console.log(`${labelKey}\terror\t${hex}\tfallback (${err instanceof Error ? err.message : err})`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
