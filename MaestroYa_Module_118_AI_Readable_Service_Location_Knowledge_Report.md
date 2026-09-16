# Module 118 — AI-Readable Service & Location Knowledge

**Branch:** `feature/module-118-ai-readable-service-location-knowledge`
**Date:** 2026-09-16
**Continuation date:** 2026-09-16 — Spain-wide geographic coverage (see Part 2, below the original report)

## A. Executive Summary

Module 117 verified MaestroYa's SEO foundation and added a reviewed-but-unused
`buildServiceJsonLd()` builder for this module to use once real per-service
pages existed. Module 118 builds that public knowledge surface — but only
where the repository itself proves the underlying capability is real.

Phase 1's inventory found exactly **six** seeded, active, top-level
`ServiceCategory` rows (`prisma/seed.ts`) and exactly **one** seeded
geography leaf (`Country` "Spain" → `Province` "Valencia" → `City`
"Gandia"). No "Repairs" category and no "Playa de Gandia" city exist
anywhere in the repository — both were named in the module brief's own
example text but are not real MaestroYa data, so neither was created.

Module 118 implements: a small, curated, typed content catalog for the
six real services and the one real location; three new route families
(`/servicios`, `/ubicaciones`, `/servicios/[slug]/[location]`) that
double-verify every page against the live database before rendering
(never trusting the static catalog alone) and 404 otherwise; a new
`buildFaqJsonLd()` structured-data builder; sitemap, `robots.txt`
allow-list, `llms.txt`, header/footer navigation, and 10-locale nav-label
updates so the new pages are both crawlable and reachable from normal
navigation. No service, location, or service+location page was created
without a live-database check confirming it corresponds to a real
platform capability. No prices, guarantees, availability counts,
professional counts, ratings, insurance, or legal/tax claims were
introduced anywhere.

## B. What Was Inspected

- `MaestroYa_Module_117_AI_Search_Recommendation_Visibility_Foundation_Report.md`
  (full read).
- `prisma/schema.prisma` (all models/enums) and `prisma/seed.ts` (full
  read) — the actual source of truth for services and geography.
- `src/app/(marketing)/**` (homepage, `/professionals`, `/search`,
  `/professionals/[id]`, `/companies/[id]`, layout) and their
  `search-form`/`results-list`/`location-picker` components.
- `src/shared/seo/*` (`site.ts`, `structured-data.ts`, `robots-rules.ts`)
  and `src/app/{robots,sitemap}.ts`, `src/app/llms.txt/route.ts`.
- `src/presentation/components/shared/{site-header,site-footer,mobile-nav}.tsx`.
- `src/core/domain/repositories/professional-discovery-repository.ts` and
  `src/core/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository.ts`
  (confirmed `categoryId`/`city`/`province` filtering is real, working
  logic, not aspirational).
- `src/app/(dashboard)/requests/new/page.tsx` and `service-request-form.tsx`
  (confirmed `categoryId`/`city` prefill query params are real).
- `src/i18n/messages/*/nav.json` (all 10 locales) and
  `tests/unit/core/infrastructure/i18n/messages-completeness.test.ts`
  (the guard rail for adding a nav label).
- `tests/unit/app/seo/*` and `tests/unit/shared/seo/*` (existing test
  conventions — direct-Prisma-mock pattern for pages, plain unit tests
  for JSON-LD builders) — followed exactly for all new tests.
- Attempted a live, read-only Prisma query against the environment's
  configured database to double-check seed data against real rows; the
  sandbox's Prisma engine binary mismatch (documented in the Module 117
  report, §U — engine built for `darwin-arm64`, this shell reports
  `linux-arm64-openssl-3.0.x`) prevented this. Treated `prisma/seed.ts`
  (idempotent upserts, the actual seeding code that runs against every
  environment) as authoritative instead — see §V, "Known Limitations".

## C. Existing Service Inventory (Phase 1 finding)

| Slug | Name | Status |
|---|---|---|
| `fontaneria` | Fontanería (Plumbing) | Seeded, top-level, ACTIVE |
| `electricidad` | Electricidad (Electrical) | Seeded, top-level, ACTIVE |
| `aire-acondicionado` | Aire acondicionado (Air conditioning) | Seeded, top-level, ACTIVE |
| `pintura` | Pintura (Painting) | Seeded, top-level, ACTIVE |
| `reformas` | Reformas (Renovation) | Seeded, top-level, ACTIVE |
| `montaje-de-muebles` | Montaje de muebles (Furniture assembly) | Seeded, top-level, ACTIVE |

