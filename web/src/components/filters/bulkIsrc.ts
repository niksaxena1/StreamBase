export function parseBulkIsrcInput(input: string): {
  isrcs: string[];
  duplicateCount: number;
} {
  const tokens = input
    .split(/[\s,]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  const seen = new Set<string>();
  const isrcs: string[] = [];
  let duplicateCount = 0;

  for (const isrc of tokens) {
    if (seen.has(isrc)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(isrc);
    isrcs.push(isrc);
  }

  return { isrcs, duplicateCount };
}
