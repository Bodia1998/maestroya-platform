import { QueryClient } from "@tanstack/react-query";

/**
 * Factory (not a singleton export) so `providers.tsx` can create a fresh
 * client per request on the server, while the browser keeps one instance
 * across the session via `useState`.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Avoid an immediate refetch on mount right after SSR hydration.
        staleTime: 60 * 1000,
      },
    },
  });
}
