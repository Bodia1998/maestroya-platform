# Module 61 — Affiliate & Partner System

## Purpose & Scope

A complete Affiliate & Partner System: partner accounts (with an admin
approval workflow), affiliate commission calculation and a full ledger,
a partner dashboard reporting projection, payout eligibility/batching
(architecturally ready for Stripe, not yet integrated), and advisory fraud
detection.

This module **extends Module 60 (Referral & Marketing Attribution
Platform)**. It does not duplicate referral tracking, attribution,
UTM handling, or click/visit deduplication — every one of those concerns
stays exactly where Module 60 put it, and this module only ever *reads*
from Module 60's repositories. Concretely:

- A partner's referral links are ordinary `ReferralCode` rows whose
  `ownerUserId` is the partner's own `userId` — there is no second
  "partner referral code" table. `GeneratePartnerReferralLinkUseCase` is a
  thin wrapper around Module 60's own `CreateReferralCodeUseCase`.
- Attribution (first/last touch, UTM, visitor identity) stays entirely
  owned by `MarketingAttribution`/`ReferralVisit`. This module adds two
  read-only query methods to those repositories
  (`findByOwnerUserId`/`listByReferralCodes`) so a partner's own slice of
  that data can be read back, but never writes to them.
- Conversions stay entirely owned by `ConversionEvent` (Module 60). This
  module never creates a `ConversionEvent` itself.

This module also **never modifies MaestroYa's platform commission
calculation** (Module 22's `commission-policy.ts` / `Commission` model).
`AffiliateCommission.platformCommissionAmount` is always a read-only
snapshot of an already-existing `Commission.amount`, supplied by whichever
future caller invokes `RecordAffiliateCommissionUseCase`. See "Commission
Policy" below for the exact calculation and its worked example.

## Architecture

Clean Architecture / DDD / Repository Pattern / CQRS-flavored, following
this codebase's existing conventions exactly (same layering and file
naming as Module 60/22):

```
domain/
  repositories/
    partner-repository.ts
    affiliate-commission-repository.ts
    partner-payout-repository.ts
    partner-fraud-flag-repository.ts
  services/
    affiliate-commission-policy.ts     — pure: 10% of Commission.amount
    partner-approval-rules.ts          — pure: partner status state machine
    partner-payout-rules.ts            — pure: threshold + batch selection
    affiliate-fraud-rules.ts           — pure: fraud signal detection

application/
  dto/affiliate.dto.ts                 — zod schemas
  use-cases/affiliate/
    register-partner.use-case.ts
    approve-partner.use-case.ts
    reject-partner.use-case.ts
    suspend-partner.use-case.ts
    ban-partner.use-case.ts
    generate-partner-referral-link.use-case.ts   — wraps Module 60
    record-affiliate-commission.use-case.ts      — the financial link
    approve-affiliate-commission.use-case.ts
    cancel-affiliate-commission.use-case.ts
    expire-affiliate-commissions.use-case.ts
    create-partner-payout.use-case.ts
    get-partner-dashboard-statistics.use-case.ts — CQRS query
    get-affiliate-summary-statistics.use-case.ts — CQRS query (platform-wide)
    detect-partner-fraud-signals.use-case.ts
    list-admin-partners.use-case.ts              — CQRS query
    get-admin-partner-audit.use-case.ts           — CQRS query
    compose.ts                                    — composition root

infrastructure/
  database/prisma/repositories/
    prisma-partner-repository.ts
    prisma-affiliate-commission-repository.ts
    prisma-partner-payout-repository.ts
    prisma-partner-fraud-flag-repository.ts
  affiliate/affiliate-report-generator.ts
```

Every write path is a plain use case class taking its dependencies via
constructor injection (no framework-level DI container exists anywhere in
this codebase — every module wires its own `compose.ts`, and this module
follows that exact pattern). Read paths (`GetPartnerDashboardStatisticsUseCase`,
`GetAffiliateSummaryStatisticsUseCase`, `ListAdminPartnersUseCase`,
`GetAdminPartnerAuditUseCase`) are separate, dependency-free-of-writes
query use cases — the CQRS split this codebase already applies elsewhere
(e.g. `GetReferralStatisticsUseCase` alongside `TrackVisitUseCase`).

Domain events: this module raises no new domain event type of its own. It
participates in the existing event-light convention this codebase already
uses for Module 60 (plain repository calls, no event bus) — see "Remaining
Limitations" for why a `PartnerApprovedEvent`/`AffiliateCommissionRecordedEvent`
was considered and deferred.

## Database Changes

