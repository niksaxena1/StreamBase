/** Relative luminance (WCAG) for sRGB hex without #. */
export function relativeLuminanceFromHex(hex: string): number {
  const clean = hex.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(clean)) return 0.5;
  const srgb = [0, 2, 4].map((i) => {
    const c = parseInt(clean.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!;
}

/** Readable text on top of --sb-accent fills. */
export function accentTextColor(hex: string): "#000" | "#fff" {
  return relativeLuminanceFromHex(hex) > 0.55 ? "#000" : "#fff";
}

function mixTowardWhite(r: number, g: number, b: number, amount: number): [number, number, number] {
  return [
    Math.round(r + (255 - r) * amount),
    Math.round(g + (255 - g) * amount),
    Math.round(b + (255 - b) * amount),
  ];
}

/** Build CSS variable overrides for a 6-char hex accent (no #). */
export function competitorAccentCssVars(hex: string): string {
  const clean = hex.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(clean)) return "";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const [softLightR, softLightG, softLightB] = mixTowardWhite(r, g, b, 0.35);
  const [softDarkR, softDarkG, softDarkB] = mixTowardWhite(r, g, b, 0.22);
  const text = accentTextColor(clean);
  return [
    `--sb-accent:#${clean}`,
    `--sb-accent-stroke:#${clean}`,
    `--sb-accent-text:${text}`,
    `--sb-accent-soft-light:rgb(${softLightR},${softLightG},${softLightB})`,
    `--sb-accent-soft-dark:rgb(${softDarkR},${softDarkG},${softDarkB})`,
    `--sb-accent-10:rgba(${r},${g},${b},0.1)`,
    `--sb-accent-20:rgba(${r},${g},${b},0.2)`,
  ].join(";");
}
