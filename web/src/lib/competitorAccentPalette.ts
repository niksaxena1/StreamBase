/**
 * Pick distinct competitor accent colors from image palette swatches.
 * Used by scripts/extract-competitor-accents.ts
 */

export const MIN_ACCENT_DISTANCE = 0.24;
/** Reds are judged more strictly so two scarlet labels do not look identical in the chrome. */
export const MIN_RED_FAMILY_DISTANCE = 0.33;

export function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return [r, g, b]
    .map((c) => clamp(c).toString(16).padStart(2, "0"))
    .join("");
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
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

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
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

export function relativeLuminance(r: number, g: number, b: number): number {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!;
}

export function adjustForContrast(hex: string): string {
  const parsed = parseHex(hex);
  if (!parsed) return hex;
  let [r, g, b] = parsed;
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

/** Weighted HSL distance; hue is circular and weighted higher. */
export function accentColorDistance(hex1: string, hex2: string): number {
  const a = parseHex(hex1);
  const b = parseHex(hex2);
  if (!a || !b) return 1;
  const [h1, s1, l1] = rgbToHsl(...a);
  const [h2, s2, l2] = rgbToHsl(...b);
  const dh = Math.min(Math.abs(h1 - h2), 360 - Math.abs(h1 - h2)) / 180;
  return Math.sqrt(dh * dh * 2.5 + (s1 - s2) ** 2 + (l1 - l2) ** 2);
}

export function isRedFamilyHue(h: number): boolean {
  return h >= 320 || h <= 28;
}

function hexHue(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return rgbToHsl(...rgb)[0];
}

function hexLightness(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0.5;
  return rgbToHsl(...rgb)[2];
}

function minRequiredDistance(hexA: string, hexB: string): number {
  if (isRedFamilyHue(hexHue(hexA)) && isRedFamilyHue(hexHue(hexB))) return MIN_RED_FAMILY_DISTANCE;
  return MIN_ACCENT_DISTANCE;
}

function hexSaturation(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return rgbToHsl(...rgb)[1];
}

function requiredDistanceToAssigned(hex: string, assigned: string[]): number {
  if (!assigned.length) return MIN_ACCENT_DISTANCE;
  return Math.max(
    ...assigned.map((a) => (isRedFamilyHue(hexHue(hex)) && isRedFamilyHue(hexHue(a)) ? MIN_RED_FAMILY_DISTANCE : MIN_ACCENT_DISTANCE)),
  );
}

function pickRedLabelToNudge(keyA: string, hexA: string, keyB: string, hexB: string): string {
  if (hexSaturation(hexA) === hexSaturation(hexB)) {
    return hexLightness(hexA) >= hexLightness(hexB) ? keyA : keyB;
  }
  return hexSaturation(hexA) >= hexSaturation(hexB) ? keyA : keyB;
}

function minDistanceToAssigned(hex: string, assigned: string[]): number {
  if (!assigned.length) return 1;
  return Math.min(...assigned.map((a) => accentColorDistance(hex, a)));
}

/** Prefer steps that move hue toward magenta/pink (for red-on-red clashes). */
function hueNudgeSteps(h: number, preferMagenta: boolean): number[] {
  if (preferMagenta) {
    const target = 332;
    const delta = ((target - h + 540) % 360) - 180;
    const sign = Math.sign(delta) || -1;
    return [
      0,
      sign * 10,
      sign * 18,
      sign * 26,
      sign * 34,
      sign * 42,
      sign * 50,
      sign * 58,
      -sign * 12,
      -sign * 22,
    ];
  }
  return [0, 18, -18, 28, -28, 40, -40, 55, -55, 70];
}

export function separateAccentFromAssigned(hex: string, assigned: string[], preferMagenta = false): string {
  if (!assigned.length) return hex;
  const required = requiredDistanceToAssigned(hex, assigned);
  if (minDistanceToAssigned(hex, assigned) >= required) return hex;

  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [h, s, l] = rgbToHsl(...rgb);
  const anyRedClash =
    preferMagenta ||
    (isRedFamilyHue(h) && assigned.some((a) => isRedFamilyHue(hexHue(a))));

  for (const delta of hueNudgeSteps(h, anyRedClash)) {
    const tryH = (h + delta + 360) % 360;
    const tryHex = adjustForContrast(rgbToHex(...hslToRgb(tryH, Math.min(1, s * 1.02), l)));
    if (minDistanceToAssigned(tryHex, assigned) >= required) return tryHex;
  }

  return hex;
}

export function pickDistinctAccent(candidates: string[], assigned: string[]): string {
  const unique = [...new Set(candidates.map((c) => c.toLowerCase()))];
  if (!unique.length) return "";

  let best = unique[0]!;
  let bestDist = minDistanceToAssigned(best, assigned);

  for (const hex of unique.slice(1)) {
    const d = minDistanceToAssigned(hex, assigned);
    if (d > bestDist) {
      best = hex;
      bestDist = d;
    }
  }

  if (bestDist >= MIN_ACCENT_DISTANCE) return best;
  return separateAccentFromAssigned(best, assigned, isRedFamilyHue(hexHue(best)));
}

/** Resolve pairwise clashes after initial assignment (e.g. two reds from artwork). */
export function harmonizeAccentBatch(accents: Map<string, string>): Map<string, string> {
  const out = new Map(accents);
  const keys = [...out.keys()];

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const keyA = keys[i]!;
        const keyB = keys[j]!;
        const hexA = out.get(keyA)!;
        const hexB = out.get(keyB)!;
        if (accentColorDistance(hexA, hexB) >= minRequiredDistance(hexA, hexB)) continue;

        const hA = hexHue(hexA);
        const hB = hexHue(hexB);
        if (isRedFamilyHue(hA) && isRedFamilyHue(hB)) {
          const nudgeKey = pickRedLabelToNudge(keyA, hexA, keyB, hexB);
          const otherAssigned = keys
            .filter((k) => k !== nudgeKey)
            .map((k) => out.get(k)!)
            .filter(Boolean);
          const adjusted = separateAccentFromAssigned(out.get(nudgeKey)!, otherAssigned, true);
          if (adjusted !== out.get(nudgeKey)) {
            out.set(nudgeKey, adjusted);
            changed = true;
          }
        } else {
          const adjusted = separateAccentFromAssigned(hexB, [hexA]);
          if (adjusted !== hexB) {
            out.set(keyB, adjusted);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  return out;
}

export function rankSwatchRgb(rgb: [number, number, number]): number {
  const [, s, l] = rgbToHsl(...rgb);
  if (s < 0.2) return -1;
  const y = relativeLuminance(...rgb);
  if (y < 0.08 || y > 0.92) return -1;
  return s * 1.4 + (l > 0.2 && l < 0.75 ? 0.25 : 0);
}

export function candidatesFromSwatches(swatches: [number, number, number][]): string[] {
  const ranked = swatches
    .map((rgb) => ({ rgb, score: rankSwatchRgb(rgb) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  const out: string[] = [];
  for (const { rgb } of ranked) {
    const hex = adjustForContrast(rgbToHex(...rgb));
    if (out.some((existing) => accentColorDistance(existing, hex) < 0.08)) continue;
    out.push(hex);
  }
  return out;
}
