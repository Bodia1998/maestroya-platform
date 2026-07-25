# Module 19 — Search & Ranking

## Purpose

Module 19 gives customers a single, unified way to find and compare
**individual professionals** and **companies** across the platform, ranked
by a deterministic, explainable set of trust and relevance signals —
answering questions like "find me the best electrician near Gandia" or
"find highly rated, verified professionals for this kind of work."

It extends the existing discovery system (Module 05 — Professional
Discovery, Module 18 — Company Professional) rather than replacing it or
duplicating it. Professional Discovery's per-professional-radius search
(`/professionals`) and Company Professional's category search
(`/companies`) both continue to work exactly as before; Module 19 adds a
new, richer, ranked search on top of the same underlying data (`/search`).

**Module 12 (Payment / Stripe Connect) is intentionally not implemented**
and Module 19 has **no dependency on it whatsoever** — no payment status,
commission, or payout field is read, written, or referenced anywhere in
this module.

## Relationship to Professional Discovery & Company Professional

| | Module 05 / 18 (existing) | Module 19 (this module) |
|---|---|---|
| Route | `/professionals`, `/companies` | `/search` |
| Use case | `SearchProfessionalsUseCase`, `SearchCompaniesUseCase` | `SearchDirectoryUseCase` |
| Matching | Category + precise lat/lng + per-professional radius | Category, free text, city/province, verification, rating, review count |
| Result shape | Professionals and companies as two separate lists | One unified, ranked, discriminated-union list |
| Ranking | None (distance asc / rating desc only) | Full deterministic multi-signal ranking engine |

Module 19 reuses `ProfessionalDiscoveryRepository` and
`CompanyDiscoveryRepository` (the same repositories Module 05/18 already
compose with) by adding one new method to each —
`searchCandidates(filter)` — rather than introducing a parallel repository
architecture. The existing `findActiveCandidatesByCategory` /
`findCandidateById` / `findPublicProfileById(BySlug)` methods, and every
use case that already depends on them, are untouched.

## Architecture

Follows the project's Clean Architecture layering:

```
src/core/domain/
  entities/search-result.ts            — SearchResult discriminated union
  value-objects/search-sort-option.ts  — SearchSortOption enum
  services/
    bayesian-rating.ts                 — confidence-adjusted rating
    profile-completeness.ts            — profile completeness signal
    location-match.ts                  — city/province + coordinate matching
    text-relevance.ts                  — query/token overlap scoring
    ranking-engine.ts                  — pure scoring + explanation engine
  repositories/
    professional-discovery-repository.ts  — + searchCandidates, + fields
    company-discovery-repository.ts       — + searchCandidates, + fields

src/core/application/
  dto/search.dto.ts                            — searchDirectorySchema (Zod)
  use-cases/search/
    search-directory.use-case.ts               — orchestration + sorting/pagination
    compose.ts                                 — composition root

src/core/infrastructure/database/prisma/repositories/
  prisma-professional-discovery-repository.ts  — + searchCandidates impl
  prisma-company-discovery-repository.ts       — + searchCandidates impl

src/app/(marketing)/search/
  page.tsx            — Server Component, reads query string, runs the use case
  search-form.tsx      — client form, navigates with query params (no Server Action)
  results-list.tsx     — renders results + ranking reasons, never a raw score

prisma/migrations/20260731000000_add_search_ranking_module/  — index-only migration
```

Nothing in `src/core/domain` or `src/core/application/use-cases/search`
imports Prisma, Next.js, or any framework type — the ranking engine and its
supporting signal functions are plain, dependency-free TypeScript, fully
unit-testable in isolation.

## Search Flow

```
SearchDirectoryInput (validated by searchDirectorySchema)
        │
        ▼
1. Candidate retrieval  — ProfessionalDiscoveryRepository.searchCandidates
                           CompanyDiscoveryRepository.searchCandidates
                           (category / verification / rating / review-count /
                            city / province / text filters pushed to SQL)
        │
        ▼
2. Filtering            — already applied at retrieval; every candidate
                           returned from step 1 is eligible by construction
                           (ACTIVE, non-deleted — enforced at the query level,
                           never left to the caller)
        │
        ▼
3. Ranking               — RankingSignals computed per candidate, scored by
                            the pure domain ranking engine
        │
        ▼
4. Ranking explanation    — scoreCandidate returns customer-safe reasons
        │
        ▼
5. Sorting                — by the requested SearchSortOption, with a fully
                             deterministic tie-break
        │
        ▼
6. Pagination              — offset-based (page/pageSize)
        │
        ▼
7. Unified result           — SearchResult[] (professionals + companies
                              interleaved), never two separate lists
```