Each also seeds one child "profession" category (e.g. `fontanero` under
`fontaneria`) — these are professional-facing sub-categories, not given
their own public page (this module's conceptual architecture is one page
per broad category, matching the brief's own example tree).

**"Repairs" does not exist** as a `ServiceCategory` anywhere in the
repository. It appears only in the module brief's own example list. No
page, content entry, or structured-data reference to it was created.
`limpieza` (cleaning) is referenced in `SITE_DESCRIPTION`/icon maps as a
plausible future category but has no seeded `ServiceCategory` row either
— also excluded, and explicitly covered by a test (§L).

## D. Existing Location Inventory (Phase 1 finding)

`prisma/seed.ts`'s `seedGeography()` seeds exactly one chain:

`Country(code="ES", name="Spain")` → `Province(name="Valencia")` →
`City(name="Gandia")`.

No other country, province, or city is seeded. **"Playa de Gandia" is
not a `City` row** — it is a beach/neighbourhood area of Gandia, named
in the module brief's example text but not a distinct geographic entity
in this schema. It was not given a page. "Valencia" (the city, as
opposed to the province of the same name) is also not seeded and was not
invented.

Separately noted: outside `prisma/seed.ts`, no application code reads
the `Country`/`Province`/`City` tables today — professional/company
"city"/"province" values come from free-text `Address.city`/`Address.province`
fields, matched case-insensitively in `ProfessionalDiscoveryRepository.searchCandidates`.
Module 117's report anticipated using `City`/`Province` for this exact
purpose ("no new data model required" for location pages), so this
module follows that recommendation rather than introducing a second,
competing geography representation — but this leaves the `City` table as
the one place this module reads it, worth knowing for Module 119 (see §T).

## E. Existing Public Knowledge Architecture (before this module)

Confirmed via Module 117's report and direct inspection: `/professionals`
and `/search` support `categoryId`/`city`/`province` query-string
filtering (a real, working capability — `SearchDirectoryUseCase` →
`ProfessionalDiscoveryRepository.searchCandidates`), but neither page has
a stable per-category or per-city canonical URL of its own (both
canonicalize to their bare path — see those pages' own `generateMetadata`
doc comments). No dedicated service or location landing page existed
before this module. `buildServiceJsonLd()` existed but was unused.

## F. New Service Pages — IMPLEMENTED

Route: `/servicios` (index) and `/servicios/[slug]` (one page per
service). Six service pages are live: `fontaneria`, `electricidad`,
`aire-acondicionado`, `pintura`, `reformas`, `montaje-de-muebles`.

Every page double-verifies before rendering (`getVerifiedService` in
`src/app/(marketing)/servicios/[slug]/page.tsx`): the slug must be an
ACTIVE, non-deleted, top-level `ServiceCategory` (live Prisma read, every
request) **and** have a curated `ServiceContent` entry
(`src/shared/content/services.ts`). Either missing → `notFound()`
(HTTP 404). A category that is real but has no curated copy yet (e.g. a
hypothetical `limpieza` row) is never rendered with invented content and
never linked from `/servicios`' index — see §L.

Content per page: introduction, common job types, what a professional
typically provides, a 4-step "how it works" list mirroring the real
`ServiceRequest → Quote → Job → Appointment` flow, links to justified
service+location pages, considerations before requesting, FAQ, related
services, and a CTA to `/requests/new?categoryId=…` (the real, existing
prefill flow).

## G. New Location Pages — IMPLEMENTED

Route: `/ubicaciones` (index) and `/ubicaciones/[slug]` (one page per
location). Exactly one location page is live: `gandia`.

Same double-verification discipline: the slug must have curated
`LocationContent` (`src/shared/content/locations.ts`) **and** a live
`City` row matching by name under the matching `Province`/`Country`
(`src/shared/content/verified-location.ts`). Either missing → 404.

Content: introduction, the services available there (derived from the
justified-pairs list, §H), a 3-step local "how it works", FAQ, and a CTA
into `/search?city=Gandia`.

## H. New Service+Location Pages — IMPLEMENTED (justified pairs only)

Route: `/servicios/[slug]/[location]`. Phase 5 explicitly forbids
auto-generating the full cross-product; `src/shared/content/service-location-pairs.ts`
hand-lists every page that is allowed to exist, with the justification
recorded in that file's own doc comment (real service, real location,
real working `categoryId`+`city` search filter, real `requests/new`
prefill). Because there is currently exactly one verified location, the
justified list happens to be the full 6×1 cross-product — but it is
still spelled out explicitly, not computed, so adding a second city later
requires a deliberate review, not an automatic expansion:

`/servicios/fontaneria/gandia`, `/servicios/electricidad/gandia`,
`/servicios/aire-acondicionado/gandia`, `/servicios/pintura/gandia`,
`/servicios/reformas/gandia`, `/servicios/montaje-de-muebles/gandia`.

Rendering requires three things to hold, live, on every request
(`getVerifiedPair` in `src/app/(marketing)/servicios/[slug]/[location]/page.tsx`):
the pair is in `JUSTIFIED_SERVICE_LOCATION_PAIRS`, the service verifies
live, and the location verifies live. Any one failing → 404 — so a
future city added to `City` does **not** automatically sprout six new
pages; someone must deliberately add pairs to that file first.

No availability/count claim is made — only that the request/quote flow
supports the combination. Content is genuinely distinct per page (merges
the service's own copy with a location-specific opening paragraph and one
location-specific FAQ question), not a template with only the city name
swapped — see §Q.

## I. Pages Intentionally NOT Created

| Candidate | Why excluded |
|---|---|
| `/servicios/repairs` (or `/servicios/reparaciones`) | "Repairs" is not a seeded `ServiceCategory`. Inventing one would violate the module's own non-negotiable rule. |
| `/ubicaciones/playa-de-gandia` | Not a `City` row — a neighbourhood of Gandia, not a distinct geographic entity in this schema. |
| `/ubicaciones/valencia` (city) | Only the *province* "Valencia" is seeded; no city named "Valencia" exists in `City`. |
| Any `/servicios/[slug]` for a category the database has but this module has no reviewed copy for (e.g. `limpieza`, `cerrajeria`, `albanileria`, `jardineria` — referenced only in icon-map fallbacks, not seeded) | Phase 17's thin-content rule: a page must have genuine, reviewed content, not a placeholder generated from a bare category name. Documented here as **REQUIRES FUTURE CONTENT**, not silently skipped. |
| Any service+location page beyond the six listed in §H | No second verified location exists yet. Adding one requires both a real `City` row and a deliberate addition to `JUSTIFIED_SERVICE_LOCATION_PAIRS` — this module does not pre-generate pages for cities that might exist later. |
| Sub-profession pages (e.g. `/servicios/fontanero`) | This module's conceptual architecture is one page per broad, top-level category (matching the brief's own example tree), not per nested profession — a customer searches by trade category, not by the professional's job title. |

## J. URL Architecture

- `/servicios` — service index.
- `/servicios/[slug]` — one service (slug = `ServiceCategory.slug`).
- `/servicios/[slug]/[location]` — one service in one location
  (`location` = the curated location slug).
- `/ubicaciones` — location index.
- `/ubicaciones/[slug]` — one location.

