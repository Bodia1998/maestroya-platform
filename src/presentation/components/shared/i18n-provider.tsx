"use client";

import { NextIntlClientProvider } from "next-intl";
import type { AbstractIntlMessages } from "use-intl/core";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";

import type { Locale } from "@/shared/i18n/locales";
import { persistLocale } from "@/shared/i18n/locale-storage";

/**
 * Module 29 — Internationalization: the client-side switch-state
 * provider, wrapping next-intl's own `NextIntlClientProvider`.
 *
 * Translations and formatting are now next-intl's job everywhere —
 * `useTranslations`/`useLocale`/`useFormatter` from `next-intl` read
 * directly from `NextIntlClientProvider`'s context, no wrapper needed.
 * What next-intl does *not* provide, and what this file exists for, is
 * the app's own language-*switching* UX: an instant optimistic locale
 * flip, the fire-and-forget `PATCH /api/user/language` write for signed-in
 * users, and the pending/failed state the switcher renders.
 *
 * ## How a switch produces an instant, refresh-free update
 *
 * The root layout resolves the locale + messages on the server (via
 * `src/i18n/request.ts`) and passes them down as props to `Providers`,
 * which hands them straight to `NextIntlClientProvider`. When the user
 * picks a language, `setLocale`:
 *
 * 1. writes the `NEXT_LOCALE` cookie + `localStorage` synchronously
 *    (`persistLocale`), so the very next server render already sees the
 *    new choice;
 * 2. fires the `PATCH /api/user/language` write for signed-in users
 *    (fire-and-forget — the UI must not wait on a round trip to change
 *    language, and the cookie already carries the choice if it fails);
 * 3. calls `router.refresh()` inside a transition.
 *
 * `router.refresh()` re-fetches the current route's RSC payload — root
 * layout included — so `src/i18n/request.ts` re-resolves the locale from
 * the now-updated cookie and every Server Component re-renders in the
 * new language, with no full page load, no locale URL segment (this app
 * deliberately has none — see `middleware.ts`), no lost client state, no
 * re-mount, and no effect on the session.
 *
 * `optimisticLocale` covers the gap: everything driven by `useI18n()`
 * (the checkmark in the switcher, `isSwitching`) flips the instant the
 * user clicks, before the refresh lands. Message *strings* — which come
 * from the server-provided `messages` prop, not from this context — only
 * update once the refresh lands.
 */

export interface I18nContextValue {
  /** The optimistic locale — flips instantly on click, ahead of the server refresh. */
  locale: Locale;
  /** True while a language switch is in flight. Drives the pending UI. */
  isSwitching: boolean;
  /**
   * True when the last switch could not be written to the account. The UI
   * is still in the requested language (the cookie succeeded); only
   * cross-device persistence failed, which is why this is a surfaced flag
   * rather than a thrown error.
   */
  switchFailed: boolean;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  locale: Locale;
  messages: AbstractIntlMessages;
  /**
   * Whether to also persist to the database. Passed down from the server
   * (which already knows the session) rather than read from
   * `useSession()` here, so the provider stays independent of next-auth
   * and renders identically on server and client.
   */
  isAuthenticated: boolean;
  children: React.ReactNode;
}

export function I18nProvider({ locale, messages, isAuthenticated, children }: I18nProviderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticLocale, setOptimisticLocale] = useState<Locale | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);

  // Once the server-rendered `locale` prop catches up with the optimistic
  // one, the optimistic value is redundant — but it is never *wrong*, so
  // it is simply preferred while set. Clearing it in an effect would add
  // an extra render for no benefit.
  const effectiveLocale = optimisticLocale ?? locale;

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === effectiveLocale) return;

      setOptimisticLocale(next);
      setSwitchFailed(false);
      persistLocale(next);

      if (isAuthenticated) {
        void fetch("/api/user/language", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale: next }),
        })
          .then((response) => {
            if (!response.ok) setSwitchFailed(true);
          })
          .catch(() => {
            // Never rethrown. The cookie has already been written, so the
            // UI *is* in the requested language either way; the only loss
            // is cross-device persistence. Surfaced as `switchFailed` so
            // the Settings page can say so, and ignored by the header
            // switcher, where an error banner would be noise.
            setSwitchFailed(true);
          });
      }

      startTransition(() => {
        router.refresh();
      });
    },
    [effectiveLocale, isAuthenticated, router],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale: effectiveLocale,
      isSwitching: isPending,
      switchFailed,
      setLocale,
    }),
    [effectiveLocale, isPending, switchFailed, setLocale],
  );

  return (
    <I18nContext.Provider value={value}>
      <NextIntlClientProvider locale={effectiveLocale} messages={messages}>
        {children}
      </NextIntlClientProvider>
    </I18nContext.Provider>
  );
}

/**
 * Throws rather than silently defaulting when the provider is missing.
 * A switcher rendering with no pending/failed state because a provider
 * was forgotten is a bug that reaches production; a thrown error is one
 * that reaches the first render in development.
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside <I18nProvider>. Check the root layout.");
  }
  return context;
}
