# MaestroYa — Roadmap to 90+/100 Production Readiness

**Baseline:** 58/100 (Functional MVP), audit at commit `2e3339b`.
**Target:** 90+/100.
**Method:** Read-only repository inspection to determine existing module numbering/conventions, followed by a module-level implementation roadmap. Nothing in the repository was modified in the preparation of this document.

## Baseline module inventory (verified from the repository)

Two parallel numbering trails exist in the repo: `docs/MODULE_NN_*.md` (design docs, up to **Module 65** — Trust & Integrity System) and root-level `MODULE_NN_IMPLEMENTATION_REPORT.md` (build logs, up to **Module 81** — Reconciliation Admin Dashboard, dated 2026-08-29, the newest work in the repo). The highest module number actually implemented is **81**. No planned-but-unbuilt module numbers (82+) exist anywhere in docs or reports. Convention observed: `Module NN — <Concise Production-Oriented Name>`, one feature branch and one PR per module (`feat(module-NN): ...`), each with a root-level implementation report.

**This roadmap therefore starts numbering at Module 82** and assigns no duplicate numbers.

Existing infrastructure this roadmap explicitly reuses rather than replaces (verified present and working in the prior audit): Clean Architecture/DDD layering, the domain event bus (`publish-domain-event.ts` + sync/queued adapters), Prisma/PostgreSQL with `Decimal(10,2)` money columns and idempotency-by-design unique constraints, Stripe Connect (Express accounts, webhooks, payout/refund/reversal machinery), the centralized `CommissionCalculationService`, the Module 79 invoicing/credit-note data model and use cases, the Module 80/81 reconciliation engine and admin dashboard, the Module 65 trust-and-integrity detector suite, the Module 62 onboarding-activation state machine, and the GDPR consent/export use cases. Every module below is scoped as **connect → complete → harden → test**, not a rewrite.

---

## Module Roadmap

### Module 82 — Admin RBAC & Production Auth Hardening

**Objective:** Close the admin privilege-escalation path and remove the conditions that let production security controls silently weaken.

**Problems addressed:** B1 (ADMIN can self-promote to SUPER_ADMIN), H10 (Redis optional in production — rate limiting silently degrades), and the medium finding that a demoted/suspended admin's JWT role claims remain valid until natural token refresh.

**Existing infrastructure to reuse:** `ChangeUserRoleUseCase` and its existing "last active admin" safeguard pattern (`change-user-role.use-case.ts`); the `requireRole` RBAC helper (`src/core/infrastructure/auth/rbac.ts`) already used consistently across ~50 admin actions; the existing `AdminAuditLogRepository.record(...)` pattern already wired into this same use case; the existing Zod-based `env.ts` production validation (already rejects test Stripe keys, requires HTTPS/`AUTH_SECRET` — the same mechanism extends naturally to Redis); the existing `RateLimitRepository`/`InMemoryRateLimitRepository` factory (`rate-limit-repository-factory.ts`).

