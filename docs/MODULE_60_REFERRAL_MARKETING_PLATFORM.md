# Module 60 — Referral & Marketing Attribution Platform

## Purpose & Scope

Adds a tracking/attribution/reporting layer that answers "where did this
visitor/registration/booking come from" — click tracking with UTM/referral
code capture, per-visitor first-touch/last-touch attribution, registration
attribution, read-only conversion markers, and a reporting projection/CLI.

Explicitly **out of scope**: payment provider integration, affiliate
payouts, commission calculation, and a Partner System — those are future
modules. This module never writes to the existing `Commission` table
(Module 22) and never computes a `rateBps`/`amount`; where it needs to note
that "a commission was generated," it records a read-only
`COMMISSION_GENERATED` `ConversionEvent` marker that can carry the existing
`Commission.id` as a plain `referenceId` string — nothing that looks like
payout logic is built here.

In scope: `ReferralCode` administration, click/visit tracking with dedup,
UTM-based and referral-code-based marketing-source resolution, per-visitor
`MarketingAttribution` (first/last touch), a best-effort link from
`RegisterUserUseCase` into that attribution, a `ConversionEvent`
recording use case/table ready for future callers, a statistics/reporting
projection, and a CLI (`npm run referral-report`).

## Architecture

- **Domain**
  - `domain/services/referral-code-rules.ts` — `assertValidReferralCode`/
    `normalizeReferralCode`/`isValidReferralCode`: format rules (3–40 chars,
    lowercase alphanumeric + underscore).
  - `domain/services/marketing-source-rules.ts` — `MarketingSourceValue`
    (11-value closed set) and `resolveMarketingSource`, a pure function with
    an explicitly documented precedence order (see "Marketing source
    resolution" below).
  - `domain/services/referral-visit-dedup-rules.ts` — `isDuplicateVisit`, a
    pure function over an already-fetched visit history (see "Click/visit
    dedup" below).
  - `domain/services/marketing-attribution-touch-rules.ts` —
    `applyAttributionTouch`, the pure write-once-first-touch/
    always-overwrite-last-touch state transition (see "Attribution model"
    below).
  - `domain/errors/domain-error.ts` — gains `ReferralCodeError`, following
    the file's existing per-module error convention. `ConflictError`/
    `NotFoundError`/`ValidationError` are reused everywhere else this module
    needs a domain error — no other new error class was added.
  - `domain/repositories/` — four new narrow, record-shaped interfaces:
    `referral-code-repository.ts`, `referral-visit-repository.ts`,
    `marketing-attribution-repository.ts`, `conversion-event-repository.ts`.
    Same "no `Entity<Props>` subclass, pure rules live in domain/services"
    convention `professional-verification-repository.ts` established.
- **Application**
  - `application/dto/referral.dto.ts` — zod schemas
    (`createReferralCodeSchema`/`trackVisitSchema`/`recordConversionSchema`),
    same convention as `verification.dto.ts`.
  - `application/ports/registration-attribution-linker.ts` —
    `RegistrationAttributionLinker`, the tiny port `RegisterUserUseCase`
    depends on (see "Registration attribution" below).
  - `application/use-cases/referral/`:
    - `create-referral-code.use-case.ts` — `CreateReferralCodeUseCase`
    - `track-visit.use-case.ts` — `TrackVisitUseCase`
    - `record-conversion.use-case.ts` — `RecordConversionUseCase`
    - `link-registration-attribution.use-case.ts` —
      `LinkRegistrationAttributionUseCase` (implements
      `RegistrationAttributionLinker`)
    - `get-referral-statistics.use-case.ts` — `GetReferralStatisticsUseCase`
    - `compose.ts` — composition root, same "shared repository instances,
      one factory per use case" convention as `verification/compose.ts`.
- **Infrastructure**
  - `infrastructure/database/prisma/repositories/`:
    `prisma-referral-code-repository.ts`,
    `prisma-referral-visit-repository.ts`,
    `prisma-marketing-attribution-repository.ts`,
    `prisma-conversion-event-repository.ts` — same "narrow SELECT +
    `toRecord` mapper" convention as `prisma-professional-verification-repository.ts`.
  - `infrastructure/referral/referral-report-generator.ts` +
    `scripts/run-referral-report.ts` — the `npm run referral-report` CLI,
    mirroring `verification-report-generator.ts`/
    `scripts/run-verification-report.ts` exactly (same `unhandledRejection`
    handler, same try/catch-and-degrade-to-null database read, same
    markdown+JSON output, same `productionReadinessScore`/
    `isProductionReady` shape).

## Database Changes

New migration:
`prisma/migrations/20260817000000_add_referral_marketing_attribution_module/migration.sql`
(hand-authored — no Postgres/Prisma-engine network access in the sandbox
this was built in, same documented constraint as every migration since
Module 21; see that migration's own comment header and
`docs/MODULE_21_DISPUTES_SUPPORT.md`'s "Validation Results").

Purely additive:

- Two new enums: `MarketingSourceKind` (11 values), `ConversionTypeKind` (6
  values).
- Four new tables: `referral_codes`, `referral_visits`,
  `marketing_attributions`, `conversion_events`.
- Two new back-relation fields on the Prisma `User` model
  (`marketingAttributions`, `referralCodes`) — relation fields only, no new
  column on the `users` table itself.

No existing table is altered, renamed, or dropped.

## Visitor identity

`visitorId` is an **opaque, client-generated/cookie-stored identifier**
supplied on every call to the (future) tracking endpoint and, optionally,
to `RegisterUserUseCase` at signup time. It is the sole join key for
`MarketingAttribution` (`visitorId` unique).

Deliberately **not** the IP hash. An IP address is shared (NAT, corporate
networks, mobile carrier CGNAT) and dynamic (mobile networks routinely
rotate IPs mid-session) — using it as an attribution join key would
misattribute visits from unrelated people sharing an IP into one
attribution record, and would fragment a single real visitor's session
across several attribution records as their IP changes. `ipHash` (via the
shared `hashIp` helper, Module 24 — see `domain/services/security-key.ts`)
is still stored **per visit**, but purely as an auxiliary abuse/dedup
signal never used to join visits together or to a user.

## Marketing source resolution

`resolveMarketingSource` (`domain/services/marketing-source-rules.ts`)
checks, in this exact order, first match wins:

1. An explicit, recognized `utm_source` (e.g. `telegram`, `instagram`,
   `google_ads`) — the marketer's own explicit label always wins.
2. An explicit but *unrecognized* `utm_source` — still explicit intent, so
   it resolves to `UNKNOWN` rather than falling through to referral-code/
   referrer inference (a marketer who bothered to tag a link clearly didn't
   intend for the platform to guess differently).
3. A `referralCode` present with no `utm_source` at all → `REFERRAL`.
4. A referrer hostname matching a known search engine (`google.`, `bing.`,
   `yahoo.`, `duckduckgo.`, `yandex.`, `baidu.` — coarse keyword match) →
   `ORGANIC_SEARCH`.
5. No referrer at all → `DIRECT`.
6. Anything else (an unrecognized external referrer with no UTM tags) →
   `UNKNOWN`.

The resolved source is stored **once, at ingestion time**, on
`ReferralVisit.marketingSource` — never recomputed later even if the
resolution rules themselves change, so a historical visit's recorded source
always reflects what the platform actually believed at the time it
happened.

## Campaign modeling — no separate `MarketingCampaign` table

A campaign is identified by its `utmCampaign` string (falling back to the
`referralCode` when `utmCampaign` is absent — the same grouping key
`TouchInput.campaign` uses), **not** a separately administered entity.
Nothing in this module's scope requires campaign lifecycle management
(budget, start/end dates, an owning admin, activation/deactivation) — only
aggregation for reporting (`GetReferralStatisticsUseCase.topCampaigns`).
Introducing a `MarketingCampaign` table now would mean either leaving it
unused (dead weight) or building lifecycle management nothing in this
module's brief calls for. If a future module needs campaign budgets/dates/
ownership, it can introduce that table and backfill `utmCampaign` values
into it without touching `ReferralVisit`/`MarketingAttribution`'s existing
shape — this module's own reporting already treats "campaign" as a string
key, so nothing here would need to change.

`ReferralCode`, by contrast, **is** a real administered entity (unique
constraint, optional owner, optional label) because a referral code is
something a professional/campaign is handed and shares verbatim — its
uniqueness and existence are meaningful in a way a free-text `utmCampaign`
string is not.

## Attribution model

`MarketingAttribution` — one row per `visitorId` (unique):

- `first*` fields (`firstSource`/`firstCampaign`/`firstReferralCode`/
  `firstVisitAt`) — **write-once**. `applyAttributionTouch`
  (`domain/services/marketing-attribution-touch-rules.ts`) is a pure
  function: given the current state and a new touch, it only ever fills in
  `first*` fields when `firstVisitAt` is still `null`; once set, every
  later call carries them through completely unchanged. There is no code
  path anywhere in this module — not the use case, not the Prisma
  repository's `upsertTouchState` — that overwrites an already-set `first*`
  field.
- `last*` fields — unconditionally replaced by every non-duplicate touch.
- `userId` — set once the visitor registers, via
  `MarketingAttributionRepository.linkUser`, itself idempotent (a no-op if
  already set or if no attribution row exists for the visitor).

## Click/visit tracking + dedup

`TrackVisitUseCase` orchestration:

1. Normalize/validate `referralCode` (a malformed `?r=` is treated as
   absent, not a failed visit — a browser extension stripping a query
   param shouldn't break tracking for everything else on the page).
2. Resolve `marketingSource` (pure, see above).
3. Hash the caller-supplied raw IP via the shared `hashIp` helper (Module
   24) — the pepper is `env.AUTH_SECRET`, the same value
   `getClientIpHash()` (`infrastructure/auth/request-context.ts`) already
   passes to `hashIp` for Module 24's own rate-limiting/security-event
   hashing (`compose.ts`'s own doc comment explains why reusing the same
   pepper is intentional: a raw IP hashed by either code path produces the
   same hash, useful for correlation without ever storing a second raw IP).
4. Fetch recent visits for this `visitorId` (`findRecentByVisitor`) and
   apply the pure `isDuplicateVisit` dedup rule.
5. If a duplicate: **no new `ReferralVisit` row, no attribution
   last-touch update.** Touching last-touch on every pixel re-fire would
   make the dedup window pointless.
6. Otherwise: create the visit row, then apply `applyAttributionTouch` to
   the visitor's existing (or empty) attribution state and persist via
   `upsertTouchState`.

**Dedup window: 60 seconds** (`VISIT_DEDUP_WINDOW_MS`), matched on the
*exact* tuple (`visitorId`, `referralCode`, `utmSource`, `utmMedium`,
`utmCampaign`, `landingPage`) within that window:

- Long enough to absorb a page double-load, back-button re-render, or an
  analytics-pixel double-fire — all of which happen within seconds of the
  original request, not minutes.
- Short enough that a genuine second visit minutes later (the visitor left
  and came back) is never silently suppressed and undercounted.
- Strict field equality (not "same referral code only") so a visitor who
  follows two different campaign links within the same minute is still
  counted as two distinct visits.

The dedup rule is a pure function over an already-fetched list, never a
live query inside domain code — `TrackVisitUseCase` does the fetching,
`isDuplicateVisit` only decides.

## Registration attribution

`RegisterUserUseCase` (`application/use-cases/auth/register-user.use-case.ts`,
Module 1/pre-existing) gained:

- An optional constructor parameter, `attributionLinker?:
  RegistrationAttributionLinker` — a tiny port
  (`application/ports/registration-attribution-linker.ts`) with one method,
  `linkRegistration(userId, visitorId)`. Optional so every pre-existing
  three-argument construction of this use case (including every existing
  test) keeps compiling unchanged.
- An optional field on `RegisterInput`
  (`application/dto/auth.dto.ts`), `visitorId?: string` — the same opaque
  identifier `TrackVisitUseCase` uses, present whenever the registration
  form loaded with the tracking cookie already set.
- In `execute`, after the user is created (and its default `CUSTOMER` role
  assigned), if both `attributionLinker` and `input.visitorId` are present,
  it calls `attributionLinker.linkRegistration(user.id, input.visitorId)`
  inside a `try`/`catch` that swallows any error. This mirrors the
  independent-side-effect pattern `RefreshVerificationStatusUseCase`
  documents in `docs/MODULE_59_PROFESSIONAL_VERIFICATION_PERSONA.md`
  ("does not raise `ProfessionalVerificationStatusChanged`" — a
  non-critical side effect must never roll back or fail the primary
  action). `LinkRegistrationAttributionUseCase` (the concrete linker,
  wired in `auth/compose.ts`) adds a second layer of the same guard
  internally, so a repository failure can never propagate even if a future
  caller forgets the outer `try`/`catch`.
- `auth/compose.ts` imports `makeLinkRegistrationAttributionUseCase` from
  `application/use-cases/referral/compose.ts` and passes it to
  `makeRegisterUserUseCase`'s `RegisterUserUseCase` construction — a
  one-directional dependency (the referral module's `compose.ts` never
  imports anything from the auth module), the same "compose roots may
  depend on another module's compose root's factory functions, never the
  reverse" shape `admin/compose.ts`/`notification/compose.ts` already
  establish.

`LinkRegistrationAttributionUseCase` deliberately does **not** also record
a `REGISTRATION`/`PROFESSIONAL_REGISTRATION`/`CLIENT_REGISTRATION`
`ConversionEvent` — it only knows `userId`/`visitorId`, not whether the
signup was ultimately professional or client (`RegisterInput.intent` is a
routing hint, not a confirmed role — see `SignupIntent`'s own doc comment
in `schema.prisma`). Recording that conversion event is deferred to
whichever future caller knows the confirmed outcome (see "Remaining
Limitations").

## Conversion tracking

`ConversionEvent` — a read-only record that "something the platform
already considers a conversion happened" for an attributed visitor:
`REGISTRATION` / `PROFESSIONAL_REGISTRATION` / `CLIENT_REGISTRATION` /
`BOOKING_CREATED` / `BOOKING_COMPLETED` / `COMMISSION_GENERATED`.

This module **never computes** `revenueAmount` or decides *when* a
conversion happened — `RecordConversionUseCase` takes already-known data
from its caller (`occurredAt`/`referenceId`/`revenueAmount` are all
supplied, not derived). It requires an existing `MarketingAttribution` row
for the given `visitorId` (throws `NotFoundError` otherwise) — unlike the
registration linker, which is explicitly best-effort because it runs
inline in registration, `RecordConversionUseCase` is called deliberately by
a caller that already knows it wants a conversion recorded, so a missing
attribution is a genuine caller error, not an expected outcome to degrade
past.

`referenceId` is a **plain string, not a Prisma relation** — the same
"reference another bounded context's id without a cross-module FK
constraint" convention `CommissionRecord.paymentId` already establishes
(`commission-repository.ts`'s own doc comment) — because a `ConversionEvent`
may point at a Booking, a Payment, or a Commission depending on `type`, and
this module has no business depending on any of those modules' schemas.

### Future Affiliate integration

A future Affiliate/Partner module can build payout logic entirely on top of
`MarketingAttribution`/`ConversionEvent` without any change to these
tables:

- `ReferralCode.ownerUserId` already identifies which user (e.g. a
  professional) a code belongs to.
- `MarketingAttribution` rows carrying that `referralCode` in
  `firstReferralCode`/`lastReferralCode` identify which visitors that
  affiliate brought in.
- `ConversionEvent` rows for those attributions' `REGISTRATION`/
  `BOOKING_COMPLETED` types (with `revenueAmount` populated) are exactly the
  event stream a payout calculation would sum/rate against.

An Affiliate module would read this data, never write to it — the same
read-only relationship this module itself has with `Commission` (below).

### Future Commission integration

This module's `COMMISSION_GENERATED` `ConversionEvent.referenceId` is
designed to hold an existing `Commission.id` (Module 22) once a future
caller (a commission-creation use case) chooses to record that a
commission was generated for an attributed booking. This module:

- Never creates, updates, or reads from the `Commission` table directly —
  `ConversionEventRepository`/`RecordConversionUseCase` have no dependency
  on `CommissionRepository` at all.
- Never computes `rateBps`/`amount` — those remain exclusively Module 22's
  responsibility.
- `GetReferralStatisticsUseCase.commissionsGenerated` counts
  `COMMISSION_GENERATED` conversion events, a read-only marker count, never
  a sum of `Commission.amount` (this module has no visibility into that
  column).

## Reporting

`GetReferralStatisticsUseCase` aggregates:

- Total visits, total attributed visitors, total registered visitors
  (attribution rows with `userId` set).
- Top referral codes / top campaigns by visit count.
- Registrations (total, professional, client — from `ConversionEvent`
  counts, **not** from `MarketingAttribution.userId`, since only a
  conversion event carries the professional/client split).
- Bookings created / completed, commissions-generated marker count.
- Revenue attributed total (`sum(revenueAmount)` across `BOOKING_COMPLETED`
  + `COMMISSION_GENERATED` events).
- Funnel conversion rates, each relative to the *previous* stage (visit →
  registration → booking created → booking completed) — not relative to
  total visits, so a reader can see exactly where the biggest drop-off is,
  the same way a marketer reads a funnel report.

`npm run referral-report` (`scripts/run-referral-report.ts`) writes
`reports/referral-report.md` and `.json`: the funnel/attribution
statistics above (best-effort — degrades to "unavailable" if the database
can't be reached, never fails the run, mirroring
`run-verification-report.ts` exactly, including the same
`--env-file-if-exists=.env --conditions=react-server` runner and the same
`unhandledRejection` non-fatal handler), architecture checks, privacy
checks (IP hashing, User-Agent truncation, IP-hash-never-a-join-key), and
integration-readiness checks (informational only, never counted against
the production-readiness score — see `referral-report-generator.ts`'s own
`isProductionReady` doc comment for why, mirroring
`verification-report-generator.ts`'s identical reasoning).

## Testing

- Domain: `referral-code-rules.test.ts`, `marketing-source-rules.test.ts`,
  `referral-visit-dedup-rules.test.ts` (window-boundary and field-equality
  cases), `marketing-attribution-touch-rules.test.ts` (first-touch
  immutability across multiple applied touches, last-touch always
  overwritten, no mutation of the input state).
- Infrastructure: `referral-report-generator.test.ts` (score computation,
  production-readiness gating, markdown rendering with/without live
  statistics) — mirrors `verification-report-generator.test.ts`.
- Integration (`tests/integration/referral/`): `fakes.ts` (in-memory
  repositories implementing the real interfaces, same pattern as
  `tests/integration/verification/fakes.ts`), `referral-flows.test.ts`
  (`CreateReferralCodeUseCase`/`TrackVisitUseCase`/`RecordConversionUseCase`/
  `GetReferralStatisticsUseCase` against real domain rules), and
  `registration-attribution.test.ts` — asserts `RegisterUserUseCase` links
  attribution when a `visitorId` is supplied, and does **not** break
  registration when no linker is provided, when the linker throws, or when
  no `visitorId` is supplied at all.

## Validation Results

Run in this sandbox (no live Postgres/Prisma-engine network access — same
documented constraint as Module 59's own "Validation Results"):

- `npm run lint` — clean, 0 errors, 0 warnings, across the entire repo.
- `npx prisma generate` — fails as expected:
  `binaries.prisma.sh` returns `403 Forbidden` for both the schema-engine
  checksum and the linux-arm64 query-engine binary in this sandbox (no
  network egress to that host here). `node_modules/.prisma/client` was
  generated on the host machine for `darwin-arm64` and cannot be
  regenerated in this Linux sandbox — the same precedent Module 59's own
  doc documents. On a machine with normal network access, `npx prisma
  generate` regenerates the client and resolves the typecheck errors below
  with no code change.
- `npm run typecheck` — clean **except** the four new Prisma repository
  files (`prisma-referral-code-repository.ts`,
  `prisma-referral-visit-repository.ts`,
  `prisma-marketing-attribution-repository.ts`,
  `prisma-conversion-event-repository.ts`), which reference
  `prisma.referralCode`/`referralVisit`/`marketingAttribution`/
  `conversionEvent` — properties that don't exist on the stale, pre-Module-60
  generated `PrismaClient` type in this sandbox. Every other file this
  module touched or added — every domain/application/DTO/use-case/
  compose/test file, `register-user.use-case.ts`, `auth.dto.ts`,
  `auth/compose.ts` — typechecks clean with zero errors.
- `npm test` — targeted runs (the full `npm test` invocation exceeded this
  sandbox's command timeout given the size of the whole suite, so it was
  run in scoped batches instead, per the task's own fallback guidance):
  - Every new Module 60 test: 7 files, 46 tests, all passing
    (`referral-code-rules`, `marketing-source-rules`,
    `referral-visit-dedup-rules`, `marketing-attribution-touch-rules`,
    `referral-report-generator`, `referral-flows`,
    `registration-attribution`).
  - `tests/integration/auth` + `tests/integration/referral` +
    `tests/unit/core/domain/services`: 22 files, 192 tests, all passing —
    confirms the existing auth registration flow is unaffected.
  - `tests/integration/verification` + `tests/unit/core/domain`: 85 files,
    750 tests, all passing — confirms `domain-error.ts`'s new
    `ReferralCodeError` addition didn't affect any existing error-class
    consumer.
- `npm run referral-report` — runs successfully end to end. At runtime
  (not just `prisma generate` time), the same darwin-vs-linux engine
  mismatch surfaces as a caught `PrismaClientInitializationError` inside
  `loadStatistics`'s own try/catch — exactly the "best-effort, never
  fatal" path this script is designed to exercise. The CLI still logs its
  readiness score, writes `reports/referral-report.md` and `.json` with
  the statistics section rendering "unavailable" and every other section
  fully populated, and exits 0.

## Remaining Limitations

- **No other module's use case calls `RecordConversionUseCase` yet.** A
  future booking-creation use case, booking-completion use case, and
  commission-creation use case would each call it with their own
  already-known `visitorId`/`revenueAmount`/`referenceId` — wiring that in
  means editing those modules' use cases, which is explicitly out of this
  module's scope (risky, and not what this task asked for). The use case
  and repository are ready to be called today.
- **No public tracking endpoint (Route Handler/Server Action) exists
  yet.** `TrackVisitUseCase`/`CreateReferralCodeUseCase` are ready for one
  to call; this module only builds the domain/application/infrastructure
  layers the brief asked for, not a new public API surface.
- **`RegisterUserUseCase`'s registration-attribution wiring is the only
  place `visitorId` currently flows into this module** — no
  client-side cookie-generation code, no tracking-pixel component, and no
  UI passes `visitorId` through to the registration form yet. Once a
  tracking endpoint exists, the registration form would need to read the
  same cookie the endpoint sets and include it as `RegisterInput.visitorId`.
- **`GetReferralStatisticsUseCase.topReferralCodes`/`topCampaigns` rank by
  visit count only**, not by conversions or revenue — a per-code/per-
  campaign conversion-rate breakdown would require joining
  `ReferralVisit`/`ConversionEvent` by `referralCode`/`utmCampaign` (rather
  than only by `attributionId`), which the current schema doesn't directly
  index for. The global funnel conversion rates already cover the
  platform-wide question this module's brief asked for; a per-code
  breakdown is a reasonable follow-up enhancement.
- **No admin-facing UI for referral-code administration was built** — only
  `CreateReferralCodeUseCase` + `compose.ts` wiring, matching this module's
  scope as a tracking/attribution/reporting backend layer, the same
  boundary Module 59's own doc draws for its provider-driven flow.
- **`MarketingAttribution.userId` is not a unique database constraint**
  (see that field's own doc comment in `schema.prisma`) — a user who
  registers under one `visitorId` after having visited under a different,
  never-registered one simply leaves the second attribution row
  permanently `userId: null`, which is an accepted, non-corrupting
  best-effort-attribution outcome, not a bug to fix here.
