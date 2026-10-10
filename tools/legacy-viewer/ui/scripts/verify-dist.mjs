import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
}
walk("dist");
const hits = [],
  nonLicenseHits = [];
for (const file of files.filter((file) => /\.(js|css|html|txt)$/.test(file))) {
  const text = readFileSync(file, "utf8");
  for (const url of text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])
    hits.push({ file, url });
  if (/https?:\/\//.test(text.replace(/\/\*[\s\S]*?\*\//g, "")))
    nonLicenseHits.push(file);
  if (
    /\.js$/.test(file) &&
    /Component gallery|Synthetic artist|synthetic event|__gallery/.test(text)
  )
    throw new Error(`Development gallery leaked into ${file}`);
}
const fonts = files.filter((file) => file.endsWith(".woff2"));
if (
  !fonts.some((file) => file.includes("inter-")) ||
  !fonts.some((file) => file.includes("space-grotesk-")) ||
  !fonts.some((file) => file.includes("geist-mono-"))
)
  throw new Error("A required bundled font is missing");
const html = readFileSync("dist/index.html", "utf8");
if (/(?:src|href)="\/assets\//.test(html) || !html.includes("./assets/"))
  throw new Error("Asset paths are not relative");
const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
const js = files.filter((file) => file.endsWith(".js")),
  css = files.filter((file) => file.endsWith(".css"));
console.log(
  JSON.stringify(
    {
      files: files.length,
      totalBytes: total,
      jsBytes: js.reduce((sum, file) => sum + statSync(file).size, 0),
      jsGzipBytes: js.reduce(
        (sum, file) => sum + gzipSync(readFileSync(file)).length,
        0,
      ),
      cssBytes: css.reduce((sum, file) => sum + statSync(file).size, 0),
      woff2Files: fonts.length,
      literalUrlHits: hits,
      galleryInProduction: false,
    },
    null,
    2,
  ),
);
if (nonLicenseHits.length)
  throw new Error(`Unexpected literal URLs: ${nonLicenseHits.join(", ")}`);
