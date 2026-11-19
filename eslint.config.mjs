import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Syncing from external sources (localStorage, URL-driven fetches, media queries) legitimately sets
      // state in effects; keep it visible as a warning rather than blocking.
      "react-hooks/set-state-in-effect": "warn",
      // TanStack Table and react-hook-form's watch() are not compiler-compatible; that is expected.
      "react-hooks/incompatible-library": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "storage/**",
  ]),
]);

export default eslintConfig;