Purely additive — five new enums, four new tables, one new relation field
on the existing `users` model (no FK column on `users` itself). No
existing table (including every Module 60/22 table) is altered, renamed,
or has a column added/removed. See
`prisma/migrations/20260818000000_add_affiliate_partner_system/migration.sql`.

- `partners` — one row per affiliate/partner account (`userId` unique).
- `affiliate_commissions` — the commission ledger (`conversionEventId`
  unique, the idempotency anchor).
- `partner_payouts` — payout batches.
- `partner_fraud_flags` — advisory fraud signals.

## Partner Accounts

`Partner.type` covers every category the spec lists: `INDIVIDUAL`,
`COMPANY`, `AGENCY`, `BLOGGER`, `TELEGRAM_CHANNEL`, `INSTAGRAM_CREATOR`,
`TIKTOK_CREATOR`, `YOUTUBE_CREATOR`, `FACEBOOK_COMMUNITY`. No business rule
in this module branches on `type` — it exists purely for admin-panel
filtering/reporting.

### Approval workflow

`domain/services/partner-approval-rules.ts` is the single state machine
every status-changing use case goes through:

```
PENDING   -> APPROVED | REJECTED
APPROVED  -> SUSPENDED | BANNED
SUSPENDED -> APPROVED | BANNED
REJECTED  -> (terminal)
BANNED    -> (terminal)
```

Only an `APPROVED` partner may generate referral links or accrue affiliate
commissions (`isPartnerActiveForAffiliateActivity`). Suspending or banning
a partner deliberately does **not** automatically cancel their outstanding
`PENDING`/`APPROVED` commissions — that is always a separate, explicit,
audited admin action (`CancelAffiliateCommissionUseCase`), so a temporary
suspension pending review never silently forfeits earnings an
investigation might later clear.

### Payout information

`Partner.payoutMethod` (`MANUAL` | `STRIPE`) and `Partner.payoutDetails`
(provider-agnostic JSON) are modeled now so a payout batch always has
somewhere to point; see "Partner Payout Rules" below for why `STRIPE`
never actually calls Stripe today.

## Referral Attribution — reused, not duplicated

Every referral/attribution capability required by this module already
exists in Module 60: first-touch/last-touch attribution
(`MarketingAttribution`), UTM handling (`ReferralVisit`), and referral
codes (`ReferralCode`). This module adds exactly three read methods across
two repository interfaces, all additive (no existing method signature
changed):

- `ReferralCodeRepository.findByOwnerUserId` — a partner's own link
  catalog.
- `ReferralVisitRepository.listByReferralCodes` — visits scoped to a
  partner's codes (feeds "clicks"/"visits" and top-campaign/top-code
  dashboard stats).
- `MarketingAttributionRepository.listByReferralCodes` — attributed
  visitors scoped to a partner's codes (feeds registration/booking counts
  and fraud detection).

## Affiliate Commission — 10% of MaestroYa's platform commission

**This is the module's most important business rule, so it is repeated
here verbatim from the spec:**

```
Booking:                        1,000€
MaestroYa platform commission:  10% = 100€
Affiliate receives:             10% OF MAESTROYA'S 100€ COMMISSION = 10€
MaestroYa keeps:                90€
```

`domain/services/affiliate-commission-policy.ts`'s
`calculateAffiliateCommission(platformCommissionAmount, rateBps)` **only
ever multiplies against an already-known commission amount** — it never
receives, reads, or derives anything from a booking/labor/materials
subtotal. This is what makes it structurally impossible for this
calculation to become "10% of the booking value" by accident: there is no
booking value anywhere in its input type.

`AFFILIATE_COMMISSION_RATE_BPS = 1000` (10%), matching the bps convention
`CommissionRates` already establishes in Module 22 (`professionalCommissionRateBps`).

**MaestroYa's platform commission calculation itself
(`commission-policy.ts`'s `calculateCommissionBreakdown`, and the
`Commission` model/table) is not modified by this module in any way** —
this module does not import `calculateCommissionBreakdown`, does not write
to the `commissions` table, and does not recompute `Commission.amount`.
`RecordAffiliateCommissionUseCase` takes `platformCommissionAmount` as a
caller-supplied `number`, exactly the way `RecordCommissionForPaymentUseCase`
(Module 22) itself takes `Payment`/`Job` data from other modules without
ever importing their calculation logic.

### Attribution resolution

`RecordAffiliateCommissionUseCase` resolves "which partner (if any) earns
a commission for this booking" entirely through Module 60's existing data,
reused as-is:

1. `MarketingAttributionRepository.findByVisitorId(visitorId)` → the
   visitor's `lastReferralCode` (falling back to `firstReferralCode`).
2. `ReferralCodeRepository.findByCode` → that code's `ownerUserId`.
3. `PartnerRepository.findByUserId` → that owner's partner account, if any
   and if `APPROVED`.

Every one of those three lookups returning nothing simply means "this
booking has no affiliate to pay" — the use case returns `null`, never
throws, for an unattributed visitor, a referral code with no partner
owner, or a partner that isn't currently `APPROVED`.

## Commission Ledger

`AffiliateCommission.status`:

```
PENDING -> APPROVED -> PAID
PENDING -> CANCELLED
PENDING -> EXPIRED  (after AFFILIATE_COMMISSION_EXPIRY_DAYS = 180 days unreviewed)
APPROVED -> CANCELLED
APPROVED -> PAID     (via CreatePartnerPayoutUseCase, batched)
```

Every row snapshots `platformCommissionAmount`, `affiliateRateBps`, and
`affiliateAmount` at creation time — a later rate change or a Module 22
correction never retroactively changes an already-recorded row (the same
"snapshot the rate actually used" convention `Commission.rateBps` already
establishes). `conversionEventId` is unique, making
`RecordAffiliateCommissionUseCase` idempotent under retry/redelivery.
`payoutId` traces every `PAID` row back to the exact `PartnerPayout` batch
that settled it, so "why was this partner paid this amount, from what" is
always answerable from the ledger alone.

## Partner Dashboard

