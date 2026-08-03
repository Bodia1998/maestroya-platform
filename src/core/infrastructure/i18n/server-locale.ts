import { cache } from "react";
import { cookies, headers } from "next/headers";

import { getCurrentUser } from "@/infrastructure/auth/rbac";
import {
  getMessages,
  getNamespaceMessages,
  type Namespace,
} from "@/infrastructure/i18n/message-loader";
import { makeGetUserLanguagePreferenceUseCase } from "@/application/use-cases/i18n/compose";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
  toLocale,
  type Locale,
} from "@/shared/i18n/locales";
import {
  resolveAuthenticatedLocale,
  resolveGuestLocale,
  type ResolvedLocale,
} from "@/shared/i18n/negotiate-locale";
import { createTranslator, type Translator } from "@/shared/i18n/translator";
import { createLocaleFormatter, type LocaleFormatter } from "@/shared/utils/intl-format";

/**
 * Module 29 — Internationalization: the server-side entry point.
 *
 * This is the *only* place a Server Component, Server Action or Route
 * Handler reads "which language is this request in" — the same role
 * `rbac.ts`'s `getCurrentUser()` plays for identity, and it is
 * intentionally built on top of it rather than calling `auth()` again.
 *
 * ## Resolution
 *
 * - **Authenticated**: `User.preferredLocale` (through
 *   `GetUserLanguagePreferenceUseCase`, never Prisma directly) ->
 *   `Accept-Language` -> Spanish.
 * - **Guest**: the `maestroya_locale` cookie (the server-readable mirror
 *   of `localStorage`) -> `Accept-Language` -> Spanish.
 *
 * The `x-maestroya-locale` header that `middleware.ts` writes is used as
 * the `Accept-Language` step's already-negotiated answer — the Edge
 * middleware has done that parse once per request, and re-doing it in
 * every Server Component would be wasted work. When the header is absent
 * (routes outside the middleware matcher — `/api/*` — or a unit test),
 * this falls back to parsing `Accept-Language` itself, so no caller ever
 * has to care whether middleware ran.
 *
 * ## Why `cache()`
 *
 * A page renders many Server Components, each of which may want
 * translations. Without React's per-request `cache()`, an authenticated
 * request would issue one `SELECT preferredLocale` per component.
 * `cache()` collapses that to one query per request, which is the whole
 * cost of DB-backed language preference: a single indexed primary-key
 * lookup. See docs/MODULE_29_INTERNATIONALIZATION.md §4.
 */

async function readRequestSignals(): Promise<{
  cookieLocale: string | null;
  headerLocale: string | null;
  acceptLanguage: string | null;
}> {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
  return {
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null,
    headerLocale: headerList.get(LOCALE_HEADER_NAME),
    acceptLanguage: headerList.get("accept-language"),
  };
}

export interface RequestLocaleContext extends ResolvedLocale {
  /**
   * Whether the request carries a session. Returned alongside the locale
   * (rather than making callers re-read the session) because the root
   * layout needs both, and `auth()` is not free.
   */
  isAuthenticated: boolean;
}

export const resolveRequestLocale = cache(async (): Promise<RequestLocaleContext> => {
  const { cookieLocale, headerLocale, acceptLanguage } = await readRequestSignals();

  // The middleware-negotiated header stands in for Accept-Language. It is
  // fed through `toLocale` first — a header can be forged by a client,
  // and an unvalidated value must never reach a catalog lookup.
  const negotiatedFromBrowser = toLocale(headerLocale);
  const browserSignal = negotiatedFromBrowser ?? acceptLanguage;

  const user = await getCurrentUser();
  if (user) {
    const userPreference = await makeGetUserLanguagePreferenceUseCase().execute(user.id);
    return {
      ...resolveAuthenticatedLocale({ userPreference, acceptLanguage: browserSignal }),
      isAuthenticated: true,
    };
  }

  return {
    ...resolveGuestLocale({ storedPreference: cookieLocale, acceptLanguage: browserSignal }),
    isAuthenticated: false,
  };
});

/** The negotiated locale for the current request. */
export async function getRequestLocale(): Promise<Locale> {
  const { locale } = await resolveRequestLocale();
  return locale;
}

/**
 * Server-side `t()`. Mirrors `useTranslations(namespace)` in Client
 * Components so a string moves between a server and a client component
 * without its call site changing.
 */
export async function getTranslations(namespace: Namespace): Promise<Translator> {
  const locale = await getRequestLocale();
  return createTranslator({
    locale,
    namespace,
    messages: getNamespaceMessages(locale, namespace),
  });
}

/** Server-side date/number/currency/relative-time formatting. */
export async function getFormatter(): Promise<LocaleFormatter> {
  return createLocaleFormatter(await getRequestLocale());
}

/**
 * Everything the client provider needs to hydrate: the resolved locale
 * plus the full merged catalog for it. Read once in the root layout and
 * passed down as props — never re-resolved on the client, which is what
 * keeps the server-rendered HTML and the first client render identical.
 */
export async function getI18nBootstrap(): Promise<{
  locale: Locale;
  messages: ReturnType<typeof getMessages>;
  isAuthenticated: boolean;
}> {
  const { locale, isAuthenticated } = await resolveRequestLocale();
  return { locale, messages: getMessages(locale), isAuthenticated };
}

export { DEFAULT_LOCALE };
export type { Namespace };
