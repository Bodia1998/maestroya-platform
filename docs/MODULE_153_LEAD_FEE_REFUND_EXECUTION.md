# Module 153 — Lead-Fee Refund Execution

Status: implemented behind two switches that are **OFF by default**. **Real-money refunds are not activated** and must not be until
every activation blocker below is closed. Nothing in the application calls this module.

## 1. What it does

`ExecuteLeadFeeRefundUseCase` (trusted-internal; composition root `makeExecuteLeadFeeRefundUseCase`, imported by nothing) refunds
**100 % of what a professional actually paid MaestroYa** for a CONFIRMED lead purchase, for exactly two reasons:

| Reason | Meaning | Refunded payment | Purchase afterwards |
|---|---|---|---|
| `PLATFORM_ERROR` | A verified MaestroYa-side defect prevented or made unusable the paid access. Excludes lead quality, customer/professional disagreement, the professional's own device/account problems and unverified allegations. | the purchase's own payment | CONFIRMED -> **REFUNDED** only after the provider confirmed the refund **and** the local transition succeeded; access is then denied (existing rules). |
| `DUPLICATE_CHARGE` | The professional was charged a second, extra time for the same purchase. | the **extra** payment (admin supplies its provider id) | stays **CONFIRMED** (access, capacity and repurchase rules unchanged). No `LeadPurchaseRefunded` event. |

`CLAIM_APPROVED` (M154) and `UNFULFILLABLE_PAYMENT` (M141) are rejected and are not in the migration. A CONFIRMED purchase whose
charged amount or currency differs from its snapshot fails closed (an "incorrect charge" is not a refund reason).

## 2. Safety properties (each is pinned by a test)

* **Amount.** Never computed from job value or the current lead price: it is the persisted purchase snapshot total, and the provider-confirmed
  charge (amount, amount received, currency EUR) must equal it exactly. No fee deduction. No provider fee is stored, read or requested.
* **Switches.** `LEAD_FEE_REFUND_REAL_REFUNDS_ENABLED` (master) and `LEAD_FEE_REFUND_AUTOMATIC_TECHNICAL_ENABLED` (needs master). Unset/empty/`false` = OFF;
  exactly `true` = ON; any other value, or automatic ON without master ON, = invalid and **blocks**. Read from the environment on every call.
  M153 contains no automatic trigger; `isAutomaticTechnicalRefundAllowed` is the only enforcement a future trigger must consult.
* **Actor.** Re-read through the existing `AdminRepository.getUserById` on every call: must exist, be `ACTIVE`, and hold `ADMIN` or `SUPER_ADMIN`
  (a local constant pinned by a drift test to the RBAC values). Repository failure rejects. No second approver.
* **Mandatory inputs.** Explanation (1-1000 characters after trim, stored verbatim, never truncated; obvious e-mail/phone/URL rejected —
  a heuristic, **not** a guarantee that no personal data is present) and a separate incident/evidence reference.
* **Provider verification before any refund.** Payment succeeded, undisputed, no refund of any origin (charge `amount_refunded`/`refunded` **and** the provider
  refund listing, so dashboard/external refunds are seen at execution time), created for this purchase (metadata), amount/currency = snapshot.
  If any of this cannot be established, the run fails closed. A partially refunded payment is never eligible for another full refund.
* **One active attempt per payment.** Partial unique index over `refundedPaymentReference` for `REQUESTED/PROVIDER_PENDING/UNKNOWN/SUCCEEDED`,
  plus unique `(payment, attemptNumber)`, `idempotencyKey` and `providerRefundId`. A SUCCEEDED refund is never refunded again.
