import type { MetadataRoute } from "next";

import { prisma } from "@/infrastructure/database/prisma/client";
import { SITE_URL } from "@/shared/seo/site";
import { listVerifiedTopLevelServiceCategories } from "@/shared/content/verified-service-category";
import { findVerifiedCity } from "@/shared/content/verified-location";
import { LOCATION_CONTENT } from "@/shared/content/locations";
import { JUSTIFIED_SERVICE_LOCATION_PAIRS } from "@/shared/content/service-location-pairs";
import { getServiceContentBySlug } from "@/shared/content/services";
import { getLocationContentBySlug } from "@/shared/content/locations";
import { findVerifiedCountry } from "@/shared/content/verified-country";
import { NATIONAL_COVERAGE_CONTENT } from "@/shared/content/national-coverage";

/**
 * Module 43 — SEO Infrastructure: `sitemap.xml`, served at `/sitemap.xml`
 * via Next's `sitemap.ts` file convention.
 *
 * URL scope, deliberately: only routes that (a) are publicly reachable
 * without authentication and (b) have a single canonical URL of their
 * own.
 *
 *  - Static marketing pages (home, directory search, top-level
 *    professional/company listing).
 *  - Every ACTIVE, non-deleted professional/company public profile —
 *    the same visibility rule `PrismaProfessionalDiscoveryRepository`/
 *    `PrismaCompanyDiscoveryRepository` already enforce for discovery
 *    (`status: "ACTIVE", deletedAt: null` — see those files), read here
 *    directly via Prisma (an `id`-only projection, no joins) rather than
 *    through the discovery repository abstraction: this is a read with
 *    no business logic of its own (not a "candidate" or "public profile"
 *    view, just an id + timestamp for the sitemap), matching the existing
 *    convention of page components reading `prisma` directly for exactly
 *    this kind of plain reference-data query (see e.g.
 *    `(marketing)/page.tsx`'s own top-level-category read).
 *
 * Explicitly NOT included, and why:
 *
 *  - Module 118 — AI-Readable Service & Location Knowledge added real
 *    `/servicios`, `/ubicaciones`, and `/servicios/[slug]/[location]`
 *    pages — see below for how their entries are built (verified live
 *    against the database, same discipline the pages themselves use, so
 *    this sitemap never lists a page that would 404).
 *  - `/professionals`/`/search` query-string variants (e.g.
 *    `?categoryId=…&city=…`): thin/duplicate content over the same base
 *    page with no stable canonical identity of their own — the base path
 *    is listed once instead, matching each page's own
 *    `alternates.canonical` (see those files' `generateMetadata`).
 *  - Every authenticated/dashboard/admin route: never public, already
 *    excluded from crawling entirely via `src/app/robots.ts`.
 *
 * Performance: each query below selects only `id`/`updatedAt` (no
 * relations, no joins) and is capped at 45,000 rows — comfortably under
 * the 50,000-URL-per-sitemap limit search engines enforce — so a single
 * sitemap file remains correct at the platform's current scale. Revisit
 * with `generateSitemaps` (Next's built-in pagination convention for this
 * exact file) if either table ever approaches that cap; no other change
 * would be needed since both queries already use `orderBy: { createdAt: "asc" }`
 * pagination-ready ordering.
 */

const MAX_ENTRIES_PER_ENTITY = 45_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [professionals, companies] = await Promise.all([
    prisma.professionalProfile.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_ENTRIES_PER_ENTITY,
    }),
    prisma.companyProfile.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_ENTRIES_PER_ENTITY,
    }),
  ]);

  // No `/companies` listing page exists (only `/companies/[id]` — company
  // discovery today happens via `/professionals` and `/search`, both of
  // which already surface company candidates alongside professionals; see
  // `search-companies.use-case.ts`) — so, unlike professionals, there is
  // no matching static "companies index" entry below.
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/professionals`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/search`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${SITE_URL}/servicios`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/ubicaciones`, changeFrequency: "weekly", priority: 0.7 },
  ];

  // Module 118 — AI-Readable Service & Location Knowledge: only ever adds
  // a URL that the corresponding page would itself render (never 404) —
  // each entry is re-verified live here rather than trusted from the
  // static content catalogs alone, matching the pages' own discipline.
  const verifiedCategories = await listVerifiedTopLevelServiceCategories();
  const verifiedCategorySlugs = new Set(verifiedCategories.map((category) => category.slug));

  const verifiedCities = new Map<string, boolean>();
  await Promise.all(
    LOCATION_CONTENT.map(async (location) => {
      const verified = await findVerifiedCity(location.cityName, location.provinceName, location.countryCode);
      verifiedCities.set(location.slug, Boolean(verified));
    }),
  );

  // Module 118 (continuation) — Spain-wide geographic coverage:
  // `/ubicaciones/espana` is listed only when the seeded `Country` row it
  // describes actually verifies live — same discipline as every other
  // entry in this function.
  const verifiedCountry = await findVerifiedCountry(NATIONAL_COVERAGE_CONTENT.countryCode);
  const nationalCoverageEntries: MetadataRoute.Sitemap = verifiedCountry
    ? [
        {
          url: `${SITE_URL}/ubicaciones/${NATIONAL_COVERAGE_CONTENT.slug}`,
          changeFrequency: "monthly",
          priority: 0.65,
        },
      ]
    : [];

  const serviceEntries: MetadataRoute.Sitemap = verifiedCategories
    .filter((category) => getServiceContentBySlug(category.slug))
    .map((category) => ({
      url: `${SITE_URL}/servicios/${category.slug}`,
      changeFrequency: "monthly",
      priority: 0.6,
    }));

  const locationEntries: MetadataRoute.Sitemap = LOCATION_CONTENT.filter(
    (location) => verifiedCities.get(location.slug) && getLocationContentBySlug(location.slug),
  ).map((location) => ({
    url: `${SITE_URL}/ubicaciones/${location.slug}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const serviceLocationEntries: MetadataRoute.Sitemap = JUSTIFIED_SERVICE_LOCATION_PAIRS.filter(
    (pair) => verifiedCategorySlugs.has(pair.serviceSlug) && verifiedCities.get(pair.locationSlug),
  ).map((pair) => ({
    url: `${SITE_URL}/servicios/${pair.serviceSlug}/${pair.locationSlug}`,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  const professionalEntries: MetadataRoute.Sitemap = professionals.map((professional) => ({
    url: `${SITE_URL}/professionals/${professional.id}`,
    lastModified: professional.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const companyEntries: MetadataRoute.Sitemap = companies.map((company) => ({
    url: `${SITE_URL}/companies/${company.id}`,
    lastModified: company.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [
    ...staticEntries,
    ...professionalEntries,
    ...companyEntries,
    ...serviceEntries,
    ...locationEntries,
    ...nationalCoverageEntries,
    ...serviceLocationEntries,
  ];
}
