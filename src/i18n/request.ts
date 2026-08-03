import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { getCurrentUser } from "@/infrastructure/auth/rbac";
import { getMessages } from "@/infrastructure/i18n/message-loader";
import { makeGetUserLanguagePreferenceUseCase } from "@/application/use-cases/i18n/compose";
import { LOCALE_COOKIE_NAME, LOCALE_HEADER_NAME, toLocale } from "@/shared/i18n/locales";
import { resolveAuthenticatedLocale, resolveGuestLocale } from "@/shared/i18n/negotiate-locale";

/**
 * Module 29 — Internationalization: next-intl's request configuration.
 *
 * This app deliberately does NOT use next-intl's `routing`/
 * `createMiddleware` — there is no `/[locale]/...` URL segment (see the
 * large comment block in `middleware.ts` for why: `callbackUrl`s,
 * `PROTECTED_PREFIXES`, and every stored deep link must not gain a
 * locale segment). This file is next-intl's documented "without i18n
 * routing" entry point instead: it is read once per request by
 * `getRequestConfig`, and its `locale`/`messages` are what
 * `NextIntlClientProvider` (root layout), `getTranslations()`,
 * `getFormatter()` and `getLocale()` (from `next-intl/server`) all
 * resolve against.
 *
 * ## Resolution
 *
 * - **Authenticated**: `User.preferredLocale` (through
 *   `GetUserLanguagePreferenceUseCase`, never Prisma directly) ->
 *   `Accept-Language` -> Spanish.
 * - **Guest**: the `NEXT_LOCALE` cookie (next-intl's own recommended
 *   cookie name for non-routing setups) -> `Accept-Language` -> Spanish.
 *
 * The `x-maestroya-locale` header `middleware.ts` writes is used as the
 * `Accept-Language` step's already-negotiated answer — the Edge
 * middleware has done that parse once per request (it cannot read
 * `User.preferredLocale` itself: Prisma is unavailable on the Edge
 * runtime), and re-doing it here for every request would be wasted work.
 * When the header is absent (routes outside the middleware matcher —
 * `/api/*` — or a unit test), this falls back to parsing
 * `Accept-Language` itself, so no caller ever has to care whether
 * middleware ran.
 *
 * `getRequestConfig`'s own `requestLocale` param (built for the
 * `[locale]` segment case) is intentionally unused — there is no segment
 * to read it from.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  const headerLocale = headerList.get(LOCALE_HEADER_NAME);
  const acceptLanguageHeader = headerList.get("accept-language");
  // The middleware-negotiated header stands in for Accept-Language. It is
  // fed through `toLocale` first — a header can be forged by a client,
  // and an unvalidated value must never reach a catalog lookup.
  const browserSignal = toLocale(headerLocale) ?? acceptLanguageHeader;

  const user = await getCurrentUser();

  const locale = user
    ? resolveAuthenticatedLocale({
        userPreference: await makeGetUserLanguagePreferenceUseCase().execute(user.id),
        acceptLanguage: browserSignal,
      }).locale
    : resolveGuestLocale({
        storedPreference: cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null,
        acceptLanguage: browserSignal,
      }).locale;

  return {
    locale,
    messages: getMessages(locale),
  };
});
