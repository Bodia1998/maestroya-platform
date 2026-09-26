/**
 * Module 118 (continuation) — Spain-wide geographic coverage.
 *
 * Curated content for the single national-scope page (`/ubicaciones/espana`).
 * Deliberately separate from `locations.ts` (city-level content) rather
 * than folded into the same catalog/type: a country-level "coverage
 * intent" page and a city-level "verified availability" page make
 * different claims and are verified against different Prisma models
 * (`Country` vs `City`) — conflating them into one shape risked exactly
 * the confusion this continuation exists to remove (see the Module 118
 * report, "Platform Coverage vs. Verified Local Availability").
 *
 * This file states MaestroYa's *business/platform* scope — "MaestroYa is
 * a marketplace that serves customers across Spain" — and is explicit,
 * on every page that renders it, that *actual* local availability is a
 * separate, data-driven question answered by `/ubicaciones/[slug]` pages
 * (currently only Gandia) and by `/servicios/[slug]/[location]` pages.
 * It never states or implies that professionals/companies are currently
 * active in every Spanish municipality, a specific coverage percentage,
 * or any count of professionals, jobs, or customers.
 *
 * Module 120 — Multilingual Localization: the prose (intro, coverage
 * statement, local-availability explanation, FAQ, and the Service JSON-LD
 * name/description) lives in the server-only `knowledge` namespace
 * (`nationalCoverage.…`, Spanish = the original copy) and is resolved per
 * locale by `resolveNationalCoverageContent()`. Every translation keeps
 * the platform-scope vs. verified-local-availability distinction exactly.
 */

import type { FaqEntry } from "./services";

export interface NationalCoverageContent {
  slug: string;
  /** Must exactly match the seeded `Country.code` (ISO 3166-1 alpha-2).
   *  The localized display name is `services.countries.<countryCode>`
   *  ("España", "Spain", "Испания", …) — distinct from `Country.name`,
   *  so page copy reads naturally without renaming the database value. */
  countryCode: string;
  /** Must exactly match the seeded `Country.name`. */
  countryName: string;
  /** Keys under `knowledge.nationalCoverage.faqs`. */
  faqs: readonly string[];
}

export const NATIONAL_COVERAGE_CONTENT: NationalCoverageContent = {
  slug: "espana",
  countryCode: "ES",
  countryName: "Spain", // i18n-ignore: database value / proper noun
  faqs: ["wholeSpain", "localAvailability", "whatServices", "professionalParticipation"],
};

export interface ResolvedNationalCoverageText {
  intro: string;
  /** The platform-scope statement, phrased so it can never be read as a
   *  guarantee of current local supply — see the module's non-negotiable
   *  rule 8/9. */
  coverageStatement: string;
  howLocalAvailabilityWorks: string;
  faqs: FaqEntry[];
  /** `Service` JSON-LD name/description for the page (never LocalBusiness). */
  structuredDataName: string;
  structuredDataDescription: string;
}

/** Resolves the national-coverage prose for one locale; `t` is bound to
 *  the `knowledge` namespace. */
export function resolveNationalCoverageContent(
  content: NationalCoverageContent,
  t: unknown,
): ResolvedNationalCoverageText {
  const translate = t as (key: string) => string;
  return {
    intro: translate("nationalCoverage.intro"),
    coverageStatement: translate("nationalCoverage.coverageStatement"),
    howLocalAvailabilityWorks: translate("nationalCoverage.howLocalAvailabilityWorks"),
    faqs: content.faqs.map((key) => ({
      question: translate(`nationalCoverage.faqs.${key}.question`),
      answer: translate(`nationalCoverage.faqs.${key}.answer`),
    })),
    structuredDataName: translate("nationalCoverage.structuredData.name"),
    structuredDataDescription: translate("nationalCoverage.structuredData.description"),
  };
}
