# Module 23 — Analytics

## 1. Module purpose

Module 23 is a **read-only analytics and reporting layer** over the
transactional data Modules 01–22 already produce. It answers questions
like "how many quotes were accepted this month," "what's my acceptance
rate," or "how much has this customer spent" by querying existing tables
directly — it never becomes a second source of truth for business data,
never mutates a service request, quote, booking, job, payment, commission,
review, or profile, and never recalculates a financial figure Module 22
already owns.

## 2. Scope

In scope: platform/admin analytics, professional analytics, customer
analytics, date-range filtering, one time-series aggregation (ServiceRequest
creation volume), category and coarse-geographic breakdowns, and a service
funnel built from the real Modules 06–11 lifecycle states.

Explicitly out of scope (per the module's own boundary and the platform's
general principles): external analytics providers (Google Analytics,
Mixpanel, Segment, etc.), marketing/ad tracking, a new event-tracking
system, ETL/data-warehouse infrastructure, machine learning or predictive
analytics, fraud detection, IVA/tax logic (deferred to Module 26), and any
new payment/commission logic (owned by Modules 12/22). No dashboard UI was
built — there was no pre-existing analytics dashboard integration point to
extend, and the spec only calls for UI where one already exists.

Company-level analytics (mirroring professional analytics for
`CompanyProfile`) was **not implemented**. The repository interfaces are
structured so it could be added without duplicating logic (see "Known
limitations" and "Future scalability").

## 3. Architecture

```
DTO (zod schema + interface)
  ↓
Use Case (application/use-cases/analytics/*.use-case.ts)
  ↓
Domain Repository Interface (domain/repositories/analytics-repository.ts)
  ↓
Prisma Repository Implementation (infrastructure/.../prisma-*-analytics-repository.ts)
```

This is the same layering every other module in this codebase uses. Three
new domain repository interfaces were introduced —
`PlatformAnalyticsRepository`, `ProfessionalAnalyticsRepository`,
`CustomerAnalyticsRepository` (all in `analytics-repository.ts`) — because
none of the existing per-module repositories (ServiceRequestRepository,
QuoteRepository, AppointmentRepository, JobRepository, ReviewRepository,
...) expose grouped counts/sums/averages across a date range; each is
scoped to its own module's transactional CRUD needs. This follows the same
precedent as `AdminRepository` (Module 16): one broad, purpose-built
interface for a cross-cutting oversight/reporting concern, not eight
near-duplicate narrow ones.

**Read-only by construction.** None of the three new repository interfaces
has a mutating method. There is no `create`, `update`, `delete`, or
`set*Status` anywhere in `analytics-repository.ts`, and the Prisma
implementations only ever call `count`, `aggregate`, `groupBy`, or a
`SELECT`-only `$queryRaw`.

## 4. Data sources

Every metric is read directly from existing tables: `User`,
`CustomerProfile`, `ProfessionalProfile`, `CompanyProfile`,
`ServiceRequest`, `Quote`, `QuoteItem`, `Appointment`, `Job`, `Review`,
`Payment`, `Refund`, `ServiceCategory`, `Address`. Financial figures are
obtained by calling into Module 22's own use cases/repository rather than
querying `Transaction`/`Commission`/`Payout` directly from this module —
see section 11.

**No schema changes were made.** Every analytics query runs against the
existing schema; no new table, column, or enum value was added. The only
schema-adjacent change is two additive interface methods on Module 22's
own `FinancialReportingRepository` (see section 11) — no migration was
required for either, since they read existing columns.

## 5. Admin analytics

`GetPlatformAnalyticsSummaryUseCase` returns `PlatformAnalyticsSummaryDTO`:
user counts (total/new/active/customers/professionals/companies),
professional counts (total/active/verified/newly-registered/with-completed-
jobs), company counts (total/active/verified), service request counts
(total/new/by-status/open/cancelled/completed), quote counts (by status,
acceptance rate, average amount), booking counts (Appointment: total/
confirmed/completed/cancelled, conversion rate), job counts (total/
completed/cancelled, completion rate), review stats (total/average/
distribution), and Module 22's own platform revenue aggregate unmodified.

Additional admin-only use cases: `GetPlatformRequestsTimeSeriesUseCase`
(daily/weekly/monthly ServiceRequest creation volume),
`GetPlatformCategoryBreakdownUseCase`, `GetPlatformGeoBreakdownUseCase`
(coarse city/province), and `GetPlatformFunnelUseCase`.

**"Active users"** needs a window even for an unranged query (an all-time
"logged in at least once" count isn't a useful signal), so an unranged
query falls back to `lastLoginAt` within the trailing 30 days from now.
This is the one metric in this module with a default window; it's
documented on `PlatformUserAggregate` and in the repository implementation.

**"Completed requests"** is deliberately *not*
`ServiceRequestStatus.COMPLETED` — that value is never written by any
existing use case (see `ServiceRequestStatus`'s own doc comment in
`schema.prisma`: `Job.status` is the single authoritative execution-
lifecycle field, introduced by Module 11 specifically because
`ServiceRequestStatus` never got a real completion transition). Instead,
"completed" is "distinct ServiceRequests with a Job whose `status` is
COMPLETED." This is read directly from the real state machine, not
invented for this module.

## 6. Professional analytics

`GetProfessionalAnalyticsSummaryUseCase` returns
`ProfessionalAnalyticsSummaryDTO`: requests responded to, quotes
(submitted/accepted/rejected/acceptance rate), bookings (received/
confirmed/completed/cancelled), jobs (completed/cancelled/completion
rate), rating (average + count, via `ReviewRepository.
getProfessionalRatingSummary` — reused, not recomputed), portfolio item
count, and earnings (via Module 22's `GetProfessionalEarningsUseCase` —
see section 11).

"Requests received" has no dedicated invitation/lead concept in this
codebase (professionals find requests via Discovery, Module 05); it's
defined as "distinct ServiceRequests this professional submitted at least
one Quote for" — the only server-recorded "received and acted on" signal
that actually exists.

## 7. Customer analytics

`GetCustomerAnalyticsSummaryUseCase` returns `CustomerAnalyticsSummaryDTO`:
requests created (+ by status), quotes (received/accepted/acceptance
rate), bookings (created/completed/cancelled), jobs completed, reviews
(submitted + average rating given), and spending (via Module 22's
additive `getCustomerSpendAggregate` — see section 11).

## 8. Date-range semantics

Defined once in `domain/services/analytics-date-range.ts` and reused by
every use case in this module:

- **Timezone**: every date is a UTC instant, matching the rest of this
  codebase's timezone-naive-columns-treated-as-UTC convention and Module
  22's own `getPlatformRevenueSummarySchema` (`z.coerce.date()`, no offset
  handling). No new timezone convention was introduced.
- **Boundaries**: both `from` and `to` are **inclusive**.
- **`from` only**: every record from `from` onward (unbounded above).
- **`to` only**: every record up to and including `to` (unbounded below).
- **Neither given**: unranged — all-time. This matches
  `GetPlatformRevenueSummaryUseCase`'s existing convention rather than
  inventing a "default to last 30 days" behavior Module 22 doesn't have.
- **Validation**: `from > to` and any invalid `Date` both throw
  `ValidationError` before any repository is queried — re-checked in the
  domain service itself, not just at the zod boundary, matching this
  codebase's layered-validation convention (see
  `CreateFinancialAdjustmentUseCase`).