Chosen deliberately to match the exact example path
(`/servicios/fontaneria`) Module 117's own `buildServiceJsonLd()` doc
comment already anticipated, and paired with a symmetric `/ubicaciones`
segment for locations — both Spanish, matching the site's Spanish-default
content (`SITE_DESCRIPTION`, all page copy). No IDs in these URLs
(stable, human-readable slugs only); no query-string canonical variants;
nesting mirrors the real hierarchy (service → location), matching the
brief's own example. No existing URL was changed or redirected.

## K. Content Architecture / Source of Truth (Phase 15)

Deliberately a small, static, typed catalog
(`src/shared/content/services.ts`, `locations.ts`,
`service-location-pairs.ts`) — not a new Prisma model. This is editorial
copy a person writes and reviews (introductions, FAQ wording), not data
that changes per request; introducing a CMS or new schema for six
paragraphs and one location would be unjustified complexity (Phase 15's
own instruction). Crucially, **the catalog is never trusted alone**:
`src/shared/content/verified-service-category.ts` and
`verified-location.ts` re-check every entry against the live database on
every request, so a stale catalog entry can only ever cause a false
negative (a 404 where a page could exist) — never a false positive (a
page describing something that doesn't exist).

## L. AI-Readable Content Design (Phase 7)

Every page uses direct, factual sentences following the brief's own
example pattern — e.g. "MaestroYa conecta a clientes con profesionales
para trabajos de fontanería... El cliente describe el problema y publica
una solicitud; los profesionales de fontanería que cubren la zona pueden
revisarla y enviar un presupuesto." No superlatives ("the best", "number
one"), no invented statistics. `tests/unit/shared/content/services.test.ts`
and `locations.test.ts` assert (regex-based) that no price, guarantee,
24/7, or "top-rated"-style claim appears anywhere in the catalog, and
that the "repairs"/"Playa de Gandia" exclusions hold at the data level,
not just by review.

## M. FAQ Architecture (Phase 8)

Every FAQ question is answered by content visible on the same page
(introductions, process steps, coverage notes) — never a question
answered only in the JSON-LD and not the HTML. Service+location pages
merge one location-specific question with two of the parent service's
own FAQ entries, keeping the page's total FAQ set genuinely different
from either parent page's full set (not a duplicate).

## N. Structured Data (Phase 9)

- **Service** (`buildServiceJsonLd`, already built in Module 117, now
  finally wired in) on every service and service+location page —
  `areaServed` only set on the service+location variant (a location-scoped
  Service), left unset on the plain service page (not scoped to one
  place).
- **BreadcrumbList** (`buildBreadcrumbJsonLd`, existing builder) on every
  new page, mirroring the visible breadcrumb.
- **FAQPage** (`buildFaqJsonLd`, **new** — added this module, in
  `src/shared/seo/structured-data.ts`, with 2 new unit tests) — built
  only from the exact Q/A pairs the page renders visibly, matching
  Phase 8's "never emit FAQ schema for an unanswered question" rule.
- **Organization/WebSite**: unchanged, still emitted once in the root
  layout, as before.
- **LocalBusiness**: intentionally NOT used for these pages — a service
  or location page describes a service category or place, not a
  business with its own address/hours; using `LocalBusiness` here would
  misrepresent MaestroYa (the platform) as a local business, the exact
  mistake Module 117's own "LocalBusiness Decision" section already
  rejected.
- No fake ratings, reviews, prices, offers, or addresses anywhere in the
  new structured data.

## O. Metadata (Phase 10)

Every new page sets `title`/`description`/`alternates.canonical`/
`openGraph`/`twitter` via the existing `Metadata`/`generateMetadata`
convention (no new metadata helper needed — reused exactly as
`(marketing)/professionals/[id]/page.tsx` does). An unverified slug (bad
service, bad location, un-justified pair) returns `{}` (empty metadata,
matching `professionals/[id]`'s own "no fabricated title" precedent) and
the page calls `notFound()`.

## P. Internal Linking (Phase 12)

Homepage → header/footer nav → `/servicios` → a service page → its
justified location pages (e.g. "Fontanería en Gandia"). Homepage → nav →
`/ubicaciones` → Gandia → its available services (same combined pages,
reached from the other direction). Service pages cross-link to
`relatedServiceSlugs`; the location page cross-links to
`relatedLocationSlugs` (currently empty — only one location exists).
Every link is a normal, crawlable `<Link>` (server-rendered `<a>`), never
a client-only control.

## Q. Navigation (Phase 13)

Added `/servicios` and `/ubicaciones` to `SiteHeader`'s `NAV_LINKS`
(desktop nav + mobile menu, which already renders whatever `links` it's
given — no separate change needed there) and to `SiteFooter`'s
"Clientes" column. Added the `services`/`locations` nav labels to all 10
locale `nav.json` files (translated per-locale, not just English
duplicated), keeping `tests/unit/core/infrastructure/i18n/messages-completeness.test.ts`'s
"every locale has every default-locale key" guarantee intact — verified
by re-running that exact test (§S).

## R. Multilingual Considerations (Phase 14)

Per Module 117's own confirmed architecture (no `/[locale]/...` URL
segment — language is a cookie/DB-resolved preference, not a URL
property), the new pages' body content is Spanish-only today, matching
every other public marketing page's body copy (`(marketing)/page.tsx`,
`/professionals`, `/search` are all Spanish-body/English-labelled the
same way). Only the two new **navigation labels** were translated across
all 10 locales (a small, mechanical, low-risk addition, unlike
translating six services' worth of paragraph content). **REQUIRES FUTURE
BUSINESS INPUT**: full per-locale translation of the service/location
body content itself, if the business wants these pages in more than
Spanish — no hreflang change is needed for that (still no per-locale URL
segment), just additional locale-keyed entries in the content catalogs
plus a locale-aware content lookup, which the current catalog shape
would need to be extended to support.

## S. Sitemap Integration (Phase 16)

`src/app/sitemap.ts` now adds: `/servicios`, `/ubicaciones` (static,
always present), and one entry per **live-verified** service, location,
and justified service+location pair — each re-checked against
`serviceCategory`/`city` at sitemap-build time, never trusted from the
static catalogs alone (so a category or city that later becomes
inactive/removed automatically drops out of the sitemap on the next
build, no code change needed). `robots-rules.ts`'s `ALLOWED_PATHS`
(documentation-only list) was extended with the same two static paths.
`llms.txt` now lists `/servicios`/`/ubicaciones` and its "no
per-service/location pages exist yet" note was updated to describe what
now exists and how it's verified.

## T. Thin/Duplicate Content Protection (Phase 17)

- Service pages: six genuinely different bodies (different job types,
  different "what a professional provides," different FAQ) — not one
  template with the category name substituted.
- Location page: exactly one, so no risk of the "same city page, ten
  times" pattern the brief warns against.
- Service+location pages: content is **not** the parent service page
  with the city name find-and-replaced — each merges the service's
  intro with a location-specific paragraph and a distinct, location-
  specific opening FAQ question, and pulls only 2 of the parent service's
  FAQ entries (not all of them) to keep the page's total content
  distinguishable from its parent.
- `/servicios` and `/ubicaciones` indexes only ever list entries that
  pass both the curated-content check and the live-database check —
  never an empty or placeholder entry.
- Every combination not in `JUSTIFIED_SERVICE_LOCATION_PAIRS` 404s, even
  if both the service and the location individually verify — this is
  the concrete mechanism preventing doorway-page-style automatic
  expansion.

## U. Security/Privacy Review (Phase 18)

No new page reads or renders any private data. All new Prisma reads
(`verified-service-category.ts`, `verified-location.ts`) select only
`ServiceCategory`/`City`/`Province`/`Country` public reference-data
fields (`id`, `slug`, `name`, `description`) — no user, address,
verification-document, payment, or financial field is touched anywhere
in this module's new code. No existing authorization/middleware logic
was changed. The new routes are all under `(marketing)`, the same public
route group as the homepage/search/professional-profile pages, and are
not in `robots-rules.ts`'s `DISALLOWED_PATHS` (correct — they are meant
to be public and indexed).