**Required implementation:**
1. In `ChangeUserRoleUseCase`, require the *caller's own* role to already be `SUPER_ADMIN` whenever the requested role set includes `ADMIN` or `SUPER_ADMIN`; a plain `ADMIN` may continue to manage non-privileged roles only.
2. In `env.ts`, make `REDIS_URL` a hard requirement when `NODE_ENV=production` (fail fast at startup, consistent with the existing pattern for Stripe key validation), removing the silent in-memory fallback in production.
3. Add a role-claim freshness check: either shorten the window before a role change takes effect (force `trigger: "update"` server-side on role change, or reduce reliance on cached JWT claims for admin-only checks by re-verifying role from DB on sensitive admin actions specifically — reuse the pattern already present in `admin/layout.tsx`'s independent re-check).

**Acceptance criteria:**
- An `ADMIN` cannot grant `ADMIN` or `SUPER_ADMIN` to any user, including themselves; only `SUPER_ADMIN` can.
- The "last active admin" protection continues to function unchanged.
- Starting the app with `NODE_ENV=production` and no `REDIS_URL` fails at startup rather than silently falling back.
- A demoted admin's elevated actions are rejected within a bounded, documented window (not indefinitely until natural token expiry).
- All existing admin functionality (the ~50 other admin actions) continues to pass its existing tests unmodified.

**Tests required:** Unit tests for `ChangeUserRoleUseCase` covering ADMIN→grants-ADMIN (rejected), ADMIN→grants-SUPER_ADMIN (rejected), SUPER_ADMIN→grants-ADMIN (allowed), SUPER_ADMIN→grants-SUPER_ADMIN (allowed), self-promotion attempt (rejected), last-admin protection (unchanged). Integration test invoking the Server Action directly (not just the use case) to confirm the guard can't be bypassed at that layer. A startup/config test asserting production env validation rejects a missing `REDIS_URL`.

**Dependencies:** None. This is a self-contained, low-risk fix and should be first.

**Production impact:** Security.

**Estimated complexity:** S.

---

### Module 83 — Professional Verification Enforcement

**Objective:** Make identity/business verification an actual prerequisite for marketplace participation, matching the intended lifecycle: registration → onboarding → verification → admin approval → ACTIVE → visibility → quoting → job participation → payout.

**Problems addressed:** B2 (unverified professionals can appear in search, quote, and complete jobs), H11 (company activation requires an awkward second manual step after verification approval).

**Existing infrastructure to reuse:** The full Module 62 onboarding-activation state machine (`professional-onboarding-rules.ts`, `ONBOARDING_STEP_VALUES`, `isEligibleForActivation`) and Module 59/17 verification case management (`professional-verification-rules.ts`, `ApproveProfessionalVerificationUseCase`, `RejectProfessionalVerificationUseCase`) — both already correct as isolated state machines and require no redesign, only connection. The existing `CheckPayoutEligibilityUseCase` gate on `verificationStatus === APPROVED` is the proof this data already flows correctly to at least one consumer — the same read needs to reach quote creation and discovery. The existing `resolveJobActor`/`resolveCompanyActor` authorization idiom for adding the new check consistently. The existing `CompanyStatus` state machine and `ReactivateCompanyUseCase` for the company-side fix.

**Required implementation:**
1. `CreateQuoteUseCase`: extend the existing `professional.status !== "ACTIVE"` check to also require `verificationStatus === "APPROVED"` (or, if activation should instead flow through `ProfessionalOnboarding.status === ACTIVATED`, wire that status into `ProfessionalProfile.status` transitions instead of adding a second parallel check — pick one canonical source of truth and have the other module write to it, not both).
2. `PrismaProfessionalDiscoveryRepository.findActiveCandidatesByCategory`/`findCandidateById`: add the same verification condition to the `where` clause used for search/discovery visibility.
3. `RejectProfessionalVerificationUseCase`: make rejection actually transition `ProfessionalProfile.status`/`verificationStatus` such that it takes effect on quoting/search immediately, not just as a notification side-effect.
4. Add a real `AdminSuspendProfessionalUseCase` (there is currently no individual-professional suspension path at all; only companies have one) that writes `ProfessionalStatus.SUSPENDED` and is consumed by the same gates above.
5. Company side: wire an event subscriber on verification-approval that automatically transitions `CompanyStatus` from `PENDING`/`SUSPENDED` to `ACTIVE`, removing the dependency on an admin remembering to call the confusingly-named `ReactivateCompanyUseCase` as a second step.

**Acceptance criteria:**
- A professional with `verificationStatus !== APPROVED` does not appear in search/discovery results.
- Such a professional's attempt to submit a quote is rejected with a clear domain error.
- Rejecting a professional's verification immediately removes their ability to quote/appear in search (not just a notification).
- A real admin suspend action exists, is RBAC-gated, audit-logged, and takes effect immediately on the same gates.
- Approving a company's verification automatically activates the company with no second manual step.
- Existing verified-professional flows (the overwhelming majority of current tests, which hardcode `verificationStatus: VERIFIED`) continue to pass unchanged.

**Tests required:** Unit tests for the updated `CreateQuoteUseCase`/discovery repository guard (positive: verified professional succeeds; negative: unverified professional rejected). Integration test explicitly covering the previously-untested gap: an `UNVERIFIED` or `REJECTED` professional attempting to quote and appear in search. Regression test that rejection cascades to search/quote immediately. Test for the new suspend use case (RBAC, audit log, effect on gates). Test for automatic company activation on verification approval.

**Dependencies:** None strictly required first, but should follow Module 82 since both touch authorization-critical code and are cheaper to review together; no technical dependency.

**Production impact:** Business Logic (Trust/Safety), Security.

**Estimated complexity:** M.

---

### Module 84 — Financial Ledger Integrity & Rate Determinism

**Objective:** Make commission and tax calculations atomic, mutually consistent, and reproducible against the rate that applied at the time of the transaction — not the rate that happens to be current when each downstream calculation runs.

**Problems addressed:** H1 (commission ledger writes not atomic), H5 (commission/tax formula disagreement for `CUSTOMER_PURCHASED` materials), H6 (no effective-dated rate snapshot, so `Commission` and `Invoice` can silently diverge if platform rates change mid-flight).

**Existing infrastructure to reuse:** `CommissionCalculationService` (the single, correct, already-centralized commission formula — not touched, only made consistent with its tax counterpart), `RecordCommissionForPaymentUseCase` (gets a transaction wrapper, not a rewrite), the existing reconciliation module's own `INVOICE_COMMISSION_AMOUNT_INCONSISTENT` check (proof the platform already detects this class of bug — this module fixes the root cause the check exists to catch), the existing `Decimal(10,2)` schema fields (rate snapshot fields are additive columns, not a schema redesign), and the existing `CalculateJobCommissionBreakdownUseCase`/`CalculateJobTaxBreakdownUseCase` pair (unified onto one shared materials-inclusion rule rather than replaced).

**Required implementation:**
1. Wrap the Commission `create` + 4 ledger `create()` calls in `RecordCommissionForPaymentUseCase` in a single `prisma.$transaction`.
2. Unify `CalculateJobCommissionBreakdownUseCase` and `CalculateJobTaxBreakdownUseCase` on one shared rule for whether `CUSTOMER_PURCHASED` materials count toward the commission/tax base.
3. Add a rate-snapshot field (commission rate bps, tax rate bps) captured once — at Quote acceptance or payment-capture time — and have both the Commission and Invoice/tax calculation paths read the snapshot rather than re-deriving "current" platform rates independently at their own later points in the lifecycle.

**Acceptance criteria:**
- A crash between the Commission write and any of the 4 ledger writes is no longer possible — the whole set commits or none of it does.
- For a `CUSTOMER_PURCHASED`-materials job, `Commission.amount` and the tax/invoice commission figure are computed from the identical materials-inclusion rule and agree exactly.
- Changing the platform commission or tax rate after a Quote is accepted does not change the commission/tax figures already associated with that job.
- The reconciliation module's `INVOICE_COMMISSION_AMOUNT_INCONSISTENT` check stops firing on new transactions (existing historical discrepancies are a data-backfill/reporting decision, not this module's scope).

