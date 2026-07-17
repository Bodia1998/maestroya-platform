"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";

import { createQueryClient } from "@/lib/query-client";

/**
 * Client-side provider boundary.
 *
 * This is intentionally the *only* "use client" boundary at the root of
 * the tree. Everything rendered inside {children} still defaults to
 * Server Components — wrapping children in a client Provider does not
 * make them client components themselves (React Server Components can be
 * passed as `children` to a Client Component and still render on the
 * server). Do not add more root-level client providers without a reason;
 * each one is a potential hydration/bundle-size cost.
 *
 * `useState` (not a module-level singleton) for the QueryClient is
 * deliberate — it avoids sharing cached data between different users'
 * requests when this component renders on the server before hydrating.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