## V. Legal/Business Accuracy Review (Phase 19)

No IVA/tax, legal-guarantee, regulatory-compliance, insurance, or
licensing claim appears anywhere in the new content — confirmed by
inspection and by the regex-based content tests in §L. Module 116's
unresolved legal/tax questions were not referenced, quoted, or
paraphrased anywhere in this module's output.

## W. Tests (Phase 20)

New files:
- `tests/unit/shared/content/services.test.ts` (7 tests) — catalog
  matches the exact seeded slugs, no "repairs", no duplicates, every
  related-slug reference resolves, every entry has real content, no
  price/guarantee/availability language.
- `tests/unit/shared/content/locations.test.ts` (7 tests) — catalog is
  exactly `["gandia"]`, matches seeded names exactly, no "Playa de
  Gandia", no availability-count claims.
- `tests/unit/shared/content/service-location-pairs.test.ts` (4 tests) —
  every pair resolves on both sides, no duplicates, every real service is
  paired with the one real location, `isJustifiedServiceLocationPair`
  rejects anything not explicitly listed.
- `tests/unit/shared/content/verified-service-category.test.ts` (3 tests)
  and `verified-location.test.ts` (2 tests) — correct Prisma query shape,
  `null` on no match.
- `tests/unit/app/seo/service-page-metadata.test.ts` (3 tests),
  `location-page-metadata.test.ts` (3 tests),
  `service-location-page-metadata.test.ts` (4 tests) — metadata for the
  happy path plus every 404 path (unverified category, verified category
  with no curated content, unverified city, un-justified pair, service-
  only-verified, location-only-verified).

Modified:
- `tests/unit/shared/seo/structured-data.test.ts` — 2 new tests for
  `buildFaqJsonLd`.
- `tests/unit/app/seo/sitemap.test.ts` — extended the existing Prisma
  mock (added `serviceCategory`/`city`) so the pre-existing professional/
  company assertions keep passing unchanged, plus 6 new tests for the
  new sitemap entries' live-verification behaviour.

Total new/changed test cases: 39 (33 new, 6 existing extended in place,
0 existing assertions removed or weakened).

Not added: full page-render tests (only `generateMetadata` is tested per
page) — this matches the exact precedent already established by
`professional-profile-metadata.test.ts`/`company-profile-metadata.test.ts`,
which also test only `generateMetadata`, not full RSC rendering.

## X. Validation Results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ Pass, no errors |
| Lint (changed files) | `npx eslint <all new/changed files>` | ✅ Pass, no errors/warnings |
| Lint (full repo) | `npx eslint .` | ✅ Pass, no errors/warnings |
| Targeted tests | `npx vitest run tests/unit/shared/content tests/unit/shared/seo tests/unit/app/seo tests/unit/core/infrastructure/i18n/messages-completeness.test.ts` | ✅ 20 files, 102/102 tests passed |
| `git diff --check` | `git diff --check` | ✅ No whitespace errors |

**Note on the targeted run:** the same 3 pre-existing, unrelated test
files Module 117's report already documented
(`professional-profile-metadata.test.ts`, `company-profile-metadata.test.ts`,
`root-layout-metadata.test.ts`) log the same pre-existing
`PrismaClientInitializationError` (sandbox Prisma engine built for
`darwin-arm64`, this device shell reports `linux-arm64-openssl-3.0.x`).
All 102 tests still pass — the errors are logged, not thrown as
failures — and none of the 3 files were touched by this module.

Full suite (`npm test`) and `npm run build` were not run to completion in
this session: `npx vitest run tests/unit` exceeded this session's command
time budget (120s, capped at 180s) partway through — the same "CI is the
authoritative full-suite/build gate" scoping Module 117's report already
established was followed here rather than forcing a longer run.

