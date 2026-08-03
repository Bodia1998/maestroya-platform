import { DEFAULT_LOCALE, SUPPORTED_LOCALES, toLocale, type Locale } from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization: locale negotiation.
 *
 * Pure functions, zero I/O, zero framework imports — everything that
 * *decides* which language a request is rendered in lives here and is
 * unit-testable without a browser, a database or a Next.js request. The
 * callers (middleware, the server-side resolver, the client provider)
 * only supply the raw inputs.
 */

export type LocaleSource =
  /** The authenticated user's stored `User.preferredLocale`. */
  | "user-preference"
  /** The guest's `localStorage`-mirrored cookie. */
  | "stored-preference"
  /** Negotiated from the browser's `Accept-Language`. */
  | "browser"
  /** Nothing matched — Spanish. */
  | "default";

export interface ResolvedLocale {
  locale: Locale;
  source: LocaleSource;
}

/**
 * Parse `Accept-Language` into language tags ordered by descending
 * q-value. Robust against the junk real clients send: missing q, `q=`
 * with a non-numeric value, stray whitespace, `*`, and duplicate tags.
 *
 * `Array.prototype.sort` is stable in every runtime this app targets
 * (ES2019+), so equal q-values keep the client's own ordering — which is
 * the ordering the client meant.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];

  return header
    .split(",")
    .map((part, index) => {
      const [rawTag = "", ...params] = part.split(";");
      const tag = rawTag.trim();
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const parsedQ = qParam ? Number.parseFloat(qParam.slice(2)) : Number.NaN;
      const q = Number.isFinite(parsedQ) ? parsedQ : 1;
      return { tag, q, index };
    })
    .filter((entry) => entry.tag !== "" && entry.tag !== "*" && entry.q > 0)
    .sort((a, b) => (b.q === a.q ? a.index - b.index : b.q - a.q))
    .map((entry) => entry.tag);
}

/**
 * First supported locale among `candidates`, matching on the primary
 * subtag: `pt-BR`, `pt-PT` and `pt` all resolve to `pt`. Region-specific
 * variants are deliberately *not* separate locales — shipping `pt-BR` and
 * `pt-PT` message files is a product decision nobody has made, and
 * silently falling back to Spanish for a Brazilian visitor would be
 * strictly worse than showing them European Portuguese.
 */
export function matchSupportedLocale(
  candidates: Iterable<string | null | undefined>,
): Locale | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const exact = toLocale(candidate.toLowerCase());
    if (exact) return exact;

    const primary = candidate.toLowerCase().split("-")[0];
    const base = toLocale(primary);
    if (base) return base;
  }
  return null;
}

export interface LocaleResolutionInput {
  /** `User.preferredLocale` — only ever pass this for an authenticated user. */
  userPreference?: string | null;
  /** The `NEXT_LOCALE` cookie / `localStorage` value. */
  storedPreference?: string | null;
  /** The raw `Accept-Language` request header. */
  acceptLanguage?: string | null;
}

/**
 * The **guest** priority chain, exactly as specified:
 * `localStorage` (mirrored to the cookie) -> `Accept-Language` -> Spanish.
 */
export function resolveGuestLocale(input: LocaleResolutionInput): ResolvedLocale {
  const stored = matchSupportedLocale([input.storedPreference]);
  if (stored) return { locale: stored, source: "stored-preference" };

  const browser = matchSupportedLocale(parseAcceptLanguage(input.acceptLanguage));
  if (browser) return { locale: browser, source: "browser" };

  return { locale: DEFAULT_LOCALE, source: "default" };
}

/**
 * The **authenticated** priority chain, exactly as specified:
 * database (`User.preferredLocale`) -> `Accept-Language` -> Spanish.
 *
 * Note what is *absent*: the guest's stored cookie is deliberately not
 * consulted for a signed-in user with no stored preference. The account
 * is the source of truth the moment there is one, and honouring a cookie
 * over the account would mean the same user sees two different languages
 * on two devices despite having chosen one — the exact confusion this
 * chain exists to avoid. Because the switcher writes the database
 * synchronously on every change, "signed in but no `preferredLocale`"
 * only ever means "has genuinely never chosen", where `Accept-Language`
 * is the better guess.
 */
export function resolveAuthenticatedLocale(input: LocaleResolutionInput): ResolvedLocale {
  const stored = matchSupportedLocale([input.userPreference]);
  if (stored) return { locale: stored, source: "user-preference" };

  const browser = matchSupportedLocale(parseAcceptLanguage(input.acceptLanguage));
  if (browser) return { locale: browser, source: "browser" };

  return { locale: DEFAULT_LOCALE, source: "default" };
}

/** Dispatches to the guest or authenticated chain. */
export function resolveLocale(
  input: LocaleResolutionInput & { isAuthenticated: boolean },
): ResolvedLocale {
  return input.isAuthenticated ? resolveAuthenticatedLocale(input) : resolveGuestLocale(input);
}

/** Every supported locale, for exhaustiveness checks in tests and admin UIs. */
export const ALL_LOCALES: readonly Locale[] = SUPPORTED_LOCALES;
