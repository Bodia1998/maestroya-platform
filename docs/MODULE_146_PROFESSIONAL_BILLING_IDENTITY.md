# Module 146 — Professional Billing Identity

Foundation for M147 (eligibility policy), M150 (lead-fee invoice), M151 (credit notes) and M152
(reconciliation). **No invoice, credit note, tax calculation, purchase gate or payment change is part of
this module.**

## Concepts kept separate

| Concept | Where it lives | Relation to billing identity |
|---|---|---|
| Account identity | `User` | none |
| Professional identity / business verification (M17, M59, M98) | `ProfessionalProfile.verificationStatus`, `ProfessionalVerification` | **independent**. Neither implies the other. |
| **Billing identity (M146)** | `ProfessionalBillingIdentity` | this module |
| Payment-provider identity | Stripe customer / PaymentIntent (M140/M141) | not evidence of legal identity |
| Payout identity | `ProfessionalPayoutAccount` | unrelated |

`ProfessionalProfile.taxId` / `businessName` are self-entered, unreviewed, globally unique profile fields.
They are **not** used, copied or backfilled: existing professionals start with *no* billing identity.

## Contract

One row per `ProfessionalProfile` (`professional_billing_identities`):
`entityType` (INDIVIDUAL | COMPANY), `legalName`, `taxId` (normalised), `taxCountry` (ISO alpha-2),
`addressLine1/2`, `city`, `region`, `postalCode`, `country` (ISO alpha-2) — every field is *material* —
plus `verificationStatus`, `revision`, `verifiedAt`, `reviewedAt`, `reviewedByUserId`, `rejectionReason`
(closed enum, shown to the professional) and `reviewNote` (admin-only, never in any professional DTO).
No billing e-mail was added (no invoicing requirement justifies it yet; the account/profile contact e-mail
already exists). `taxId` is intentionally **not** unique, so one professional cannot probe whether another
holds an identifier. Nothing is Spain-specific: country is data, not an assumption.

## Lifecycle

```
(no row = MISSING) --save--> UNVERIFIED  (shown as "awaiting review")
UNVERIFIED --admin verify--> VERIFIED
UNVERIFIED | VERIFIED --admin reject--> REJECTED  (shown as "correction needed")
any status --professional changes ANY detail--> UNVERIFIED   (revision + 1, review metadata cleared)
identical re-save --> no change (status preserved)
```

Reuses the existing `VerificationStatus` enum (`PENDING` is unused and blocked by a CHECK). "Incomplete" is
unrepresentable: the form only stores complete details, so *missing* is the only incomplete state.

## Verification authority

There is no verification provider or registry (VIES etc.) in the application, and none was invented.
`VERIFIED` means **a MaestroYa administrator reviewed exactly these details at this revision** — not that a
tax authority confirmed them.

* Only `VerifyBillingIdentityUseCase` / `RejectBillingIdentityUseCase` can set a decision. They are reached
  only through `admin/billing-identities/actions.ts`, whose first statement is
  `requireRole(ADMIN, SUPER_ADMIN)` (same pattern as the M17 verification actions). Decisions take an
  `expectedRevision`; a stale review (the professional edited meanwhile) or an already-reviewed row is a
  `ConflictError` and changes nothing.
* The professional flow (`saveBillingIdentityAction` → `SaveMyBillingIdentityUseCase` →
  `ProfessionalBillingIdentityRepository.saveDetails`) has **no status parameter at all**. The DTO schema
  strips unknown keys (status, timestamps, ids, revision), the target profile is resolved from the session
  user, and no client-supplied profile/identity id exists.
* Database backstops (migration): rows can only be INSERTed `UNVERIFIED`; a BEFORE UPDATE trigger resets
  status/metadata and bumps `revision` whenever any material column changes (even via raw SQL, even if the
  same statement also writes VERIFIED); `revision` and ownership cannot change otherwise; CHECK constraints
  bind VERIFIED to `verifiedAt`/`reviewedAt`, REJECTED to a reason, and enforce canonical shapes.

## Validation (honest scope)

Syntax and completeness only: tax id normalised (uppercase, spaces/dots/hyphens/slashes removed, country
prefix neither added nor stripped) and checked as 4–20 letters/digits; countries as two-letter codes; postal
code as 2–20 safe characters. **No per-country checksum and no registry/VIES lookup exist**; a
syntactically plausible but invalid number is accepted until an administrator rejects it. Tax treatment is
never inferred from the country; M136 (21% pilot) is untouched.

## Eligibility and purchase flow (M147 integration point)

M146 changes **no** gate. `isProfessionalEligibleToPurchaseLeads`, lead-purchase initiation, lead-fee
payment initiation (M140), payment confirmation (M141) and contact unlock (M138) do not reference the billing
identity (pinned by `professional-billing-identity-boundary-m146.test.ts`). A payment legitimately initiated
before a billing change is confirmed exactly as before.

For M147: call `GetProfessionalBillingReadinessUseCase.execute(professionalProfileId)` (trusted-internal; the
id must come from a session or a persisted purchase, never the client). Its `billingReady` is
"VERIFIED and still complete"; `state` is MISSING | PENDING_REVIEW | VERIFIED | NEEDS_CORRECTION. For M150 the
same result carries a frozen `snapshot` (details + `revision` + `verifiedAt`) that is non-null only when
`billingReady`. Attaching the snapshot to a purchase/invoice is deliberately left to M150 (it would touch the
write-once purchase trigger and payment confirmation, which M146 must not change).

## Privacy

Professional DTOs contain details + state + closed rejection reason + `verifiedAt` only. No billing field
appears in the M134 feed, M124 preview, M138 contact DTO, M145 notification templates or M140/M141 DTOs.
Audit entries (`BILLING_IDENTITY_SUBMITTED/VERIFIED/REJECTED`) carry ids, revision and reason code only —
never a tax id, name, address or note. Admin review queue rows mask the tax id.

## Operational gaps / known limitations

* **No admin review UI.** The review boundary exists (actions + `ListBillingIdentitiesPendingReviewUseCase`,
  `GetBillingIdentityForAdminReviewUseCase`) but until a console exists (M157) an admin cannot yet verify
  through the UI. Until then no professional can become `billingReady`; this is harmless today because
  nothing consumes the flag.
* No change history table (rows hold the current revision only; audit entries record each submission and
  decision). Invoice-grade history is M150's snapshot.
* No billing contact e-mail, no multi-entity (one company, several users) modelling — purchases belong to
  `ProfessionalProfile`.
* GDPR: the row cascades with the professional profile; invoice-retention interplay is M158.
* Legal content of invoices (D16) and eligibility (D14) remain open business/legal decisions.