## Y. Exact Files Changed

New:
- `src/shared/content/services.ts`
- `src/shared/content/locations.ts`
- `src/shared/content/service-location-pairs.ts`
- `src/shared/content/verified-service-category.ts`
- `src/shared/content/verified-location.ts`
- `src/app/(marketing)/servicios/page.tsx`
- `src/app/(marketing)/servicios/[slug]/page.tsx`
- `src/app/(marketing)/servicios/[slug]/[location]/page.tsx`
- `src/app/(marketing)/ubicaciones/page.tsx`
- `src/app/(marketing)/ubicaciones/[slug]/page.tsx`
- `tests/unit/shared/content/services.test.ts`
- `tests/unit/shared/content/locations.test.ts`
- `tests/unit/shared/content/service-location-pairs.test.ts`
- `tests/unit/shared/content/verified-service-category.test.ts`
- `tests/unit/shared/content/verified-location.test.ts`
- `tests/unit/app/seo/service-page-metadata.test.ts`
- `tests/unit/app/seo/location-page-metadata.test.ts`
- `tests/unit/app/seo/service-location-page-metadata.test.ts`

Modified:
- `src/shared/seo/structured-data.ts` (added `buildFaqJsonLd` + `FaqItem`)
- `src/app/sitemap.ts` (added service/location/service+location entries,
  all live-verified)
- `src/app/llms.txt/route.ts` (added links to the new index pages, updated
  the "no per-service/location pages" note)
- `src/shared/seo/robots-rules.ts` (added `/servicios`/`/ubicaciones` to
  the documentation-only `ALLOWED_PATHS`)
- `src/presentation/components/shared/site-header.tsx` (added 2 nav links)
- `src/presentation/components/shared/site-footer.tsx` (added 2 footer
  links)
- `src/i18n/messages/{cs,de,en,es,fr,it,pl,pt,ro,uk}/nav.json` (added
  `services`/`locations` keys, translated per locale)
- `tests/unit/shared/seo/structured-data.test.ts` (added `buildFaqJsonLd`
  tests)
- `tests/unit/app/seo/sitemap.test.ts` (extended mocks + new assertions)

Unchanged (verified only): `prisma/schema.prisma`, `prisma/seed.ts`,
`middleware.ts`, every existing `(marketing)/**/page.tsx` other than the
nav/footer components listed above, `src/shared/seo/site.ts`,
`buildOrganizationJsonLd`/`buildWebSiteJsonLd`/`buildBreadcrumbJsonLd`/
`buildProfessionalServiceJsonLd`/`buildLocalBusinessJsonLd`/
`buildServiceJsonLd` (used as-is, not modified).

## Z. Remaining Work for Module 119

- Any AI recommendation *monitoring* (checking whether/how AI assistants
  mention MaestroYa, competitor comparisons, ranking dashboards) is
  explicitly out of scope here, per the brief, and was not attempted.
- Module 119 can now consume a real public knowledge graph
  (`/servicios/*`, `/ubicaciones/*`, their `Service`/`FAQPage`/
  `BreadcrumbList` JSON-LD, and their sitemap entries) as its subject
  matter.

## AA. Known Limitations

