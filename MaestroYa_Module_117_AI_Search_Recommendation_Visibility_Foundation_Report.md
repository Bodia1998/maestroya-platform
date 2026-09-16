# Module 117 — AI Search & Recommendation Visibility Foundation

**Branch:** `feature/module-117-ai-search-recommendation-visibility-foundation`
**Date:** 2026-09-16

## A. Executive Summary

This module's brief asked for a technical foundation making MaestroYa
discoverable, understandable, structured, and crawlable by search engines
and AI systems. The repository audit (Phase 1) found that **almost all of
this foundation already exists**, built and shipped as **Module 43 — SEO
Infrastructure** (`docs/MODULE_43_SEO_INFRASTRUCTURE.md`): a complete
`Metadata` API implementation, `sitemap.xml`, `robots.txt`, canonical
URLs, Open Graph/Twitter Cards, and schema.org JSON-LD (`Organization`,
`WebSite`+`SearchAction`, `BreadcrumbList`, `ProfessionalService`,
`LocalBusiness`), with 38 passing unit tests documenting every decision.

Per this module's own non-negotiable rules ("DO NOT invent a parallel
SEO/content architecture if one already exists," "reuse existing
architecture wherever possible"), Module 117 does **not** rebuild or
duplicate that work. Instead it: (1) verifies Module 43's implementation
still holds and is AI-crawler-safe, (2) closes the specific gaps the
Module 117 brief asks for that Module 43 did not cover — an `llms.txt`
file, and a reusable `Service` JSON-LD foundation for Module 118 — and
(3) documents the decisions (LocalBusiness, `sameAs`, geographic
signals, locale/hreflang) that were already made correctly in Module 43
and remain correct today.

**Net new code:** one route handler (`/llms.txt`), one unused-but-ready
JSON-LD builder function (`buildServiceJsonLd`) plus a documentation note
on `buildOrganizationJsonLd`, and their tests. No existing file's
behavior was changed. No routes, metadata, sitemap entries, or robots
rules were modified.

## B. Initial Repository / Frontend State

Audited directly (Phase 1), not assumed:

- **Public routes:** `/` (homepage), `/professionals` (search/browse),
  `/professionals/[id]` (public profile), `/companies/[id]` (public
  profile), `/search` (unified directory search). All under the
  `(marketing)` route group, all Server Components, all server-rendered
  without requiring client-side interaction to reveal essential content.
- **Private routes:** everything under `(dashboard)` — `/dashboard`,
  `/admin`, `/requests`, `/appointments`, `/jobs`, `/messages`,
  `/disputes`, `/support-tickets`, `/profile`, `/receipts`, `/reviews`,
  `/notifications`, `/analytics` — plus `/auth/*` (login/register/
  password-reset/verify-email, token-bearing) and all of `/api/*`.
- **Route protection:** `middleware.ts` (`PROTECTED_PREFIXES`,
  `ROLE_GATED_PREFIXES`) redirects unauthenticated visitors to
  `/auth/login`; every dashboard page additionally calls `requireAuth()`
  itself. This is the real access-control boundary — robots.txt/
  metadata are defense-in-depth on top of it, never a substitute for it.
- **Metadata:** Next.js Metadata API already fully adopted — root layout
  (`metadataBase`, title template, `alternates.canonical`, `robots`,
  `openGraph`, `twitter`, `icons`, `manifest`) plus per-page
  `metadata`/`generateMetadata` on every public page, including the two
  dynamic profile pages (wrapped in React `cache()` to avoid a duplicate
  Prisma fetch — see Module 43 §2.4).
- **Canonical URLs:** `alternates.canonical` set on every public page to
  its own bare path; query-string filter variants (`/professionals?...`,
  `/search?...`) deliberately canonicalize to the base path rather than
  being treated as distinct pages (avoids near-duplicate-content URLs).
- **robots.txt / sitemap.xml:** both implemented (`src/app/robots.ts`,
  `src/app/sitemap.ts`), reading a single shared `DISALLOWED_PATHS` list
  (`src/shared/seo/robots-rules.ts`) that a test keeps in sync with
  `middleware.ts`'s own protected-prefix lists, and a sitemap built from
  live, `id`/`updatedAt`-only Prisma reads of `ACTIVE`, non-deleted
  professional/company profiles (capped at 45,000 rows/entity).
