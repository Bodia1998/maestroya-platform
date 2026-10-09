# Module 147 — LEAD_V1 Professional Eligibility Policy

M147 adds one centralized, server-enforced answer to "may this professional **start a new**
LEAD_V1 lead purchase?". It composes two rules that already existed and re-implements neither. It adds
no table, no migration and no schema change, and it changes no pricing, tax, Stripe or webhook
behaviour.

## Purpose and scope

* **In scope:** the eligibility decision, its enforcement in purchase initiation (M126/M135) and — as a
  defensive re-check — in lead-fee payment initiation (M140), typed failure reasons, and display-only
  guidance on the purchase page.
* **Deliberately not changed:** M136 IVA policy, the lead-fee pricing formula, the M141 verified Stripe
  webhook, purchase confirmation (M137), contact unlock (M138), customer request creation, lead
  publication and the lead feed. None of them references the policy.
* **Not inferred:** the policy reads no tax ID, country, address or entity type. It infers no VAT
  exemption, tax treatment or legal eligibility from the billing identity.

## The two existing rules it composes

| Rule | Authority in code | What counts |
|---|---|---|
| M98 identity / business verification | `isProfessionalEligibleToPurchaseLeads` (`domain/services/lead-purchase.ts`) | `ProfessionalProfile.status === "ACTIVE"` **and** `ProfessionalProfile.verificationStatus === "VERIFIED"`. The existence of a profile or a populated `taxId` / `businessName` is not verification. |
| M146 billing readiness | `GetProfessionalBillingReadinessUseCase` (`billingReady`) | An administrator verified exactly the stored, complete billing details. |

The M98 half is delegated to the existing predicate (no second status rule). The billing half is read
through the M146 use case; completeness and verification are not recomputed. Only four readiness
flags (`state`, `isComplete`, `isVerified`, `billingReady`) are copied out of the result; the
`snapshot` (tax ID, address) never leaves the policy service.

## Code map

| Piece | File |
|---|---|
| Pure decision, reason codes, `LeadPurchaseNotEligibleError` | `src/core/domain/services/lead-purchase-eligibility.ts` |
| Application service (reads M146 readiness) | `src/core/application/services/lead-purchase-eligibility-policy.ts` |
| Composition root (only place that wires M146 readiness into the policy) | `src/core/application/use-cases/lead-purchase-eligibility/compose.ts` |
| Read-only guidance use case (session user only) | `src/core/application/use-cases/lead-purchase-eligibility/get-my-lead-purchase-eligibility.use-case.ts` |
| Guidance Server Action (no parameters) | `src/app/(dashboard)/dashboard/professional/leads/[leadId]/purchase/eligibility-actions.ts` |

The policy is injected as a required last constructor argument of `InitiateLeadPurchaseUseCase`
(7th) and `InitiateLeadFeePaymentUseCase` (5th). There is no default and no optional bypass; the
production composition roots (`lead-purchase/compose.ts`, `lead-fee-payment/compose.ts`) both obtain it
from `makeLeadPurchaseEligibilityPolicy()`.

## Decision table

Evaluated in this order; the first failing row decides. Billing is **only read once M98 passes**.

