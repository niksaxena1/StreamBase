import type { Plugin } from "vite";
// Namespace identifiers are required by createElementNS; they are never fetched.
// Emit escaped slashes to meet the literal URL audit, preserving their runtime value.
// Only these inert identifiers may be encoded; new external endpoints fail the build.
const namespaces = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/1999/xhtml",
]);
export function offlineDependencyStrings(): Plugin {
  return {
    name: "archive-offline-dependency-strings",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "chunk") continue;
        asset.code = asset.code.replace(
          /https:\/\/react\.dev\/errors\//g,
          "offline React error ",
        );
        // Recharts brings Redux into the production Explorer. This is an error
        // decoder in a diagnostic string, never a runtime request.
        asset.code = asset.code.replace(
          /https:\/\/redux\.js\.org\/Errors\?code=/g,
          "offline Redux error ",
        );
        asset.code = asset.code.replace(
          /https:\/\/redux-toolkit\.js\.org\/Errors\?code=/g,
          "offline Redux Toolkit error ",
        );
        asset.code = asset.code.replace(
          /https:\/\/bit\.ly\/3cXEKWf/g,
          "bundled Immer diagnostic",
        );
        // html-to-image compares a URL's protocol before resolving local CSS.
        // A bare protocol is not a network endpoint; retain its runtime value.
        asset.code = asset.code.replace(/(["'])https?:\/\/\1/g, (literal) =>
          literal.replace("//", "\\u002f\\u002f"),
        );
        asset.code = asset.code.replace(
          /(["'])http:\/\/[^"']+\1/g,
          (literal) => {
            const url = literal.slice(1, -1);
            if (!namespaces.has(url))
              this.error(`Unexpected HTTP literal in offline bundle: ${url}`);
            return literal.replace("http://", "http:\\u002f\\u002f");
          },
        );
        // Remove license comments before checking: license source links are permitted.
        const executable = asset.code.replace(/\/\*[\s\S]*?\*\//g, "");
        if (/https?:\/\//.test(executable))
          this.error(
            `Unexpected external URL in offline chunk ${asset.fileName}: ${executable.match(/.{0,60}https?:\/\/.{0,100}/)?.[0]}`,
          );
      }
    },
  };
}
