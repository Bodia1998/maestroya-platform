# Module 155 — Chargebacks & Access Revocation (Phase 8)

**Status: implemented in part. NOT marked complete.** Dispute tracking, access suspension and revocation are done and verified. The financial
consequence of a chargeback (refund, credit note, ledger adjustment) and a revocation "with refund" are deliberately not implemented, because
they need owner financial-policy decisions that do not exist yet (section 6). The roadmap file is not edited.

## 1. What it does

- Records a provider dispute (chargeback) on a LEAD_V1 lead-fee payment: `lead_fee_disputes` (one row per provider dispute id).
- **Decision D25 (default, owner may change): suspend access while a dispute is open.** A new purchase status `DISPUTED` means "the fee payment is
  being contested". Contact access is derived from `status = CONFIRMED` on every read, so a `DISPUTED` purchase loses contact access on the very
  next call, through every existing authorization path, with no new flag. The purchase keeps its slot (`DISPUTED` is in the active set that backs the
  partial unique index and the buyer-capacity count), so the lead cannot be bought again by the same professional while the dispute is open.
- Dispute outcome: WON / WARNING_CLOSED returns `DISPUTED` to `CONFIRMED` (original `confirmedAt` kept, not re-stamped) **only when no relevant
  platform-error refund exists** (H1 fix, section 3a); LOST moves the purchase to
  `REVOKED` and writes an append-only `lead_purchase_revocations` row (source `DISPUTE_LOST`). A lost chargeback is **not** `REFUNDED`.
- Administrative revocation without refund (`RevokeLeadPurchaseUseCase`): `CONFIRMED -> REVOKED` with actor, explanation and evidence reference, one
  transaction with the audit entry. Trusted-internal, no caller before the admin console (M157).
- Basic evidence submission (`SubmitLeadFeeDisputeEvidenceUseCase`): text only, admin-initiated, **OFF** unless
  `LEAD_FEE_DISPUTE_EVIDENCE_SUBMISSION_ENABLED` is exactly `true`. Claim persisted and audited before the provider call; deterministic idempotency key.

## 2. State model

Dispute status (forward-only, terminal absorbing, mirrored by a DB trigger): `NEEDS_RESPONSE -> UNDER_REVIEW -> WON | LOST | WARNING_CLOSED` (and
`NEEDS_RESPONSE ->` any final). Provider mapping: `needs_response`/`warning_needs_response` -> NEEDS_RESPONSE; `under_review`/`warning_under_review` ->
UNDER_REVIEW; on `charge.dispute.closed` only `won`/`lost`/`warning_closed`. Anything else (including a final status on an open event) is **rejected
without any state change** (fail closed).

Purchase transitions added: `CONFIRMED -> DISPUTED`, `DISPUTED -> CONFIRMED | REFUNDED | REVOKED`. A pure function maps (dispute status(es), purchase
status) to SUSPEND / RESTORE / REVOKE / NONE; priority across several disputes is LOST > open > restore.

## 3. Idempotency, ordering, concurrency

- Webhook claim `(STRIPE_LEAD_FEE_PAYMENTS, event id)` as in M141; a failed run marks the claim FAILED so the provider redelivery re-processes.
- The dispute is found by the write-once `paymentReference` only (never metadata). The dispute id is unique; re-association to another
  purchase/payment/charge is rejected (`ASSOCIATION_CONFLICT`), also enforced by a trigger.
- Lock order: purchase row `FOR UPDATE`, then dispute. All writes are status-conditional `updateMany` that must hit exactly one row.
- The effect depends only on current states, so duplicates, stale and out-of-order events converge. No ordering guarantee from the provider is assumed.
- A dispute that arrives **before** the payment is confirmed is stored; the M141 webhook calls a reconcile hook right after confirming, so the purchase
  becomes `DISPUTED` immediately (optional 8th constructor argument, additive).
- Dispute record, purchase change, revocation row and audit entries are one transaction; a failing audit insert rolls everything back.

## 3a. Refund / dispute interaction (H1 fix, third migration)

**Defect fixed.** A successful M153 `PLATFORM_ERROR` refund could coexist with a `DISPUTED` purchase (M153 never locks the purchase row, and its
completion only moves a `CONFIRMED` purchase). When the dispute was later won or warning-closed, M155 restored `CONFIRMED` and contact access despite the
refund.

**"Relevant refund"** = a `lead_fee_refunds` row of the purchase with `reasonCode = PLATFORM_ERROR`. Its status decides what a won / warning-closed
dispute may do:

| Relevant refund | Won / warning-closed result |
| --- | --- |
| none, or only `FAILED` | restore `CONFIRMED` (unchanged behavior) |
| `SUCCEEDED` | converge to `REFUNDED` (`refundedAt` stamped, audit action `LEAD_PURCHASE_REFUND_CONVERGED`); access stays denied |
| `REQUESTED` / `PROVIDER_PENDING` / `UNKNOWN` | stay `DISPUTED`; access stays denied |
| any other / unrecognised status | stay `DISPUTED` (fail safe) |

`DUPLICATE_CHARGE` refunds are not considered. LOST and open disputes are unaffected by refunds (LOST still revokes). Priority stays LOST > open > restore.

