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
