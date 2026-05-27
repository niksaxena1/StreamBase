/**
 * Estimate object-position for competitor label thumbs (optical center in square crop).
 * Usage: cd web && npx tsx scripts/analyze-competitor-thumb-fit.ts
 */

import sharp from "sharp";

const LABELS: { label_key: string; url: string }[] = [
  {
    label_key: "atlast",
    url: "https://image-cdn-fa.spotifycdn.com/image/ab67706c0000da84346926a096c054efd94c0c68",
  },
  {
    label_key: "chillyourmind",
    url: "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000d72c7ab90d72c6d4ab3718ac3e11",
  },
  {
    label_key: "paraiso",
    url: "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da84ca02c8484311ed9d39f2ad4a",
  },
  {
    label_key: "selected",
    url: "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da84a30aae43934dd61a40d774fc",
  },
  {
    label_key: "soave",
    url: "https://image-cdn-fa.spotifycdn.com/image/ab67706c0000d72ca2649342a039f85f4059bd2d",
  },
];

const SIZE = 128;

async function centroidForUrl(url: string): Promise<{ x: number; y: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(raw)
    .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const corners = [
    pixel(data, info, 2, 2),
    pixel(data, info, SIZE - 3, 2),
    pixel(data, info, 2, SIZE - 3),
    pixel(data, info, SIZE - 3, SIZE - 3),
  ];
  const bg = averageRgb(corners);

  let sumX = 0;
  let sumY = 0;
  let weight = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const p = pixel(data, info, x, y);
      const dist = colorDist(p, bg);
      if (dist < 28) continue;
      const w = Math.min(255, dist);
      sumX += x * w;
      sumY += y * w;
      weight += w;
    }
  }

  if (weight < 1) return { x: 50, y: 50 };
  return {
    x: Math.round((sumX / weight / (info.width - 1)) * 1000) / 10,
    y: Math.round((sumY / weight / (info.height - 1)) * 1000) / 10,
  };
}

function pixel(
  data: Buffer,
  info: { width: number; channels: number },
  x: number,
  y: number,
): [number, number, number, number] {
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!, info.channels === 4 ? data[i + 3]! : 255];
}

function averageRgb(samples: [number, number, number, number][]): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const s of samples) {
    r += s[0];
    g += s[1];
    b += s[2];
  }
  const n = samples.length;
  return [r / n, g / n, b / n];
}

function colorDist(p: [number, number, number, number], bg: [number, number, number]): number {
  return Math.sqrt((p[0] - bg[0]) ** 2 + (p[1] - bg[1]) ** 2 + (p[2] - bg[2]) ** 2);
}

async function main() {
  const out: Record<string, string> = {};
  for (const { label_key, url } of LABELS) {
    const c = await centroidForUrl(url);
    const snappedX = Math.round(c.x / 2) * 2;
    const snappedY = Math.round(c.y / 2) * 2;
    out[label_key] = `${snappedX}% ${snappedY}%`;
    console.log(`${label_key}: centroid ${c.x}% ${c.y}% -> object-position ${out[label_key]}`);
  }
  console.log("\nexport const COMPETITOR_LABEL_THUMB_OBJECT_POSITION:", JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