| # | Condition | Reason | Purchase initiation throws | Payment initiation (new provider payment) |
|---|---|---|---|---|
| 1 | No professional profile resolved for the session user | `NO_PROFESSIONAL_PROFILE` | `LeadNotPurchasableError` (generic) | `LeadFeePaymentNotInitiableError("NOT_ELIGIBLE")` |
| 2 | `status !== "ACTIVE"` (INACTIVE, SUSPENDED, unknown) | `PROFESSIONAL_NOT_ACTIVE` | `LeadNotPurchasableError` | `...("NOT_ELIGIBLE")` |
| 3 | ACTIVE but `verificationStatus !== "VERIFIED"` (UNVERIFIED, PENDING, REJECTED, unknown) | `PROFESSIONAL_NOT_VERIFIED` | `ProfessionalNotVerifiedError` | `...("NOT_ELIGIBLE")` |
| 4 | Billing readiness missing (`null`) | `BILLING_NOT_READY` | `LeadPurchaseNotEligibleError` | `...("NOT_ELIGIBLE")` |
| 5 | Billing `state === "MISSING"` (no row) | `BILLING_MISSING` | `LeadPurchaseNotEligibleError` | `...("NOT_ELIGIBLE")` |
| 6 | Billing `state === "PENDING_REVIEW"` (saved, awaiting admin) | `BILLING_PENDING_REVIEW` | `LeadPurchaseNotEligibleError` | `...("NOT_ELIGIBLE")` |
| 7 | Billing `state === "NEEDS_CORRECTION"` (admin-rejected) | `BILLING_NEEDS_CORRECTION` | `LeadPurchaseNotEligibleError` | `...("NOT_ELIGIBLE")` |
| 8 | Billing `state === "VERIFIED"` but not complete | `BILLING_INCOMPLETE` | `LeadPurchaseNotEligibleError` | `...("NOT_ELIGIBLE")` |
| 9 | Any other billing shape (unknown state, or `billingReady` / `isVerified` / `isComplete` not all exactly consistent with `state === "VERIFIED"`) | `BILLING_NOT_READY` | `LeadPurchaseNotEligibleError` | `...("NOT_ELIGIBLE")` |
| 10 | M98 passes **and** `billingReady === true`, `state === "VERIFIED"`, `isVerified === true`, `isComplete === true` | eligible | proceeds | proceeds |

Rows 1–3 deliberately keep the errors that purchase initiation threw before M147 (generic
`LeadNotPurchasableError` for no profile / not ACTIVE; `ProfessionalNotVerifiedError` for ACTIVE but
unverified). Only the billing reasons (4–9) are new.

## Where it is enforced, and in what order

### Purchase initiation — `InitiateLeadPurchaseUseCase.execute(userId, leadId)`

1. Input shape check (`userId` non-empty string, `leadId` a UUID) → `LeadNotPurchasableError`.
2. `professionals.findByUserId(userId)` — the profile comes from the **session user**.
3. **Eligibility policy** (this module). Runs **before any lead, request, preview or candidate is read**,
   so an ineligible caller learns nothing about any lead and no `LeadPurchase` row can be created.
4. Existing checks, unchanged: lead exists / LEAD_V1 / PUBLISHED, request open, marketplace-ready (M134),
   visibility and category/radius, not the caller's own request.
5. Existing early idempotent answer (`findActiveByLeadAndProfessional`).
6. Existing atomic create (`purchases.initiate`: lead row lock, duplicate check before buyer capacity,
   snapshot copy, partial unique index as final arbiter). M147 did not touch the repository.

Server Action path: `startLeadPurchaseAction` (session user from `requireAuth`) →
`makeInitiateLeadPurchaseUseCase()` (re-exported by `lead-checkout/compose.ts`) → the use case above.
The only caller of `purchases.initiate` in `src` is this use case.

### Lead-fee payment initiation — `InitiateLeadFeePaymentUseCase.execute(userId, purchaseId)`

1. Input shape check → `NOT_ELIGIBLE`/`INPUT` denial.
2. **M98 half only**, on every call, in the same position and with the same reason as before M147:
   no profile, or not ACTIVE + VERIFIED → `LeadFeePaymentNotInitiableError("NOT_ELIGIBLE")`.
3. Purchase lookup and ownership (`NOT_FOUND`), LEAD_V1 check (`LEGACY`).
4. Purchase status + snapshot validation (`leadFeePaymentTermsFromPurchase`): any status other than
   `PENDING_PAYMENT` → `STATUS`; incomplete snapshot → `LEGACY` / `SNAPSHOT_INVALID`.
5. **Existing provider attempt** (`purchase.paymentReference` set) → the attempt is re-read from the
   provider and reused (same client secret). **No billing check on this path.**