- **Maximum range**: summary/breakdown queries have no maximum range —
  every one of them is a bounded aggregate (`COUNT`/`AVG`/`GROUP BY`)
  whose result size never grows with the size of the range. Only the
  **time-series** use case enforces a maximum (731 daily buckets / 522
  weekly / 240 monthly) and requires both `from` and `to` — generating an
  unbounded array of mostly-empty points is exactly the performance
  problem this cap exists to prevent.

## 9. Aggregation semantics

Only one time-series metric was implemented: ServiceRequest creation
volume, at DAY/WEEK/MONTH granularity (`GetPlatformRequestsTimeSeriesUseCase`).
This was the one aggregation the spec's own examples called out and where
the value is highest (visualizing signup/demand trend); other candidate
time series (quotes, bookings, jobs over time) were left out for this
iteration to keep scope focused — see "Known limitations."

- Buckets are truncated in UTC (`DAY` = midnight UTC, `WEEK` = Monday
  00:00 UTC, `MONTH` = the 1st, 00:00 UTC).
- The repository query (`$queryRaw` with Postgres `date_trunc`) returns
  **sparse** results — only buckets with at least one row. The use case
  (`GetPlatformRequestsTimeSeriesUseCase`) fills every bucket in `[from,
  to]` with `count: 0` where the repository didn't return one
  (`generateBucketBoundaries`), so a consumer never needs to special-case
  a missing period.
