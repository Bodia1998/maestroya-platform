# Module 22 — Commission & Financial

## Scope

This module implements MaestroYa's dual-sided commission model and the
authoritative financial record-keeping it requires: a centralized commission
policy, an append-only financial ledger, professional/customer/admin-facing
financial views, and the integration boundaries the future Module 12
(Payment/Stripe Connect), Module 21 (Disputes & Support), and Module 26
(IVA/Tax) need.

It does **not** implement: actual Stripe API calls (payment capture,
Connect transfers, webhooks), IVA/VAT calculation, or a general analytics
dashboard. Those are explicitly deferred to Modules 12, 26, and 23
respectively — see the boundary sections below.

## Business model

```
commissionBase        = laborSubtotal                          (materials NEVER included)
customerPlatformFee    = commissionBase * customerPlatformFeeRateBps / 10000
professionalCommission = commissionBase * professionalCommissionRateBps / 10000
professionalNetLaborEarnings = laborSubtotal - professionalCommission
platformGrossRevenue   = customerPlatformFee + professionalCommission
```

Default rates: 750 basis points (7.5%) for both the customer platform fee
and the professional commission. Worked example (labor €1,000, materials
€500): commission base = €1,000 (never €1,500); customer platform fee =
€75; professional commission = €75; professional net labor earnings =
€925; platform gross revenue = €150; customer total payable (labor +
materials + platform fee) = €1,575.

All of this lives in `src/core/domain/services/commission-policy.ts` — a
pure, dependency-free function
(`calculateCommissionBreakdown`). It is the single place this arithmetic
exists; every use case calls into it rather than re-deriving the math.

### Rates are configurable, not hardcoded

Rates are read through `CommissionRateRepository.getCurrentRates()`
(`src/core/domain/repositories/commission-rate-repository.ts`), backed by
the pre-existing `PlatformSetting` key/value table
(`PrismaCommissionRateRepository`, keys
`commission.customerPlatformFeeRateBps` /
`commission.professionalCommissionRateBps`). If no setting row exists yet,
the repository falls back to `DEFAULT_COMMISSION_RATES` (750/750). No
Server Action or use case in this module can write a rate — changing it is
an ops/PlatformSetting concern, never a client-triggered financial
operation.

### Labor vs. materials

`QuoteItem` gained a `category` column (`QuoteItemCategory`: `LABOR` |
`MATERIALS`, DB default `LABOR`). `CalculateJobCommissionBreakdownUseCase`
sums a Job's accepted Quote's items by category to get `laborSubtotal`/
`materialsSubtotal` before calling the commission policy — materials are
never multiplied by either rate.

Module 08 (Quote/Estimate) extension: `quoteItemSchema` gained an
**optional** `category` field (no schema-level default, so the *inferred
TypeScript type* stays optional and every existing call site — including
every other module's tests that seed a Quote — keeps compiling and
behaving exactly as before). `CreateQuoteUseCase`/`UpdateQuoteUseCase`
coalesce a missing category to `"LABOR"` before writing. The quote
submission UI itself was not changed by this module — a follow-up UI
change is expected to let a professional mark specific line items as
`MATERIALS`; until then, every item defaults to `LABOR`, which is the
conservative choice from the platform's own revenue perspective (never
silently zero-rates an item's commission).

## Financial lifecycle

Commission is recognized when a Payment is `CAPTURED`, never merely
because a Quote was accepted. The canonical flow, matching the module
spec's own "FUTURE MODULE 12 COMPATIBILITY" section:

```
quote ACCEPTED -> Job created (Module 11)
                -> Payment captured (future Module 12)
                -> RecordCommissionForPaymentUseCase (this module)
                -> Commission + ledger Transactions written
                -> payout eligibility (future Module 12/Payout)
```