- **Structured data:** `src/shared/seo/structured-data.ts` +
  `src/presentation/components/seo/json-ld.tsx` already implement
  `Organization` and `WebSite` (root layout, every page) and
  `BreadcrumbList` + `ProfessionalService`/`LocalBusiness` (profile
  pages), each with city/province-only `PostalAddress` (never exact
  coordinates or a street address) and `AggregateRating` only when a
  real rating exists.
- **Locale architecture:** `next-intl`-backed, 10 supported interface
  languages (`src/i18n/messages/{es,en,uk,cs,de,fr,it,pt,ro,pl}`), but
  **no `/[locale]/...` URL segment** — language is a per-user/cookie
  preference resolved server-side, not a URL property (Module 29). This
  is a deliberate, documented architectural decision (see
  `middleware.ts`'s `negotiateLocale` doc comment), not a gap.
- **hreflang:** deliberately not implemented, for the same reason —
  `hreflang` requires a distinct URL per language variant, which the
  above architecture does not have. Confirmed still correct; not
  something this module should introduce (would mean rewriting Module
  29's routing decision, forbidden by this module's own brief).
- **Env / domain config:** `NEXT_PUBLIC_APP_URL` is the single source of
  truth (`src/shared/seo/site.ts`'s `SITE_URL`), already set correctly
  per environment: `http://localhost:3000` in `.env`/`.env.local`,
  `https://maestroya.es` in `.env.production`. No domain is hardcoded
  anywhere in the SEO producers audited.
- **Existing tests:** `tests/unit/shared/seo/*` and `tests/unit/app/seo/*`
  — 10 files, 38 test cases, covering every producer above.
- **AI-crawler-specific state:** `robots.txt` uses `userAgent: "*"` with
  no bot-specific overrides, so common AI crawlers (GPTBot, ClaudeBot,
  Google-Extended, PerplexityBot, etc.) are allowed exactly like any
  other crawler; `next.config.ts`'s `securityHeaders` contain no
  `X-Robots-Tag` or bot-blocking header. No `llms.txt` existed prior to
  this module (confirmed by repository search).

## C. What Module 117 Implemented

1. **`/llms.txt`** (`src/app/llms.txt/route.ts`) — a small, factual,
   supplementary text file: site name and one-line description (reusing
   `SITE_NAME`/`SITE_DESCRIPTION`, never a new, drifting copy), links to
   the same public pages already in the sitemap, and links to
   `/sitemap.xml`/`/robots.txt`. No marketing claims, no fabricated
   statistics, no duplication of page content. See §"llms.txt Decision"
   below for the scope reasoning.
2. **`buildServiceJsonLd()`** (`src/shared/seo/structured-data.ts`) — a
   reviewed, tested, but currently **unused** `Service` JSON-LD builder,
   added specifically so Module 118 has a ready shape to call when real
   per-service pages exist, rather than inventing one then. Not wired
   into any page — there is no service page yet to attach it to, and
   attaching it to a page that doesn't actually describe that service
   would violate "structured data must accurately describe the visible
   page content."
3. **Documentation note on `buildOrganizationJsonLd()`** — explains why
   `sameAs` is intentionally omitted today (no verified official
   external profile exists) and exactly what to add when one does. No
   behavioral change.
4. **Tests** for both of the above (see §"Tests Added").

Nothing else in the existing SEO surface (metadata, sitemap, robots,
existing JSON-LD builders, canonical URLs, OG/Twitter) was changed.

## D. Public Route Inventory

| Route | Status | Notes |
|---|---|---|
| `/` | Public, indexable | Homepage |
| `/professionals` | Public, indexable | Search/browse; canonical = bare path |
| `/professionals/[id]` | Public, indexable | Per-profile canonical, dynamic metadata |
| `/companies/[id]` | Public, indexable | Per-profile canonical, dynamic metadata |
| `/search` | Public, indexable | Canonical = bare path |
| `/sitemap.xml` | Public | Generated |
| `/robots.txt` | Public | Generated |
| `/llms.txt` | Public (**new**) | Generated, supplementary |
| `/manifest.webmanifest` | Public | Generated |
| `/icon`, `/apple-icon`, `/opengraph-image` | Public | Generated placeholder assets |
| `/auth/*` | Public pages, **disallowed in robots.txt** | Token-bearing query strings on reset/verify |
| `/dashboard/*`, `/admin/*`, `/requests`, `/appointments`, `/jobs`, `/messages`, `/disputes`, `/support-tickets`, `/profile`, `/receipts`, `/reviews`, `/notifications`, `/analytics` | Private (auth-required) | Redirected by middleware if signed out; disallowed in robots.txt |
| `/api/*` | Never public | Disallowed in robots.txt |
| `/r/[code]` | Public redirect route | Referral short link; not in sitemap (not a content page) |

## E. Metadata Implementation

VERIFIED — implemented in Module 43, unchanged by this module. Root
layout sets `metadataBase`, a title template, `description`, `keywords`,
`authors`/`creator`/`publisher`, default `robots` policy, `openGraph`,
`twitter`, `icons`, and `manifest`. Every public page overrides
title/description/canonical/OG/Twitter for itself. Dynamic profile pages
build their description from real profile fields (headline, city,
province) — never a fabricated claim.

## F. Canonical URL Strategy

VERIFIED. `SITE_URL` (from `NEXT_PUBLIC_APP_URL`) is the single base;
`absoluteUrl()`/`metadataBase` do all path joining, so no page
string-concatenates a domain. Canonical URLs are deterministic (one
canonical per resource, id-based for profiles), never include query
strings, and never canonicalize an unrelated page to the homepage.

## G. Robots Implementation

VERIFIED, and confirmed still AI-crawler-safe: `userAgent: "*"` allows
every crawler (including AI crawlers) the same default access; the
disallow list only removes genuinely private/authenticated/internal
paths, each one cross-checked by an existing test against
`middleware.ts`'s own protected-route lists. References
`${SITE_URL}/sitemap.xml`. No changes made.

## H. Sitemap Implementation

VERIFIED. Contains only the static public pages and every `ACTIVE`,
non-deleted professional/company profile — no private, admin,
verification-document, or API URLs; no query-string variants. Ready for
Module 118 to extend with service/location pages once those exist (same
file, same pattern — append new static or DB-driven entries).

## I. Organization Structured Data

VERIFIED. `Organization` (`name`, `url`, `logo`) emitted once, root
layout, on every page. No invented address, phone number, founding date,
employee count, or award. `sameAs` intentionally omitted — see §"sameAs".

## J. LocalBusiness Decision

VERIFIED, decision reaffirmed. MaestroYa the platform is represented as
`Organization`, not `LocalBusiness` — it has no storefront, address, or
opening hours of its own. Individual professionals are
`ProfessionalService` (a `LocalBusiness` subtype); companies are
`LocalBusiness`. This correctly avoids misrepresenting every professional
on the platform as a "branch" of MaestroYa. No change needed; this
module's audit confirms the distinction is still accurate to the current
business model.

## K. Service Structured Data Foundation

IMPLEMENTED (foundation only). `buildServiceJsonLd()` added, unused. No
service pages were created — none exist yet, and Module 117's brief
explicitly forbids generating a large service-page system in this
module. **REQUIRES MODULE 118** to actually call this builder from real
per-service (and per-service+location) pages once they exist.

## L. sameAs / External Identity

REQUIRES FUTURE BUSINESS/CONTENT INPUT. No official MaestroYa social or
business-directory profile was found or confirmed to exist. `sameAs` is
left omitted (not populated with a placeholder or guess), with a doc
comment on `buildOrganizationJsonLd()` explaining exactly what to add
and when. Do not add `sameAs` until an official, verified URL exists.

## M. Geographic Signals

VERIFIED / documented, no new pages. Current geographic signal is
`PostalAddress` (`addressLocality`/`addressRegion`, city/province only —
matching `City`/`Province` Prisma models already in the schema) embedded
in each professional's/company's JSON-LD, plus free-text city/province
in profile content itself. The brief's example areas (Gandia, Playa de
Gandia, Valencia/Comunidad Valenciana) are not hardcoded anywhere — a
professional's actual city/province drives this, so coverage is never
claimed beyond what a real active profile supports. **REQUIRES MODULE
118** for any dedicated location landing pages; the existing
`City`/`Province` schema models mean no new data model is needed when
that work starts.

## N. Language/Locale Architecture

VERIFIED, unchanged. See §B — cookie/DB-resolved interface language, no
locale URL segment, therefore no `hreflang` (correct, not a gap — see
Module 43 §3 and `docs/MODULE_29_INTERNATIONALIZATION.md` §3). Spanish
remains the default/complete locale for all public SEO metadata.

## O. Internal Linking

VERIFIED. Homepage links to category grid and professional CTA;
`/professionals` and `/search` are reachable via normal navigation
(header/nav components), not only client-side controls; profile pages
link back via breadcrumbs (`BreadcrumbList` JSON-LD mirrors visible
breadcrumb UI). No new pages were added in this module, so no new links
were needed.

## P. AI Crawler Accessibility

VERIFIED. All public pages are Server Components rendering essential
content (name, description, location, categories) directly in the
initial HTML — none of it is gated behind client-only rendering,
authentication, or an API call the crawler would need to execute
JavaScript to reach. `robots.txt`'s wildcard `userAgent: "*"` treats AI
crawlers (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, etc.)
identically to search engine crawlers — no separate allow/disallow block
for them was added, since the existing policy already permits them and a
per-bot list would only be extra surface to keep in sync for no
behavioral difference. URLs are stable (id-based, no session tokens).

## Q. llms.txt Decision

IMPLEMENTED, as supplementary only. `llms.txt` is not a guaranteed or
primary mechanism for AI visibility — no such guarantee exists for any
mechanism, which this module's brief is explicit about. The file
implemented here is deliberately minimal: it restates facts already
public elsewhere (name, description, canonical page list, sitemap/robots
links) and adds nothing an AI system couldn't already get by crawling the
site directly. It contains no unsupported claims.

## R. Open Graph

VERIFIED, unchanged. Root defaults plus per-page overrides on every
public page; profile pages use the professional's/company's own photo
when available, falling back to the generated `/opengraph-image`. No
fabricated social-proof image.

## S. Security Boundary Review

VERIFIED — re-checked, not assumed:
- `DISALLOWED_PATHS` (`robots-rules.ts`) still matches every
  `middleware.ts` `PROTECTED_PREFIXES`/`ROLE_GATED_PREFIXES` entry plus
  `/api` and `/auth`; the existing `robots-rules.test.ts` enforces this.
- `sitemap.ts` reads only `id`/`updatedAt` off `ACTIVE`, non-deleted
  profiles — no verification documents, financial data, or private
  identifiers.
- No new API route, metadata field, or structured-data builder in this
  module exposes verification, financial, or personal data. The new
  `buildServiceJsonLd()` takes only a name/path/description/area —
  no capability to leak private data even when Module 118 wires it up,
  as long as callers pass only already-public fields (matching the
  existing convention documented in `structured-data.ts`'s own file doc
  comment).
- `llms.txt`'s content was reviewed field-by-field against this same
  bar; it contains no data beyond what `sitemap.ts`/`robots.ts` already
  make public.
- No route, middleware, or auth logic was touched by this module.

## T. Tests Added

- `tests/unit/app/seo/llms-txt.test.ts` (2 tests): asserts the response
  is `text/plain`, contains the site name and every primary public URL,
  and never contains a forbidden marketing-claim pattern (guards against
  regressions like "best marketplace"/"number one"/"guaranteed").
- `tests/unit/shared/seo/structured-data.test.ts` (+3 tests): default
  provider shape, conditional `areaServed`, and provider scoping via
  `providerId` for `buildServiceJsonLd()`.

Total: 5 new test cases, 0 existing tests modified or removed.

## U. Validation Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ Pass, no errors |
| Lint (changed files) | `npx eslint src/app/llms.txt/route.ts src/shared/seo/structured-data.ts tests/unit/app/seo/llms-txt.test.ts tests/unit/shared/seo/structured-data.test.ts` | ✅ Pass, no errors/warnings |
| Lint (full repo) | `npx eslint .` | ✅ Pass, no errors/warnings |
| Targeted tests | `npx vitest run tests/unit/app/seo tests/unit/shared/seo` | ✅ 11 files, 43/43 tests passed |
| `git diff --check` | `git diff --check` | ✅ No whitespace errors |

**Note on the targeted test run:** 3 unrelated, pre-existing test files
(`professional-profile-metadata.test.ts`, `company-profile-metadata.test.ts`,
`root-layout-metadata.test.ts`) log an unhandled `PrismaClientInitializationError`
during the run (the sandbox's Prisma engine binary is built for
`darwin-arm64`, but this device shell reports itself as a
`linux-arm64-openssl-3.0.x` runtime). All 43 tests still pass — the
errors are logged, not thrown as failures — and this is a pre-existing
sandbox/engine-binary mismatch unrelated to this module's changes (the
same class of issue Module 43's own report documented for its sandbox).
Re-run in the project's normal development environment or CI for a
completely clean log.

Full suite (`npm test`) and `npm run build` were not run in this session
— out of scope for this module's targeted changes, and the existing
Module 43 precedent already establishes CI (`.github/workflows/ci.yml`)
as the authoritative full-suite/build gate.

## V. Files Changed

New:
- `src/app/llms.txt/route.ts`
- `tests/unit/app/seo/llms-txt.test.ts`

Modified:
- `src/shared/seo/structured-data.ts` (added `buildServiceJsonLd()` +
  `ServiceJsonLdInput`; added a doc comment to `buildOrganizationJsonLd()`
  about `sameAs`; no existing export's behavior changed)
- `tests/unit/shared/seo/structured-data.test.ts` (added tests for
  `buildServiceJsonLd()`)

Unchanged (verified only): `src/app/layout.tsx`, `src/app/robots.ts`,
`src/app/sitemap.ts`, `src/app/manifest.ts`, `src/shared/seo/site.ts`,
`src/shared/seo/robots-rules.ts`, `src/presentation/components/seo/json-ld.tsx`,
`middleware.ts`, every `(marketing)/**/page.tsx`.

## W. Remaining Work for Module 118

- Build real per-service pages (and, if warranted, per-service+location
  pages) and wire `buildServiceJsonLd()` (added here) into them.
- Add those pages' URLs to `sitemap.ts` once they exist.
- Consider dedicated city/category landing pages for stronger local SEO,
  using the existing `City`/`Province` Prisma models — no new data model
  required.
- Extend `llms.txt` to reference the new pages once they exist.

## X. Remaining Work for Module 119

- Any AI recommendation *monitoring* (checking whether/how AI assistants
  mention MaestroYa) is explicitly out of scope for Module 117's
  foundation work and was not attempted here, per the brief.

## Y. Known Limitations

- Icons/OG image remain Module 43's generated placeholders, not final
  design assets (unchanged, pre-existing gap, tracked in Module 43's own
  report §5).
- `sameAs` stays empty until an official external profile is confirmed
  (REQUIRES FUTURE BUSINESS/CONTENT INPUT).
- Full test suite / `next build` not executed in this session (see §U).

## Z. Final Module 117 Readiness Assessment

The AI Search & Recommendation Visibility Foundation is **substantially
already in place** (via Module 43) and, after this module's audit and
additions, is **ready**: public pages are server-rendered and crawlable,
private areas remain protected (verified against `middleware.ts`),
canonical URLs and structured data are accurate and non-fabricated,
`robots.txt` treats AI crawlers no differently from any other
well-behaved crawler, and a minimal, honest `llms.txt` now exists
alongside a reviewed `Service` structured-data foundation ready for
Module 118. No unsupported claims, fake reviews, fake locations, or
fabricated statistics were introduced. Typecheck, targeted tests, and
lint (scoped and full-repo) all pass; `git diff --check` is clean.
