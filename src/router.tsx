import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // A POS terminal is not a website: it must never re-hit the database just
  // because the window regained focus or a component remounted. Freshness
  // comes from targeted invalidation after writes (and delta polling on the
  // live screens), not from the zero-stale default. Slow-changing reference
  // data (catalog, collections, stores) raises its staleTime per query.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
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
    defaultPreloadStaleTime: 0,
  });

  return router;
};
