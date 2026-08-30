# MaestroYa Production Readiness Audit

**Audit date:** 2026-08-29
**Scope:** Full read-only architecture, security, financial, and operational audit of `maestroya-platform-auth` at commit `2e3339b` ("Merge pull request #94 ... module-81-reconciliation-admin-dashboard").
**Method:** Six parallel domain audits (Payments/Stripe, IVA/Invoicing/Reconciliation, Verification/Domain State Machines, Security/AuthZ, Database/Concurrency/Architecture, Observability/GDPR/Scalability/Fraud/Testing), each tracing actual executable code paths — use cases, repositories, API routes, Prisma schema, and tests — rather than trusting documentation, module names, or the repo's own prior self-audit reports (`MaestroYa_Audit_Report.md`, `MODULE_*_IMPLEMENTATION_REPORT.md`). No files were modified. A previous internal audit (`MaestroYa_Audit_Report.md`, Aug 1) exists in the repo but predates the Stripe payment/payout/refund/invoicing work (Modules 71–81) entirely and should not be read as describing the current system.

---

## Executive Summary

MaestroYa's payment core — PaymentIntent capture, commission calculation, payout execution, and refund-with-transfer-reversal — is unusually mature, disciplined engineering: real triple-layer idempotency, atomic compare-and-swap state transitions, `Decimal(10,2)` money columns, and consistent ownership-based authorization with anti-enumeration `NotFoundError` masking across every resource type sampled (Job, Quote, Payment, Invoice, Review, verification documents, payout info). This is the strongest part of the codebase and it is genuinely production-grade, not merely well-documented.

However, several complete, well-built subsystems are **implemented but never wired into any real user flow**, which is the single biggest pattern in this audit: professional identity/business verification does not gate quoting or search; the entire invoicing and credit-note system (Module 79) is never triggered by anything; 8 of ~10 fraud/abuse detectors are never called; GDPR right-to-erasure only produces a report and never deletes anything; Stripe chargeback/dispute webhooks are not handled at all. Separately, a real privilege-escalation bug lets any `ADMIN` self-promote to `SUPER_ADMIN`. None of these are visible from reading module names, file structure, or the prior implementation reports — each required tracing whether the code is actually called.

**Overall Score: 58 / 100 — Functional MVP**, held back mainly by business-rule and compliance gaps (verification bypass, invoicing, GDPR erasure) rather than by the core payment mechanics, which score well on their own.

---

## Overall Score

| Category | Score | Rationale (short) |
|---|---:|---|
| Architecture | 12 / 15 | Clean layering, consistent DDD idiom, one minor Prisma-in-application leak |
| Business Logic | 6 / 15 | Commission math correct & centralized, but verification gate unenforced; commission/tax formula disagreement; invoicing never fires |
| Payments & Stripe | 13 / 20 | Excellent capture/payout/refund core; no chargeback handling; zero real Stripe-mode testing; ledger-write atomicity gap |
| Security | 9 / 15 | Excellent IDOR/authZ discipline; one real privilege-escalation blocker; rate-limit fallback risk |
| Database & Data Integrity | 8 / 10 | Strong schema, transactions, idempotency-by-design; unverified under real concurrent DB tests |
| Testing | 4 / 10 | Strong unit/integration coverage of edge cases, but on fakes, not a real DB; Stripe SDK fully mocked; e2e is 2 trivial specs |
| Observability & Operations | 3 / 5 | Strong logging/health/reconciliation dashboard; no real-time alerting on failed payments |
| Scalability | 3 / 5 | No N+1 found; in-memory geo-search won't scale; caching genuinely wired |
| GDPR / Data Protection | 2 / 5 | Consent & export real; erasure never executes; deleted-document storage never purged |
| **Total** | **58 / 100** | |

### Production Readiness Level: **41–60 — Functional MVP**

Just below Beta/Controlled Launch. The core transaction can technically complete (customer can pay, professional can be paid out, refunds work), but several blockers — an admin privilege-escalation bug, an unenforced professional-verification gate, and a non-functional GDPR erasure right — are the kind of issues that should be closed before any real money or real customer PII touches this system, even in a controlled/limited launch.

---

## Critical Transaction Flow

```
Customer          Request          Quote           Payment          Job            Completion       Payout          Invoice          Review
   |                 |                |                |               |                |               |                |               |
Register  ──────►  Publish  ──────►  Submitted  ──►  ACCEPTED  ──►  PaymentIntent ─►  CREATED  ──►  IN_PROGRESS ─►  COMPLETED ──►  Payout       Invoice        Review
(WORKS)            (WORKS)           (WORKS, but      by customer    authorized &      (WORKS,       (WORKS,        (WORKS,        eligibility   never          (WORKS)
                                      unverified        (WORKS,        captured via      atomic tx)    materials-     verification   check         auto-
                                      pros can           atomic tx,     webhook, not                    gated)         re-checked     CORRECTLY     created
                                      quote — see        race-safe)     client-confirmed;                              inside tx)     gates on      (BLOCKER —
                                      Business Logic                    commission                                                     verification  Module 79
                                      Blocker #1)                       recorded, but                                                  APPROVED      wired to
                                                                        4 ledger writes                                                 (WORKS)       nothing)
                                                                        not in one
                                                                        transaction)
```