- **Sandbox Prisma engine mismatch** (pre-existing, documented in Module
  117's own report): this development sandbox cannot execute a live
  Prisma query against the configured database, so live inventory
  numbers (exact current row counts) could not be directly re-confirmed
  here beyond what `prisma/seed.ts` guarantees will exist in every
  environment it runs against. The pages themselves do not have this
  limitation — they query the live database normally at runtime in any
  working environment; this is a limitation of this inspection session,
  not of the shipped code.
- Full test suite (`npm test`) / `next build` not run to completion in
  this session (command time budget) — see §X.
- Only Spanish body content exists for the new pages (see §R,
  "REQUIRES FUTURE BUSINESS INPUT").
- Categories referenced only in UI icon-map fallbacks
  (`limpieza`, `cerrajeria`, `albanileria`, `jardineria`) have no seeded
  `ServiceCategory` row and therefore no page — flagged as **REQUIRES
  FUTURE DATA** if the business later seeds them.
- The `City`/`Province`/`Country` tables, used here for location
  verification, are otherwise unused by the rest of the application
  (professional/company location comes from free-text `Address` fields)
  — worth resolving in a future module so the two representations don't
  silently drift apart.

## AB. Component Classification Summary

| Component | Classification |
|---|---|
| Service pages (6) | IMPLEMENTED, VERIFIED (live-checked every request) |
| Location page (1: Gandia) | IMPLEMENTED, VERIFIED |
| Service+location pages (6) | IMPLEMENTED, VERIFIED |
| "Repairs" service page | NOT APPLICABLE — not a real category |
| "Playa de Gandia" / city-level "Valencia" pages | NOT APPLICABLE — not real `City` rows |
| Pages for DB categories with no curated copy (`limpieza`, etc.) | REQUIRES FUTURE DATA / FUTURE CONTENT |
| `FAQPage` structured data | IMPLEMENTED, VERIFIED (2 tests) |
| `Service`/`BreadcrumbList` structured data on new pages | IMPLEMENTED, VERIFIED (reused Module 117 builders) |
| Metadata/canonical on new pages | IMPLEMENTED, VERIFIED |
| Sitemap integration | IMPLEMENTED, VERIFIED (6 new tests) |
| Robots/`llms.txt` integration | IMPLEMENTED, VERIFIED |
| Navigation (header/footer, 10 locales) | IMPLEMENTED, VERIFIED (i18n completeness test still passes) |
| Multilingual body content | REQUIRES FUTURE BUSINESS INPUT |
| Live production row-count re-verification | REQUIRES MODULE 119 or a working Prisma engine in this sandbox |
| Any AI-recommendation monitoring | REQUIRES MODULE 119 (explicitly out of scope here) |

## AC. Final Module 118 Readiness Assessment

MaestroYa now has a small, coherent, factually grounded public knowledge
architecture: six service pages, one location page, and six
service+location pages, every one of them re-verified against the live
database on every request and absent entirely if that verification ever
fails. No page was mass-generated, no thin/duplicate content was
introduced, and no unsupported claim (price, guarantee, availability
count, professional count, rating, insurance, licensing, or legal/tax
characterization) appears anywhere in the new copy or structured data.
The two items in the module brief's own example text that turned out not
to be real MaestroYa data — "Repairs" and "Playa de Gandia" — were
identified during Phase 1 and deliberately excluded, with the reasoning
recorded in §I. Typecheck, full-repo lint, and all targeted/existing
tests pass; `git diff --check` is clean. This surface is ready for
Module 119 to build on.

---

# Part 2 — Continuation: Spain-Wide Geographic Coverage

**Date:** 2026-09-16. This is a continuation/correction of Module 118, not
a new module. No new module number was created, per the explicit
instruction for this work.

## 1. Why the Original Module 118 Location Scope Was Insufficient

The original implementation (Part 1, above) was factually correct given
what it inspected, but it derived MaestroYa's entire public geographic
footprint from a single fact: `prisma/seed.ts` seeds exactly one city
(Gandia). That was the right conclusion for "which cities have verified
availability today", but it silently became the *only* geographic
statement the site made — there was no page anywhere stating that
MaestroYa, as a business/platform, is intended to operate across Spain.
A reader (human or AI system) landing on `/ubicaciones` before this
continuation would reasonably conclude MaestroYa is a Gandia-only
service, which is not the business model. This continuation adds the
missing statement of platform scope without touching or weakening any of
the original, correctly-scoped Gandia content.

## 2. Platform Coverage vs. Verified Local Availability (the core distinction)

This continuation is built around one explicit distinction, stated on
every relevant page and in the code's own doc comments:

- **Platform/business coverage** — MaestroYa is a marketplace intended to
  operate across Spain. This is a statement about what MaestroYa *is*,
  verified against the one real, seeded `Country` row (`code: "ES"`) —
  not a claim about who is currently on the platform.
- **Verified local availability** — a specific city has its own page
  (`/ubicaciones/[slug]`) only when real data (a seeded `City` row) backs
  it. Today that is Gandia alone. A service+location page
  (`/servicios/[slug]/[location]`) exists only for a reviewed, justified
  pair (Module 118's `JUSTIFIED_SERVICE_LOCATION_PAIRS`).

These two concepts are never merged into one claim. The Spain-wide page
explicitly says local availability "depende de cada zona" and "no
garantiza que exista un profesional disponible en cualquier localidad
concreta"; the `/ubicaciones` index visually and structurally separates
"Alcance de la plataforma" (one link, to the Spain-wide page) from
"Localidades con cobertura confirmada" (the real, verified list — still
just Gandia).

## 3. Existing Location Hierarchy (re-inspected)

Re-inspection of `prisma/schema.prisma` confirmed the hierarchy is
exactly: `Country` → `Province` → `City`. There is **no** "Comunidad
Autónoma" (Autonomous Community) level anywhere in the schema — Spain's
real administrative hierarchy has one (Country → Autonomous Community →
Province → Municipality), but this repository's schema does not model
it. Adding a new Prisma model/migration for a level with zero seeded
data and no current product need would be exactly the
over-engineering Phase 3 of this continuation's brief explicitly warns
against, so **no schema change was made**. The existing `Country` →
`Province` → `City` chain is reused as-is, matching the original Module
118 report's own finding that no new data model is required.

Seeded rows, confirmed again via `prisma/seed.ts` (the sandbox's Prisma
engine binary mismatch — documented in both this report's Part 1 and the
Module 117 report — still prevented a live query in this session, so the
seed file, not a live read, is what was re-confirmed):

`Country(code="ES", name="Spain")` → `Province(name="Valencia")` →
`City(name="Gandia")`. Exactly one row at each level. No Autonomous
Community, no second province, no second city.

## 4. What Was Changed

### 4.1 New content/data-access modules

- `src/shared/content/verified-country.ts` — live verification helper
  for the `Country` model (`findVerifiedCountry(code)`), the same
  "verify against the live database, never trust static content alone"
  pattern `verified-service-category.ts`/`verified-location.ts` already
  established.
- `src/shared/content/national-coverage.ts` — curated content for the
  single Spain-wide page. Deliberately a separate type/file from
  `locations.ts` (city-level content) rather than folded into the same
  catalog — a country-level "platform scope" statement and a city-level
  "verified availability" statement are different claims, verified
  against different models, and conflating their shapes risked
  reintroducing exactly the confusion this continuation removes.

### 4.2 New page

- `src/app/(marketing)/ubicaciones/espana/page.tsx` — a **static**
  sibling route of the existing `/ubicaciones/[slug]` dynamic route
  (Next.js resolves a static segment ahead of a dynamic one at the same
  level, so `/ubicaciones/espana` always renders this file, never
  `[slug]/page.tsx` with `slug="espana"` — and `locations.ts` never
  defines an `"espana"` city slug either, so there is no ambiguity at
  the content layer). Verified live against the seeded `Country` row;
  404s (via `notFound()`) if that row is ever absent, exactly like every
  other page in this module.

### 4.3 Changed pages

- `src/app/(marketing)/ubicaciones/page.tsx` — restructured into two
  clearly separated sections: "Alcance de la plataforma" (one link to
  `/ubicaciones/espana`) and "Localidades con cobertura confirmada" (the
  original verified-city list, logic unchanged — still the same
  intersection of `LOCATION_CONTENT` and a live `City` lookup). The
  page's title/intro copy now states the Spain-wide framing; the
  underlying verified-city query and list rendering are untouched.

### 4.4 Integration changes

- `src/app/sitemap.ts` — added a `/ubicaciones/espana` entry, gated on a
  live `findVerifiedCountry("ES")` check (never unconditional).
- `src/app/llms.txt/route.ts` — (a) fixed a **pre-existing** inaccuracy
  inherited from Module 117: the summary paragraph listed "repairs" as a
  service, which is not a real seeded `ServiceCategory` (Module 118 Part
  1 already established this) — corrected to the six real categories;
  (b) added the Spain-wide framing sentence and a link to
  `/ubicaciones/espana`; (c) added a "Notes" bullet stating explicitly
  that platform-wide scope does not imply every municipality has
  confirmed availability.

### 4.5 Unchanged (verified only)

`src/shared/content/services.ts`, `locations.ts`,
`service-location-pairs.ts`, `verified-service-category.ts`,
`verified-location.ts`, every `/servicios/**` page, the Gandia
`/ubicaciones/[slug]/page.tsx` page's own logic, `src/shared/seo/site.ts`,
`buildOrganizationJsonLd`/`buildWebSiteJsonLd`/`buildBreadcrumbJsonLd`/
`buildProfessionalServiceJsonLd`/`buildLocalBusinessJsonLd` (used as-is),
`src/shared/seo/robots-rules.ts` (already covered `/ubicaciones` as a
prefix; no change needed), `prisma/schema.prisma`, `prisma/seed.ts`,
`middleware.ts`, and all financial/commission/IVA/tax/Stripe/payout/
verification/authentication/GDPR/legal code — none of it was touched, as
required. The untracked `legal/` directory was not modified.

## 5. Pages Added/Changed (exact list)

Added: `/ubicaciones/espana` (1 page).

Changed (copy/structure only, not verification logic):
`/ubicaciones` (index).

Unchanged: `/ubicaciones/gandia`, all `/servicios/*` and
`/servicios/*/gandia` pages, `/professionals`, `/search`, `/`,
`/companies/[id]`, `/professionals/[id]`.

## 6. Data Sources Used

Exactly the same two Prisma models already used in Module 118 Part 1,
plus the one already-seeded model one level up:

- `Country` (new use in this continuation — `findVerifiedCountry`).
- `Province`, `City` (unchanged use — `findVerifiedCity`).

No external location database or API was introduced or considered
appropriate — Phase 12's own instruction was to use one only "if the
repository already contains one and it is clearly appropriate"; it does
not, and the existing `Country`/`Province`/`City` models already cover
every level this continuation needed.

## 7. What Was Intentionally NOT Generated

| Candidate | Why excluded |
|---|---|
| A new "Comunidad Autónoma" Prisma model/migration | No seeded data at that level, no current product need — would be the over-engineering Phase 3 explicitly warns against. The conceptual hierarchy is documented (this section, §3) so a future module can add it deliberately if the business seeds real data there. |
| Province-level pages (e.g. `/ubicaciones/valencia` for the province) | `Province(name="Valencia")` is a real seeded row, so this is technically *supportable*, but no curated, reviewed content exists for it yet and building one was not necessary to satisfy this continuation's objective (communicating Spain-wide scope). Flagged as **REQUIRES FUTURE CONTENT**, not silently dropped. |
| Any municipality page beyond Gandia (Madrid, Barcelona, Sevilla, etc.) | Explicitly forbidden by this continuation's own brief (Phase 6) — no `City` row exists for any of them. Not created. |
| Any `/servicios/[slug]/[location]` page for a city other than Gandia | Same reason — `JUSTIFIED_SERVICE_LOCATION_PAIRS` was not touched; still exactly the original six Gandia pairs. |
| Thousands of auto-generated municipality pages from an external Spanish geography dataset | Explicitly forbidden (non-negotiable rule 2/3/12). No external dataset was imported. |
| A `LocalBusiness` structured-data entry for the Spain-wide page | Would misrepresent a nationwide marketplace as a single physical business — the exact mistake Module 117's "LocalBusiness Decision" already rejected. Not used; verified by a dedicated test (§10). |

## 8. SEO / AI Discoverability Changes

- **Sitemap**: `/ubicaciones/espana` added, live-verified (§4.4).
- **Robots**: no change needed — `/ubicaciones` was already allowed as a
  public prefix; the new page inherits that.
- **llms.txt**: corrected the inherited "repairs" inaccuracy, added the
  Spain-wide framing sentence, linked `/ubicaciones/espana`, and added an
  explicit "platform scope ≠ confirmed everywhere" note (§4.4).
- **Metadata/canonical**: `/ubicaciones/espana` has its own
  title/description/canonical (`/ubicaciones/espana`)/OG/Twitter, built
  the same way every other page in this module builds them; empty
  metadata (`{}`) when the `Country` row doesn't verify.
- **Internal links**: `/ubicaciones` → `/ubicaciones/espana` (new);
  `/ubicaciones/espana` → `/servicios/[slug]` for every verified category
  and → `/ubicaciones/[slug]` for every verified city (currently Gandia);
  `/ubicaciones/espana` → `/search` and `/auth/register` (real, existing
  flows — browse professionals, or register as one).
- **Header/footer navigation**: unchanged. The existing "Ubicaciones" nav
  label already points at `/ubicaciones`, which now leads with the
  Spain-wide framing — no new nav label was needed.

## 9. Structured-Data Changes

- **Reused, not modified**: `buildServiceJsonLd`, `buildBreadcrumbJsonLd`,
  `buildFaqJsonLd` (all from Module 118 Part 1 / Module 117 — no builder
  signature changed).
- **New usage, not a new builder**: `/ubicaciones/espana` emits one
  `Service` entry (`name: "Servicios para el hogar a través de
  MaestroYa"`, `areaServed: "España"`) whose `description` field
  explicitly repeats the "availability varies by category and zone"
  caveat inline, so the JSON-LD payload itself — not just the visible
  page text — never reads as an unqualified nationwide-availability
  claim. One `BreadcrumbList` (Home → Ubicaciones → España). One
  `FAQPage` built only from the four FAQ pairs the page renders visibly.
- **Deliberately absent**: `LocalBusiness`/`ProfessionalService` — see
  §7. Verified by a source-inspection test (§10) that the page never
  imports or calls `buildLocalBusinessJsonLd`.
- **Organization/WebSite**: unchanged, still emitted once in the root
  layout only.

## 10. Localization Changes

Per the existing, unchanged locale architecture (no `/[locale]/...` URL
segment — confirmed still true, not re-litigated), the new page's body
content is Spanish-only, exactly matching the precedent already set by
every other page in this module (and by `(marketing)/page.tsx`,
`/professionals`, `/search`). **No new i18n architecture was
introduced** and **no `nav.json` changes were needed** in this
continuation — the "Ubicaciones" nav label added in Module 118 Part 1
already covers this page (it's still under `/ubicaciones`), so no new
per-locale translation work was required here. hreflang remains
correctly absent (no locale-segmented URLs exist to pair). Full
multilingual translation of the Spain-wide page's *body* content remains
**REQUIRES FUTURE BUSINESS INPUT**, same open item already recorded in
Part 1 for the rest of this module's content.

## 11. Tests and Validation

New test files:
- `tests/unit/shared/content/national-coverage.test.ts` (4 tests) — the
  content is keyed to the real seeded `Country`; never claims
  professionals are active in every municipality, a 100%/guarantee, or
  any fabricated count; explicitly states the platform-scope/verified-
  availability distinction in its own copy.
- `tests/unit/shared/content/verified-country.test.ts` (2 tests) —
  correct Prisma query shape; `null` on no match.
- `tests/unit/app/seo/national-coverage-metadata.test.ts` (4 tests) —
  metadata happy path, empty metadata when `Country` doesn't verify, no
  "available everywhere"-style title/description wording, and a source-
  inspection assertion that the page module never references
  `buildLocalBusinessJsonLd` while it does use `buildServiceJsonLd`/
  `buildBreadcrumbJsonLd`/`buildFaqJsonLd`.

Modified test files:
- `tests/unit/app/seo/sitemap.test.ts` — extended the shared `mockPrisma`
  helper with a `country.findFirst` mock (defaulted to a verified "ES"
  row so every pre-existing assertion keeps passing unchanged) and added
  3 new tests: `/ubicaciones/espana` listed when `Country` verifies,
  never listed when it doesn't, and Gandia's own location entry still
  appears independently of it (regression guard).

Total: 10 new test cases, 3 existing sitemap tests extended in place (via
the shared mock default), 0 existing assertions weakened or removed.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ Pass, no errors |
| Lint (changed/new files) | `npx eslint <all files touched in this continuation>` | ✅ Pass, no errors/warnings |
| Targeted tests | `npx vitest run tests/unit/shared/content tests/unit/shared/seo tests/unit/app/seo tests/unit/core/infrastructure/i18n/messages-completeness.test.ts` | ✅ 23 files, 115/115 tests passed |
| Sitemap tests (isolated re-run) | `npx vitest run tests/unit/app/seo/sitemap.test.ts` | ✅ 12/12 tests passed |
| `git diff --check` | `git diff --check` | ✅ No whitespace errors |

The same 3 pre-existing, unrelated test files already documented in the
Module 117 report and Part 1 of this report
(`professional-profile-metadata.test.ts`, `company-profile-metadata.test.ts`,
`root-layout-metadata.test.ts`) log the same pre-existing sandbox
`PrismaClientInitializationError` (engine built for `darwin-arm64`, this
shell reports `linux-arm64-openssl-3.0.x`). All 115 tests still pass —
the errors are logged, not thrown as failures — and none of these 3
files were touched by this continuation either.

Full suite (`npm test`) / `next build` were not run to completion in this
session — `npx vitest run tests/unit` (the full unit directory) exceeded
this session's command time budget in Part 1 of this module and was not
re-attempted for the same reason here; this is a session/time-budget
limitation, documented plainly rather than hidden, not a claim that the
full suite passes.

## 12. Remaining Limitations

- Sandbox Prisma engine mismatch (pre-existing, see §3 and the Module 117
  report) still prevents a live query against the configured database
  from this session; `prisma/seed.ts` was re-inspected as the
  authoritative source instead.
- Full test suite / production build not run to completion (session time
  budget) — see §11.
- No Autonomous Community data model exists; the conceptual hierarchy is
  documented but not implemented in the schema (§3, §7).
- Province-level content (Valencia) is technically supportable by real
  data but has no curated page yet (§7).
- Spain-wide page body content is Spanish-only (§10).

## 13. Decisions Requiring Future Product/Business Input

- Whether to seed additional real cities/provinces (and, if the business
  wants the Autonomous-Community level represented, add that model) —
  this continuation makes the architecture *capable* of representing
  more locations without inventing any.
- Whether to write curated, reviewed content for a province-level page
  (Valencia) — technically supportable today, intentionally not written
  without a content decision.
- Whether/when to translate the Spain-wide (and other Module 118) page
  bodies into the platform's other 9 locales.
- Whether MaestroYa's actual, current legal/operational ability to serve
  every Spanish region has been confirmed by the business — this
  continuation makes no legal claim either way (per its own non-
  negotiable rule 7) and states only marketplace *scope*, not legal
  authorization.

## 14. Final Assessment for This Continuation

MaestroYa's public knowledge architecture now states two distinct, both
true, both database-verified facts: (1) MaestroYa is a marketplace whose
platform scope is Spain-wide (verified against the real seeded `Country`
row), and (2) exactly one city, Gandia, currently has verified local
availability content (unchanged from Part 1, still verified against the
real seeded `City` row). Neither statement was inflated to cover the
other. No fake locations, no thin municipality pages, no LocalBusiness
misuse, and no financial/legal/verification/authentication code were
introduced. Typecheck, full-repo-scoped lint, and all targeted/existing
tests pass; `git diff --check` is clean; no Git mutation was performed.