**Two layers.** (1) The repository reads the refund statuses with a read-only `SELECT` inside the convergence transaction, under the purchase row
`FOR UPDATE` lock, and decides with a pure function. (2) Migration `20261021000000_add_module_155_refund_dispute_restore_guard` replaces only
`lead_purchases_dispute_guard()`: `DISPUTED -> CONFIRMED` is rejected in the database whenever such a refund is `REQUESTED`, `PROVIDER_PENDING`,
`UNKNOWN` or `SUCCEEDED`, so no application path, replay or manual statement can restore access.

**Concurrency and lock ordering.** M155 keeps its order: purchase row `FOR UPDATE`, then dispute row, then (read-only) refund rows. M153 is unchanged and
takes no purchase lock, but its refund INSERT trigger takes `FOR SHARE` on the purchase row, which conflicts with M155's `FOR UPDATE`: an attempt is
either serialized before the dispute (and then seen by the SELECT / guard) or after it (and rejected because the purchase is no longer `CONFIRMED`).
Refund statuses only move forward (`REQUESTED -> ... -> SUCCEEDED`), so a status read under the lock can only be stale in the safe direction (refund
newer than the read); the DB guard re-checks at the UPDATE. Every code path acquires purchase before dispute and never takes a refund lock first, so no
new lock cycle is introduced. Covered by real-PostgreSQL race tests (closed-won vs refund completion for three refund paths, repeated; dispute opening vs
refund attempt).

**Remaining limitations of this fix.**
- If the dispute is already terminal while the refund is still in flight, the purchase stays `DISPUTED` (access denied) until a later converge: a
  dispute event with a new event id, `reconcilePurchase`, or the M141 confirm hook. No scheduler exists for this; M153's completion does not move a
  `DISPUTED` purchase (M153 was deliberately not changed).
- When the purchase converges to `REFUNDED`, a later M153 re-run may stamp `purchaseTransitionedAt` / publish `LeadPurchaseRefunded` through M153's own path.
- A `LOST` dispute with a `SUCCEEDED` refund still ends `REVOKED` (access denied); the money consequence (D12) is unresolved.
- Rollback of this fix: re-run migration 2's version of `lead_purchases_dispute_guard()` (plus reverting the code).

## 4. Access paths reviewed

All contact reads go through `PrismaLeadContactAuthorizationReader` (grant only for `CONFIRMED` of the caller's own purchase) / `GetLeadContactUseCase`.
The professional's "blocked" signal also treats a latest `DISPUTED` purchase as blocked. The M134 feed and previews never carry contact data and are
unchanged; no endpoint, DTO or legacy path reads contact from a purchase status. `DISPUTED` is unknown to checkout-view and falls back to "unavailable".

## 5. Financial and audit invariants preserved

No refund, credit note, invoice, revenue-ledger entry, payment, commission or payout is created, updated or implied by this module (static test plus
row-count assertions on real PostgreSQL). M153 is unchanged (its insert trigger still requires a `CONFIRMED` purchase, so a `DISPUTED` purchase cannot
be refunded). M154 is untouched and `CLAIM_APPROVED` is not integrated. Audit goes through the append-only `AuditLog`; free text (revocation
explanation, evidence text) is stored in the dedicated rows and never copied into audit metadata. Money is compared in integer minor units against the
immutable M135/M136 snapshot total; a partial dispute is accepted, an amount above the payment is rejected.

## 6. Roadmap deviations / not done (owner decisions needed)

1. **Financial consequence of a lost chargeback** (refund/credit note/ledger reversal, who bears the fee): no existing policy; not guessed (D12).
2. **Revocation "with refund"**: M153's closed reason list has no revocation reason and a refunded purchase ends `REFUNDED`, not `REVOKED`. Blocked.
3. **M152 reconciliation** is not extended to understand disputes.
4. Dispute events must be subscribed on the **platform** Stripe endpoint (operational prerequisite; nothing in production was changed).
5. Provider semantics for evidence (`evidence_details` fields, one submission, statuses such as `charge_refunded`/`prevented`) are unverified against a
   test-mode rehearsal; every unrecognised answer fails closed.
6. No durable outbox and no domain events are published for dispute transitions.
7. The generic `TransitionLeadPurchaseUseCase` now permits `DISPUTED -> REFUNDED | REVOKED` (needed for the state machine; no caller uses it that way).
8. If an M153 refund completes while a dispute opens, the purchase can end `REFUNDED` with an open dispute; access is denied in both states. A dispute
   closed in our favour no longer restores access over a succeeded / in-flight platform-error refund (section 3a). D12 (financial consequence of a
   chargeback) and the M152 reconciliation policy remain **unresolved blockers**.

## 7. Persistence

Three migrations (PostgreSQL cannot use a new enum value in the transaction that adds it; the third is the additive H1 guard replacement of section 3a):
`20261019000000_add_module_155_lead_purchase_disputed_status` (only `ALTER TYPE ... ADD VALUE 'DISPUTED'`) and
`20261020000000_add_module_155_lead_fee_disputes` (index swap to include `DISPUTED`, three enums, `lead_fee_disputes`, `lead_purchase_revocations`,
triggers, CHECKs) and `20261021000000_add_module_155_refund_dispute_restore_guard` (function replacement only). Nothing existing is dropped, rewritten or backfilled. **Rollback**: before any `DISPUTED` row exists, drop the two tables and
triggers and restore the old index (statements are in the migration headers); the enum value itself cannot be removed from PostgreSQL. After production
`DISPUTED` rows exist, roll forward instead.
