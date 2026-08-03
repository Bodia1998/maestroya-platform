import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  toLocale,
  type Locale,
} from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization: the guest-side persistence layer.
 *
 * `localStorage` is the store of record for a guest's language, per the
 * product requirement. The cookie written alongside it is *the same
 * value* — it exists purely so the **server** can render the very first
 * HTML response in the right language, which `localStorage` can never
 * support (it is unreadable from a Server Component, a Route Handler and
 * Edge middleware alike). Writing only `localStorage` would mean every
 * guest gets a Spanish first paint followed by a visible flip, i.e. the
 * flash-of-wrong-language problem.
 *
 * Every read is validated through `toLocale`. Both stores are fully
 * attacker-controlled — the value is used to index a message catalog, so
 * it must be a member of a closed union before it goes anywhere near
 * one, never an arbitrary string.
 *
 * Every function here is a no-op (or `null`) outside the browser, so the
 * module is safe to import from code that also runs on the server.
 */

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function readStoredLocale(): Locale | null {
  if (!isBrowser()) return null;
  try {
    return toLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    // Safari private mode and "block all cookies" both make localStorage
    // access throw rather than return null. A language preference is not
    // worth breaking a render over — the caller falls through to the
    // Accept-Language step.
    return null;
  }
}

export function readLocaleCookie(): Locale | null {
  if (!isBrowser()) return null;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE_NAME}=`));
  return match ? toLocale(decodeURIComponent(match.slice(LOCALE_COOKIE_NAME.length + 1))) : null;
}

/**
 * `SameSite=Lax` (not `Strict`): a user who follows a link into MaestroYa
 * from an email or a search result must land in their chosen language,
 * and `Strict` would withhold the cookie on exactly that first
 * cross-site navigation. `Secure` is set whenever the page is served over
 * HTTPS — omitted on plain-HTTP localhost, where a `Secure` cookie is
 * silently dropped by the browser and dev would appear broken.
 *
 * Not `HttpOnly` by necessity: this same value is mirrored into
 * `localStorage` by client code, and the client has to be able to read
 * back what it wrote. It carries no authentication meaning.
 */
export function writeLocaleCookie(locale: Locale): void {
  if (!isBrowser()) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

/** Write both stores. The one function UI code should call. */
export function persistLocale(locale: Locale): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // See readStoredLocale — the cookie below still carries the choice.
  }
  writeLocaleCookie(locale);
}

/**
 * The browser's own language list, for the client-side half of the
 * negotiation chain. Shaped as an `Accept-Language`-style string so it
 * can be fed to the exact same `parseAcceptLanguage` the server uses
 * instead of a second, subtly different matcher.
 */
export function readBrowserLanguages(): string | null {
  if (typeof navigator === "undefined") return null;
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.filter(Boolean).join(",") || null;
}