6. **Full eligibility policy** (M98 + billing) — evaluated only when there is no persisted attempt, i.e.
   immediately before a **new** provider payment would be created.
7. Provider `createPayment`, then write-once `recordPaymentReference` (unchanged).

A billing denial here is the same generic `LeadFeePaymentNotInitiableError("NOT_ELIGIBLE")` as any
other "you may not pay this" outcome. The specific reason is only logged
(`lead_fee_payment.denied` with `reason: "NOT_ELIGIBLE"` and the closed `eligibilityReason` code).

### Behaviour by purchase state

| Situation | Purchase initiation | Payment initiation |
|---|---|---|
| No purchase yet, eligible | creates `PENDING_PAYMENT` exactly as before | n/a |
| No purchase yet, billing not ready | `LeadPurchaseNotEligibleError`; nothing created | n/a |
| `PENDING_PAYMENT`, no provider attempt, eligible | idempotent replay of the same purchase | creates the attempt |
| `PENDING_PAYMENT`, no provider attempt, billing became not ready | **denied** (policy runs before the replay) | **denied** (`NOT_ELIGIBLE`), nothing sent to the provider |
| `PENDING_PAYMENT`, provider attempt already persisted, billing became not ready | **denied** (it is still an "initiate") | **reused** — same client secret, no new provider payment |
| `CONFIRMED` | `DuplicateActiveLeadPurchaseError` for an eligible caller (unchanged) | rejected as `STATUS` before any billing check |
| `FAILED` / `CANCELLED` | a new attempt after a terminal row is a new purchase and needs eligibility | rejected as `STATUS` |

The reuse rule matches the M146 statement that a payment legitimately initiated before a billing
change is confirmed exactly as before. The M141 webhook never evaluates eligibility, so a payment
already in flight is confirmed regardless of later billing changes.

## Fail-closed behaviour

* Unknown / unsupported `status` or `verificationStatus` never grants eligibility (the M98 predicate is
  an exact `"ACTIVE"` / `"VERIFIED"` comparison).
* A `null` readiness result, an unknown billing `state`, or contradictory flags are ineligible
  (`BILLING_NOT_READY` / `BILLING_INCOMPLETE`).
* If the readiness read **throws**, the error propagates; it is never converted into eligibility, and no
  purchase or provider payment is created.
* Decisions are frozen objects.

## User-facing errors and guidance

