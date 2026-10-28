// Desktop build: the same app as a static single-page bundle for the Tauri shell
// in `storqdesktop/`. No Nitro, no SSR — Tauri serves `dist-desktop/client/` from
// disk, so every route must be reachable from one `index.html`.
//
// Differences from the web build (vite.config.ts):
//   - `nitro: false` skips the server output; a packaged till has no server.
//   - SPA mode prerenders one shell that the webview boots for every route.
//   - Hash routing (see src/router.tsx) keeps deep links reloadable: the webview
//     asks the asset protocol for `index.html` only, never for `/app/reports`.
//   - The two billing server functions are swapped for calls to the deployed web
//     API (`src/lib/billing.desktop.ts`), because there is no server to run them.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const desktopBilling = fileURLToPath(
  new URL("./src/lib/billing.desktop.ts", import.meta.url),
).replace(/\\/g, "/");

/**
 * True for the billing server-function module, however it arrives: the bare
 * specifier, or the absolute path the resolver already turned `@/` into before
 * this plugin runs (Vite resolves tsconfig paths natively).
 */
function isBillingFunctions(id: string): boolean {
  const path = id.split("?")[0].replace(/\\/g, "/");
  return (
    path === "@/lib/billing.functions" ||
    path.endsWith("/src/lib/billing.functions") ||
    path.endsWith("/src/lib/billing.functions.ts")
  );
}

// The origin the packaged app calls for payments and for its own download link.
// It is compiled in: a webview has no way to discover a deployment at runtime.
const API_ORIGIN = (
  process.env["VITE_DESKTOP_API_ORIGIN"] ||
  process.env["VITE_SITE_URL"] ||
  "https://storq.xyz"
).replace(/\/+$/, "");

export default defineConfig({
  nitro: false,
  tanstackStart: {
    server: { entry: "server" },
    spa: {
      enabled: true,
      // The page the webview opens is prerendered from `src/routes/shell.tsx`,
      // which renders nothing: the marketing landing page would otherwise flash
      // in the window before the router settles on the workspace.
      maskPath: "/shell",
      // Emit the shell as `index.html` at the root of the bundle so the Tauri
      // asset protocol can serve it without a path-rewriting layer.
      prerender: { outputPath: "/index.html", crawlLinks: false },
    },
    sitemap: { enabled: false },
  },
  vite: {
    plugins: [
      {
        // A packaged app cannot run `createServerFn`: the stub would POST to a
        // route that does not exist on `tauri.localhost`. Swapping the import for
        // the desktop module keeps the same call shape in Billing and ops.
        //
        // This is a `resolveId` hook rather than `resolve.alias` because the
        // tsconfig paths plugin also answers for `@/*` and would win the match
        // first, silently shipping the server-function bundle in the installer.
        name: "storq:desktop-billing",
        enforce: "pre",
        resolveId(id) {
          if (isBillingFunctions(id)) return desktopBilling;
          return null;
        },
      },
    ],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        process.env["VITE_SUPABASE_URL"] || "https://gtkfczmudhzhbdooftsa.supabase.co",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0a2Zjem11ZGh6aGJkb29mdHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDAwMzcsImV4cCI6MjEwNjkxNjAzN30.60j4606POwzMRuC-wDZdEwRf-J9sSuEWj7-2SYqL45E",
      ),
      "import.meta.env.VITE_SITE_URL": JSON.stringify(API_ORIGIN),
      "import.meta.env.VITE_DESKTOP_API_ORIGIN": JSON.stringify(API_ORIGIN),
      "import.meta.env.VITE_DESKTOP": JSON.stringify("1"),
    },
    build: {
      outDir: "dist-desktop",
      emptyOutDir: true,
    },
    // Must match `build.devUrl` in storqdesktop/src-tauri/tauri.conf.json, or
    // `tauri dev` waits on a window that never finds its own dev server.
    server: {
      port: 8080,
      strictPort: true,
    },
    optimizeDeps: {
      include: [
        "@supabase/supabase-js",
        "@tanstack/react-query",
        "jspdf",
        "jspdf-autotable",
        "recharts",
      ],
    },
  },
});
