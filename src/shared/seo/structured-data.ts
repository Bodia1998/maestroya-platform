import { SITE_NAME, SITE_URL, absoluteUrl } from "./site";

/**
 * Module 43 — SEO Infrastructure: JSON-LD (schema.org) builders.
 *
 * Deliberately plain, framework-free functions that take already-public
 * data (the same `ProfessionalPublicProfileRecord`/`CompanyPublicProfileRecord`
 * shapes the marketing pages already fetch — see
 * `domain/repositories/professional-discovery-repository.ts` and
 * `company-discovery-repository.ts`) and return a plain JSON-LD object.
 * No new repository/use-case/query is introduced here — this module never
 * fetches anything itself, only shapes data a page already has. Rendering
 * (the `<script type="application/ld+json">` tag) is
 * `presentation/components/seo/json-ld.tsx`'s job, kept separate so these
 * builders stay trivially unit-testable without React/JSDOM.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON-LD is inherently an untyped, open vocabulary; schema.org has no first-party TS types this codebase depends on.
export type JsonLdObject = Record<string, any>;

/** The platform itself — emitted once, in the root layout, on every page.
 *  `LocalBusiness`-adjacent detail (address, opening hours) intentionally
 *  omitted: MaestroYa is the marketplace operator, not a local business
 *  with its own storefront — individual professionals/companies are the
 *  `LocalBusiness`/`ProfessionalService` entities (see below). */
export function buildOrganizationJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/icon"),
  };
}

/** Also emitted once, root layout. `SearchAction` tells search engines
 *  the directory search page (`/search`) can be reached with a query
 *  parameter, enabling a "sitelinks search box" in results — a direct,
 *  low-effort win for a marketplace whose whole value is being found. */
export function buildWebSiteJsonLd(): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

/** Emitted on any page deeper than the homepage (search results,
 *  professional/company profiles) so search results can show the
 *  breadcrumb trail instead of the raw URL. */
export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/** Shared shape both profile JSON-LD builders below need — a subset of
 *  `ProfessionalPublicProfileRecord`/`CompanyPublicProfileRecord` that
 *  exists on both (never the full record, so neither builder can
 *  accidentally leak a field the *other* record shape doesn't have a
 *  public-safety review for). */
interface LocalBusinessLike {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  city: string | null;
  province: string | null;
  averageRating: number | null;
  reviewCount: number;
  path: string;
}

/**
 * `ProfessionalService` (a schema.org subtype of `LocalBusiness`) for a
 * single public professional profile. Only ever built from fields the
 * page already renders publicly (city/province, never a street address or
 * coordinates — see `ProfessionalPublicProfileRecord`'s own doc comment
 * on why exact location is never exposed here either).
 */
export function buildProfessionalServiceJsonLd(profile: LocalBusinessLike): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": absoluteUrl(profile.path),
    name: profile.name,
    url: absoluteUrl(profile.path),
    ...(profile.description ? { description: profile.description } : {}),
    ...(profile.image ? { image: profile.image } : {}),
    ...(profile.city || profile.province
      ? {
          address: {
            "@type": "PostalAddress",
            ...(profile.city ? { addressLocality: profile.city } : {}),
            ...(profile.province ? { addressRegion: profile.province } : {}),
            addressCountry: "ES",
          },
        }
      : {}),
    ...(profile.averageRating !== null && profile.reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: profile.averageRating,
            reviewCount: profile.reviewCount,
          },
        }
      : {}),
  };
}

/** `LocalBusiness` for a single public company profile — same shape and
 *  reasoning as `buildProfessionalServiceJsonLd`, `LocalBusiness` (the
 *  base type) rather than `ProfessionalService` since a company profile
 *  is a business entity, not an individual practitioner. */
export function buildLocalBusinessJsonLd(profile: LocalBusinessLike): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": absoluteUrl(profile.path),
    name: profile.name,
    url: absoluteUrl(profile.path),
    ...(profile.description ? { description: profile.description } : {}),
    ...(profile.image ? { image: profile.image } : {}),
    ...(profile.city || profile.province
      ? {
          address: {
            "@type": "PostalAddress",
            ...(profile.city ? { addressLocality: profile.city } : {}),
            ...(profile.province ? { addressRegion: profile.province } : {}),
            addressCountry: "ES",
          },
        }
      : {}),
    ...(profile.averageRating !== null && profile.reviewCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: profile.averageRating,
            reviewCount: profile.reviewCount,
          },
        }
      : {}),
  };
}
