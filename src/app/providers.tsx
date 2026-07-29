"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { SessionProvider } from "next-auth/react";
import { useState } from "react";

import { createQueryClient } from "@/lib/query-client";

/**
 * Client-side provider boundary.
 *
 * This is intentionally the *only* place root-level client providers are
 * added. Everything rendered inside {children} still defaults to Server
 * Components — wrapping children in a client Provider does not make them
 * client components themselves (React Server Components can be passed as
 * `children` to a Client Component and still render on the server). Do
 * not add more root-level client providers without a reason; each one is
 * a potential hydration/bundle-size cost.
 *
 * `SessionProvider` (from `next-auth/react`) wraps the tree because
 * Auth.js v5's docs list it as required infrastructure for *any*
 * `next-auth/react` client API — `signIn()`, `signOut()`, `useSession()`
 * — used anywhere in the app (see `login-form.tsx`'s `signIn("credentials", ...)`
 * call). It was missing here; this app had never had it. No `session`
 * prop is passed (no server-fetched session available at this boundary),
 * so it fetches its own on mount — the documented, supported default.
 *
 * `useState` (not a module-level singleton) for the QueryClient is
 * deliberate — it avoids sharing cached data between different users'
 * requests when this component renders on the server before hydrating.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV === "development" && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
      </QueryClientProvider>
    </SessionProvider>
  );
}
