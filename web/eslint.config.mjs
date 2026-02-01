import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Debt-taming: keep important correctness rules as errors, but don't block
  // merges on legacy patterns while we pay them down incrementally.
  {
    rules: {
      // Useful signal, but too noisy for this codebase right now.
      "react-hooks/set-state-in-effect": "warn",
      // Too many legacy any's; warn for now, fix incrementally.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["src/lib/sai/**/*.{ts,tsx}", "src/lib/supabase/cache.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