This mirrors the module's required separation: **candidate retrieval**,
**ranking/scoring**, and **result presentation** are three distinct steps
that never mix Prisma queries, ranking mathematics, and UI logic in one
file.

## Candidate Retrieval & Filtering

`ProfessionalSearchFilter` / `CompanySearchFilter` (domain-level, both
optional-field shapes) accept:

- `categoryId` — must offer this `ServiceCategory`
- `query` — free text, matched with case-insensitive `contains` against
  name/business-name/headline (professionals) or name/legal-name/description
  (companies) at the database level
- `city`, `province` — case-insensitive exact match
- `verifiedOnly` — `verificationStatus = VERIFIED` (professionals) /
  `isVerified = true` (companies)
- `minRating`, `minReviewCount` — pushed down as `gte` filters

Every filter is optional; an absent filter matches everything rather than
excluding everything. Eligibility (`status = ACTIVE`, `deletedAt = null`,
`CompanyStatus.ACTIVE`) is **always** enforced inside the repository, never
accepted as a filter from the caller — a suspended, deactivated, pending,
or soft-deleted professional/company can never appear in Module 19 search
results, matching the "Suspended/deleted entities excluded" requirement.

## Ranking Algorithm

`scoreCandidate` (`src/core/domain/services/ranking-engine.ts`) computes:

```
SearchResultScore =
    categoryMatchScore
  + textRelevanceScore
  + locationScore
  + verificationScore
  + ratingScore
  + reviewVolumeScore
  + portfolioScore
  + profileCompletenessScore
  + recencyScore
```

### Ranking weights

| Signal | Weight | Rationale |
|---|---|---|
| Category match | 20 | The single strongest intent signal — did they offer what was searched for. |
| Text relevance | 20 | Free-text query match, scaled by token overlap [0,1]. |
| Location — exact city | 20 | Customers overwhelmingly prefer someone local. |
| Location — same province | 10 | Weaker but still relevant regional signal. |
| Verification | 15 | Verified (Module 17) professionals/companies are a trust signal, but shouldn't alone dominate over relevance/location. |
| Rating (Bayesian) | 15 | Confidence-adjusted, see below — capped so an early 5-star streak can't dominate. |
| Review volume | 5 | A small, separately-capped nudge for proven track record, on top of (not duplicating) the rating score. |
| Portfolio | 5 | Rewards having *a* portfolio, capped at 5 items — not a race to upload the most photos. |
| Profile completeness | 5 | Rewards a fully filled-out profile using only existing fields. |
| Recency | 5 | Small decay-based nudge for newly active accounts, fully decayed after 90 days. |

Every weight is a named constant in `RANKING_WEIGHTS`, specifically so the
formula can be re-tuned later without touching any caller. This is a
starting, documented model — not a claim that these exact numbers are
final; they were chosen so no single signal (especially verification or
rating) can dominate category/location relevance, following the module's
explicit "do not let verification or one review overwhelm everything else"
requirement.

### Bayesian / weighted rating methodology

A professional with one 5-star review must never automatically outrank one
with hundreds of consistently strong reviews. `computeBayesianRating`
implements a standard Bayesian average:

```
bayesianRating = (priorWeight × priorMean + reviewCount × averageRating)
                  / (priorWeight + reviewCount)
```

with `priorMean = 3.5` (midpoint of the 1–5 scale) and `priorWeight = 10`
("ten phantom average reviews" of skepticism). A professional with 1 review
at 5.0 scores ≈3.64; a professional with 300 reviews at 4.7 scores ≈4.66 —
correctly outranking the single 5-star case. This is verified directly in
`tests/unit/core/domain/services/bayesian-rating.test.ts` and
`tests/unit/core/domain/services/ranking-engine.test.ts`
("does not let a single 5-star review outrank hundreds of solid reviews").

Review volume itself contributes a small, separate, capped score
(`reviewVolumeScore`, capped at 50 reviews) so that "many completed jobs"
is still visible in the explanation without double-counting what the
Bayesian rating already accounts for.

### Verification boost

`isVerified` comes directly from the existing, already-computed trust
fields Module 17/18 maintain — `ProfessionalProfile.verificationStatus ===
"VERIFIED"` for individual professionals, `CompanyProfile.isVerified` for
companies. Module 19 never re-derives verification from
`ProfessionalVerification`/`CompanyVerification` case history, and never
reads verification documents, reviewer identities, or rejection/
resubmission reasons — see "Privacy & Security Boundaries" below.