* **UNKNOWN is never replayed.** A timeout/network/5xx/unrecognised outcome is stored as `UNKNOWN`. A re-run only **lists the provider's refunds for the payment and
  matches our refund-record id** (written to the refund's metadata). No match = it stays unresolved (never inferred as failed). The request/idempotency key is
  never re-sent while an attempt is unresolved. Only definitive provider rejections (`INVALID_REQUEST`, `AUTHENTICATION`, `NOT_FOUND`) or a provider-reported
  `failed/canceled` refund mark an attempt `FAILED`.
* **Controlled retry.** Only an explicit admin re-run after a `FAILED` attempt: new attempt number, new idempotency key, every check re-run, history kept.
* **Pending refunds** leave the purchase and access unchanged until the provider reports success (re-run to reconcile).
* **Event.** `LeadPurchaseRefunded` (purchase id only) is published best-effort **after** the commit and only for a provider-confirmed `PLATFORM_ERROR` refund whose purchase
  transition succeeded. A publish failure never reverses the refund. There is **no durable outbox and no guaranteed delivery**; no subscriber or notification exists.
* **Isolation.** No ledger, invoice or credit-note row is read or written; no automatic credit note; the legacy `Refund` model and legacy payment code are not used.

## 3. Persistence

`lead_fee_refunds` (migration `20261016000000_add_module_153_lead_fee_refunds`, additive, hand-authored): one row per attempt. DB triggers make money, identity,
actor, explanation and evidence immutable; status forward-only (`REQUESTED -> PROVIDER_PENDING|UNKNOWN|SUCCEEDED|FAILED`, `PROVIDER_PENDING -> SUCCEEDED|FAILED`,
`UNKNOWN -> PROVIDER_PENDING|SUCCEEDED|FAILED`); provider id / failure category / transition stamp write-once; rows are never deleted; the insert is cross-checked against the
CONFIRMED purchase (payment reference, total, currency). Rollback notes are in the migration header.

## 4. Port and adapter

The existing `LeadFeePaymentGateway` gained the minimum capabilities: `retrievePaymentFacts`, `listRefunds`, `createRefund` (Stripe adapter: `refunds.create`,
`refunds.list`, `paymentIntents.retrieve(..., {expand:["latest_charge"]})`). The M140 boundary test was narrowed **only** for `refunds.` (now `refunds.create`/`refunds.list` are allowed,
any other `refunds.*` still fails); Connect/transfer/capture/payout prohibitions and the legacy-refund prohibition are unchanged. M141 scope is unchanged.

## 5. Roadmap deviations (approved; the roadmap itself is not edited)

| # | Roadmap | M153 as built |
|---|---|---|
| 1 | Purpose: "ledger reversal, credit note" | Neither. Separate refund record. |
| 2 | Purpose: "purchase CONFIRMED->REFUNDED" | Only for `PLATFORM_ERROR`. `DUPLICATE_CHARGE` leaves the purchase CONFIRMED. |
| 3 | "Explicit reason and actor (admin/system)" | Closed reason codes. Admin actor only, with mandatory explanation, incident reference and role check. No system actor. |
| 4 | D12 default: automatic for unfulfillable and duplicates | Automatic only via the second switch, no trigger; unfulfillable stays in M141. |
| 5 | "Publishes `LeadPurchaseRefunded` (consumed by ledger, credit note, notifications, later affiliate)" | Best-effort, ids only, no consumers, only for `PLATFORM_ERROR`. |
| 6 | "Contact access removed immediately" | Removed on provider-confirmed success. |
| 7 | "Port extension" (M141 lists it too) | Introduced here as the minimum capability plus an additive read-model extension. M141 behaviour/scope unchanged. |
| 8 | "Files affected": port, purchase repository, subscribers | Adds a refund-record table and migration. No subscribers. |
| 9 | Acceptance: "ledger and credit note consistent" | Replaced by: ledger, invoice and credit notes unchanged and the refund record consistent. |
| 10 | Acceptance: "access denied afterwards" | `PLATFORM_ERROR` only. |
| 11 | Acceptance: "refunded purchase not re-purchasable per D13" | Enforcement is M137's; M153 cannot prove it alone. |
| 12 | Acceptance: "double invocation -> one Stripe refund" | Kept, strengthened to cover UNKNOWN and existing external refunds. |
| 13 | Exit: "reconciliation clean after refunds" | Cannot be claimed: M152 reads no provider data and does not see refunds. |
| 14 | Tests: "end-to-end subscriber chain" | Removed. Failure injection and real-PostgreSQL idempotency stay. |
| 15 | Dependencies: M141, M149, M151, D12, D13 | M149 and M151 become soft. M135, M137 and M157 are added. |
| 16 | Lifecycle: capacity counts PENDING+CONFIRMED(+DISPUTED) | Contradicts the capacity policy; the change belongs to M137, not M153. |
| 17 | M141 "technical full refund"; M151 "subscriber / ledger reversal linkage" | Neither is delivered by M153. |
| 18 | M154 "approval produces exactly one refund" | Needs `CLAIM_APPROVED` added by M154. |

Dependencies M153 does not satisfy: M141's unfulfillable-payment refund, M135's EXPIRED, M137's re-buy block / capacity change / close-at-capacity, M157 as the only intended caller,
M152's awareness of refunds.

## 6. Known limitations

* An `UNKNOWN` attempt can stay unresolved indefinitely (no match at the provider). There is no monitoring, alerting, unresolved-refund listing or admin UI; it is found only by re-running.
* A `DUPLICATE_CHARGE` refund requires the purchase to still be CONFIRMED (a purchase already REFUNDED for `PLATFORM_ERROR` rejects with `PURCHASE_NOT_CONFIRMED`).
* External (dashboard) refunds are detected only at execution time.
* The explanation personal-data check is a heuristic.
* No durable event outbox: `LeadPurchaseRefunded` may be lost; it is informational.
* All admin runs (including reconciliation) require the master switch to be ON.

## 7. Activation blockers (not closed by this module)

1. Legal / tax / IVA / accounting treatment of refunds, and whether and how a credit note is issued (M151 is manual and gated; nothing is automatic).
2. **Stripe test-mode rehearsal.** The following are **not verified**: that dashboard-created refunds appear in `refunds.list`, listing consistency/latency after `refunds.create`,
   idempotency-key behaviour on retries/timeouts, the exact refund status semantics (`pending`, `requires_action`, `failed`, `canceled`) and `charge.disputed` timing.
   Until tested, treat them as assumptions; the code fails closed on anything unrecognised.
3. M137 (re-buy block, capacity), M135 (EXPIRED), M141 (unfulfillable payments) and M157 (admin entry point) must land before the module has a caller.
4. Monitoring/alerting for UNKNOWN attempts and unconfirmed purchase transitions.
5. Review of the new switches in every deployment environment (must stay unset/false until activation is approved).
