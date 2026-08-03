"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";

import type { LocaleCatalog, Namespace } from "@/infrastructure/i18n/message-loader";
import { DEFAULT_LOCALE, type Locale } from "@/shared/i18n/locales";
import { persistLocale } from "@/shared/i18n/locale-storage";
import { createTranslator, type Translator } from "@/shared/i18n/translator";
import { createLocaleFormatter, type LocaleFormatter } from "@/shared/utils/intl-format";

/**
 * Module 29 — Internationalization: the client-side counterpart of
 * `server-locale.ts`.
 *
 * ## How a switch produces an instant, refresh-free update
 *
 * The provider never loads message files itself. The root layout resolves
 * the locale on the server and passes `{ locale, messages }` down as
 * props (the same shape `next-intl`'s `NextIntlClientProvider` takes).
 * When the user picks a language, `setLocale`:
 *
 * 1. writes `localStorage` + the mirror cookie synchronously, so the very
 *    next server render already sees the new choice;
 * 2. fires the `PATCH /api/user/language` write for signed-in users
 *    (fire-and-forget — the UI must not wait on a round trip to change
 *    language, and the cookie already carries the choice if it fails);
 * 3. calls `router.refresh()` inside a transition.
 *
 * `router.refresh()` re-fetches the current route's RSC payload — root
 * layout included — so the server re-renders every Server Component *and*
 * re-sends this provider's `messages` prop in the new language, with no
 * full page load, no lost client state, no re-mount, and no effect
 * whatsoever on the session (the user is never signed out).
 *
 * `optimisticLocale` covers the gap: `locale` and everything derived from
 * it (`<html lang>`, formatters, the checkmark in the switcher) flips the
 * instant the user clicks, before the refresh lands. Message *strings*
 * arrive with the refresh a moment later — see
 * docs/MODULE_29_INTERNATIONALIZATION.md §10 for why shipping all ten
 * catalogs to the client to close that last gap is a deliberate no.
 */

export interface I18nContextValue {
  locale: Locale;
  messages: LocaleCatalog;
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
  messages: LocaleCatalog;
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
      messages,
      isSwitching: isPending,
      switchFailed,
      setLocale,
    }),
    [effectiveLocale, messages, isPending, switchFailed, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Throws rather than silently defaulting when the provider is missing.
 * A Client Component rendering untranslated text because a provider was
 * forgotten is a bug that reaches production; a thrown error is one that
 * reaches the first render in development.
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside <I18nProvider>. Check the root layout.");
  }
  return context;
}

/** `useTranslations("settings")` — same signature as its server twin. */
export function useTranslations(namespace: Namespace): Translator {
  const { locale, messages } = useI18n();
  return useMemo(
    () => createTranslator({ locale, namespace, messages: messages[namespace] }),
    [locale, messages, namespace],
  );
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useFormatter(): LocaleFormatter {
  const { locale } = useI18n();
  return useMemo(() => createLocaleFormatter(locale), [locale]);
}

export { DEFAULT_LOCALE };
