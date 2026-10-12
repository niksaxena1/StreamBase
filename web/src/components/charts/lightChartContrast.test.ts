import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read the actual light CSS values; composite alpha before computing WCAG luminance.
const root = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8").split(":root {")[1].split("\n}")[0];
function token(name: string): number[] {
  const value = root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`Missing token ${name}`);
  if (value.startsWith("#")) return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)).concat(1);
  return value.match(/[\d.]+/g)!.map(Number);
}
function composite(fg: number[], bg: number[]) {
  return fg.slice(0, 3).map((v, i) => v * (fg[3] ?? 1) + bg[i] * (1 - (fg[3] ?? 1))).concat(1);
}
function luminance(rgb: number[]) {
  return rgb.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
describe("light chart token contrast", () => {
  for (const background of ["--sb-bg", "--sb-card", "--sb-surface"]) {
    for (const [name, minimum] of [
      ["--sb-positive", 3], ["--sb-positive-muted", 3], ["--sb-revenue", 3], ["--sb-tracks", 3],
      ["--sb-warning", 4.5], ["--sb-error", 4.5], ["--sb-info", 3],
      ["--sb-chart-label", 4.5], ["--sb-text", 4.5],
      ["--sb-chart-ma", 3], ["--sb-muted", 4.5],
    ] as const) {
      it(`${name} reaches ${minimum}:1 on ${background}`, () => {
        const bg = composite(token(background), token("--sb-bg"));
        const a = luminance(composite(token(name), bg));
        const b = luminance(bg);
        expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(minimum);
      });
    }
  }
});