`RecordCommissionForPaymentUseCase` resolves the Payment's Job via
`Payment.quote.job` (never a stored `Payment.jobId` column — this mirrors
Module 11's own "don't denormalize the amount" convention for Job), guards
on `payment.status === "CAPTURED"`, and is idempotent (see below).

## Ledger model

The pre-existing, previously-unused `Transaction` model is this module's
append-only general ledger — one row per money movement. This module adds
no update/delete method to `FinancialLedgerRepository`: a correction is
always a new row (e.g. a `COMMISSION_REVERSAL` entry), never a mutation of
a prior one.

`TransactionType` was extended (additively — the five pre-existing values
are untouched) with: `LABOR_CHARGE`, `MATERIALS_CHARGE`,
`CUSTOMER_PLATFORM_FEE`, `PROFESSIONAL_NET_EARNING`, `PLATFORM_REVENUE`,
`COMMISSION_REVERSAL`, `DISPUTE_ADJUSTMENT`, `PAYOUT_REVERSAL` (plus the
pre-existing `COMMISSION`, used for the professional's own commission
line). A captured Payment produces up to six ledger rows: `LABOR_CHARGE`,
`MATERIALS_CHARGE` (only if materials > 0), `COMMISSION`,
`CUSTOMER_PLATFORM_FEE`, `PROFESSIONAL_NET_EARNING`, `PLATFORM_REVENUE`.

Every ledger row carries `paymentId`/`commissionId` (or `payoutId`/
`refundId`, at most one, matching the pre-existing schema convention) for
traceability back to its source event, plus `createdAt`. `Commission` and
`FinancialAdjustment` in turn reference `Job`/`Quote`/`Payment`, so any
ledger row can be traced back to a customer, professional/company, and
job.

## Idempotency

Every write path is keyed deterministically, never on a caller-supplied
value (trusting the caller would make idempotency only as strong as the
caller's own discipline):

- Commission recording: `commission:<paymentId>`, plus one sub-key per
  ledger row (e.g. `:labor`, `:commission`). Retrying for the same Payment
  returns the existing `Commission` unchanged. `Commission.paymentId`'s DB
  unique constraint is the backstop against a concurrent duplicate.
- Financial adjustments: `adjustment:<jobId>:<disputeId|"none">:<type>:<paymentId|"none">`.
  Retrying the same logical adjustment returns the existing record.
  `FinancialAdjustment.idempotencyKey` and `Transaction.idempotencyKey` are
  both unique DB columns.

## Refunds and dispute-driven adjustments

Module 21 (Disputes & Support) is **not modified** by this module.
`ResolveDisputeUseCase` continues to only set `Dispute.resolution` — it
never moves money (see that use case's own doc comment, unchanged).

The integration boundary is `CreateFinancialAdjustmentUseCase`
(`src/core/application/use-cases/financial/create-financial-adjustment.use-case.ts`),
covering the exact vocabulary the module spec lists: `FULL_REFUND`,
`PARTIAL_REFUND`, `PROFESSIONAL_PAYOUT_REDUCTION`,
`PROFESSIONAL_PAYOUT_RELEASE`, `CUSTOMER_COMPENSATION`,
`PLATFORM_FEE_REFUND`, `COMMISSION_REVERSAL`. It is expected to be called
from the admin/support delivery layer — e.g. an admin action invoked right
after `resolveDisputeAction` — once an admin decides a resolved Dispute
requires a financial consequence. It deliberately does not import
`DisputeRepository` or any Dispute domain type: `disputeId` is accepted and
stored purely as an opaque traceability reference on
`FinancialAdjustment.disputeId`, keeping the two modules decoupled in both
directions.

Each adjustment is a two-step, auditable write: `create()` writes a
`PENDING` `FinancialAdjustment` row (idempotent), then a ledger
`Transaction` (`DISPUTE_ADJUSTMENT` or `COMMISSION_REVERSAL`) is created
and linked via `markApplied()`. If the ledger write fails, the adjustment
is marked `FAILED` rather than left silently `PENDING`.

Note: this module does not itself create a `Refund` model row (that
requires an actual Stripe refund call, Module 12's job) — it records the
*adjustment* and its ledger trail. Module 12 is expected to create the
matching `Refund` row once the real refund is processed and reconcile it
against the `FinancialAdjustment`.

## Money representation and rounding

Follows the project's existing, documented convention (see `money.ts`):
`Decimal(10,2)` in Postgres, converted to plain `number` at the repository
boundary, rounded to whole cents via `roundToCents` at every arithmetic
step — no arbitrary-precision decimal library. `commission-policy.ts`
reuses this exact primitive. Rounding is deterministic (same input always
produces the same output — see
`tests/unit/core/domain/commission-policy.test.ts`, "is a pure,
deterministic function"). Standard rounding (round-half-away-from-zero via
`Math.round`), applied independently to each computed figure (labor
subtotal, each fee) rather than derived by subtraction from a
pre-rounded total, so results never drift by a cent across repeated
calculations of the same input.

## Authorization

- **Customer**: `GetCustomerFinancialSummaryUseCase` re-derives ownership
  from the session (`CustomerProfileRepository.findByUserId` compared
  against `Job.customerId`) — never trusts a client-supplied customer id.
  A Job the caller isn't the customer for surfaces as `NotFoundError`
  (same anti-enumeration convention as `resolveJobActor`). The returned
  `CustomerFinancialSummaryDTO` has no field for the professional's
  commission, net earnings, or platform revenue — they are structurally
  absent from the type, not merely omitted by convention.
- **Professional**: `GetProfessionalEarningsUseCase` takes only a
  `userId`, resolves the caller's own `ProfessionalProfile`, and lists only
  `Commission` rows for that `professionalProfileId` — there is no
  parameter through which another professional's id could be requested.
- **Admin**: `GetPlatformRevenueSummaryUseCase` and
  `CreateFinancialAdjustmentUseCase` carry no authorization logic
  themselves — authorization is enforced by the caller
  (`requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN, ...)`), the same
  convention every other admin use case in this codebase follows (see
  `admin/disputes/actions.ts`). No Server Action for these use cases was
  added in this pass (see "Module 16 boundary" below); a future one must
  call `requireRole` first.
- **State transitions are always server-controlled**: no use case accepts
  a commission rate, ledger amount, or adjustment status from the client
  as-is without recomputation or an authorization gate — commission
  amounts are always calculated server-side from Quote/QuoteItem data, and
  `FinancialAdjustment.amount` is only ever accepted from an
  already-role-gated admin/support caller.

## Module 12 (Payment/Stripe Connect) boundary

No Stripe SDK import exists anywhere in this module's domain or
application layers (verified — every "Stripe" mention in this module's
source is a doc comment, never an import). The domain/application layers
only know about `Payment`, `PaymentStatusValue`, `Commission`,
`FinancialTransactionRecord` (ledger), `FinancialAdjustment`, and payout
eligibility as abstract concepts — never a `Stripe.PaymentIntent` or
similar SDK type. `PaymentRepository`
(`src/core/domain/repositories/payment-repository.ts`) is deliberately
**read-only** — it has no create/capture/authorize method. Creating and
capturing a Payment via a real Stripe PaymentIntent remains entirely
Module 12's job; the expected integration is that Module 12's
payment-captured webhook handler calls
`RecordCommissionForPaymentUseCase.execute(paymentId)` once it has
written the Payment row as `CAPTURED`.

## Module 21 (Disputes & Support) boundary

Covered above under "Refunds and dispute-driven adjustments." No file
under Module 21's own ownership (`domain/repositories/dispute-repository.ts`,
`domain/services/dispute-*.ts`, `application/use-cases/dispute/*`,
`app/(dashboard)/admin/disputes/*`) was modified by this module.

## Module 23 (Analytics) boundary

`GetPlatformRevenueSummaryUseCase` is a thin, single-purpose aggregate (no
charts, no trends, no drill-down) — the same boundary
`GetAdminDashboardOverviewUseCase` already documents for Module 16. Module
22 is responsible for authoritative financial records and one simple
admin summary of them; visualization, trend analysis, and cross-module
analytics belong to Module 23.

## Module 26 (IVA/Tax) boundary

No tax rate, VAT logic, or 21%-IVA assumption exists anywhere in this
module. `CommissionBreakdown` and the ledger deliberately keep labor,
materials, the customer's platform fee, and the professional's commission
as separate, addressable figures precisely so a future Module 26 can
apply IVA to the correct base(s) without re-deriving them from a merged
total.

## Module 16 (Admin Panel) boundary

No admin financial dashboard page or Server Action was added in this
pass — `GetAdminDashboardOverviewUseCase` explicitly excludes financial
figures today, so there is no existing admin financial section to
integrate with, and the module spec calls for building only the
domain/application infrastructure needed for future integration when
that's the case. `makeGetPlatformRevenueSummaryUseCase()` and
`makeCreateFinancialAdjustmentUseCase()` (see `compose.ts`) are ready for
a future `app/(dashboard)/admin/financial/actions.ts` to wire up behind
`requireRole`.

## Database changes

Migration: `prisma/migrations/20260803000000_add_commission_financial_module/`.
All changes are additive:

1. `QuoteItem.category` (`QuoteItemCategory` enum, default `LABOR`).
2. `TransactionType` gains 8 new values (existing 5 untouched).
3. `Transaction.idempotencyKey` (nullable, unique).
4. `FinancialAdjustment` table + `FinancialAdjustmentType`/
   `FinancialAdjustmentStatus` enums, with FKs to `Job` (required),
   `Dispute`/`Payment` (optional), `User` (`requestedByUserId`), and
   `Transaction` (`transactionId`, 1:1).

Nothing existing is renamed, dropped, or backfilled. `Payment`,
`Commission`, `Payout`, `Refund`, and `Transaction` (pre-existing, unused
before this module) are reused as-is.

**Environment note**: this environment has no live PostgreSQL instance and
no network access to the Prisma engine binary registry by default, so
`prisma migrate dev` could not be run to auto-generate this migration —
the same documented limitation every prior migration in this repo notes
(see e.g. `20260802000000_add_disputes_support_module/migration.sql`'s own
header). The migration SQL was hand-authored to mirror what that command
would produce. `prisma validate`, `prisma generate`, and `prisma migrate
status` semantics were otherwise verified (see "Validation results"
below); run the real command once a database is available to
double-check.

## Security considerations

- No commission rate, ledger entry, or payout status can be set directly
  by any client input — every calculated figure is always derived
  server-side from Quote/QuoteItem/PlatformSetting data.
- `FinancialAdjustment.amount` is the one place this module accepts a
  money amount directly from a caller, and only from an already
  role-gated admin/support Server Action — never from a customer or
  professional.
- Ownership checks collapse "doesn't exist" and "isn't yours" into the
  same `NotFoundError`, preventing ID enumeration.
- The ledger has no update/delete surface at all — immutability is
  structural (the interface has no such method), not just a convention.

## Testing

- `tests/unit/core/domain/commission-policy.test.ts`: 15 tests covering
  the customer/professional 7.5% calculations, labor-only commission
  base, materials exclusion (including materials dwarfing labor), zero
  labor, zero materials, large amounts, rounding determinism,
  configurable rates, and rejection of negative input.
- `tests/integration/financial/financial-flows.test.ts`: 15 integration
  tests (real use cases + domain services, fake in-memory repositories —
  same convention as every other module) covering: commission-breakdown
  calculation from an accepted Quote/Job, the "never charge on
  quote-acceptance alone" lifecycle rule, full ledger trail on capture,
  commission-recording idempotency, professional-earnings visibility
  (including "never another professional's"), customer-summary
  authorization (`NotFoundError` for another customer's Job),
  customer-safe DTO field exclusion, refund reflection, dispute-adjustment
  creation and application, adjustment idempotency, adjustment rejection
  for a nonexistent Job, materials-exclusion at the Job level,
  configurable rates at the Job level, ledger append-only behavior, and
  ledger-to-payment traceability.

## Validation results

- `prisma validate`: schema is valid.
- `prisma generate`: Prisma Client generated successfully with all new
  models/fields/enums.
- `tsc --noEmit`: zero errors across the entire codebase (including this
  module's new files and the Module 08 extension).
- `eslint`: zero errors, zero warnings on every file this module touched
  or added.
- `vitest`/`next build`: could not be executed in this environment — the
  installed `node_modules` was built for macOS (darwin-arm64) and this
  sandbox is linux-arm64; both `esbuild` and `rollup`'s native binaries
  are platform-specific, and this environment has no network access to
  the npm registry to install the missing linux-arm64 variants (confirmed
  — `npm view` against the public registry itself returns 403). This is
  an environment limitation affecting every module's test suite, not
  specific to this change. As a substitute, the commission-policy domain
  logic was compiled with the project's own `tsc` (no native dependency)
  and executed directly with plain Node — all 14 runtime checks passed,
  including the module spec's own worked examples (labor €1,000/materials
  €500 → €75/€75; labor €2,000/materials €10,000 → €150/€150; zero labor →
  zero commission; 2.49975 rounds to 2.50; configurable rates). Please run
  `npm test`, `npm run build`, and `npm run lint` in a normal (matching
  native-binary) environment before merging to confirm the full suite,
  including the new integration tests.

## Future extension points

- Module 12: implement `PaymentRepository`'s write side (or a sibling
  interface) and call `RecordCommissionForPaymentUseCase` from the
  payment-captured webhook handler; populate `Payout`/`Refund` rows for
  real Stripe Connect transfers/refunds.
- Module 16: add `app/(dashboard)/admin/financial/actions.ts` wiring
  `makeGetPlatformRevenueSummaryUseCase`/`makeCreateFinancialAdjustmentUseCase`
  behind `requireRole`, plus a corresponding admin page.
- Module 21: call `makeCreateFinancialAdjustmentUseCase()` from the admin
  disputes UI once an admin decides a resolved Dispute needs a financial
  consequence.
- Module 26: consume `CommissionBreakdown`'s `laborSubtotal`/
  `materialsSubtotal`/`customerPlatformFee`/`professionalCommission` as
  the pre-tax bases for IVA calculation.
- A future quote-submission UI change to let professionals mark specific
  line items as `MATERIALS` (currently only the backend supports it).
