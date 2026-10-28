import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { isDesktop } from "@/lib/desktop";
import { deviceStorageReady } from "@/lib/offline";

export const getRouter = () => {
  // Restoring the local database is the first thing that must happen: it feeds
  // the snapshot the workspace reads before its first query. Starting it here
  // (rather than in a component) wins the milliseconds the auth check spends on
  // the network.
  if (typeof window !== "undefined") void deviceStorageReady();

  // A POS terminal is not a website: it must never re-hit the database just
  // because the window regained focus, a component remounted, or someone
  // refreshed the page. Freshness comes from targeted invalidation after
  // writes (and delta polling on the live screens), not from the zero-stale
  // default. Slow-changing reference data raises its staleTime per query, and
  // the persisted snapshot rehydrates with its original fetch time, so a
  // reload inside these windows costs no reads.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        // Reads are idempotent; one retry rides out a Wi-Fi blip without
        // stacking duplicate requests behind a slow connection.
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // The packaged app is a folder of static files with no server to rewrite a
    // deep link, so its routes live after the hash (`#/app/reports`). Every
    // reload then asks for `index.html` only, while the website keeps clean
    // paths and real URLs for search engines.
    ...(typeof window !== "undefined" && isDesktop() ? { history: createHashHistory() } : {}),
    // There are no route loaders yet; this keeps a future preloaded route from
    // re-running its loader on every hover/click. Auth checks are memoized too.
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