### Location scoring

Module 19 does **not** depend on Module 20 (Maps & Geolocation). Two
abstractions exist, both usable today:

- `computeLocationMatch(query, candidate)` — city/province string
  comparison (case-insensitive, whitespace-tolerant). This is what the
  Prisma-backed `searchCandidates` filter and the ranking engine actually
  use today, since it works for every candidate regardless of whether they
  have coordinates set.
- `computeCoordinateLocationMatch(searchPoint, candidatePoint)` — an
  optional refinement using the same `haversineDistanceKm` primitive
  Professional Discovery's radius search already uses, returning `null`
  (meaning "fall back to the string match") whenever either point lacks
  coordinates.

Module 20 can later extend `LocationMatch` with a distance-banded
tier (e.g. "within 10km") without changing either function's signature or
any caller — a clean, additive extension point.

### Portfolio & profile completeness

`portfolioItemCount` (visible, non-deleted, non-admin-hidden items) feeds
a capped score (5 items) and, when > 0, a "Portfolio available (N items)"
explanation. `computeProfileCompleteness` is a fraction over 7 existing-field
signals (headline/description, bio/description, categories, location,
avatar/logo, contact info, portfolio) — deliberately **excluding**
verification, since that already has its own, larger, non-duplicated
weight.

### Tie-breaking

Every `SearchSortOption` (`RELEVANCE`, `RATING`, `REVIEWS`, `NEWEST`,
`VERIFIED`) resolves ties through the same deterministic chain:

```
1. total score desc
2. review count desc
3. createdAt asc  (the more established candidate first)
4. id asc         (absolute, guaranteed-unique final tie-break)
```

This guarantees ranking never depends on retrieval/insertion order and that
equal-score candidates always sort identically — verified directly in
`tests/integration/search/search-directory.test.ts`
("produces a fully deterministic order across repeated runs",
"breaks ties between equal-score candidates deterministically by id,
independent of insertion order").

## Ranking Transparency / Explanations

`scoreCandidate` returns a `reasons: string[]` alongside the numeric
breakdown. Reasons are customer-safe, human-readable, and gated behind a
threshold on their own contribution (e.g. "Highly rated" only appears when
the Bayesian rating is ≥4 *and* there is at least one real review). Example
reasons: `"Verified professional"`, `"Highly rated (4.8/5 from 200
reviews)"`, `"Many completed jobs"`, `"Located in the requested city"`,
`"Matches the requested service category"`, `"Portfolio available (5
items)"`, `"Strong, complete profile"`.

**The numeric score itself is never exposed** — not in the `SearchResult`
domain entity, not on the results page, not in any API response. Only the
internal ranking engine (and its unit tests) ever see `RankingScore.total`
/ `.breakdown`.

## Unified Professional / Company Search

`SearchResult` (`src/core/domain/entities/search-result.ts`) is a
discriminated union on `kind: "PROFESSIONAL" | "COMPANY"` — a company is
never forced into the professional shape or vice versa, matching Module
18's own architecture. Both share a common base (id, displayName,
categoryIds, city/province, rating, review count, portfolio count, ranking
reasons) plus kind-specific fields (`headline`/`yearsExperience`/
`hourlyRate` for professionals; `legalName`/`description`/`teamSize` for
companies).

## Pagination

Offset-based (`page`/`pageSize`), matching the convention
`SearchProfessionalsUseCase` already established elsewhere in this
codebase — this project has no existing cursor-pagination pattern to be
consistent with, so introducing one here would be the inconsistent choice.
`page`/`pageSize` are bounded by `searchDirectorySchema` (`page` ≤ 1000,
`pageSize` ≤ 50) to prevent pathological queries.

## Sorting

A closed `SearchSortOption` enum (`RELEVANCE | RATING | REVIEWS | NEWEST |
VERIFIED`) — never a raw string/DB column name accepted from the client.
`RELEVANCE` (the default) sorts by the full ranking score; the others sort
by their named field with the same deterministic tie-break chain applied
underneath.

## Performance & Database Indexes

Sorting/ranking is computed in the application layer (matching the
existing "candidates, then rank/filter in-app" pattern
`SearchProfessionalsUseCase` already uses for radius filtering) — so the
database's job is purely efficient **candidate retrieval and filtering**.
Migration `20260731000000_add_search_ranking_module` is **index-only** (no
new tables/columns/enums):

