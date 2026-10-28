import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      // Build output
      "dist",
      "dist-desktop",
      ".output",
      ".vinxi",
      // The Tauri shell embeds the built bundle into its Rust target directory,
      // which is build output, not source.
      "storqdesktop/src-tauri/target",
      "storqdesktop/src-tauri/gen",
      // Tool-managed state and agent scratch space
      ".wrangler",
      ".tanstack",
      ".qoder",
      ".lovable",
      "tmp",
      // Not application source
      "public",
      "supabase",
      // Auto-generated: Lovable Cloud rewrites the Supabase integration files,
      // and shadcn/ui primitives are vendored — neither should be hand-linted.
      "src/integrations/supabase",
      "src/components/ui",
      "src/routeTree.gen.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Build and tooling config runs in Node, not in the browser.
    files: ["*.config.{js,ts,mjs}", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
  // Keep this last. It switches off every rule Prettier owns, so `bun run lint`
  // reports real defects only and `bun run format:check` owns code style.
  // Formatting used to surface as thousands of `prettier/prettier` lint errors,
  // which buried genuine problems and made lint slower than the build.
  prettier,
);
