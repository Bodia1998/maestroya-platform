/**
 * Module 118 — AI-Readable Service & Location Knowledge.
 *
 * Curated, hand-written public content for locations MaestroYa's public
 * knowledge pages describe. Deliberately tiny today: `prisma/seed.ts`'s
 * `seedGeography()` seeds exactly one country → province → city chain
 * (Spain → Valencia → Gandia) via the `Country`/`Province`/`City` Prisma
 * models, and no other city exists in the repository's own seed data.
 *
 * "Playa de Gandia" (mentioned in earlier planning material) is
 * deliberately NOT included here — it is a neighbourhood/beach area of
 * Gandia, not a distinct `City` row in the schema, and the module brief's
 * own non-negotiable rule is "do not assume a location exists simply
 * because it is mentioned in a previous planning document." See the
 * Module 118 report, "Pages Intentionally NOT Created".
 *
 * As with `services.ts`, this file is never trusted on its own: every
 * page that renders an entry here also looks the city up live via Prisma
 * (`Country` → `Province` → `City`) and 404s if it does not find an exact
 * match — so a stale entry here can never cause a page to claim coverage
 * of a place MaestroYa's own data does not have.
 *
 * Module 120 — Multilingual Localization: the prose (intro, FAQ) lives in
 * the server-only `knowledge` namespace (`locations.<slug>.…`, Spanish =
 * the original copy) and is resolved per locale by
 * `resolveLocationContent()`. City/province names are proper nouns and
 * stay untranslated; the country's display name comes from
 * `services.countries.<countryCode>`.
 */

import type { FaqEntry } from "./services";

export interface LocationContent {
  /** URL slug, e.g. "gandia". */
  slug: string;
  /** Must exactly match a real `City.name` row (case-insensitive compare
   *  performed by the page's live lookup). Proper noun — never translated. */
  cityName: string;
  /** Must exactly match that city's `Province.name`. */
  provinceName: string;
  /** Must exactly match that province's `Country.code` (ISO 3166-1 alpha-2).
   *  The localized country name is `services.countries.<countryCode>`. */
  countryCode: string;
  /** Keys under `knowledge.locations.<slug>.faqs` (each with a `question`
   *  and an `answer`). The intro is `knowledge.locations.<slug>.intro`. */
  faqs: readonly string[];
  /** Other location slugs to link to — must also exist in this catalog. */
  relatedLocationSlugs: readonly string[];
}

export const LOCATION_CONTENT: readonly LocationContent[] = [
  {
    slug: "gandia",
    cityName: "Gandia", // i18n-ignore: database value / proper noun
    provinceName: "Valencia", // i18n-ignore: database value / proper noun
    countryCode: "ES",
    faqs: ["whatServices", "howToHire", "outsideGandia"],
    relatedLocationSlugs: [],
  },
] as const;

export function getLocationContentBySlug(slug: string): LocationContent | undefined {
  return LOCATION_CONTENT.find((location) => location.slug === slug);
}

export interface ResolvedLocationText {
  intro: string;
  faqs: FaqEntry[];
}

/** Resolves a location's prose for one locale; `t` is bound to the
 *  `knowledge` namespace (see `KnowledgeTranslator` in `./services`). */
export function resolveLocationContent(content: LocationContent, t: unknown): ResolvedLocationText {
  const translate = t as (key: string) => string;
  const base = `locations.${content.slug}`;
  return {
    intro: translate(`${base}.intro`),
    faqs: content.faqs.map((key) => ({
      question: translate(`${base}.faqs.${key}.question`),
      answer: translate(`${base}.faqs.${key}.answer`),
    })),
  };
}

/** Localized country display name (`services.countries.<code>`, e.g.
 *  "España" / "Spain" / "Испания"); `t` is bound to the `services`
 *  namespace. Falls back to the ISO code for a country without an entry. */
export function localizeCountryName(t: unknown, countryCode: string): string {
  const translate = t as ((key: string) => string) & { has(key: string): boolean };
  const key = `countries.${countryCode}`;
  return translate.has(key) ? translate(key) : countryCode;
}