| Index | Supports |
|---|---|
| `addresses(city)` | Professional city/province location filtering |
| `professional_profiles(averageRating)` | `minRating` filtering for professionals |
| `company_profiles(city)` | Company city filtering |
| `company_profiles(province)` | Company province filtering |
| `company_profiles(averageRating)` | `minRating` filtering for companies |

Category, verification-status, and status/deletedAt filtering all reuse
indexes already added by earlier modules (`ServiceCategory` relations,
`ProfessionalProfile.verificationStatus`/`.status`,
`CompanyProfile.isVerified`/`.status`). No external search infrastructure
(Elasticsearch, Algolia, Meilisearch, Typesense) was introduced — Module 19
stays fully self-contained on Postgres/Prisma. Full-text search
(`tsvector`/`ts_rank`) was evaluated but not introduced: the current
`ILIKE`/`contains` query filtering is sufficient at this scale, and the
domain-level `computeTextRelevance` keeps the *ranking* of an already-
filtered set framework-independent; a future pass can swap the filtering
implementation for `tsvector` without changing `SearchDirectoryUseCase` or
the ranking engine at all.

## Privacy & Security Boundaries

Module 19 never exposes:

- Verification documents, document URLs, reviewer/admin identities,
  rejection reasons, or resubmission instructions (`ProfessionalVerification`
  / `CompanyVerification` and their document tables are never read by this
  module at all — only the already-public `verificationStatus`/`isVerified`
  fields on the profile itself).
- Internal audit-log or moderation data.
- Private company member identities (only the existing `teamSize` count).
- Suspended, deactivated, pending, or soft-deleted professionals/companies
  — enforced inside the repository query, not left to the application
  layer or UI to filter out.
- Any raw numeric ranking score — only customer-safe `rankingReasons`
  strings.

Verified directly in `tests/integration/search/search-directory.test.ts`
("never exposes verification-case internals", "excludes suspended
professionals and non-active companies").

Trust boundary: the only client-controlled inputs are query text, category,
city/province, `verifiedOnly`, `minRating`, `minReviewCount`, `sortBy`, and
pagination — all validated by `searchDirectorySchema`. Status,
verification status, and discovery eligibility are never client-supplied;
they come entirely from the discovery repositories.

## Admin Oversight

No new admin UI was added for Module 19 — ranking weights are code
constants (`RANKING_WEIGHTS`), not runtime-configurable data, so there is
no "ranking configuration" surface for an admin to manage yet. This
documentation *is* the admin-visible explanation of the search/ranking
architecture per the module's "at minimum, ensure admin can understand the
architecture through documentation" requirement. Admin's own existing
authorization logic (Module 16) is untouched and not duplicated.

## Future Maps & Geolocation Integration (Module 20)

Module 19 was built so Module 20 is a pure addition:

- `computeCoordinateLocationMatch` already exists and is unit-tested; once
  every candidate reliably has coordinates, `LocationMatch` can grow a
  distance-banded tier without changing any calling signature.
- `ProfessionalSearchFilter`/`CompanySearchFilter` can grow `latitude`/
  `longitude`/`radiusKm` fields additively.
- The repository `searchCandidates` methods can push a PostGIS/spatial
  query down once that infrastructure exists, without changing
  `SearchDirectoryUseCase`'s contract at all.

No maps API, geospatial database extension, or external mapping dependency
was added in this module.

## Stripe / Payment (Module 12) — Explicit Non-Dependency

Module 12 (Payment / Stripe Connect) is **intentionally not implemented**.
Module 19 does not import, reference, or depend on any Stripe type, payment
status, commission, or payout field anywhere in its domain, application,
infrastructure, or presentation code. Nothing in this module assumes
Stripe exists.

## Testing

**Unit tests** (`tests/unit/core/domain/services/`,
`tests/unit/core/application/dto/`):

- `bayesian-rating.test.ts` — prior-mean fallback, damping of low-volume
  ratings, determinism, custom priors, negative-input clamping.
- `profile-completeness.test.ts` — full/empty/partial fractions,
  key-order independence.
- `location-match.test.ts` — exact city, same-province fallback, no-match,
  case/whitespace insensitivity, coordinate-based refinement and its
  `null` fallback.
- `text-relevance.test.ts` — empty query, full/partial match, case/accent
  insensitivity, null-field tolerance, determinism.
- `ranking-engine.test.ts` — category match, verification boost, location
  tiering, Bayesian rating vs. volume, capped review/portfolio scores,
  linear text-relevance scaling, recency decay, no negative/NaN totals,
  portfolio-reason gating, no raw score leakage into reasons.
- `search.dto.test.ts` — defaults, valid/invalid category ids, query
  length limits, empty-string normalization, rating/review-count bounds,
  closed sort enum, pathological page/pageSize rejection.

**Integration tests** (`tests/integration/search/search-directory.test.ts`,
using in-memory fakes implementing the real repository interfaces, the
same convention as every other module's integration tests in this
codebase):

- Unified professional + company results in one list.
- Suspended professionals / non-ACTIVE companies excluded.
- Category, `verifiedOnly`, `minRating`+`minReviewCount`, and city filters.
- Ranking correctly favors verified/highly-rated/well-reviewed candidates.
- Ranking reasons are present and no raw score field leaks onto results.
- No verification-case internals ever appear on a result.
- Sorting by `RATING`, `REVIEWS`, `NEWEST`, `VERIFIED`.
- Offset pagination across multiple pages with no gaps/duplicates.
- Empty result set handled without error.
- Every optional filter omitted still runs correctly.
- Deterministic ordering across repeated runs.
- Tie-breaking is stable and independent of insertion order.

Existing Professional Discovery / Offers-Quotes / Notification tests were
updated only where the additive interface changes (new
`ProfessionalDiscoveryCandidate`/`CompanyDiscoveryCandidate` fields, new
`searchCandidates` method) required their fakes to be extended — no
existing test's assertions or business logic were changed.

## Validation Results

Run inside this session's sandboxed environment (see "Remaining Issues" —
this sandbox has real, verifiable native-binary/network restrictions
distinct from the code itself):

