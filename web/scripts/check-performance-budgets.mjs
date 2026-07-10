import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const chunkRoot = path.join(root, ".next", "static", "chunks");
const limits = {
  maxChunkBytes: 450_000,
  maxPageChunkBytes: 250_000,
  maxClientComponentLines: 3_650,
};

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
      }),
    )
  ).flat();
}

const failures = [];
for (const file of (await walk(chunkRoot)).filter((file) =>
  file.endsWith(".js"),
)) {
  const bytes = (await stat(file)).size;
  const isPage = path.basename(file).startsWith("page-");
  const limit = isPage ? limits.maxPageChunkBytes : limits.maxChunkBytes;
  if (bytes > limit)
    failures.push(
      `${path.relative(root, file)} is ${bytes} bytes (budget ${limit})`,
    );
}

for (const file of (await walk(path.join(root, "src"))).filter((file) =>
  file.endsWith(".tsx"),
)) {
  const source = await readFile(file, "utf8");
  if (!/^['\"]use client['\"];?/m.test(source)) continue;
  const lines = source.split(/\r?\n/).length;
  if (lines > limits.maxClientComponentLines)
    failures.push(
      `${path.relative(root, file)} is ${lines} lines (budget ${limits.maxClientComponentLines})`,
    );
}

if (failures.length) {
  console.error(`Performance budgets failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Performance budgets passed.");