**Tests required:** Unit test for transactional rollback on a simulated failure mid-ledger-write. Unit test comparing commission/tax breakdown outputs for a `CUSTOMER_PURCHASED`-materials fixture before/after the fix. Regression test: change the platform rate between quote acceptance and payout, assert the job's commission/tax figures are unaffected. Postgres-backed test (not just an in-memory fake) verifying the transaction actually rolls back under a real DB — this can be built together with Module 87's concurrency-test infrastructure rather than duplicated.

**Dependencies:** None technically, but should follow Modules 82–83 since it's lower urgency than active security/trust gaps; must precede Module 85 (invoicing needs deterministic, snapshotted figures to invoice against) and Module 86 (dispute-driven reversals write ledger entries and should do so atomically).

**Production impact:** Financial, Compliance.

**Estimated complexity:** M.

---

### Module 85 — Invoicing & Credit Note Activation

**Objective:** Turn the fully-built but never-triggered Module 79 invoicing/credit-note system into a real, automatic part of the transaction lifecycle, and close the customer-facing invoicing gap.

**Problems addressed:** B4 (invoicing built but never triggered; no customer-facing invoice type exists), the medium invoice-numbering race/gap risk.

**Existing infrastructure to reuse:** The entire Module 79 data model and use cases (`Invoice`, `InvoiceLineItem`, `CreditNote`, `CreditNoteLineItem`, `CreateProfessionalInvoiceDraftUseCase`, `IssueInvoiceUseCase`, `CreateCreditNoteUseCase`) — none of this needs to be rebuilt, only called from somewhere real. The existing sequential, concurrency-safe document-number allocator (`prisma-document-number-allocator.ts`, atomic `INSERT...ON CONFLICT...RETURNING`) — only the ordering of allocate-vs-issue needs correcting, not the allocator itself. The existing domain event bus and subscriber pattern already used elsewhere (e.g. `RecordCommissionOnPaymentCapturedSubscriber`) as the template for wiring invoice creation to `Job` completion / `PaymentCaptured` events. The existing tamper-evidence hashing (`computeDocumentHash`) on issued invoices.

**Required implementation:**
1. Add an event subscriber that calls `CreateProfessionalInvoiceDraftUseCase` automatically on job completion (or payment capture — pick the point that has the finalized, rate-snapshotted figures from Module 84) instead of leaving it uncalled.
2. Fix the numbering race in `IssueInvoiceUseCase`: only allocate the sequential number inside the same transaction as the compare-and-swap `issue()` write (or roll back the allocation on a lost race) so a lost race never burns a number with no invoice attached.
3. Wire `CreateCreditNoteUseCase` into `ExecuteRefundUseCase` so a refund against an issued invoice automatically produces a corrective credit note instead of leaving the invoice silently stale.
4. Design and add a genuine customer-facing invoice/receipt type (a second `InvoiceType` alongside the existing `PROFESSIONAL_SELF_BILLED`, or an adjacent `CustomerReceipt` entity if the legal shape differs enough to warrant it) so the customer who is actually charged receives a real document, not just the platform's internal self-billing record to the professional.
5. Replace the placeholder `MAESTROYA_ISSUER_TAX_ID = "PENDING-CIF-CONFIRMATION"` with the platform's real registered tax ID before any invoice is issued in a real environment (a configuration/legal action, not a code change per se, but the code should fail loudly rather than issue a legally invalid document if this placeholder is still set).

**Acceptance criteria:**
- Every completed, paid job automatically produces an issued professional (self-billed) invoice with no manual trigger.
- Every such payment also produces a customer-facing invoice/receipt.
- A refund against an invoiced job automatically produces a matching credit note.
- Invoice numbering cannot gap under a lost concurrent-issue race.
- The system refuses to issue a real invoice while the issuer tax ID is still the placeholder value.

**Tests required:** Integration test asserting an invoice is created automatically on job completion with no manual call. Concurrency test for the numbering-race fix (two concurrent issue attempts, assert no gap). Test that a refund produces a credit note referencing the correct invoice and reversed tax amount. Test that customer invoices are generated and contain the correct rate-snapshotted figures from Module 84.

**Dependencies:** Module 84 (needs deterministic, snapshotted commission/tax figures to invoice against correctly).

**Production impact:** Compliance (Spanish invoicing requirements), Financial.

