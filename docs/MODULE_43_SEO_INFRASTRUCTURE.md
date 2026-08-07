# Module 43 — SEO Infrastructure

## 1. Audit summary

Before writing any code, the repository was audited for every SEO surface
listed in the module brief. Result: **no SEO infrastructure existed at
all** prior to this module.

| Area | Status found | Action |
|---|---|---|
| `generateMetadata()` | Missing everywhere | Implemented for both dynamic profile pages |
| Root layout metadata | Partial (`title` template + `description` only) | Completed (`metadataBase`, `alternates`, `robots`, `keywords`, `authors`, `creator`, `publisher`, `openGraph`, `twitter`, `icons`, `manifest`) |
| Static page metadata (`/`, `/professionals`, `/search`) | Partial (bare `{ title }` objects, no description/canonical/OG) | Completed |
| `sitemap.xml` | Missing | Implemented (`src/app/sitemap.ts`) |
| `robots.txt` | Missing | Implemented (`src/app/robots.ts`) |
| Canonical URLs | Missing everywhere | Implemented via `alternates.canonical` on every public page |
| Open Graph | Missing everywhere | Implemented (root + per-page) |
| Twitter Cards | Missing everywhere | Implemented (root + per-page) |
| JSON-LD / structured data | Missing | Implemented (Organization, WebSite+SearchAction, BreadcrumbList, ProfessionalService, LocalBusiness) |
| `metadataBase` | Missing | Implemented |
| `hreflang` / locale alternates | Missing | **Deliberately not implemented** — see §3 |
| Icons / manifest | Missing (no assets in `public/` at all) | Implemented via generated routes (`icon.tsx`, `apple-icon.tsx`, `manifest.ts`) |
| Breadcrumbs (structured data) | Missing | Implemented on both profile pages |
| Local SEO (city/service pages) | No dedicated pages exist | Out of scope — see §3 |
| SEO utilities | None | New `src/shared/seo/*` module |
| SEO tests | None | 10 new test files, 38 new test cases |
| SEO documentation | None | This document |

No existing SEO code was found to reuse, duplicate, or deprecate — every
producer in this module is new. Existing conventions (repository access
patterns, `params: Promise<...>`, Server-Components-by-default, plain
Prisma reads for non-business-logic reference data) were followed
throughout rather than introduced.

## 2. Architecture decisions

### 2.1 `src/shared/seo/` — framework-free SEO utilities

Mirrors the existing `src/shared/i18n/` convention: pure, dependency-free
modules importable from Server Components, the special
`sitemap.ts`/`robots.ts`/`manifest.ts` files, and plain unit tests alike.

- `site.ts` — `SITE_URL`, `SITE_NAME`, `SITE_DESCRIPTION`, `SITE_KEYWORDS`,
  `toOgLocale()`, `absoluteUrl()`. Reads `NEXT_PUBLIC_APP_URL` from
  `process.env` directly rather than through
  `@/infrastructure/config/env` — that module is `server-only` and would
  throw if ever reached from a client bundle; SEO metadata constants must
  stay importable from anywhere.
- `robots-rules.ts` — `DISALLOWED_PATHS`/`ALLOWED_PATHS`, single source of
  truth for `robots.ts`, kept in sync (by a test) with `middleware.ts`'s
  own `PROTECTED_PREFIXES`/`ROLE_GATED_PREFIXES`.
- `structured-data.ts` — plain builder functions returning JSON-LD
  objects. No fetching of their own; every builder takes data a page
  already has in hand.

### 2.2 `src/presentation/components/seo/json-ld.tsx`

One small Server Component (`<script type="application/ld+json">`)
shared by every producer of structured data, so escaping/serialization
logic lives in exactly one place.

### 2.3 No new repository/use-case abstractions