- Bucket generation is deterministic and pure (no I/O), independently
  unit-tested (`tests/unit/core/domain/services/analytics-date-range.test.ts`).

## 10. Funnel definitions

```
Request Created → Quotes Received → Quote Accepted → Booking Created → Job Completed
```

Every stage reads an existing lifecycle state — no state was invented for
this module:

| Stage | Definition |
|---|---|
| Request Created | `ServiceRequest` rows in range, excluding soft-deleted |
| Quotes Received | ...with at least one `Quote` |
| Quote Accepted | ...with at least one `Quote` where `status = ACCEPTED` |
| Booking Created | ...with at least one `Appointment` |
| Job Completed | ...with at least one `Job` where `status = COMPLETED` |

**Important nuance, documented rather than hidden**: in this codebase's
actual state machine, a `Job` (and its first `Appointment`, in
`PENDING_SCHEDULE`) is created **automatically and atomically** the moment
a `Quote` is accepted (see `Job`'s doc comment in `schema.prisma` and
`PrismaQuoteAcceptanceRepository.acceptQuote`) — there is no separate
customer/professional action that creates a "booking" after acceptance.
The "acceptance → booking" stage is therefore expected to track very close
to 1:1. This isn't a modeling bug in Module 23; it's an accurate reflection
of how Modules 10/11 actually work. If a future module changes that
(e.g. a booking becomes a distinct, delayed action), this funnel will
reflect that automatically with no code change here.

Every `*Rate` field is `null` (never `0`) when its denominator is 0 — see
`safeRatio` and the funnel/platform-summary tests covering this.

## 11. Financial boundary with Module 22

Module 22 remains the single source of truth for commission calculation,
rates, ledger entries, and financial adjustments. Module 23 never imports
`stripe` and never queries `Transaction`/`Commission`/`Payout` directly
from its own use cases or repositories.

- **Platform**: `GetPlatformAnalyticsSummaryUseCase` calls Module 22's
  existing `GetPlatformRevenueSummaryUseCase` unmodified and re-exposes its
  `PlatformRevenueSummaryDTO` verbatim as the `financial` field.
- **Professional**: `GetProfessionalAnalyticsSummaryUseCase` calls Module
  22's existing `GetProfessionalEarningsUseCase` and **sums** the
  already-computed `professionalCommission`/`professionalTotalNetEarnings`
  fields from its `ProfessionalEarningsDTO[]` — no rate, subtotal, or
  earnings figure is recalculated here. Caveat: `ProfessionalEarningsDTO`
  has no `createdAt`, only `settledAt`. When a date range is given, only
  *settled* commissions whose `settledAt` falls inside the range are
  summed; still-pending (unsettled) commissions have no settlement date
  yet and are only reflected in the unranged (all-time) query. This is a
  documented, tested behavior (see "Known limitations"), not a silent gap.
- **Customer**: `GetCustomerAnalyticsSummaryUseCase` calls a new, narrow,
  **additive** method on Module 22's own `FinancialReportingRepository`:
  `getCustomerSpendAggregate(payerId, range)`. This was added (rather than
  computed independently in Module 23) because no existing method
  aggregates a customer's total captured payments/refunds across a date
  range — `GetCustomerFinancialSummaryUseCase` is scoped to one `Job` at a
  time. The new method is a straight `SUM`/`COUNT` over `Payment.amount`/
  `Refund.amount`, gated on `status = CAPTURED`/`PROCESSED` — the same
  authoritative columns `getPlatformRevenueAggregate` already trusts. It
  introduces no new commission/fee logic and required no migration (no new
  column, no new table).