**Where it currently succeeds:** Customer registration → request → quote → acceptance → payment capture → job execution → completion → payout is a real, traceable, mostly race-safe path end to end. This is the one area where "the happy path actually works" is true, not aspirational.

**Where it currently breaks or is incomplete:**
- An **unverified professional** can enter this flow at the "Quote" step and ride it all the way to job completion — verification is only checked at the final payout-eligibility gate, not at any earlier step.
- **Invoice** never gets created automatically anywhere in the flow (Module 79 exists, is never called).
- No **customer-facing invoice/receipt** exists at all — only an internal professional/platform self-billing document, which itself is never generated in practice.
- A **Stripe chargeback** on a captured payment produces no automatic reaction anywhere in this chain.

---

## 🔴 Production Blockers

### B1 — Any ADMIN can self-promote to SUPER_ADMIN (privilege escalation)
- **Location:** `src/app/(dashboard)/admin/actions.ts:146` (`changeUserRoleAction`, gated `requireRole(ROLES.ADMIN, ROLES.SUPER_ADMIN)`) → `src/core/application/use-cases/admin/change-user-role.use-case.ts:20-61` (`ChangeUserRoleUseCase.execute`).
- **Problem:** The use case validates role keys and preserves "at least one active admin," but never checks that the *caller* is `SUPER_ADMIN` before granting `ADMIN`/`SUPER_ADMIN` to a target user (including themselves).
- **Why it matters:** `SUPER_ADMIN`-only surfaces exist specifically because some actions are considered too sensitive for ordinary admins — e.g. `admin/security/actions.ts` (viewing security events, creating/lifting account restrictions). This bug erases that boundary entirely.
- **Real-world failure scenario:** A disgruntled or compromised `ADMIN` account calls the Server Action directly (no UI button needed — Server Actions are network-reachable regardless of UI) to grant itself `SUPER_ADMIN`, then accesses account-restriction controls and security event logs it was never meant to see.
- **Recommended solution:** In `ChangeUserRoleUseCase`, require the caller's own role to be `SUPER_ADMIN` whenever the requested role set includes `ADMIN` or `SUPER_ADMIN`.
- **Complexity:** Low (one additional guard + a test). **Dependencies:** none.

### B2 — Professional verification does not gate quoting, search visibility, or job execution
- **Location:** `src/core/application/use-cases/quotes/create-quote.use-case.ts:44` (checks only `professional.status !== "ACTIVE"`), `src/core/infrastructure/database/prisma/repositories/prisma-professional-discovery-repository.ts:117-140` (search filters only on `status: "ACTIVE"`). `ProfessionalProfile.status` defaults to `ACTIVE` at creation (`prisma/schema.prisma:1361-1362`); `verificationStatus` defaults to `UNVERIFIED` and is never read by these paths.
- **Problem:** The entire identity/business-verification and admin-approval subsystem (Module 62 onboarding-activation, `ProfessionalOnboarding.status`) is real and internally correct but writes to a table nothing downstream reads. A rejected verification (`RejectProfessionalVerificationUseCase`) never updates `ProfessionalProfile.status` either — rejection is a no-op against the professional's ability to keep operating. There is also no admin use case to suspend an individual professional at all (`ProfessionalStatus.SUSPENDED` is a dead enum value).
- **Why it matters:** This is the platform's core trust promise for a home-services marketplace — the professional-verification requirement in the business model is not enforced at all in the parts of the flow customers actually interact with.
- **Real-world failure scenario:** A new professional completes onboarding (address + service category only, no documents), appears in search immediately, submits a binding quote, gets accepted, and performs real work in a customer's home — all before any human reviews an ID document. If their verification is later rejected, nothing changes: they can keep quoting and working. The only place verification is ever checked is the final payout-eligibility gate, so the professional could complete the job and only get stuck trying to be paid — an unsatisfying and confusing failure mode for both sides, and a real safety exposure for the customer in the meantime.
- **Recommended solution:** Gate `CreateQuoteUseCase` and the discovery/search repository query on `verificationStatus === "APPROVED"` (or equivalently wire `ProfessionalOnboarding.status === ACTIVATED` into `ProfessionalProfile.status`), and add a real `AdminSuspendProfessionalUseCase` plus make rejection actually flip `ProfessionalProfile.status`.
- **Complexity:** Medium (touches quote creation, discovery repository, needs a migration path for existing test/demo data, and a suspend use case). **Dependencies:** none blocking; should ship together with test coverage (`tests/integration/quotes/quote-flows.test.ts` currently hardcodes `verificationStatus: VERIFIED` in its fixtures and has no negative test).

