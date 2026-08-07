/**
 * Module 43 — SEO Infrastructure: single source of truth for the
 * site-wide values every metadata/sitemap/robots/structured-data producer
 * needs (base URL, name, default description, default OG locale).
 *
 * Framework-free on purpose (no `next`, no `server-only` import of its
 * own) so it can be imported from Server Components, Route Handlers, the
 * special `sitemap.ts`/`robots.ts`/`manifest.ts` files, and plain unit
 * tests alike — same rationale `shared/i18n/locales.ts` documents for
 * itself. It reads `NEXT_PUBLIC_APP_URL` directly (not through
 * `@/infrastructure/config/env`) precisely so it stays import-safe from
 * that non-`server-only` set of call sites; `env.ts`'s `server-only`
 * guard would throw if this module were ever reached from a Client
 * Component's bundle. The value is otherwise the exact same public,
 * already-validated environment variable `env.ts` exposes as
 * `NEXT_PUBLIC_APP_URL` (see that file) — this is not a second,
 * competing source of configuration, just a boundary-safe re-read of it.
 */

const FALLBACK_SITE_URL = "http://localhost:3000";

function readSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return FALLBACK_SITE_URL;
  // Next's Metadata API (`metadataBase`, sitemap/robots entries) all want a
  // URL with no trailing slash for consistent `new URL(path, base)` joins.
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/** Absolute origin of the deployed app, e.g. `https://maestroya.es`. */
export const SITE_URL = readSiteUrl();

export const SITE_NAME = "MaestroYa";

/** Spanish is this platform's default/complete locale — see
 *  `shared/i18n/locales.ts`'s own `DEFAULT_LOCALE` doc comment. Mirrored
 *  here as the default SEO description/OG locale for the same reason. */
export const SITE_DESCRIPTION =
  "Conecta con profesionales de confianza para tu hogar: fontanería, electricidad, reformas, limpieza y mucho más.";

export const SITE_KEYWORDS = [
  "profesionales del hogar",
  "servicios para el hogar",
  "fontanero",
  "electricista",
  "reformas",
  "limpieza",
  "MaestroYa",
];

/** Maps this app's interface `Locale` (`shared/i18n/locales.ts`) to the
 *  IETF/Open-Graph locale tag OG's `og:locale` expects (`xx_XX`). Open
 *  Graph has no "language without region" concept, so every supported
 *  locale is paired with the one region that makes sense for a
 *  Spain-based marketplace's audience in that language. */
const OG_LOCALE_BY_LOCALE: Record<string, string> = {
  es: "es_ES",
  en: "en_US",
  uk: "uk_UA",
  cs: "cs_CZ",
  de: "de_DE",
  fr: "fr_FR",
  it: "it_IT",
  pt: "pt_PT",
  ro: "ro_RO",
  pl: "pl_PL",
};

export function toOgLocale(locale: string): string {
  return OG_LOCALE_BY_LOCALE[locale] ?? OG_LOCALE_BY_LOCALE.es!;
}

/** Builds an absolute, `SITE_URL`-based URL for a site-relative path.
 *  Prefer this (or `metadataBase`, which does the same thing implicitly
 *  for `Metadata.alternates.canonical`/`openGraph.url`) over string
 *  concatenation so every producer agrees on the no-trailing-slash rule
 *  above. */
export function absoluteUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${normalized}`;
}