`GetPartnerDashboardStatisticsUseCase` returns every figure the spec's
"Partner Dashboard" section lists, scoped to exactly one partner's own
referral codes: `clicks`, `visits` (Module 60 does not model "click" as
distinct from "visit" — this module does not introduce a second concept
for it, consistent with "reuse, don't duplicate"), `registrations`
(further split into `professionalRegistrations`/`customerRegistrations`
via Module 60's existing `ConversionEvent.type`), `bookingsCreated`,
`completedJobs`, `platformCommissionGenerated`, `affiliateEarnings`
(pending/approved/paid totals), `conversionRate`, `topCampaigns`, and
`topReferralCodes`.

Not optimized for a partner with an extremely large attributed-visitor
count — conversions are fetched one attribution at a time (no "list by
many attributionIds" batch method exists in Module 60). Accepted,
documented limitation rather than a reason to speculatively add batch
query methods to Module 60 (see "Remaining Limitations").

## Partner Payout Rules

`domain/services/partner-payout-rules.ts`:

- `DEFAULT_MINIMUM_PAYOUT_THRESHOLD = 50` (platform base currency) —
  overridable per partner via `Partner.minimumPayoutThreshold`.
- `selectPayoutBatch` settles a partner's **entire** `APPROVED` balance in
  one batch (no partial payouts) — this keeps `AffiliateCommission.payoutId`
  unambiguous.
- `PartnerPayout.status`: `PENDING -> PROCESSING -> PAID`, or `-> FAILED`
  / `-> CANCELLED`.
- Payment history: every `PartnerPayout` row, queryable per partner via
  `PartnerPayoutRepository.listForPartner`.
- Exportable reports: `npm run affiliate-report` (see "Reporting" below);
  a future CSV/PDF export of `listForPartner`'s result is a thin
  presentation-layer concern on top of already-available data, not
  something this module needs to add itself.

### Future Stripe support — architecture only

`PartnerPayoutMethod.STRIPE` exists in the enum/schema **today**, purely
so this architecture never needs a migration when Stripe Connect payouts
are actually wired up. **No Stripe SDK call happens anywhere in this
module.** `CreatePartnerPayoutUseCase` records a `PartnerPayout` row with
whatever `method` the partner is configured for; when that's `STRIPE`, the
row's `status` starts `PENDING` and stays there until some future module
actually initiates and confirms the transfer. This mirrors exactly how
`ProfessionalProfile.stripeConnectAccountId`/`Payout.stripeTransferId`
already exist in this schema well ahead of a live Stripe integration.

## Fraud Protection

`domain/services/affiliate-fraud-rules.ts` — every rule is a pure function
over already-fetched data (visits/attributions from Module 60, plus this
module's own registration-outcome data), independently unit-testable with
no repository/mock required:

- `detectSelfReferral` — the partner's own `userId` appears as the
  referred user.
- `detectRepeatedIp` — the same hashed IP behind 4+ distinct referred
  users.
- `detectRepeatedDevice` — the same truncated User-Agent behind 4+
  distinct referred users.
- `detectDuplicateAccounts` — the same referred user attributed under 2+
  distinct `visitorId`s.
- `detectSuspiciousConversionVelocity` — 20+ conversions within a
  10-minute window.
- `detectFakeRegistrationPattern` — 80%+ of a partner's registrations
  (once there are at least 5) never produced any further activity
  (no `BOOKING_CREATED`/`BOOKING_COMPLETED`).

`DetectPartnerFraudSignalsUseCase` runs every rule for one partner and
persists any findings as `PartnerFraudFlag` rows (`status: OPEN`). **Every
rule is advisory only** — detecting a signal never itself blocks a
conversion, cancels a commission, suspends, or bans a partner. An admin
always reviews an `OPEN` flag and resolves it (`REVIEWED` / `DISMISSED` /
`CONFIRMED`) via `PartnerFraudFlagRepository.resolve`; only a human
decision drives any consequential action (`SuspendPartnerUseCase`,
`CancelAffiliateCommissionUseCase`, etc.), never this use case itself.

Thresholds (4 distinct users for IP/device, 20 conversions/10 minutes, 80%
dead-registration ratio with a 5-registration minimum sample) are
deliberately conservative defaults tuned to avoid false-positiving a small
or brand-new partner on noise; every threshold is a function parameter
with a documented default, not a hardcoded magic number, so a future
tuning pass never requires touching the rule's logic itself.

## Admin Panel

Every admin capability the spec lists is a dedicated use case:
`ApprovePartnerUseCase`, `RejectPartnerUseCase`, `SuspendPartnerUseCase`,
`BanPartnerUseCase` (actions); `ListAdminPartnersUseCase` (listing,
optionally filtered by status — e.g. the pending-approvals queue);
`GetAdminPartnerAuditUseCase` (the single "audit this partner" read:
profile, every referral link, full commission ledger, payout history, and
fraud flags, all in one call). As with Module 60, no Route
Handler/Server Action/UI page is wired up by this module — see "Remaining
Limitations."

## Reporting

`npm run affiliate-report` runs `scripts/run-affiliate-report.ts`, writing
`reports/affiliate-report.md` and `reports/affiliate-report.json`. Same
"gather data (best-effort, never fatal if the database is unreachable),
hand it to a pure renderer" split `scripts/run-referral-report.ts`
establishes — `infrastructure/affiliate/affiliate-report-generator.ts` is
the pure renderer, unit tested independently of any database access.

## Testing

- **Unit (domain)**: `affiliate-commission-policy.test.ts`,
  `partner-approval-rules.test.ts`, `partner-payout-rules.test.ts`,
  `affiliate-fraud-rules.test.ts` — every pure rule, including the exact
  worked example from the spec (1,000€ booking → 100€ platform commission
  → 10€ affiliate).
- **Unit (infrastructure)**: `affiliate-report-generator.test.ts`.
- **Integration**: `tests/integration/affiliate/affiliate-flows.test.ts` —
  every use case exercised end-to-end against fake repositories
  (`tests/integration/affiliate/fakes.ts`), reusing Module 60's own fakes
  (`tests/integration/referral/fakes.ts`) rather than re-implementing
  referral/attribution behavior. Covers the full partner approval
  lifecycle, referral-link generation, the commission ledger's full
  lifecycle (record → approve → payout, and record → cancel/expire),
  dashboard statistics, and fraud detection.
- **Repository tests**: Prisma repositories in this codebase are
  consistently exercised only indirectly, through the integration tests
  above with fakes standing in for them (the same pattern Module 60/22
  follow — there is no direct-against-Postgres repository test suite
  anywhere in this codebase, since no database is available in this
  sandbox; see "Validation Results").
- **Application tests**: covered by the integration suite (every use case
  is exercised through its public `execute` method).

## Validation Results

Run on the real project (not a partial checkout) — same environment
constraint every prior module's own "Validation Results" section
documents: `node_modules/.prisma/client` was generated on the host machine
for `darwin-arm64`; there is no live Postgres connection available here
either.

- `npm run lint` (`eslint`) — every file this module added or touched: 0
  errors, 0 warnings (one `@typescript-eslint/consistent-type-imports`
  warning was found and fixed during development —
  `generate-partner-referral-link.use-case.ts`'s `CreateReferralCodeUseCase`
  import is type-only).
- `npm run typecheck` (`tsc --noEmit`) — clean **except** the four new
  Prisma repository files (`prisma-partner-repository.ts`,
  `prisma-affiliate-commission-repository.ts`,
  `prisma-partner-payout-repository.ts`,
  `prisma-partner-fraud-flag-repository.ts`), which reference
  `prisma.partner`/`affiliateCommission`/`partnerPayout`/`partnerFraudFlag`
  — properties that don't exist on the stale, pre-Module-61 generated
  `PrismaClient` type until `npx prisma generate` is re-run against the
  updated schema. Every other file this module touched or added —
  every domain/application/DTO/use-case/compose/test file, plus the two
  Module 60 repository interfaces/implementations extended
  (`referral-code-repository.ts`, `referral-visit-repository.ts`,
  `marketing-attribution-repository.ts`, and their Prisma
  implementations) — typechecks clean with zero errors. Two real bugs
  surfaced and were fixed during this pass (both `noUncheckedIndexedAccess`
  violations, unrelated to Prisma): a possibly-`undefined` array read in
  `detectSuspiciousConversionVelocity`, and six possibly-`undefined`
  `findings[0]` accesses in `affiliate-fraud-rules.test.ts`.
- `npm test` (targeted `vitest run`, since the full suite exceeds a single
  command's time budget in this environment — same fallback every prior
  module's own "Validation Results" documents):
  - Every new Module 61 unit test: 5 files, 44 tests, all passing
    (`affiliate-commission-policy`, `partner-approval-rules`,
    `partner-payout-rules`, `affiliate-fraud-rules`,
    `affiliate-report-generator`).
  - `tests/integration/affiliate` + `tests/integration/referral`: 2 files,
    37 tests, all passing — confirms Module 60's own referral flow is
    unaffected by this module's two additive repository-interface
    extensions.
  - `tests/unit/core/domain/commission-policy.test.ts` +
    `tests/integration/auth`: 2 files, 24 tests, all passing — confirms
    Module 22's commission calculation and the existing registration flow
    are both untouched.
- `npm run affiliate-report` — runs successfully end to end and exits 0.
  `GetAffiliateSummaryStatisticsUseCase` hits the expected
  darwin-vs-linux `PrismaClientInitializationError` (surfaced here as a
  plain `TypeError` since the stale client has no `partner` property at
  all to even construct the proper Prisma error from) inside its own
  try/catch — exactly the "best-effort, never fatal" path this script is
  designed to exercise, the same way `referral-report`'s own statistics
  query does. Writes `reports/affiliate-report.md` and
  `reports/affiliate-report.json` with the summary section rendering
  "unavailable," every architecture and commission-policy check PASS, and
  a resulting readiness score of 69/100 (informational integration-readiness
  checks intentionally FAIL — see that section — production-ready is still
  `YES`).

## Remaining Limitations

Deliberately out of this module's scope, mirroring exactly how Module 60
documents its own remaining integration gaps:

- **Module 22 does not yet call `RecordAffiliateCommissionUseCase`.**
  `RecordCommissionForPaymentUseCase` is the natural caller (immediately
  after it creates a `Commission` row and Module 60's
  `RecordConversionUseCase` records the matching `COMMISSION_GENERATED`
  event) but no such wiring exists yet — this module only provides the
  use case, ready to be called.
- **`ExpireAffiliateCommissionsUseCase` is not wired to a scheduler.**
  Ready for a future cron entry point, the same way Module 60's own
  reporting script has none either.
- **No public partner-facing or admin-facing Route Handler/Server
  Action/UI exists.** Every use case in this module is ready for a
  presentation layer to call; none is wired up by this module, matching
  Module 60's own "tracking/attribution use cases exist, no endpoint
  calls them yet" state at the time it was built.
- **Stripe Connect payout execution is not implemented** — see "Future
  Stripe support" above.
- **`GetPartnerDashboardStatisticsUseCase` is not optimized for very
  large attribution volumes** — see "Partner Dashboard" above.
- **No `PartnerApprovedEvent`/`AffiliateCommissionRecordedEvent` domain
  event is raised.** This codebase's existing modules do not use an event
  bus for this class of "notify something else happened" concern (e.g.
  Module 60 also raises no event when a conversion is recorded) — a
  notification (email/SMS to the partner on approval, etc.) is left to
  whatever future module owns that responsibility, the same way Module 60
  leaves "notify a professional their referral converted" unimplemented.
- **Fraud detection thresholds are fixed defaults, not admin-configurable.**
  Every threshold is a documented function parameter (see "Fraud
  Protection"), so making them configurable later is a small, localized
  change — not a rule-logic rewrite — but no `PlatformSetting`-backed
  configuration surface exists for them yet (unlike Module 22's own
  `CommissionRateRepository`, which this module deliberately did not
  imitate here to keep initial scope bounded).