### B3 — GDPR right-to-erasure never actually deletes anything
- **Location:** `src/core/application/use-cases/gdpr/prepare-account-deletion.use-case.ts:25-28` (own doc comment: "Never performs an irreversible delete or mutates any data... a read-only report"). No `anonymize`/`hardDelete`/`executeDeletion` use case exists anywhere in `src/core` (repo-wide grep confirmed). `tests/integration/gdpr/gdpr-flows.test.ts:214` names the behavior explicitly: "classifies every GDPR data category exactly once, without deleting anything."
- **Problem:** Article 17 (right to erasure) is scoped and planned but not implemented. A user's deletion request today produces a report for a human to act on manually, with no execution path in the codebase at all.
- **Why it matters:** This is a regulatory exposure for a platform operating in Spain/EU, and it means there is currently no technical way to fulfill an erasure request even manually through the app — an operator would have to hand-write SQL against production, which is itself risky given the extensive FK network (`onDelete: Restrict` everywhere).
- **Real-world failure scenario:** A customer or professional formally requests deletion of their data; MaestroYa has no built-in way to comply within a reasonable timeframe without engineering intervention on live data.
- **Recommended solution:** Build the actual anonymization/erasure execution use case (likely: anonymize PII fields in place rather than hard-delete, given `Restrict` FKs on financial records that must be retained for tax/accounting purposes — this needs a deliberate design, not a quick patch).
- **Complexity:** High (must reconcile with the immutable-financial-record requirements audited elsewhere in this report). **Dependencies:** legal/compliance sign-off on what "erasure" means for a party with financial obligations on file.