`sitemap.ts` reads `prisma.professionalProfile`/`prisma.companyProfile`
directly (id + `updatedAt` projection only) rather than adding a new
method to `ProfessionalDiscoveryRepository`/`CompanyDiscoveryRepository`.
This matches the existing precedent of page components reading `prisma`
directly for plain reference-data queries with no business logic (see
`(marketing)/page.tsx`'s category read) and avoids widening two
domain-layer interfaces — and every in-memory fake that implements
them across `tests/integration/**` — for a read with no business rule of
its own.

### 2.4 `generateMetadata` + React `cache()`

Both dynamic profile pages (`professionals/[id]`, `companies/[id]`) wrap
their use-case call in React's `cache()` so `generateMetadata` and the
page component share one fetch per request. Next.js does not dedupe
arbitrary async function calls the way it dedupes `fetch()` — without
this, the same Prisma-backed use case would run twice per request
(Requirement 10: "Avoid duplicated queries").

### 2.5 Generated icons/OG image, not static assets

`public/` contains no design assets at all (confirmed during audit — see
§1). Rather than leave `<link rel="icon">` and Open Graph images entirely
absent, `icon.tsx`, `apple-icon.tsx`, and `opengraph-image.tsx` use
Next's `ImageResponse` file-convention to generate a minimal placeholder
(brand primary color + "M" mark / site name) at request time. This is
trivially replaceable with static assets later — Next resolves a static
`app/icon.png` the same way, no metadata change required. See "Known
gaps" (§5).

## 3. Scope decisions (what was deliberately NOT built)

- **No `hreflang`/locale-URL alternates.** This app's i18n architecture
  (Module 29) deliberately has **no `/[locale]/...` URL segment** —
  language is a per-user/cookie preference, not a URL property (see
  `middleware.ts`'s own `negotiateLocale` doc comment and
  `docs/MODULE_29_INTERNATIONALIZATION.md` §3). `hreflang` requires a
  distinct URL per language variant; inventing one would mean rewriting
  Module 29's routing decision, which this module's brief explicitly
  forbids ("DO NOT rewrite existing architecture"). Every page therefore
  gets exactly one canonical URL, independent of the visitor's
  negotiated language.
- **No dedicated city/category landing pages.** `City` and
  `ServiceCategory` have no page of their own today — discovery is
  entirely through `/professionals` and `/search`'s query-string filters.
  Building `/cities/[city]` or `/categories/[slug]` pages would be a new
  product feature, out of this module's scope ("DO NOT perform unrelated
  refactoring"). Local SEO signal instead comes from the `PostalAddress`
  (city/province) already embedded in each professional's/company's
  `ProfessionalService`/`LocalBusiness` JSON-LD.
- **No `/companies` sitemap/robots entry.** No such listing page exists
  (only `/companies/[id]`) — company discovery happens via
  `/professionals` and `/search`.
- **Query-string search pages are not enumerated in the sitemap.**
  `/professionals`/`/search` are listed once, at their bare path; every
  filter combination shares that one canonical URL (`alternates.canonical`)
  rather than being treated as a separate indexable page — this avoids
  thin/duplicate-content URLs, per Requirement 7 ("Avoid duplicate
  indexing").

## 4. Implemented features

### Metadata (`src/app/layout.tsx`)
`metadataBase`, title template, `description`, `keywords`, `authors`,
`creator`, `publisher`, `alternates.canonical`, default `robots` policy,
`openGraph`, `twitter`, `icons`, `manifest`.

### Sitemap (`src/app/sitemap.ts`)
Static pages (`/`, `/professionals`, `/search`) + every `ACTIVE`,
non-deleted professional and company profile, `id`/`updatedAt`-only
Prisma projection, capped at 45,000 rows per entity (under the
50,000-URL sitemap limit).

### Robots (`src/app/robots.ts` + `src/shared/seo/robots-rules.ts`)
Allows `/` by default; disallows every authenticated-only prefix
(`/dashboard`, `/admin`, `/requests`, `/appointments`, `/jobs`,
`/messages`, `/disputes`, `/support-tickets`, `/profile`), `/api`, and
`/auth` (token-bearing password-reset/verify-email links). References
`sitemap.xml`.

### Structured data (`src/shared/seo/structured-data.ts`)
`Organization` and `WebSite` (with `SearchAction` → `/search`) emitted
once in the root layout; `BreadcrumbList` + `ProfessionalService` on
professional profiles; `BreadcrumbList` + `LocalBusiness` on company
profiles, including `PostalAddress` (city/province only — never exact
coordinates) and `AggregateRating` when a rating exists.

### Open Graph / Twitter Cards
Root defaults + per-page overrides on the homepage, `/professionals`,
`/search`, and both dynamic profile pages. Profile pages use the
professional's/company's own photo as the OG/Twitter image when one
exists; every other page falls back to the generated `/opengraph-image`.

### Canonical URLs
Every public page sets `alternates.canonical` to its own bare path.

### Local SEO
`PostalAddress` (city/province) in profile JSON-LD; see §3 for what was
out of scope.

### Icons / manifest
`icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx` (generated),
`manifest.ts` (Web App Manifest at `/manifest.webmanifest`).

## 5. Known gaps / follow-ups

- **No real design assets.** Generated icons/OG image are a placeholder
  (brand color + "M"/site name) — replace with real static assets under
  `public/` (or `app/icon.png`, etc.) once design delivers them; no other
  code change is required when that happens.
- **`ProfessionalPublicProfileRecord` has no rating fields.** Unlike
  `CompanyPublicProfileRecord`, the professional public-profile read
  model doesn't expose `averageRating`/`reviewCount` (a prior module's
  deliberate scoping — see that interface's own doc comment). Professional
  `ProfessionalService` JSON-LD therefore never includes `aggregateRating`
  today; extending the read model to add that back is a Reviews & Ratings
  module concern, not this one.
- **City/category landing pages** (§3) would meaningfully improve local
  SEO further but are a product/content feature, not infrastructure —
  proposed as a future module.

## 6. Testing

10 new test files, 38 new test cases, under `tests/unit/shared/seo/` and
`tests/unit/app/seo/`:

- `structured-data.test.ts` — every JSON-LD builder, including negative
  cases (no rating yet, no address, never leaks exact coordinates).
- `site.test.ts` — `SITE_URL` normalization/fallback, `absoluteUrl`,
  `toOgLocale`.
- `robots-rules.test.ts` — cross-checks `DISALLOWED_PATHS` against
  `middleware.ts`'s auth-gated prefixes.
- `robots.test.ts` — the actual `robots()` route output.
- `sitemap.test.ts` — mocked-Prisma coverage of both the resulting URLs
  and the exact query shape (`ACTIVE`/non-deleted filter, `id`/`updatedAt`
  projection).
- `manifest.test.ts` — manifest shape.
- `json-ld.test.tsx` — the `<script>` renderer, including a
  `</script>`-injection escaping test.
- `root-layout-metadata.test.ts`, `professional-profile-metadata.test.ts`,
  `company-profile-metadata.test.ts` — `generateMetadata`/`metadata`
  output for the root layout and both dynamic profile pages, including
  the "unknown id → empty metadata, never a fabricated title" case.

No existing test was modified or removed.

## 7. Validation results

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | ✅ Pass, no errors |
| `npm run lint` (`eslint .`, full repo) | ✅ Pass, no errors or warnings |
| `npm test` (`vitest run`) | ⚠️ Could not execute in this sandbox |
| `npm run build` (`next build`) | ⚠️ Could not execute in this sandbox |

**Why test/build couldn't run here:** this sandbox is Linux/arm64, but
`node_modules` (and the SWC/Rollup native binaries it contains) were
installed on a macOS/arm64 machine — `rollup`/Next's SWC both ship
platform-specific native binaries, and the Linux ones are missing. The
sandbox has no network access to the npm registry (`npm ping` itself
returns `403 Forbidden`) to install them. This is confirmed pre-existing
and unrelated to this module: running an *existing, untouched* test file
(`tests/unit/core/infrastructure/prisma-language-repository.test.ts`)
fails with the identical `Cannot find module @rollup/rollup-linux-arm64-gnu`
error before any Module 43 code executes.

Both `tsc` and `eslint` are pure-JS tools with no native binary
dependency, which is why they ran cleanly and give real signal that every
new and modified file is type-correct and lint-clean. `vitest run
tests/unit/app/seo tests/unit/shared/seo` (and the full suite) should be
re-run in the project's normal (macOS) development environment or CI to
get an executed pass/fail result before merging — the CI pipeline
(`.github/workflows/ci.yml`), which installs its own platform-matched
`node_modules` from `package-lock.json`, is not subject to this sandbox
limitation.
