import type { MetadataRoute } from "next";

import { prisma } from "@/infrastructure/database/prisma/client";
import { SITE_URL } from "@/shared/seo/site";

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
 *  - Service categories and cities have no dedicated public landing page
 *    of their own yet (discovery is entirely via `/professionals` and
 *    `/search`'s query-string filters) — adding one is a new feature, out
 *    of this module's scope (see `docs/MODULE_43_SEO_INFRASTRUCTURE.md`,
 *    "Local SEO"). Nothing here should be read as those pages existing.
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
  ];

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

  return [...staticEntries, ...professionalEntries, ...companyEntries];
}
