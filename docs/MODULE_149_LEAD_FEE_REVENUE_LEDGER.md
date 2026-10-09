# Module 149 — Lead-Fee Revenue Ledger

Status: implemented on `feature/module-149/lead-fee-revenue-ledger`. Scope: LEAD_V1 only.
This document describes **only behaviour confirmed by the implementation**. Part A is *operational ledger
semantics* (what the code does). Part B is *formal accounting / tax policy* — none of it is decided here.

## Part A — Operational ledger semantics

### A1. Authoritative source event
A lead-fee payment is proven **only** by the signature-verified Stripe `payment_intent.succeeded` event
handled by `ProcessLeadFeePaymentWebhookUseCase` (Module 141), after it has:

1. claimed the event id in the idempotency ledger (`external_webhook_events`, provider `STRIPE_LEAD_FEE_PAYMENTS`);
2. correlated the purchase by the persisted, write-once, unique `LeadPurchase.paymentReference` (never by client/metadata ids);
3. validated reference, metadata cross-check, LEAD_V1 lead, M135/M136 snapshot, **amount in exact minor units and currency** against the immutable snapshot.

Payment initiation (M140), a client-side success response, `payment_intent.payment_failed`,
`payment_intent.canceled`, and every rejected / unmatched / duplicate / ignored event **never** create an entry.

### A2. What an entry means
`lead_fee_ledger_entries` (Prisma `LeadFeeLedgerEntry`) is an **append-only operational event record**:
"the professional's lead-access fee payment SUCCEEDED and the purchase was CONFIRMED". The only entry type is
`LEAD_FEE_PAYMENT_SUCCEEDED`. It is not a double-entry ledger (no debit/credit, accounts or balances).

| Field | Meaning / source |
|---|---|
| `id` | UUID |
| `entryType` | `LEAD_FEE_PAYMENT_SUCCEEDED` |
| `leadPurchaseId` | FK (RESTRICT) to `lead_purchases`; the stable link to purchase |
| `leadId`, `professionalProfileId` | copied from the purchase (immutable there); indexed, not separate FKs |
| `paymentReference` | the purchase's Stripe PaymentIntent id |
| `providerEventId`, `providerEventCreatedAt` | the verified Stripe event that proved payment (audit link to `external_webhook_events.externalEventId`) |
| `netFeeAmount` | `LeadPurchase.price` — the net lead-access fee |
| `taxAmount` | M136 IVA exactly as snapshotted (copied, never recomputed; not an accounting allocation) |
| `totalCollectedAmount` | `LeadPurchase.totalAmount` = net + IVA = what the professional paid MaestroYa; equals the provider amount that was verified in minor units |
| `currency` | ISO code from the snapshot (EUR today) |
| `taxPolicyVersion`, `pricingConfigVersion`, `pricingRuleVersion` | provenance copied from the snapshot |
| `paymentConfirmedAt` | `LeadPurchase.confirmedAt` |
| `recordedAt` | DB insert time |

