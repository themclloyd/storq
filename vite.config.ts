// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Fallback for hosted builds that run without .env (it is git-ignored):
    // inline the PUBLIC backend URL + publishable key so the browser bundle
    // never ships empty and blank-screens. These are safe to publish.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        process.env["VITE_SUPABASE_URL"] || "https://gtkfczmudhzhbdooftsa.supabase.co",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0a2Zjem11ZGh6aGJkb29mdHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDAwMzcsImV4cCI6MjEwNjkxNjAzN30.60j4606POwzMRuC-wDZdEwRf-J9sSuEWj7-2SYqL45E",
      ),
    },
    optimizeDeps: {
      // Pre-bundle the libraries the route graph only reaches after the first
      // navigation. Discovering one mid-session makes Vite optimise deps again
      // and force-reload the page, which reads as the app "loading slowly" twice.
      include: [
        "@supabase/supabase-js",
        "@tanstack/react-query",
        "jspdf",
        "jspdf-autotable",
        "recharts",
      ],
    },
    server: {
      warmup: {
        // Transform the router and every route/component module as the server
        // boots, so the first browser request is served from cache instead of
        // compiling the graph on demand. Both halves matter: the document is
        // rendered by the SSR graph (that was the ~3.5s wait on the first
        // request after `dev` prints its URL), and the hydration scripts come
        // from the client graph.
        clientFiles: ["./src/router.tsx", "./src/routes/**/*.tsx", "./src/components/**/*.tsx"],
        ssrFiles: ["./src/server.ts", "./src/router.tsx", "./src/routes/**/*.tsx"],
      },
    },
  },
});
