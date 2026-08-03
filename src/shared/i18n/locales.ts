/**
 * Module 29 — Internationalization: the single source of truth for which
 * interface languages this platform ships.
 *
 * Deliberately dependency-free and framework-free (no React, no Next, no
 * `server-only`) so the exact same list can be imported from a Server
 * Component, a Client Component, `middleware.ts` (Edge runtime), a Route
 * Handler, a Zod schema, and a plain unit test — there must never be two
 * competing lists of "supported languages" in this codebase.
 *
 * ## Adding a language
 *
 * 1. add its code to `SUPPORTED_LOCALES` below,
 * 2. add its entry to `LOCALE_DESCRIPTORS`,
 * 3. drop `src/i18n/messages/<code>/<namespace>.json` in for every
 *    namespace, and register the block in `message-catalog.ts`.
 *
 * That is the whole change. No use case, repository, API route, component
 * or migration is touched — which is exactly why `preferredLocale` is a
 * VARCHAR column and not a Postgres enum, and why the language list is
 * not the seeded `Language` reference table. See
 * docs/MODULE_29_INTERNATIONALIZATION.md §7.
 */

/**
 * Spanish is the default, not English: MaestroYa is a Spain-focused
 * marketplace and every pre-i18n string in this codebase was written in
 * Spanish. Making `es` the default means the fallback locale is also the
 * *complete* locale — a missing key in any other locale falls back to a
 * correct Spanish string rather than to an untranslated English one that
 * no other part of the product uses.
 */
export const DEFAULT_LOCALE = "es";

export const SUPPORTED_LOCALES = [
  "es",
  "en",
  "uk",
  "cs",
  "de",
  "fr",
  "it",
  "pt",
  "ro",
  "pl",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleDescriptor {
  code: Locale;
  /** The language's own name — what a speaker of it expects to see in a picker. */
  nativeName: string;
  /** English name, used for admin/debug surfaces and `aria-label` fallbacks. */
  englishName: string;
}

/**
 * Ordered exactly as the language picker renders them: the default locale
 * first, then the rest in the order they were added to the product. This
 * is deliberately *not* alphabetical-by-native-name — a picker that opens
 * with "Čeština" for a Spain-first marketplace is worse for the majority
 * of users than one that opens with "Español".
 */
export const LOCALE_DESCRIPTORS: readonly LocaleDescriptor[] = [
  { code: "es", nativeName: "Español", englishName: "Spanish" },
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "uk", nativeName: "Українська", englishName: "Ukrainian" },
  { code: "cs", nativeName: "Čeština", englishName: "Czech" },
  { code: "de", nativeName: "Deutsch", englishName: "German" },
  { code: "fr", nativeName: "Français", englishName: "French" },
  { code: "it", nativeName: "Italiano", englishName: "Italian" },
  { code: "pt", nativeName: "Português", englishName: "Portuguese" },
  { code: "ro", nativeName: "Română", englishName: "Romanian" },
  { code: "pl", nativeName: "Polski", englishName: "Polish" },
];

/**
 * Cookie name. A cookie — not only `localStorage` — because the server
 * has to render the *first* HTML response in the right language, and
 * `localStorage` is unreadable from a Server Component, a Route Handler
 * or Edge middleware. `localStorage` remains the client-side store of
 * record for guests (per the product requirement); the cookie is its
 * server-readable mirror, written by the same client code that writes
 * `localStorage`. See docs/MODULE_29_INTERNATIONALIZATION.md §4.
 *
 * Not prefixed `__Host-`/`__Secure-`: this value must be readable by
 * client JS (the switcher mirrors it into `localStorage`) and carries no
 * authentication meaning whatsoever — the worst an attacker who forges it
 * can do is show the victim the UI in another language. It is validated
 * against `SUPPORTED_LOCALES` on every read, so it can never be used to
 * smuggle a path fragment into a message-file lookup.
 */
export const LOCALE_COOKIE_NAME = "maestroya_locale";

/** `localStorage` key. Same value, same validation, browser-only store. */
export const LOCALE_STORAGE_KEY = "maestroya_locale";

/**
 * Request header written by `middleware.ts` so that anything downstream
 * (Server Components, Route Handlers) can read the negotiated locale
 * without re-parsing `Accept-Language`. Mirrors the existing
 * `REQUEST_ID_HEADER` pattern from Module 25 exactly.
 */
export const LOCALE_HEADER_NAME = "x-maestroya-locale";

/** One year. A language choice is not session state. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Narrows an arbitrary string to a `Locale`, or `null`. The one place
 * untrusted input (cookie, header, DB column, query param, request body)
 * is allowed to become a `Locale`.
 */
export function toLocale(value: unknown): Locale | null {
  return isSupportedLocale(value) ? value : null;
}

export function getLocaleDescriptor(locale: Locale): LocaleDescriptor {
  const descriptor = LOCALE_DESCRIPTORS.find((d) => d.code === locale);
  // Unreachable while LOCALE_DESCRIPTORS covers SUPPORTED_LOCALES (there
  // is a unit test asserting exactly that), but `find` is typed as
  // possibly-undefined and this module must never hand back `undefined`
  // to a caller that is about to render it.
  if (!descriptor) {
    throw new Error(`No descriptor registered for locale "${locale}".`);
  }
  return descriptor;
}
