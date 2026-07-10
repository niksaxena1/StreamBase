import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const report = path.join(tmpdir(), `streambase-eslint-${process.pid}.json`);
const eslintBin = path.join(
  process.cwd(),
  "node_modules",
  "eslint",
  "bin",
  "eslint.js",
);
const result = spawnSync(
  process.execPath,
  [eslintBin, ".", "--format", "json", "--output-file", report],
  { stdio: "inherit" },
);
if (result.status !== 0 && !existsSync(report))
  process.exit(result.status ?? 1);
const files = JSON.parse(readFileSync(report, "utf8"));
rmSync(report, { force: true });
const errors = files.reduce((sum, file) => sum + file.errorCount, 0);
const warnings = files.reduce((sum, file) => sum + file.warningCount, 0);
const warningBudget = 224;
if (errors || warnings > warningBudget) {
  console.error(
    `Lint budget failed: ${errors} errors, ${warnings} warnings (warning budget ${warningBudget}).`,
  );
  process.exit(1);
}
console.log(
  `Lint budget passed: ${errors} errors, ${warnings}/${warningBudget} warnings.`,
);
