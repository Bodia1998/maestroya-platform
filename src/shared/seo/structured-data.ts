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
 *  `LocalBusiness`/`ProfessionalService` entities (see below).
 *
 *  Module 117 — AI Search & Recommendation Visibility Foundation:
 *  `sameAs` (schema.org's property for linking an entity to its official
 *  external profiles — social accounts, official business directories,
 *  etc.) is deliberately omitted here, not merely forgotten. As of this
 *  module, MaestroYa has no confirmed, official external profile to
 *  link to; inventing or guessing one (a placeholder social handle, a
 *  competitor's profile, an unclaimed directory listing) would be a
 *  false, verifiable-as-wrong claim in structured data, which this
 *  module's brief explicitly forbids. Add `sameAs: [...]` here — the
 *  array schema.org expects — the moment real, verified official URLs
 *  exist; no other change is needed. See the Module 117 report,
 *  "sameAs / External Identity". */
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

/**
 * Module 117 — AI Search & Recommendation Visibility Foundation: `Service`
 * structured-data foundation.
 *
 * Deliberately UNUSED today — no page calls this yet. There is no
 * dedicated public page per service/category (see
 * `docs/MODULE_43_SEO_INFRASTRUCTURE.md` §3 and the Module 117 report's
 * "Service Structured Data Foundation" section for why building one is
 * out of this module's scope), so emitting this on, say, the homepage
 * would describe content that page doesn't actually render — exactly the
 * "structured data must accurately describe the visible page content"
 * rule this module's brief forbids violating. This builder exists only
 * so Module 118, when it adds real per-service (and per-service+location)
 * pages, has a ready, reviewed shape to call rather than inventing one
 * under deadline pressure. `provider` intentionally reuses the same
 * `Organization`/`LocalBusiness` shapes `buildOrganizationJsonLd`/
 * `buildLocalBusinessJsonLd` already emit — a `Service` should point back
 * at the same provider identity those builders establish, not a third,
 * divergent representation.
 */
export interface ServiceJsonLdInput {
  /** The category name as MaestroYa actually names it, e.g. "Fontanería" —
   *  never an invented or translated variant. */
  name: string;
  /** Canonical site-relative path of the page this Service is embedded
   *  in, once one exists (e.g. `/servicios/fontaneria`). */
  path: string;
  description?: string | null;
  /** `areaServed` is a plain place name (city/province), matching the
   *  same city/province granularity `buildProfessionalServiceJsonLd`/
   *  `buildLocalBusinessJsonLd` already use — never a fabricated service
   *  radius or coordinate. */
  areaServed?: string | null;
  /** Defaults to MaestroYa's own Organization identity; pass a specific
   *  professional/company `LocalBusinessLike` `@id` when this Service is
   *  scoped to one provider rather than the platform as a whole. */
  providerId?: string;
}

export function buildServiceJsonLd(input: ServiceJsonLdInput): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: input.name,
    url: absoluteUrl(input.path),
    ...(input.description ? { description: input.description } : {}),
    ...(input.areaServed ? { areaServed: { "@type": "Place", name: input.areaServed } } : {}),
    provider: {
      "@type": "Organization",
      "@id": input.providerId ?? SITE_URL,
      name: SITE_NAME,
    },
  };
}

/**
 * Module 118 — AI-Readable Service & Location Knowledge: `FAQPage`
 * structured data for a service/location page's on-page FAQ section.
 *
 * Only ever built from the exact question/answer pairs a page already
 * renders visibly (see `shared/content/services.ts` / `locations.ts`) —
 * never a superset invented for search visibility. Phase 8 of this
 * module's brief is explicit: "Do not create FAQ schema for questions
 * that are not visibly answered on the page."
 */
export interface FaqItem {
  question: string;
  answer: string;
}

export function buildFaqJsonLd(items: FaqItem[]): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