## 12. Security and ownership

- **Admin**: every platform analytics Server Action
  (`src/app/(dashboard)/admin/analytics/actions.ts`) calls
  `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)` before doing anything else
  — identical to every other admin action in this codebase. The use cases
  themselves have no role-awareness (matching
  `GetAdminDashboardOverviewUseCase`/`GetPlatformRevenueSummaryUseCase`'s
  own convention); authorization is the Server Action's job.
- **Professional**: `GetProfessionalAnalyticsSummaryUseCase` takes a
  `userId` (never a `professionalId`) and resolves the caller's own
  `ProfessionalProfile` via `ProfessionalRepository.findByUserId` — the
  identical pattern `GetProfessionalEarningsUseCase` already uses. There is
  no parameter anywhere in this module's DTOs or use cases that lets a
  caller name a different professional's id. A user with no professional
  profile gets `ValidationError`, never another professional's data (see
  the dedicated cross-professional-access test).
- **Customer**: `GetCustomerAnalyticsSummaryUseCase` takes a `userId`
  (never a `customerId`) and resolves the caller's own `CustomerProfile`
  the same way `GetCustomerFinancialSummaryUseCase` does. Same guarantee:
  no cross-customer access is possible by construction (see the dedicated
  test).

## 13. Privacy considerations

- Geographic analytics (`getCityBreakdown`) reads only `Address.city`/
  `Address.province` — never `latitude`/`longitude` and never
  `line1`/`line2`. No method on any analytics repository selects a
  coordinate or a precise street address; this is enforced by the
  interface shape itself (`AnalyticsCityAggregate` has no such field), and
  a test asserts the returned shape has neither.
- No verification documents, dispute message contents, or moderation notes
  are exposed anywhere in this module.
- Customer/professional summaries never include another user's PII;
  contact fields (`email`, `phone`) never appear on any Module 23 DTO.

## 14. Performance considerations

Every repository method is a bounded aggregate query:

- Platform summary/breakdown queries are `COUNT`/`AVG`/`GROUP BY` — result
  size is O(number of statuses/categories/cities), never O(number of
  rows). The city breakdown is additionally capped at the top 50 cities by
  volume.
- The two multi-table breakdowns (category-by-quote, category-by-job,
  city) that Prisma's `groupBy` can't express (no relation support) use a
  single parameterized `$queryRaw` `JOIN ... GROUP BY` each — bounded by
  the number of categories/cities, not the number of quotes/jobs/requests,
  and using the same indexed foreign keys (`categoryId`, `serviceRequestId`,
  `addressId`) those tables already have.
- Professional/customer summaries are scoped `WHERE professionalProfileId
  = :id` / `WHERE customerId = :id` on indexed columns — bounded by that
  one user's own record count, never the platform's.
- The time-series query uses one raw `date_trunc` `GROUP BY`, capped at a
  maximum bucket count (see section 8) so the response size can never grow
  unboundedly with the requested range.
- No method loads a full table into application memory to count/sum/filter
  in JavaScript. The one exception — summing `ProfessionalEarningsDTO[]`
  in `GetProfessionalAnalyticsSummaryUseCase` — is bounded by one
  professional's own commission count (their own jobs), not a platform-
  wide scan, the same bound `GetProfessionalEarningsUseCase` itself
  already accepts.

## 15. Database changes

**None.** No new table, column, or enum value was added, and no Prisma
migration was created. The only schema-adjacent change is two additive
TypeScript interface methods on Module 22's existing
`FinancialReportingRepository` (`getCustomerSpendAggregate`), implemented
against existing `Payment`/`Refund` columns.

## 16. API endpoints

This codebase uses Next.js Server Actions, not a REST/route-handler API,
for every other module — Module 23 follows the same convention rather
than introducing a new `/api/analytics/*` surface:

- `src/app/(dashboard)/admin/analytics/actions.ts` — admin-only:
  `getPlatformAnalyticsSummaryAction`, `getPlatformRequestsTimeSeriesAction`,
  `getPlatformCategoryBreakdownAction`, `getPlatformGeoBreakdownAction`,
  `getPlatformFunnelAction`.