* `LeadPurchaseNotEligibleError`: `code = "LEAD_PURCHASE_NOT_ELIGIBLE"`, static message
  "Complete your billing details before purchasing leads.", plus `reason` (closed code about the
  caller's own state). It carries no tax ID, address, rejection reason or admin note. It is registered in
  `LOCALIZED_ERROR_CODES` with an `errors.byCode.LEAD_PURCHASE_NOT_ELIGIBLE` sentence in all 12 locales.
* The purchase page shows an alert with the localized reason and a link
  (`professional.leadCheckout.eligibility.*`, all 12 locales): profile → `/dashboard/professional`;
  not active / not verified → `/dashboard/professional/verification`; billing reasons →
  `/dashboard/professional/billing`. An unknown reason falls back to the generic billing guidance.
* The guidance Server Action takes **no parameters** and returns only `{ eligible, reason }`.

## Security boundaries

* **The enforcement boundary is the application use cases**, not the UI. Both are reached only through
  Server Actions that take the identity from the session (`requireAuth`); the client supplies a lead id
  or purchase id, never a user, professional, billing or verification value.
* **Why disabling the buttons is not the mechanism:** `blocked` in `purchase-checkout.tsx` only disables
  buttons for convenience, from a value read at render time that can be stale. A crafted Server Action
  call, a stale tab or a replay bypasses the page entirely, and still hits the policy inside
  `InitiateLeadPurchaseUseCase` / `InitiateLeadFeePaymentUseCase`. If the guidance read fails, the page
  shows no banner and the server still enforces.
* The billing lookup key is the `id` of the profile resolved from the session user; one professional
  cannot borrow another's verified billing.
* Billing details are never placed in DTOs, errors, logs or the UI. The M146 boundary test pins that
  confirmation, the webhook, contact unlock, `lead-purchase.ts` and the tax policy do not mention the
  billing identity; an M147 boundary test pins where the policy is and is not referenced.

## Known limitations

* **Not atomic with billing updates.** The decision is a point-in-time read. The purchase transaction
  locks the lead row, not the billing row, so billing can change between the check and the insert. This
  is narrowed (not eliminated) by the payment-initiation re-check before any new provider payment. A
  purchase created in that window is `PENDING_PAYMENT` only; it grants no contact access and nothing is
  charged until a payment attempt passes the re-check.
* **Integration tests need local verification.** `tests/integration-db/lead-purchase/lead-purchase-eligibility-m147.test.ts`
  exercises the real policy over the real billing tables and Prisma repositories, and two existing
  integration files (M139, M140) were edited only for the new constructor argument. At the time of writing
  these real-PostgreSQL tests had **not** been executed (the authoring environment had no PostgreSQL or
  Linux Prisma engine). Run them locally:
  `npm run test:integration:db -- tests/integration-db/lead-purchase tests/integration-db/billing-identity`.
* The M139/M140 integration tests use the real policy over a fake "billing ready" reader; only the M147
  integration test uses the real billing tables.
* Billing syntax validation and "VERIFIED" semantics are M146's (administrator review, no registry/VIES
  check); M147 inherits those limits.

## Operational dependency and open decisions

* **Admin verification is a prerequisite.** A professional can only become `billingReady` after an
  administrator verifies their billing identity (`VerifyBillingIdentityUseCase`, reached only through the
  admin billing-identities actions). M146 documents that no admin review UI exists yet (planned M157).
  Existing professionals have no billing row (`MISSING`) and nothing is backfilled, so once this module is
  deployed, **no professional can start a new lead purchase until an administrator has verified their
  billing identity**.
* Any material billing edit resets the identity to `UNVERIFIED` (M146), which makes the professional
  ineligible again until re-review.

Open product / legal decisions:

1. Should a professional with an open `PENDING_PAYMENT` purchase be able to call purchase initiation
   again while billing is unverified? Today they are denied, while payment initiation still reuses an
   already-persisted provider attempt.
2. Is it acceptable to block all new purchases until admin verification tooling exists, or should
   rollout wait for it (or be gated per professional)?
3. Legal eligibility (D14) and invoice content (D16) remain open; M147 makes no legal claim and infers
   nothing from the billing identity.
4. The 11 non-English guidance translations were not reviewed by native speakers (the Romanian copy uses
   a more formal register than the surrounding checkout strings).

## Tests

| Layer | Files |
|---|---|
| Pure policy + service | `tests/unit/core/domain/services/lead-purchase-eligibility.test.ts` |
| Purchase enforcement | `tests/unit/core/application/use-cases/lead-purchase/lead-purchase-eligibility-m147.test.ts` |
| Payment re-check | M147 block in `tests/unit/core/application/use-cases/lead-fee-payment/initiate-lead-fee-payment-m140.test.ts` |
| Static boundary | `tests/unit/prisma/lead-purchase-eligibility-boundary-m147.test.ts` |
| i18n | `tests/unit/i18n/lead-purchase-eligibility-i18n-m147.test.ts` |
| Real PostgreSQL (run locally) | `tests/integration-db/lead-purchase/lead-purchase-eligibility-m147.test.ts` |

Existing tests changed narrowly: constructor call sites (new collaborator), two `constructor.length`
pins (6 → 7), and `professional-billing-identity-boundary-m146.test.ts` (one owner file added; the
"introduces NO gate" assertion rewritten, while confirmation, webhook, contact and tax files are still
asserted billing-free).