**Estimated complexity:** L (the customer-invoice-type design work is the largest single piece in this roadmap that isn't pure wiring).

---

### Module 86 — Stripe Chargeback & Dispute Handling

**Objective:** Give the platform automatic visibility and response to real card-network chargebacks, which currently produce zero reaction anywhere in the codebase.

**Problems addressed:** B5 (no `charge.dispute.*` webhook handling exists at all).

**Existing infrastructure to reuse:** The existing Stripe webhook route pattern (`src/app/api/webhooks/stripe-payments/route.ts`, raw-body signature verification already correct), the existing `ExternalWebhookEventRepository` idempotency-claim mechanism (`@@unique([provider, externalEventId])`), and — critically — the already-working `ReverseProfessionalPayoutUseCase`/`StripeTransferGatewayAdapter.reverseTransfer` machinery built for admin-mediated marketplace disputes, which this module reuses for Stripe-side disputes rather than building new reversal logic.

**Required implementation:**
1. Extend `stripe-payment-webhook-verifier.ts`'s handled-event set to include `charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`.
2. Add a `ProcessStripeDisputeWebhookUseCase` that records the dispute against the relevant `Payment`, and — where the connected professional has already been paid out — invokes the existing `ReverseProfessionalPayoutUseCase` the same way a marketplace-dispute resolution does today.
3. Surface open Stripe disputes in the Module 81 reconciliation dashboard (a new discrepancy/alert category, reusing its existing severity-classification pattern) rather than building a separate view.

**Acceptance criteria:**
- A `charge.dispute.created` webhook is received, verified, deduped, and recorded against the correct `Payment` with no manual intervention.
- If the professional has already been paid out for the disputed job, a transfer reversal is automatically attempted via the existing reversal path.
- Dispute state is visible in the reconciliation dashboard.
- Unknown/unhandled dispute sub-events are safely ignored (matching the existing pattern for other webhook types), not treated as errors.

**Tests required:** Unit tests for the new webhook use case covering dispute-created, dispute-closed (won/lost), and funds-withdrawn. Integration test confirming reuse of the existing reversal path produces the same outcome as an admin-resolved dispute reversal. Idempotency test (duplicate dispute webhook delivery).

**Dependencies:** Module 84 (dispute-triggered reversals write ledger entries and should do so atomically, per that module's fix).

**Production impact:** Financial, Compliance.

**Estimated complexity:** M.

---

### Module 87 — Financial & Concurrency Test Hardening

**Objective:** Replace code-review-only confidence in the platform's concurrency-safety and Stripe-integration mechanisms with real, automated proof — and add the one missing category of coverage (full golden-path E2E) entirely.

**Problems addressed:** H2 (no real Stripe test-mode integration testing — SDK fully mocked everywhere), H3 (no real Postgres concurrency testing for race-safety mechanisms that are currently only correct by code review), H9 (no real end-to-end user journey — only two trivial Playwright specs).

**Existing infrastructure to reuse:** The existing docker-compose Postgres test service already used in CI (`prisma migrate deploy`/`migrate status` already run against real Postgres in `.github/workflows/ci.yml` — this module extends what already touches real Postgres in CI, rather than introducing new infrastructure), the existing `playwright.config.ts` (already configured, just not used for anything beyond two trivial specs), and Stripe's own test-mode API (no new adapter needed — the existing `StripePaymentGatewayAdapter`/`StripeTransferGatewayAdapter` are exercised as-is against Stripe's sandbox rather than mocked).

**Required implementation:**
1. Add a small number of true Postgres-backed concurrency tests (not in-memory fakes) that fire concurrent requests at `PrismaQuoteAcceptanceRepository.acceptQuote`, `PrismaExternalWebhookEventRepository.claim`, and `ExecuteProfessionalPayoutUseCase`, asserting exactly one winner under real MVCC.
2. Add a Stripe test-mode integration suite that runs the actual payment-capture → payout → refund → reversal cycle against Stripe's sandbox (using test API keys, gated to run in CI/staging, not against every local `npm test`), verifying the adapters' request/response-shape assumptions against the real API rather than a mock.
3. Add one full E2E Playwright test covering the golden path: customer registration → request → quote → acceptance → payment (Stripe test mode) → webhook-driven capture → job → completion → payout → invoice → review. Add a second E2E test for the payment → payout → refund → transfer-reversal → credit-note path.

**Acceptance criteria:**
- The three identified concurrency mechanisms have passing tests against a real Postgres instance, not fakes.
- The full payment/payout/refund/reversal cycle has passed at least once against real Stripe test mode, and that suite is runnable on demand (CI-gated, not necessarily on every commit given external-network dependency).
- Both golden-path E2E scenarios pass reliably (accounting for reasonable retry/flake tolerance appropriate to E2E suites).

**Tests required:** This module *is* the test work; no separate test-the-tests layer is needed beyond confirming the new suites are wired into CI and don't flake unacceptably.

**Dependencies:** Modules 83, 84, 85, 86 (the E2E golden path exercises verification gating, deterministic commission/tax, automatic invoicing, and — for the second scenario — dispute/reversal handling; testing before those land would test behavior that's about to change).

**Production impact:** Testing, Reliability.

**Estimated complexity:** L.

---

### Module 88 — GDPR Erasure Execution & Document Retention

**Objective:** Turn the existing report-only deletion-planning use case into a real, executable erasure/anonymization path that respects the platform's immutable financial-record requirements, and stop leaking removed identity documents into indefinite storage.

**Problems addressed:** B3 (GDPR erasure is report-only, no execution path exists anywhere), H8 (removed verification documents are deleted from the DB but never from Cloudinary; no retention/purge job exists).

**Existing infrastructure to reuse:** `PrepareAccountDeletionUseCase` (kept as-is — the planning/classification step is correct and becomes the input to the new execution step, not replaced), the existing `onDelete: Restrict` FK design on financial records (the constraint that makes hard-delete unsafe is exactly why this module anonymizes rather than deletes — no schema change needed, the design already protects the right things), the existing consent/export use cases and their audit-logging pattern, and the existing Cloudinary upload service (`verification-document-upload-service.ts`) which already has the credentials/config needed to also call `destroy`.

**Required implementation:**
1. Build an `ExecuteAccountAnonymizationUseCase` that takes `PrepareAccountDeletionUseCase`'s report as input and anonymizes (not hard-deletes) personal-identifying fields on the user's records, while explicitly preserving whatever fields are legally required to remain on financial records (amounts, dates, tax IDs used for filings) per the existing `Restrict` FK design — i.e., financial rows keep existing but their pointers to identifying personal data are severed/nulled/replaced with an anonymized placeholder, following the same category-by-category breakdown `PrepareAccountDeletionUseCase` already produces.
2. Fix `RemoveVerificationDocumentUseCase`/`prisma-professional-verification-repository.ts`'s `removeDocument()` to call Cloudinary's `destroy` API when the DB pointer is removed, not just delete the pointer.
3. Add a scheduled retention/purge job (reusing the existing background-job worker infrastructure with its retry/dead-letter handling) that purges verification documents past a defined retention window even if never explicitly "removed" by the user.
4. Audit-log every anonymization/purge action through the existing `AdminAuditLogRepository` pattern.

**Acceptance criteria:**
- Executing an account-erasure request actually anonymizes the user's personal data (not merely producing a report), verified by inspecting the affected rows post-execution.
- Financial records required for tax/accounting retention remain intact and internally consistent (no orphaned or broken FK references) after anonymization.
- Removing a verification document deletes the actual file from Cloudinary, not just the DB pointer.
- A scheduled job purges documents past the retention window without requiring a user action.
- Every erasure/anonymization/purge action is audit-logged.

**Tests required:** Unit tests for the anonymization use case across each GDPR data category `PrepareAccountDeletionUseCase` already classifies. Integration test confirming financial-record referential integrity survives anonymization of the associated user. Test confirming Cloudinary `destroy` is called on document removal (mockable at the adapter boundary, consistent with existing test patterns for that service). Test for the scheduled purge job's retention-window logic.

**Dependencies:** Module 85 (needs the invoicing/financial-record shape to be settled, since anonymization must specifically preserve invoice data correctly).

**Production impact:** Compliance.

**Estimated complexity:** L (the anonymize-while-preserving-financial-integrity design is the genuinely hard part; the Cloudinary/retention piece is small by comparison).

---

### Module 89 — Fraud & Trust Signal Activation

**Objective:** Connect the already-built, already-unit-tested Module 65 trust-and-integrity detector suite to the real user flows it was designed to protect, instead of leaving 8 of ~10 detectors uncalled.

**Problems addressed:** H4 (fraud/abuse detectors mostly not connected to actual application flows).

**Existing infrastructure to reuse:** The entire Module 65 detector suite as-is (`DetectOffPlatformCommunicationUseCase`, `DetectFraudSignalsUseCase`, `DetectFakeReviewPatternsUseCase`, `DetectSpamActivityUseCase`, `DetectSuspiciousPricingUseCase`, `DetectBookingAbuseUseCase`, `DetectPaymentAbuseUseCase`, `DetectIdentityRiskUseCase`) — none of these need redesign, they need callers. `RecordUserBehaviorSignalUseCase` as the existing entry point. The existing two working examples (`DetectPrematureJobCompletionUseCase`/`DetectJobCompletionDisputeConflictUseCase`, already correctly subscribed in `instrumentation.ts`) as the exact template to replicate for the other 8.

**Required implementation:** Add subscriber wiring (matching the existing `instrumentation.ts` registration pattern) so that:
1. Chat-message send calls `DetectOffPlatformCommunicationUseCase`.
2. Review creation calls `DetectFakeReviewPatternsUseCase`.
3. Quote creation calls `DetectSuspiciousPricingUseCase`.
4. Signup/repeated-registration calls `DetectIdentityRiskUseCase`/`DetectFraudSignalsUseCase`.
5. Booking/appointment actions call `DetectBookingAbuseUseCase`.
6. Payment-related actions call `DetectPaymentAbuseUseCase`.
7. Generic activity call `DetectSpamActivityUseCase` where applicable.

Each wiring point is additive event-subscription, not new detection logic.

**Acceptance criteria:**
- All ~10 detectors have at least one real, production-reachable caller (verified by the same kind of "grep for callers outside compose.ts and tests" check the original audit used to find the gap).
- Triggering a real off-platform-communication pattern, fake-review pattern, etc. in a test environment produces a recorded trust signal without any code changes beyond this module.
- No detector produces false positives severe enough to block legitimate existing test suites (regression-checked).

**Tests required:** Integration test per detector confirming it fires from the real flow (not just its own unit test in isolation). Regression tests confirming existing chat/review/quote/booking/payment flows still succeed for legitimate use.

**Dependencies:** None technically; can proceed in parallel with Modules 83–86.

**Production impact:** Security, Business Logic (Trust & Safety).

**Estimated complexity:** M.

---

### Module 90 — Automated Reconciliation & Operational Alerting

**Objective:** Make the already-correct Module 80/81 reconciliation engine run on its own schedule and make critical financial failures (failed payments, failed payouts, Stripe disputes, reconciliation discrepancies) page a human, instead of only being visible to someone who checks a dashboard.

**Problems addressed:** H7 (reconciliation is manual/admin-triggered only, no schedule), and the operational gap the original audit identified: a failed payment is a normally-handled outcome (not an exception), so it currently doesn't trigger any real-time alert even though Sentry is wired for actual exceptions.

**Existing infrastructure to reuse:** The entire Module 80/81 reconciliation engine and admin dashboard (`StartReconciliationRunUseCase`, the severity-classified discrepancy model, `/admin/reconciliation`) — not touched, only scheduled. The existing `vercel.json` cron mechanism (already used for `expire-workflows` — the same mechanism, a second cron entry). The existing Sentry wiring (`instrumentation.ts`'s `onRequestError` hook) as the delivery mechanism for the new alert triggers, rather than introducing a new alerting channel.

**Required implementation:**
1. Add a scheduled cron entry that runs a reconciliation pass automatically (daily, or more frequently if volume warrants) using the existing `StartReconciliationRunUseCase`.
2. Add explicit alert triggers (via the existing Sentry/logging infrastructure, captured as a deliberate `logger.error`/Sentry-capturable event, not merely a normal-path log line) for: a CRITICAL-severity reconciliation discrepancy, a failed payment webhook outcome, a failed payout, and a new Stripe dispute (from Module 86).
3. Extend the reconciliation dashboard (from Module 86) to surface dispute-related discrepancies alongside the existing Payment/Commission/Tax/Invoicing/Payout/Refund/Credit-Note categories.

**Acceptance criteria:**
- A reconciliation run executes automatically on a schedule with no admin action required.
- A CRITICAL discrepancy, a failed payment, a failed payout, or a new Stripe dispute each produce a real-time alert (Sentry-visible at minimum), not just a dashboard row waiting to be noticed.
- The existing reconciliation dashboard and its data model are otherwise unchanged.

**Tests required:** Test confirming the scheduled job fires and invokes the existing use case correctly. Test confirming each alert trigger condition actually produces a Sentry-capturable event (can be asserted at the logging/capture boundary without needing a live Sentry project in CI).

**Dependencies:** Modules 84, 85, 86 (the reconciliation categories being alerted on depend on those modules' data being correct and complete — alerting on a known-inconsistent figure before Module 84 lands would just generate noise).

**Production impact:** Operations, Reliability, Financial.

**Estimated complexity:** M.

---

## Score Model — Per-Module Impact

Scoring is conservative and capped at each category's maximum; a module is credited only for the categories its acceptance criteria actually change.

| Module | Category(ies) affected | Before → After (this module's increment) |
|---|---|---|
| 82 — Admin RBAC & Auth Hardening | Security | 9 → 13 (+4) |
| 83 — Professional Verification Enforcement | Business Logic | 6 → 12 (+6) |
| 84 — Financial Ledger Integrity & Rate Determinism | Business Logic, Payments & Stripe, DB & Integrity | 12→14 (+2), 13→15 (+2), 8→9 (+1) |
| 85 — Invoicing & Credit Note Activation | Business Logic, Payments & Stripe | 14→15 (+1, category cap), 15→16 (+1) |
| 86 — Stripe Chargeback & Dispute Handling | Payments & Stripe | 16 → 18 (+2) |
| 87 — Financial & Concurrency Test Hardening | Testing, DB & Integrity, Payments & Stripe | 4→8 (+4), 9→10 (+1, cap), 18→19 (+1) |
| 88 — GDPR Erasure Execution & Document Retention | GDPR | 2 → 4 (+2) |
| 89 — Fraud & Trust Signal Activation | Security, Observability & Operations | 13→14 (+1), 3→4 (+1) |
| 90 — Automated Reconciliation & Operational Alerting | Observability & Operations, Payments & Stripe | 4→5 (+1, cap), 19→20 (+1, cap) |

**Categories deliberately left unaddressed by this roadmap (explained in §"Explicitly Do Not Build Yet"):** Architecture stays at 12/15 (the one minor Prisma-in-application leak and the dead mass-assignment pattern are cosmetic, not scored as blocking); Scalability stays at 3/5 (in-memory geo-search is a real future bottleneck but not required to cross 90 at current or near-term user counts).

---

## Score Projection

| Stage | Modules completed | Estimated Score |
|---|---|---|
| Current | — (existing implementation) | 58 |
| Stage 1 | 82, 83 | 68–71 |
| Stage 2 | + 84, 85, 86 | 77–80 |
| Stage 3 | + 87, 88 | 85–88 |
| Final | + 89, 90 | **90–92** |

Ranges reflect that some acceptance criteria (particularly the E2E and Stripe-sandbox suites in Module 87, and the anonymization-while-preserving-financial-integrity design in Module 88) have execution risk that could land slightly better or worse than the point-table above depending on implementation quality — the table is a conservative planning estimate, not a guarantee.

---

## Module Dependency Graph

```
Module 82 (Admin RBAC & Auth Hardening)
   │
   ├──────────────────────────────┐
   ▼                               ▼
Module 83                     Module 89
(Verification Enforcement)    (Fraud Signal Activation)
   │                               │
   ▼                               │
Module 84                          │
(Financial Ledger Integrity        │
 & Rate Determinism)               │
   │                               │
   ├────────────┐                  │
   ▼            ▼                  │
Module 85    Module 86             │
(Invoicing)  (Stripe Disputes)     │
   │            │                  │
   ├────────────┤                  │
   ▼            ▼                  │
Module 88   Module 90 ◄────────────┘
(GDPR Erasure) (Reconciliation
   │            & Alerting)
   │            │
   └─────┬──────┘
         ▼
   Module 87
   (Financial & Concurrency
    Test Hardening — final
    validation gate)
         │
         ▼
     90+/100
```

Module 89 (fraud signal activation) has no real dependency on the financial cluster and can proceed on a parallel track alongside Modules 83–86 — it is placed last in the linear development order below only for team-bandwidth sequencing, not because anything blocks it.

---

## Recommended Development Order

```
Module 82 — Admin RBAC & Auth Hardening
    ↓  (closes the one active security blocker first; cheapest, highest-urgency fix)
Module 83 — Professional Verification Enforcement
    ↓  (closes the core trust/safety blocker before any more transactions flow through the system)
Module 84 — Financial Ledger Integrity & Rate Determinism
    ↓  (financial correctness must be fixed before building invoicing/disputes on top of it)
Module 85 — Invoicing & Credit Note Activation
    ↓  (depends on 84's deterministic figures; unlocks compliance-critical documents)
Module 86 — Stripe Chargeback & Dispute Handling
    ↓  (depends on 84's atomic ledger; reuses 85's invoice/credit-note trail for dispute bookkeeping)
Module 89 — Fraud & Trust Signal Activation
    ↓  (independent track; slotted here so it lands before public launch without blocking the financial chain)
Module 88 — GDPR Erasure Execution & Document Retention
    ↓  (depends on 85's settled financial-record shape to anonymize correctly)
Module 90 — Automated Reconciliation & Operational Alerting
    ↓  (depends on 84/85/86's data being correct — alerting before that would just generate noise)
Module 87 — Financial & Concurrency Test Hardening
    ↓  (final validation gate: proves everything above under real Postgres and real Stripe, plus full E2E)
90+/100
```

---

## Module Summary Table

| Module | Name | Audit Issues Closed | Priority | Complexity | Dependencies | Score Impact |
|---|---|---|---|---|---|---|
| 82 | Admin RBAC & Production Auth Hardening | B1, H10, JWT-revocation medium | P0 | S | None | Security +4 |
| 83 | Professional Verification Enforcement | B2, H11 | P0 | M | None (sequenced after 82) | Business Logic +6 |
| 84 | Financial Ledger Integrity & Rate Determinism | H1, H5, H6 | P0 | M | None (sequenced after 83) | Business Logic +2, Payments +2, DB +1 |
| 85 | Invoicing & Credit Note Activation | B4, invoice-numbering medium | P1 | L | 84 | Business Logic +1, Payments +1 |
| 86 | Stripe Chargeback & Dispute Handling | B5 | P1 | M | 84 | Payments +2 |
| 87 | Financial & Concurrency Test Hardening | H2, H3, H9 | P1 | L | 83, 84, 85, 86 | Testing +4, DB +1, Payments +1 |
| 88 | GDPR Erasure Execution & Document Retention | B3, H8 | P1 | L | 85 | GDPR +2 |
| 89 | Fraud & Trust Signal Activation | H4 | P2 | M | None | Security +1, Observability +1 |
| 90 | Automated Reconciliation & Operational Alerting | H7, alerting gap | P2 | M | 84, 85, 86 | Observability +1, Payments +1 |

---

## Scalability — What's required for 90+ vs. safe to postpone

**Required for 90+:** Nothing. No scalability fix is on the critical path to 90/100 given the current, much more severe gaps in trust/safety, financial correctness, and compliance. The original audit's scalability finding (in-memory geo-search, no DB-level spatial pre-filter) is real but degrades gracefully with professional count per category — it is a growth-stage bottleneck, not a correctness or safety defect.

**Safe to postpone past 90+:** DB-level geospatial pre-filtering for search/discovery; enabling OpenTelemetry tracing by default; further caching optimization; read-replica routing improvements. All of these should be revisited once real usage data shows where the bottleneck actually bites, rather than built speculatively now.

---

## 90+ Definition of Done

MaestroYa can be considered 90+/100 when, verified against the repository (not against documentation or module names):

- An `ADMIN` cannot grant itself or anyone else `ADMIN`/`SUPER_ADMIN` — only `SUPER_ADMIN` can (Module 82).
- Production cannot start without `REDIS_URL` configured, so rate limiting cannot silently degrade to per-instance-only (Module 82).
- An unverified or rejected professional cannot appear in search, submit a quote, or participate in a job (Module 83).
- A real admin action exists to suspend an individual professional, and it takes effect immediately (Module 83).
- Commission and tax figures are computed from one shared, deterministic rule and snapshotted against drift from later rate changes (Module 84).
- Every payment automatically produces both a professional self-billed invoice and a customer-facing invoice/receipt, with no manual trigger (Module 85).
- A refund against an invoiced job automatically produces a matching credit note (Module 85).
- A real Stripe chargeback is automatically recorded and, where the professional was already paid out, automatically triggers the existing transfer-reversal path (Module 86).
- The core concurrency-safety mechanisms (quote acceptance, webhook idempotency, payout dedup) are proven under a real Postgres instance, not only in-memory fakes (Module 87).
- The full payment→payout→refund→reversal cycle has been verified against real Stripe test mode at least once (Module 87).
- At least one full golden-path E2E test (registration → payment → payout → invoice → review) passes reliably (Module 87).
- A GDPR erasure request produces real anonymization of personal data, with financial records preserved intact for legal retention (Module 88).
- Removing a verification document deletes the file from Cloudinary, and a retention job purges old documents automatically (Module 88).
- Real user actions (chat, reviews, quotes, signups, bookings, payments) feed the existing fraud/abuse detectors, not just their own unit tests (Module 89).
- Financial reconciliation runs on a schedule with no admin action required, and critical discrepancies, failed payments, failed payouts, and disputes generate a real-time alert (Module 90).

---

## Explicitly Do NOT Build Yet

- **Do not rewrite or replace Clean Architecture/DDD layering.** The one identified leak (`get-materials-statistics.use-case.ts` importing Prisma directly) is a two-line fix folded into ordinary code review, not a module.
- **Do not replace Prisma.** Schema design, transaction usage, and idempotency constraints are already correct and well-suited to this workload.
- **Do not replace Stripe or the Connect/Express account model.** The payment/payout/refund core is the strongest part of the codebase; it needs the specific gaps in this roadmap closed, not a different provider or architecture.
- **Do not introduce microservices or split the monolith.** Nothing in the audit points to a scaling or team-boundary problem that would justify this at current or near-term scale.
- **Do not build DB-level geospatial search infrastructure now.** Real, but a post-90 growth concern (see Scalability section above).
- **Do not enable OpenTelemetry tracing by default as part of reaching 90.** It exists, it's low-risk to leave off, and turning it on is an operations toggle, not a module.
- **Do not build a new fraud/trust architecture.** Module 65's detector suite is sufficient; the gap is wiring (Module 89), not detection logic.
- **Do not build a new invoicing or tax engine.** Module 79 and the IVA calculation services are correct; the gap is triggering and a missing document type (Module 85), not calculation logic.
- **Do not perform cosmetic refactors** (console.log → structured logger migration, logger value-shape PII redaction, dead mass-assignment cleanup in the unreachable `RegisterPartnerUseCase`) as dedicated modules — fold them into the PRs of whichever module happens to touch nearby code, or track as ordinary backlog.

---

## Final Answers

1. **Minimum number of new modules needed to reach 90+/100:** 9.

2. **Exact module names and numbers:**
   - Module 82 — Admin RBAC & Production Auth Hardening
   - Module 83 — Professional Verification Enforcement
   - Module 84 — Financial Ledger Integrity & Rate Determinism
   - Module 85 — Invoicing & Credit Note Activation
   - Module 86 — Stripe Chargeback & Dispute Handling
   - Module 87 — Financial & Concurrency Test Hardening
   - Module 88 — GDPR Erasure Execution & Document Retention
   - Module 89 — Fraud & Trust Signal Activation
   - Module 90 — Automated Reconciliation & Operational Alerting

3. **Audit findings each module eliminates:** see the Module Summary Table above — every one of B1–B5 and H1–H11 (plus the medium invoice-numbering and JWT-revocation findings) is mapped to exactly one primary module, with no finding left unaddressed except the explicitly-deferred scalability and cosmetic items listed in "Explicitly Do NOT Build Yet."

4. **Correct development order:** 82 → 83 → 84 → 85 → 86 → 89 → 88 → 90 → 87 (final validation gate), as detailed above.

5. **Priority split:** P0 — Modules 82, 83, 84 (the active security blocker, the trust/safety blocker, and the financial-correctness foundation everything else builds on). P1 — Modules 85, 86, 87, 88 (compliance and verification work required before public launch, and the test-hardening that proves it all). P2 — Modules 89, 90 (real risk-reduction and operational maturity, but the platform can respond manually a little longer than it can tolerate the P0/P1 gaps).

6. **Existing code to reuse rather than rewrite:** Clean Architecture/DDD layering; the domain event bus; Prisma schema and transaction patterns; the entire Stripe Connect/payment/payout/refund/reversal core; `CommissionCalculationService`; the Module 79 invoicing/credit-note data model; the Module 80/81 reconciliation engine and dashboard; the Module 65 fraud/trust detector suite; the Module 62 onboarding and Module 59/17 verification state machines; the GDPR consent/export use cases; the existing RBAC/audit-log/rate-limit infrastructure. None of this requires redesign — every module above is scoped as connect/complete/harden/test.

7. **What can safely remain unfinished at 90+:** DB-level geospatial search optimization, default-on distributed tracing, further caching/read-replica tuning, the minor Clean Architecture leak, and other cosmetic logging/dead-code cleanup — all explicitly deferred in "Explicitly Do NOT Build Yet."

8. **Must be complete before processing real customer money:** Modules 82, 83, 84 at minimum (privilege-escalation closed, verification enforced, financial ledger atomic and deterministic), plus Module 86 (chargeback handling — real cards will produce real chargebacks) and at least the Stripe-sandbox portion of Module 87 before trusting the payment core beyond what code review alone can confirm.

9. **Must be complete before public launch (beyond the money-safety set above):** Module 85 (invoicing/compliance), Module 88 (GDPR erasure — regulatory exposure scales with real user count), and Module 90 (so failures are caught proactively, not only by an admin who happens to check a dashboard). Module 89 (fraud wiring) should also land before public (as opposed to closed-pilot) traffic, since abuse patterns are far more likely at open scale.

10. **Projected final score after completing the full roadmap:** **90–92/100**, using the same scoring model as the original audit, landing MaestroYa in the "Production Ready with Minor Risks" band (86–95) — appropriately short of the 96–100 "Highly Production Ready" band, since some deliberately-deferred scalability and cosmetic items remain, matching this roadmap's stated goal of commercially production-ready rather than theoretical perfection.
