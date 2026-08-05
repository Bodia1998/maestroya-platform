"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { SessionProvider } from "next-auth/react";
import type { AbstractIntlMessages } from "use-intl/core";
import { useState } from "react";

import { I18nProvider } from "@/components/shared/i18n-provider";
import { Toaster } from "@/components/ui/toast";
import type { Locale } from "@/shared/i18n/locales";

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
export interface ProvidersProps {
  children: React.ReactNode;
  /**
   * Module 29 — Internationalization. Resolved on the *server*
   * (`src/i18n/request.ts`, read in the root layout via `getLocale()`/
   * `getMessages()` from `next-intl/server`) and passed down, never
   * re-resolved here: the client must render the first pass with exactly
   * the messages the server used, or React reports a hydration mismatch
   * on every translated string. This is `NextIntlClientProvider`'s own
   * documented contract, which `I18nProvider` forwards to.
   */
  locale: Locale;
  messages: AbstractIntlMessages;
  isAuthenticated: boolean;
}

export function Providers({ children, locale, messages, isAuthenticated }: ProvidersProps) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {/* Innermost of the three so that a language switch's
            `router.refresh()` re-renders the tree without tearing down
            the session or the query cache above it. */}
        <I18nProvider locale={locale} messages={messages} isAuthenticated={isAuthenticated}>
          {children}
        </I18nProvider>
        <Toaster />
        {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </SessionProvider>
  );
}