### B4 — Invoicing and credit-note system is fully built but never triggered
- **Location:** `src/core/application/use-cases/invoicing/create-professional-invoice-draft.use-case.ts` and `.../refunds/create-credit-note.use-case.ts` are composed in their own `compose.ts` files but have **zero callers** anywhere else in the codebase (no route, server action, event subscriber, or cron — confirmed by repo-wide grep and by `vercel.json`'s single cron being unrelated). `ExecuteProfessionalPayoutUseCase` defaults `requireInvoiceForPayout = false` and this is never overridden. Additionally there is **no customer-facing invoice entity at all** — only `InvoiceType.PROFESSIONAL_SELF_BILLED`, a platform-to-professional commission document.
- **Problem:** In production today, zero invoices and zero credit notes would ever be generated automatically. `ExecuteRefundUseCase` has no awareness of invoices/credit notes at all, so even if invoicing were wired on, a refund would leave an issued invoice silently stale.
- **Why it matters:** Spain requires proper invoicing for commercial transactions; a marketplace charging customers directly needs a customer-facing receipt/invoice at minimum, and the platform's own self-billing to professionals (for commission, which is itself a taxable service) needs to actually be issued to be usable for either party's accounting or the platform's own tax filings.
- **Recommended solution:** Wire `CreateProfessionalInvoiceDraftUseCase` to fire on job completion / payment capture (event subscriber is the natural mechanism, matching the pattern already used elsewhere in the codebase), wire `CreateCreditNoteUseCase` into `ExecuteRefundUseCase`, and design a genuine customer-facing invoice/receipt entity. Also replace the placeholder issuer tax ID (`MAESTROYA_ISSUER_TAX_ID = "PENDING-CIF-CONFIRMATION"` in `invoicing-issuer.ts`) before any invoice is legally issued.
- **Complexity:** Medium for wiring the existing (self-billed) invoice; High for adding a genuine customer invoice type. **Dependencies:** B3's financial-immutability considerations overlap here; legal review of Spanish invoicing requirements.

### B5 — No Stripe chargeback/dispute webhook handling
- **Location:** `stripe-payment-webhook-verifier.ts` only parses `payment_intent.*` events plus `charge.refunded`; `stripe-connect-webhook-verifier.ts` only handles `account.updated`/`transfer.created`. Repo-wide grep for `charge.dispute`/`chargeback` returns no handling code.
- **Problem:** A real card-network chargeback lands in the platform's Stripe balance with zero automatic reaction — no `Payment` status change, no automatic transfer reversal (even though the reversal machinery, `ReverseProfessionalPayoutUseCase`, works correctly for admin-decided marketplace disputes and could in principle be reused), no alert.
- **Why it matters:** Chargebacks are a normal, expected occurrence for any card-accepting business; without handling, the platform could pay a professional and then eat the full chargeback loss with no visibility until someone happens to check the Stripe Dashboard.
- **Real-world failure scenario:** A customer disputes a charge with their card issuer weeks after a job is paid out; Stripe deducts the amount plus a dispute fee from the platform's balance; nothing in MaestroYa records this, flags it, or attempts to recover the paid-out amount from the professional.
- **Recommended solution:** Subscribe to `charge.dispute.created`/`.closed`/`.funds_withdrawn`, record a `Dispute`-equivalent Stripe-side record, and — where the connected professional has already been paid out — trigger the same transfer-reversal path used for admin-resolved disputes today.
- **Complexity:** Medium (the reversal mechanics already exist; this is mainly webhook wiring + a new record type). **Dependencies:** none.

### B6 — No customer-facing invoice/receipt exists
*(Folded into B4 above but called out separately because it is a distinct legal requirement, not merely a wiring gap.)* See B4.

---

## 🟠 High-Risk Issues

**H1 — Commission ledger writes are not atomic.** `RecordCommissionForPaymentUseCase` (`record-commission-for-payment.use-case.ts:63-177`) performs a Commission `create` followed by four separate, unwrapped `ledger.create()` calls, with no `$transaction` wrapping the sequence (confirmed: zero `$transaction` usage anywhere in `src/core/application/use-cases`). A crash between writes leaves a partially-recorded financial ledger; only the reverse case (ledger row without a Commission row) is defended against. *Recommended:* wrap the 5 writes in one `prisma.$transaction`. Medium complexity.

**H2 — Zero real/sandbox Stripe integration testing.** Every Stripe-touching test (`stripe-payment-gateway.test.ts`, `stripe-transfer-gateway.test.ts`, `stripe-connect-gateway.test.ts`, and the integration suites) fully mocks the Stripe SDK or uses in-memory fakes. The adapters' assumptions about Stripe's actual request/response shapes have never been checked against Stripe itself — the codebase's own `MODULE_72_IMPLEMENTATION_REPORT.md` flags this as an open item. *Recommended:* run the full payment→payout→refund cycle against Stripe's real test mode before go-live.

**H3 — Concurrency-safety mechanisms are untested against a real database.** The optimistic-lock `updateMany` guards, the raw-SQL unique-violation webhook idempotency, and the triple-layered payout dedup are all correctly designed by code review, but all ~62 integration tests use hand-written in-memory Fake repositories, not a real Postgres instance under concurrent load (CI does run `prisma migrate deploy` against real Postgres, but the test suite itself never exercises it for these mechanics). *Recommended:* add a small number of true Postgres-backed concurrency tests (docker-compose test DB is already provisioned) for `PrismaQuoteAcceptanceRepository.acceptQuote`, the webhook `claim()` path, and `ExecuteProfessionalPayoutUseCase`.

**H4 — 8 of ~10 fraud/abuse detectors are never invoked.** Off-platform-communication, fake-review-pattern, spam, suspicious-pricing, booking-abuse, payment-abuse, and identity-risk detectors (`src/core/application/use-cases/trust-integrity/*`) are fully built and unit-tested but have no caller anywhere in `src/app` or `instrumentation.ts`'s subscriber registrations. Only 2 of ~10 (premature-job-completion, completion/dispute conflict) actually fire. *Recommended:* wire `RecordUserBehaviorSignalUseCase` calls into the real chat-message, review-creation, and signup flows.

**H5 — Commission-base formula disagreement for CUSTOMER_PURCHASED-materials jobs.** `CalculateJobCommissionBreakdownUseCase` counts all MATERIALS line items into the commission base regardless of `materialsStrategy`, while `CalculateJobTaxBreakdownUseCase` only counts materials when `materialsStrategy === PROFESSIONAL_SUPPLIED`. For a customer-purchased-materials job, `Commission.amount` and `Invoice.commissionAmount` will disagree — a live, self-flagged-but-unfixed bug (the reconciliation module even has a category for it, `INVOICE_COMMISSION_AMOUNT_INCONSISTENT`). *Recommended:* unify both use cases on one shared materials-inclusion rule.

**H6 — No effective-dated commission/tax rates.** `Commission` (recorded at payout-release) and `Invoice` (recorded at job-completion) each independently re-derive from the "current" platform rate at their own point in time, with no snapshot on `Quote`/`Payment`. A mid-flight rate change can make the two disagree for the same job, detectable only by a manually-run reconciliation. *Recommended:* snapshot the applicable commission/tax rate on the Quote or Payment at the moment of calculation.

**H7 — Financial reconciliation has no schedule.** The Module 81 admin reconciliation dashboard is real and well-built, but nothing (`vercel.json` has exactly one unrelated cron) ever triggers a run automatically — it depends on an admin remembering to click it. *Recommended:* add a scheduled job (daily) that runs reconciliation and surfaces critical discrepancies via alert, not just dashboard visibility.

**H8 — GDPR: removed verification documents are never purged from storage.** `RemoveVerificationDocumentUseCase` deletes only the database pointer; Cloudinary's `destroy` is never called, and no retention/purge job exists anywhere. A "removed" passport/ID image remains in cloud storage indefinitely. *Recommended:* call Cloudinary `destroy` on removal and add a scheduled purge job for documents past a defined retention window.

**H9 — No end-to-end test of any complete user journey.** `playwright.config.ts` exists, but `tests/e2e/` contains only a 5-line homepage smoke test and a 49-line locale-switching test — no signup→quote→payment→completion journey is tested end-to-end. *Recommended:* add at least one full happy-path e2e test using Stripe test mode.

**H10 — Rate limiting silently degrades without `REDIS_URL` in production.** `rate-limit-repository-factory.ts:29-37` falls back to an in-memory limiter when `REDIS_URL` is unset, and `env.ts` does not require it in production. In a horizontally-scaled deployment, each instance keeps independent counters, multiplying the effective brute-force budget by instance count. *Recommended:* require `REDIS_URL` in production via the existing Zod env validation, or fail loudly at startup if absent with `NODE_ENV=production`.

**H11 — Company activation after verification approval requires a second, oddly-named manual step.** `ApproveCompanyVerificationUseCase` only flips `CompanyVerification.status`; only `ReactivateCompanyUseCase` (named for SUSPENDED→ACTIVE, but also legally permits PENDING→ACTIVE) can move `CompanyStatus` to `ACTIVE`, and nothing does so automatically on approval. *Recommended:* auto-activate via an event subscriber on verification approval, or rename/clarify the use case.

---

## 🟡 Medium Risks

- Invoice numbering can gap: `IssueInvoiceUseCase` allocates a sequential number before the compare-and-swap `issue()` write; if that write loses a race, the number is burned with no invoice recorded — contrary to Spanish gapless-numbering expectations (`issue-invoice.use-case.ts:39-78`).
- Logger PII redaction is key-name-pattern-based only; a value like an email under a non-suspicious key (`{ profile }`, `{ user }`) is not redacted and can leak to logs/Sentry.
- Structured logger adoption is inconsistent — 74 files still use raw `console.log`/`console.error` versus 50 using the structured logger.
- Webhook claim/process/mark sequence (`ProcessCustomerPaymentWebhookUseCase`) is not itself a single transaction; if the final status-write fails after business logic already applied, the event is stuck `PROCESSING` forever and unreclaimable by future Stripe retries (self-acknowledged, low-probability edge case in `MODULE_72_IMPLEMENTATION_REPORT.md`).
- Search/discovery does full in-memory geo-filtering with haversine distance computed in application code for every candidate in a category, then sorts/paginates in memory — will not scale past a modest number of professionals per category; no DB-level spatial pre-filter.
- OpenTelemetry tracing exists but is default-off (`TRACING_ENABLED` unset) — no distributed tracing actually runs in production unless explicitly enabled.
- `get-materials-statistics.use-case.ts` imports Prisma directly, bypassing the repository-interface boundary every other use case respects — a minor Clean Architecture leak.
- `RegisterPartnerUseCase` spreads raw input into a Prisma write (mass-assignment pattern) but is currently unreachable/dead code (no caller under `src/app`) — should be fixed or removed before the affiliate module gets a UI.
- Middleware's route matcher excludes `/api/**` entirely, so there is no middleware-level authentication backstop for future API routes; currently benign since no route relies on it, but a process gap for future authors.
- No hard check that a currently-elevated JWT (role claims) is revoked immediately when an admin is demoted mid-session — takes effect only on next token refresh.

## 🔵 Technical Debt

- Money arithmetic is floating-point JS `number` with `roundToCents` applied at every step (a deliberate, documented convention), rather than integer cents or a Decimal library in process — works today, consistently applied, but a lower-guarantee foundation than the underlying `Decimal(10,2)` schema type implies.
- Two docker-compose files: the dev one has a plaintext default Postgres password (`postgres`), fine for local dev; the prod one correctly requires the variable with no default.
- `PrismaExternalWebhookEventRepository` uses raw SQL, reportedly because `prisma generate` couldn't reach `binaries.prisma.sh` in the sandbox at implementation time — worth confirming this isn't also a live constraint in the real CI/deploy environment rather than a sandbox artifact being permanently routed around.
- Several `MODULE_*_IMPLEMENTATION_REPORT.md` files referenced by module number (73–77) are missing from the repo root even though the corresponding code exists and works — a documentation-hygiene gap, not a code gap.

---

## 🟢 What MaestroYa Already Does Well

- **Payment capture is genuinely server-authoritative.** `InitiateQuotePaymentUseCase` never trusts a client-supplied amount — it always recomputes the total from the accepted Quote's line items server-side, closing off a classic price-tampering vector.
- **Triple-layer idempotency is applied consistently** across payment initiation, payout execution, and refunds: a distributed lock, a deterministic Stripe idempotency key, and a DB-unique constraint, all three independently capable of preventing a double-charge, double-payout, or double-refund.
- **Refund-after-payout reversal is a real, working implementation**, not aspirational: `ExecuteRefundUseCase` detects an already-paid-out job and calls `ReverseProfessionalPayoutUseCase`, which performs a real `stripe.transfers.createReversal` with its own idempotency key and compare-and-swap guard, and separately reverses the commission via a ledger entry rather than mutating the frozen `Commission` row.
- **Quote acceptance is fully race-safe**: a real `prisma.$transaction` with a conditional `updateMany` compare-and-swap means two concurrent "accept quote" requests cannot both succeed, backed further by a DB-unique constraint on `Job.quoteId`.
- **Webhook idempotency uses a real unique-constraint race guard** (raw SQL `INSERT` relying on Postgres's own unique index), not a check-then-insert pattern — genuinely race-proof against concurrent duplicate deliveries.
- **Authorization/IDOR discipline is consistently applied across the entire resource surface** (Job, Quote, Payment, Invoice, Review, verification documents, payout info, company membership): ownership is always re-derived from the server session, never trusted from a client-supplied ID, and a resource that exists-but-isn't-yours returns the same `NotFoundError` as one that doesn't exist, preventing enumeration.
- **Commission math is centralized in exactly one service** (`CommissionCalculationService`), with no stray hardcoded percentages found anywhere else in the codebase — the flat 10%-on-total model matches the intended business spec, worked-example-verified.
- **Money fields are `Decimal(10,2)` throughout the schema**, with `onDelete: Restrict` protecting every financial record from cascade-delete, and comprehensive unique constraints (payment intent ID, transfer ID, refund ID, idempotency keys) baked into the schema itself.
- **Health checks are exceptionally mature**: proper liveness/readiness/startup separation, 12+ subsystem checks run concurrently, admin-gated diagnostics, degradable dependencies correctly excluded from failing readiness.
- **Password reset and login security are well-built**: single-use, hashed, time-boxed tokens; enumeration-safe generic responses; dual email+IP rate limiting with automatic account-level lockout escalation.
- **The Module 81 reconciliation dashboard is a real, purpose-built operator tool**, not unused dead code — cross-checking Payments, Commission, Tax, Invoicing, Payouts, Refunds, and Credit Notes with severity-classified discrepancies.

---

## Module-by-Module Status

| Module | Status | Evidence | Risk |
|---|---|---|---|
| Customer registration/auth | 🟢 Complete | `auth.ts`, `auth-config.ts`, rate-limited, enumeration-safe | Low |
| Professional onboarding | 🟡 Partial | `complete-professional-onboarding.use-case.ts` — creates profile with no verification requirement | High |
| Professional verification (documents, admin review) | 🟡 Partial | Fully built state machine, but not connected to `ProfessionalProfile.status` used elsewhere (B2) | Blocker |
| Company verification/activation | 🟡 Partial | Better gated than individual pros, but activation requires a manual second step (H11) | Medium |
| Quote lifecycle | 🟢 Complete | Atomic accept, race-safe, authorization-checked | Low |
| Job lifecycle | 🟢 Complete | Atomic transitions, materials gate; inherits verification gap upstream | Low (mechanically) |
| Payment capture | 🟢 Complete | Server-authoritative amount, triple idempotency, webhook-driven | Low |
| Stripe Connect onboarding/status sync | 🟢 Complete | Correct capability gating, stale-write protection | Low (unverified live) |
| Payout execution | 🟢 Complete | Triple dedup, correct commission deduction, failure classification | Low |
| Refunds | 🟢 Complete | Real transfer-reversal, idempotent, race-guarded against concurrent payout | Low |
| Chargebacks/disputes (Stripe-side) | ⚪ Not Implemented | No webhook subscription for `charge.dispute.*` at all (B5) | Blocker |
| Marketplace disputes (customer↔professional) | 🟢 Complete | Full state machine, admin-mediated, financial-outcome execution wired | Low |
| IVA/VAT calculation | 🟡 Partial | Correct math, single rate always applied, no rate snapshot (H6) | Medium |
| Invoicing | 🔴 Not Production Ready | Fully built, never triggered by anything (B4) | Blocker |
| Credit notes | 🔴 Not Production Ready | Fully built, never triggered, refund flow unaware of it (B4) | Blocker |
| Financial reconciliation | 🟡 Partial | Real and correct, but manual-trigger-only, no schedule (H7) | High |
| Admin panel / RBAC | 🟡 Partial | Excellent 3-layer defense in depth, except one role-escalation bug (B1) | Blocker |
| GDPR consent | 🟢 Complete | Real, tested, idempotent | Low |
| GDPR data export | 🟡 Partial | Assembles export data; delivery mechanism not independently verified | Medium |
| GDPR erasure | 🔴 Not Production Ready | Report-only, never deletes/anonymizes anything (B3) | Blocker |
| Fraud/abuse detection | 🟡 Partial | 8/10 detectors built but never invoked (H4) | High |
| Observability (logging/health/tracing) | 🟢 Complete | Strong logging & health checks; tracing off by default | Low |
| Search/discovery | 🟡 Partial | Correct results, but scalability bottleneck at growth (in-memory geo-filter) | Medium |
| Testing (unit/integration) | 🟡 Partial | Strong edge-case coverage, but on fakes, not a real DB or live Stripe | High |
| Testing (e2e) | 🔴 Not Production Ready | Two trivial specs; no full journey tested (H9) | High |

---

## Security Assessment

Authentication and per-resource authorization are the strongest security area: JWT sessions with sane expiry/refresh, single-use hashed password-reset/verification tokens, dual email+IP rate limiting with automatic escalation, and a remarkably consistent IDOR-prevention idiom applied across every resource type sampled (session-derived ownership checks, generic `NotFoundError` on mismatch). The one serious finding is the admin privilege-escalation bug (B1) — a plain `ADMIN` can grant itself `SUPER_ADMIN` via a directly-callable Server Action with no additional guard. Secondary findings: rate limiting silently degrades to per-instance-only without `REDIS_URL` in production (H10), and there's no middleware-level backstop for `/api/**` routes (currently benign, a process risk for the future). No hardcoded secrets were found in source, scripts, or config; production env validation correctly rejects Stripe test keys and requires HTTPS/`AUTH_SECRET`.

## Payment & Stripe Assessment

The payment core (capture, payout, refund, reversal) is production-grade in design: server-authoritative pricing, triple-layer idempotency, atomic compare-and-swap transitions, and a genuinely working refund-after-payout transfer-reversal path. The commission model (flat 10% on total) is correctly and centrally implemented, matching the specified business rule with a verified worked example. The two real gaps are structural, not mechanical: no Stripe chargeback/dispute webhook handling exists at all (B5), and the commission-ledger write sequence is not atomic (H1). A third, cross-cutting concern is that none of this has ever been exercised against real (even sandbox) Stripe — every test mocks the SDK (H2) — so the wire-level correctness of the Stripe integration is unverified by anything other than code review.

## VAT / IVA / Invoicing Assessment

IVA calculation math itself is centralized and correct (21% general rate, consistent rounding), but it is only computed at invoice-draft time — and invoices are never actually created in any live code path (B4). There is no customer-facing invoice/receipt entity at all, only an internal professional self-billing document for commission (B6). Commission and tax figures are independently re-derived at different points in time with no rate snapshot, risking silent historical drift if platform rates ever change (H6), and the two calculation paths already disagree for customer-purchased-materials jobs today (H5). Credit notes exist as a data model but are equally disconnected from the refund flow.

## Database & Financial Integrity

This is a genuine strength: `Decimal(10,2)` money columns throughout, `onDelete: Restrict` on every financial relation, and comprehensive unique constraints backing idempotency (payment intent ID, transfer ID, refund ID, webhook event ID, and multiple explicit idempotency-key columns). Concurrency-sensitive operations (quote acceptance, webhook processing, payout execution) use real database transactions and compare-and-swap guards rather than naive read-then-write patterns. The caveat is that none of this concurrency safety is exercised by the test suite against a real database under concurrent load (H3) — correctness currently rests on code review alone.

## Testing Assessment

Where tests exist, they are genuinely good — real edge-case and failure-path coverage for payment/refund/payout flows (double-refund rejection, concurrent-refund races, webhook duplicate-delivery handling), not shallow happy-path padding. But the entire integration suite runs against hand-written in-memory Fake repositories rather than a real Postgres instance, the Stripe SDK is fully mocked everywhere, and end-to-end coverage is essentially nonexistent (two trivial Playwright specs, no signup→payment journey). High test *quality* per test, low test *proof of production integration*.

## Event / Webhook Assessment

Domain events are published after commit (not inside the state-changing transaction), so a failing subscriber cannot roll back financial state, and bus failures aren't silently hidden. Stripe webhooks correctly verify signatures against the raw body before parsing, use a real unique-constraint-backed idempotency claim (not check-then-insert), and return status codes that correctly drive Stripe's retry behavior. The one disclosed gap is a claim/process/mark sequence that isn't itself transactional, risking a permanently-stuck `PROCESSING` event if the final write fails after business logic has already applied (self-acknowledged, low-probability).

## Observability & Operations

Structured logging, correlation IDs, and health checks (liveness/readiness/startup) are all mature and production-appropriate; Sentry and OpenTelemetry are wired (tracing off by default). The Module 81 reconciliation dashboard gives an operator real visibility into payment/payout/refund discrepancies. The gap is *proactive, real-time* alerting: a failed payment is a normally-handled outcome, not an exception, so it would not page anyone overnight — an operator would see it the next morning via the dashboard, but nothing wakes them up tonight.

## Scalability Assessment

No classic N+1 query patterns were found in the sampled hot paths, pagination is correctly implemented on discovery results, and Redis-backed caching is genuinely wired into real code paths (not a dead adapter). The identified bottleneck is architectural: professional/company search loads all active candidates per category into memory and computes haversine distance and sorting in application code rather than at the database layer — this will degrade as the professional count per category grows, well before reaching six-figure user counts.

## GDPR Technical Assessment

Consent (grant/withdraw) is real, tested, and idempotent. Data export exists at the use-case level. The right to erasure, however, is scoped but not implemented — it produces a report for a human to act on, with no execution path anywhere in the codebase (B3), which is a genuine regulatory exposure. Separately, "removed" identity verification documents are deleted from the database but never from Cloudinary storage, and no retention/purge job exists anywhere (H8) — meaning sensitive ID/passport images can persist indefinitely after a user believes they've removed them.

---

## P0 — Must Fix Before ANY Production Transaction

1. **B1 — Admin privilege escalation.** A single unguarded Server Action can hand out `SUPER_ADMIN`. This must close before any admin account exists in a live environment.
2. **B2 — Professional verification enforcement.** Real customers should not be matched with unverified professionals under any circumstance; this is core to the platform's safety promise, not a nice-to-have.
3. **B5 — Stripe chargeback/dispute webhook handling.** Real cards will produce real chargebacks; the platform needs at minimum visibility and ideally automatic transfer-reversal wiring before processing real charges.
4. **H1 — Atomic commission-ledger writes.** A financial ledger that can silently become partially written is not safe to run with real money at any volume.

## P1 — Must Fix Before Public Launch

5. **B4/B6 — Invoicing and customer receipts.** Needed for legal/tax compliance in Spain before scaling beyond a closed pilot.
6. **B3 — GDPR erasure execution.** Needed before onboarding real customer/professional PII at scale; a closed pilot with a handful of known users is a smaller (but still real) exposure than public launch.
7. **H5/H6 — Commission/tax formula consistency and rate snapshotting.** Fix before financial reporting is relied upon for real tax filings.
8. **H2/H3/H9 — Real Stripe-mode and real-DB concurrency testing, plus at least one e2e happy path.** Needed before trusting the mechanisms this report found well-designed but empirically unverified.
9. **H10 — Require `REDIS_URL` in production.** Cheap fix, closes a real multi-instance abuse-protection gap.

## P2 — Fix Shortly After Launch

10. **H4 — Wire the fraud/abuse detectors** into real chat/review/signup flows.
11. **H7 — Schedule reconciliation runs** and alert on critical discrepancies automatically.
12. **H8 — Purge removed verification documents** from Cloudinary and add a retention policy.
13. **H11 — Fix company auto-activation** on verification approval.
14. Medium items: invoice-numbering gap risk, logger value-shape redaction, console.log→structured-logger migration.

## P3 — Future Improvements

15. Move search/discovery to a DB-level geospatial pre-filter before professional counts grow large.
16. Consider integer-cents or Decimal.js arithmetic in the application layer to match the schema's `Decimal` guarantee more strictly.
17. Enable OpenTelemetry tracing by default in production.
18. Clean up the Prisma-in-application-layer leak in `get-materials-statistics.use-case.ts` and the dead mass-assignment pattern in `RegisterPartnerUseCase`.

---

## Production Launch Checklist

| Item | Status |
|---|---|
| Customer can register | PASS |
| Professional can register | PASS |
| Professional verification is enforced | **FAIL** (B2) |
| Customer can create request | PASS |
| Professional can quote | PASS (but unverified professionals can too — see B2) |
| Customer can accept quote | PASS |
| Customer can actually pay | PASS |
| Payment is persisted | PASS |
| Payment is idempotent | PASS |
| Stripe webhook is reliable | PARTIAL (correct design; unverified against real Stripe — H2; one disclosed stuck-event edge case) |
| Job lifecycle works | PASS |
| Completion works | PASS |
| Payout works | PASS |
| Commission is correct | PARTIAL (correct core formula; disagreement for customer-purchased-materials jobs — H5) |
| Refund works | PASS |
| Dispute strategy exists | PARTIAL (marketplace disputes: yes; Stripe chargebacks: **FAIL**, B5) |
| Invoice exists | **FAIL** (B4/B6 — built but never triggered; no customer invoice type at all) |
| IVA is persisted | PARTIAL (calculated correctly; not persisted on Quote/Payment, only at invoice time — which never fires) |
| Financial reconciliation exists | PARTIAL (real tool; no schedule — H7) |
| Authorization is secure | PARTIAL (excellent IDOR discipline; one admin privilege-escalation blocker — B1) |
| Admin controls are secure | **FAIL** (B1) |
| Audit logs exist where required | PASS |
| Monitoring exists | PASS |
| Critical failures generate alerts | PARTIAL (exceptions alert via Sentry; normal-path payment failures do not page anyone) |
| Backups exist | NOT INDEPENDENTLY VERIFIED (a `20260814000000_add_backup_disaster_recovery_module` migration exists; out of this audit's sampled scope to confirm operational backup execution) |
| Recovery strategy exists | NOT INDEPENDENTLY VERIFIED (same as above) |
| GDPR technical requirements are addressed | **FAIL** (consent/export: yes; erasure: no — B3; document retention: no — H8) |
| Rate limiting / abuse prevention exists | PARTIAL (real and thorough when Redis is configured; silently weakens without it — H10; fraud detectors mostly unwired — H4) |
| Critical flows have integration/E2E tests | PARTIAL (strong unit/integration coverage on fakes; e2e essentially absent — H9) |

---

## Final Verdict

**Would I personally allow MaestroYa to process real customer money today? No.**

The payment/payout/refund core is good enough that I would trust it technically — but it doesn't stand alone. The admin privilege-escalation bug (B1) and the unenforced professional-verification gate (B2) are the two blockers I would not accept moving past under any framing, because they defeat the platform's basic security and trust promises regardless of how solid the payment plumbing is. The GDPR erasure gap (B3) and missing invoicing (B4/B6) are compliance blockers that scale in severity with how many real users touch the system, so they matter less for a two-person friends-and-family pilot than for anything resembling a public launch — but they should not be treated as optional even then.

**Minimum changes for a controlled/limited production launch (a small number of known, trusted users, not public traffic):**

1. Fix B1 (admin role-escalation guard) — small, mechanical, no excuse to defer.
2. Fix B2 (wire verification status into quote/search authorization) — this is the platform's core safety property.
3. Add at minimum passive Stripe dispute-webhook logging/alerting (B5) so a chargeback doesn't go unnoticed, even if full automated reversal comes later.
4. Wrap the commission-ledger writes in a transaction (H1) — small fix, real financial-integrity payoff.
5. Run the full payment→payout→refund cycle against real Stripe test mode at least once (H2) before trusting the mocked test suite's confidence level.
6. Require `REDIS_URL` in production (H10) — a one-line env-validation change.

Invoicing (B4/B6), GDPR erasure (B3), and the fraud-detector wiring (H4) can reasonably follow shortly after a controlled launch rather than blocking it outright, provided the operator is aware of and actively tracking these gaps rather than assuming they're covered — which, before this audit, the module names and prior implementation reports would have suggested they were.