- `src/app/(dashboard)/dashboard/professional/analytics/actions.ts` —
  `getProfessionalAnalyticsSummaryAction`.
- `src/app/(dashboard)/analytics/actions.ts` — `getCustomerAnalyticsSummaryAction`,
  placed at the top level alongside this codebase's other customer-facing
  top-level routes (`/requests`, `/jobs`, `/reviews`) since there is no
  dedicated `dashboard/customer` namespace to nest under.

No dashboard UI/pages were built for any of these — see "Scope."

## 17. Testing strategy

Same convention as every other module: real use cases + in-memory fake
repositories implementing the real domain interfaces (no repository is
tested against a live/fake database — this codebase's existing tests never
do that either, including Module 22's own financial-flows tests).

- `tests/unit/core/domain/services/analytics-date-range.test.ts` — pure,
  dependency-free unit tests for date-range validation, time-series range
  capping, bucket-boundary generation, and safe-ratio division.
- `tests/integration/analytics/analytics-flows.test.ts` — use-case-level
  integration tests covering: platform summary ratio/financial-boundary
  behavior and unranged-by-default semantics; time-series gap-filling and
  range/size rejection; funnel conversion math and division-by-zero
  safety; category/geo breakdown pass-through and coarse-geography-only
  shape; professional-analytics ownership (cannot read another
  professional's data), empty-activity handling, acceptance/completion
  rate math, earnings reuse-not-recalculation, and settlement-date
  filtering; customer-analytics ownership (cannot read another customer's
  data), empty-activity handling, and spend-aggregate reuse.
- Role-based admin authorization is already covered once, generically, by
  the existing `tests/unit/core/infrastructure/auth/rbac.test.ts` — this
  module's Server Actions call the identical `requireRole()` helper every
  other admin action already uses, so it isn't re-tested per-action here
  (matching this codebase's own existing convention of not re-testing
  `requireRole` in every module's own test file).

## 18. Known limitations

- **Company-level analytics** (mirroring professional analytics for
  `CompanyProfile`/`CompanyMember`) was not implemented in this pass. The
  repository interfaces don't preclude it, but no `CompanyAnalyticsRepository`
  or use case exists yet.
- **Professional earnings date-filtering** only reflects *settled*
  commissions inside the range (see section 11) — a professional filtering
  to "this month" won't see still-pending commissions for jobs completed
  this month but not yet settled. The all-time (unranged) query always
  includes them.
- **Time-series aggregation** was only implemented for ServiceRequest
  creation volume, not for quotes/bookings/jobs/revenue over time.
- **Category breakdown** does not include an average-rating-per-category
  figure (`Review` has no direct category relation; deriving it would
  require an additional join through `Job → ServiceRequest → category`,
  left out of this pass to keep the query set focused).
- **Geographic analytics** covers requests/completed-jobs by city only —
  "professionals by city" and a supply/demand comparison were left out
  (a professional has no single canonical city in this schema; their
  `Address` rows belong to their `User`, not their `ProfessionalProfile`,
  and a professional may have more than one).
- This sandbox environment could not execute `npx prisma validate`/
  `generate` or `npm test` (see section "Validation results" in the final
  report) due to platform-mismatched native binaries unrelated to this
  module's code; `tsc --noEmit` and `eslint` both ran successfully and
  cleanly across the whole repository including this module's new files.

## 19. Future scalability options

- Add `CompanyAnalyticsRepository`/`GetCompanyAnalyticsSummaryUseCase`
  mirroring the professional path, scoped by `CompanyMember` role/
  ownership.
- Extend the time-series use case to other metrics (quotes, bookings,
  jobs, revenue) by adding sibling methods to `PlatformAnalyticsRepository`
  following the same sparse-result + gap-fill pattern already established.
- If reporting query load ever becomes a concern at much larger data
  volumes, a materialized-view or nightly-snapshot layer could sit behind
  the same `PlatformAnalyticsRepository` interface without changing any
  use case or DTO — the interface boundary was deliberately kept
  storage-agnostic for exactly this reason. Not needed for the current
  MVP scale (see the module spec's own "prefer live reporting queries over
  snapshot infrastructure" guidance).