| Command | Result |
|---|---|
| `npm run typecheck` | **Passed**, zero errors, across the entire codebase including every new and modified Module 19 file. |
| `npm run lint` | **Passed**, zero errors/warnings. |
| `npm run prisma:generate` | **Blocked** — sandbox network access to `binaries.prisma.sh` returns 403; the schema change is index-only, so the already-generated Prisma Client's TypeScript types are structurally unaffected (confirmed by the clean typecheck above). |
| `npx prisma migrate dev` | **Blocked** — no Postgres reachable in this sandbox (`localhost:5432` connection refused) and no permission to install one (no root/sudo, package manager locked). Migration SQL was hand-authored (the established convention in this repo — every prior migration file carries the same disclaimer) and reviewed for correctness; run it for real once a database is available. |
| `npm test` (Vitest) | **Blocked** — `@rollup/rollup-linux-arm64-gnu` native binary missing (this environment's `node_modules` were installed for a different platform) and the npm registry is not reachable to install it (403 Forbidden). Manually verified the new ranking domain logic instead: compiled `bayesian-rating.ts`, `profile-completeness.ts`, `location-match.ts`, `text-relevance.ts`, and `ranking-engine.ts` directly with `tsc` (no bundler/native binary required) and exercised them with Node — confirmed correct Bayesian damping, location matching, text relevance, and that a verified/highly-rated/complete candidate scores well above a weak one, with the expected explanation reasons. |
| `npm run build` | **Blocked** — same class of issue: the Next.js SWC compiler's native binary for `linux/arm64` is missing and not installable (403 Forbidden) in this sandbox. |

## Remaining Issues

1. **Vitest/build native binaries could not be validated in this session's
   sandbox** — `@rollup/rollup-linux-arm64-gnu` and `@next/swc-linux-arm64-*`
   are missing, and this sandbox has no route to the npm registry to install
   them (403 Forbidden) and no root access to work around it. This is a
   platform/network restriction of *this specific execution environment*,
   not a defect in the code — `typecheck` and `lint` both pass cleanly
   across the whole codebase, and the new ranking logic was independently
   verified by direct compilation + execution. Re-run `npm test` and
   `npm run build` on a machine with a matching platform (or with npm
   registry access) to get the official pass/fail signal.
2. **`prisma migrate dev` was not run against a real database** for the
   same reason every prior migration in this repo carries the same
   disclaimer — no Postgres instance is reachable in this sandbox. The
   migration is index-only and additive; applying it is expected to be
   low-risk, but should still be run for real before merging.
3. No full-text search (`tsvector`) was implemented — `ILIKE`/`contains`
   filtering is used instead, which is adequate at current scale and
   documented above as a clean future upgrade path that would not require
   changing the ranking engine or use case.
4. No admin-facing ranking-configuration UI was built (ranking weights are
   code constants) — intentionally, per the module's "do not overbuild"
   guidance; this document is the admin-facing explanation of the
   architecture.