Money is `Decimal(10,2)` and travels as decimal **strings** (the repository's fixed-point conventions); no JS float.
Every amount is read from the persisted purchase snapshot, never from the client and never from the event body
(the event amount only has to *match*).

### A3. Lead-access fee vs. the professional's service revenue
The entry holds only the fee the professional pays MaestroYa. The customer's job value, the lead's
`publicationEstimatedJobValue`, quotes, and the customer→professional payment are not read, copied or inferable
from an entry (unit test asserts the exact field set). MaestroYa never collects the professional's service revenue
(no Stripe Connect transfer/payout is touched).

### A4. Idempotency and uniqueness
Layers, outermost first:

1. **Webhook event claim** — same Stripe event id processed once (`duplicate`).
2. **Status-conditional update** — `PENDING_PAYMENT → CONFIRMED` matches for exactly one concurrent caller; only that caller inserts the entry.
3. **DB unique indexes** — `(leadPurchaseId, entryType)` and `(paymentReference, entryType)`; the final arbiter.
4. **Already-confirmed reprocessing** — a *new* event id for an already-CONFIRMED purchase whose facts match goes through `recordIfAbsent` (`INSERT … ON CONFLICT DO NOTHING`, then re-read). No entry → one is created from the persisted snapshot (original `confirmedAt` kept; `recordedAt` is later); entry exists and matches → nothing written; entry exists but disagrees → `LeadFeeLedgerConflictError` is thrown (never overwritten).

### A5. Transaction boundary and failure behaviour
- The first confirmation runs in **one DB transaction** (`PrismaLeadPurchaseRepository.transition(…, ledgerSource)` → `confirmWithLedgerEntry`): conditional status update **and** ledger insert. The existing path is reused: webhook → `ConfirmLeadPurchaseUseCase.confirmWithLedgerSource` (the unchanged `execute(purchaseId)` contract writes no entry) → repository; there is no second payment-processing path. Without a `ledgerSource` the repository behaves exactly as before.
- If the entry cannot be built or inserted, the transaction rolls back (purchase stays `PENDING_PAYMENT`, no contact access), the error propagates, the webhook claim is marked `FAILED` (re-claimable) and the route returns 5xx, so Stripe retries. Ledger errors are never swallowed or reported as recorded.
- Deterministic data problems (e.g. a confirmed purchase without `confirmedAt`) are acknowledged as `rejected` with rejection `LEDGER_ENTRY_INVALID` and logged, like the other business rejections; nothing is recorded.
- The `LeadPurchaseConfirmed` notification event (M145) is raised after the ledger step, unchanged and best-effort.
- DB append-only trigger: `UPDATE`/`DELETE` on the ledger raise an error. Corrections must be new entries (later modules).

### A6. Exclusions (not in M149)
No invoice (M150), credit note (M151), reconciliation (M152), refund execution (M153), claims (M154), chargeback / access
revocation (M155) or fraud controls (M156); no IVA calculation (IVA is the existing M136 snapshot); no admin console; no Stripe
Connect. Entry types for refunds/credit notes do not exist. Legacy `Payment`/`Payout`/`Commission`/`Transaction` code is
untouched and cannot write this table (static test).

### A7. Why a new table instead of the legacy `Transaction` ledger
The existing `Transaction` ledger is tied by FK to legacy `Payment`/`Payout`/`Refund`/`Commission`, is swept by the legacy
reconciliation (M92) and typed with legacy `TransactionType`s. Writing LEAD_V1 fees there would mix flows and imply a
debit/credit/signing convention that has not been approved. A separate additive table keeps both flows isolated.

### A8. Schema / migration
`prisma/migrations/20261013000000_add_module_149_lead_fee_revenue_ledger/migration.sql` — additive only: enum
`LeadFeeLedgerEntryType`, table `lead_fee_ledger_entries`, two unique indexes, three secondary indexes, FK RESTRICT to
`lead_purchases`, CHECKs (net > 0, tax ≥ 0, total = net + tax, ISO currency, non-empty references) and the append-only
trigger. No existing table/column/row is changed or backfilled. Rollback: drop the table, function and type (only if no entry must be kept).

### A9. Tests
- `tests/unit/core/domain/services/lead-fee-revenue-ledger-m149.test.ts` — entry rules, precision, field set, status guards.
- `tests/unit/core/application/use-cases/lead-fee-payment/lead-fee-revenue-ledger-m149.test.ts` — confirmation, duplicates, concurrency, reprocessing, pre-M149 repair, non-success events, failure/rollback/retry.
- `tests/unit/core/infrastructure/database/prisma/repositories/prisma-lead-fee-revenue-ledger-m149.test.ts` — one-transaction contract, lost race, rollback propagation, `recordIfAbsent`.
- `tests/unit/prisma/lead-fee-revenue-ledger-boundary-m149.test.ts` — who may write, legacy isolation, wiring, migration guarantees.
- `tests/integration-db/lead-fee-ledger/lead-fee-revenue-ledger-m149.test.ts` — real PostgreSQL (atomicity/rollback, concurrency, constraints, trigger). See the final report for which checks were actually executed.

### A10. Known limitations
- Purchases confirmed before M149 have no entry until a verified success event is redelivered with a *new* event id (a re-send of the same event id is a `duplicate`). There is no backfill job (out of scope).
- `leadId` / `professionalProfileId` are denormalised (no own FKs); the FK to the purchase determines them and they are immutable there.
- `ledger` is an optional constructor dependency of the webhook use case (kept optional so existing constructions stay valid); the composition root injects it and a static test guards that. The atomic first-confirmation entry does not depend on it.
- Only the verified event's id and timestamp are stored from the provider; no payload is persisted.

## Part B — Open accounting / tax / product decisions (require approval; NOT decided by M149)
1. **What is "revenue"**: net fee only, or net + IVA as a gross receipt with IVA as a liability? The entry stores net, IVA and total separately and takes no position.
2. **Revenue-recognition timing** (at payment vs. at lead delivery/access vs. other) — `paymentConfirmedAt` is the confirmation time only.
3. **Double-entry model**: chart of accounts, debit/credit direction, signing convention for later refunds/credit notes.
4. **IVA treatment/allocation** and whether the 21% policy (M136) holds for every professional (e.g. billing identity, reverse-charge, intra-EU, exempt cases); IVA is copied from the M136 snapshot.
5. **Stripe fees** and payment-provider settlement (gross vs. net of fees) are not recorded.
6. **Refund / credit-note / chargeback semantics** (reversal entries vs. status) — M151/M153/M155.
7. **Backfill** of pre-M149 confirmed purchases and whether `recordedAt ≠ paymentConfirmedAt` entries need a flag.
8. **Retention / immutability policy** for ledger rows and the legal basis (append-only is enforced technically).
