# Module 85 — Invoicing & Credit Note Activation

## 1. Status

**COMPLETE WITH CONDITIONS**

All required implementation, unit/integration tests, `typecheck`, `lint`, and `git diff --check` passed cleanly with zero regressions across the full existing suite (560 files / 4722 tests). The one open item is `npm run build` (Next.js production build): it could not be observed to finish inside this environment's hard per-command execution cap (180s), and background/detached processes do not survive across separate tool invocations here (confirmed by a direct control experiment — see Section 12). This is an environment/tooling limitation, not a build failure: `strace` during a build attempt showed the compiler actively forking workers and doing real work, not hanging or erroring. `typecheck` (which runs the same TypeScript compiler over the same changed files) is clean, and no build-only failure mode (e.g. a bad import, a missing export, a type-only construct invalid at the bundler level) was triggered by any change in this module. Recommend the user run `npm run build` once, locally or in CI, to get a hard pass/fail signal before deploying; I could not obtain that signal myself given the tool constraints described above.

## 2. Audit Findings

The invoicing/credit-note engine built in Module 79 was structurally complete and heavily tested in isolation, but never activated:

- `CreateProfessionalInvoiceDraftUseCase`, `SubmitInvoiceForAcceptanceUseCase`, `AcceptInvoiceUseCase`, `IssueInvoiceUseCase`, and `CreateCreditNoteUseCase` were only ever instantiated by their own `compose.ts` factory functions. No route, no admin UI action, and no domain-event subscriber called into any of them. A completed job with a captured/released payment never produced an invoice; a refund never produced a credit note.
- There was no invoice type or flow for the customer-facing document (the receipt shown to the customer for what they paid MaestroYa), only the self-billed invoice issued to the professional/company.
- Invoice/credit-note numbering was allocated by a separate call to `PrismaDocumentNumberAllocator` *before* the CAS `issue()`/`issue()` write on the document itself. If that CAS write lost a race (e.g. two issue attempts against the same document, or any transient failure between allocation and the write), the allocated sequence number was permanently burned with no document ever attached to it — a real compliance gap for a legally-sequential invoice series, not merely a cosmetic gap.
- The issuer's tax ID (`MAESTROYA_ISSUER_TAX_ID`) had no "is this actually configured" check; a real invoice could be issued carrying a placeholder value with no way to detect it downstream.
- VAT/commission calculation itself (Module 78's `calculateMaestroYaTaxBreakdown`) was correct and already the single source of truth for both the professional-side and customer-side figures; the gap was that nothing ever called the invoicing use cases with these figures at the right lifecycle moment.

## 3. Root Causes

1. **Missing event wiring** — the domain event bus had no subscribers registered for `PaymentReleaseApproved` (the trigger for invoice creation) or `PaymentRefunded` (the trigger for credit-note creation) in the invoicing module. The use cases existed; nothing invoked them in response to the events that should.
2. **Numbering allocated outside the atomic write** — `allocateNextDocumentSequence` and the CAS `issue()` update were two separate, non-transactional operations. A lost CAS race left an orphaned, gap-causing number allocation.
3. **No customer-facing document type** — the domain model (`InvoiceType`) only had `PROFESSIONAL_SELF_BILLED`; there was no way to represent the customer receipt without either overloading the existing type incorrectly or building a second parallel model (both of which the brief prohibited).
4. **No issuer-configuration guard** — `invoicing-issuer.ts` had hardcoded/placeholder values with no mechanism to fail loudly if production configuration was never supplied.

## 4. Changes Implemented

**New event subscribers** (wired in `src/core/application/use-cases/invoicing/compose.ts`):
- `ActivateInvoiceLifecycleOnPaymentReleaseApprovedSubscriber` — on `PaymentReleaseApproved`, resumes each of the professional self-billed invoice and the customer receipt independently from whatever state they are currently in (not always assuming `DRAFT`), advancing draft → submit → accept → issue (professional) or draft → issue (customer receipt) as far as the current state allows. A failure activating one document type does not block the other. Expected non-activation states (`SelfBillingNotAuthorizedError`, validation errors for an already-progressed/duplicate document) are swallowed as normal, not-yet-eligible outcomes; anything else is rethrown and reported via `FailureReporter`.
- `CreateCreditNoteOnPaymentRefundedSubscriber` — on `PaymentRefunded`, finds the professional self-billed invoice for the job, computes the professional-side refund amount from the existing `calculateTaxReversal`-derived breakdown proportionally to the customer-side refunded amount, clamps it to the invoice's remaining creditable amount, and creates a credit note keyed by an idempotency key derived from the triggering financial-adjustment id. Credit-note failures are caught and reported, never left to surface as an unhandled event-bus error, since the underlying refund has already succeeded and must not be blocked by a downstream document failure.

**New use case:**
- `CreateCustomerReceiptDraftUseCase` — creates the `CUSTOMER_RECEIPT` invoice draft (all quote line items, customer-side tax figures from the existing tax breakdown, no self-billing authorization required) with the same idempotency contract as the professional draft use case.

**Numbering-race fix** (applies to both invoices and credit notes — the same defect class, so fixed in both per the "root cause, not just the named symptom" instruction):
- Extracted `allocateNextDocumentSequence(client, series, year)` as a shared helper operating over a `RawQueryClient` structural type.
- `PrismaInvoiceRepository.issue()` and `PrismaCreditNoteRepository.issue()` now perform the number allocation and the CAS status/number write inside the same `prisma.$transaction`. If the CAS write's `fromStatuses` condition fails to match (a lost race), a private sentinel error forces the whole transaction — including the counter increment — to roll back, so no number is ever burned without a document attached to it.
- `IssueInvoiceData`/`IssueCreditNoteData` changed from taking a pre-computed `invoiceNumber`/`creditNoteNumber` + `documentHash` to taking a `buildDocumentHash(number)` callback, since the number is now only known inside the transaction.

**Customer-facing invoice type:**
- `InvoiceType` enum gained `CUSTOMER_RECEIPT` (schema + domain type).
- `Invoice.selfBillingAuthorizationId` made nullable (customer receipts have no self-billing authorization).
- Per-job uniqueness constraint widened from "one active invoice per job" to "one active invoice per (job, type)" so a job can have both a professional invoice and a customer receipt simultaneously without violating uniqueness.
- New repository method `findByJobIdAndType(jobId, type)`; `findByJobId` now delegates to it scoped to `PROFESSIONAL_SELF_BILLED` for full backward compatibility with existing callers.

**Issuer-configuration guard:**
- `IssuerTaxIdNotConfiguredError` (new domain error) is thrown by `IssueInvoiceUseCase` if the issuer tax ID is still the placeholder value (`isPlaceholderIssuerTaxId`), preventing a real invoice from ever being issued with unconfigured issuer data.
- `MAESTROYA_ISSUER_LEGAL_NAME`/`MAESTROYA_ISSUER_TAX_ID` now read from environment variables with the previous hardcoded values kept as fallback defaults, so existing behavior is unchanged unless production configuration is supplied.

No changes were made to: the 10% commission calculation, the VAT/IRPF calculation logic itself, the money-rounding utility, the Stripe/payment lifecycle, or any repository's underlying raw-SQL access pattern beyond what the numbering fix required.

## 5. Invoice Lifecycle

Unchanged state machine (`DRAFT → PENDING_ACCEPTANCE → ACCEPTED → ISSUED`, with `CANCELLED` as a terminal side-branch) for `PROFESSIONAL_SELF_BILLED` invoices, now actually driven end-to-end by `PaymentReleaseApproved`. `CUSTOMER_RECEIPT` invoices use a simpler `DRAFT → ISSUED` path (`issuableFromStatus` returns `DRAFT` for this type, `ACCEPTED` for the self-billed type) since there is no self-billing acceptance step for a document addressed to the customer. Both paths converge on the same `issue()` implementation and the same transactional numbering fix.

## 6. Credit Note Lifecycle

Unchanged domain model and `calculateTaxReversal` reuse; the activation gap was purely "nothing ever called `CreateCreditNoteUseCase` on a refund." `CreateCreditNoteOnPaymentRefundedSubscriber` now does so, deriving amounts from the existing authoritative tax-breakdown/reversal calculation and clamping against `computeRemainingCreditableAmount` so a sequence of partial refunds can never over-credit an invoice.

## 7. Financial Consistency

No historical figures are ever recalculated. The subscriber reads the tax breakdown that was computed at the time of the original job/payment (Module 78's single calculation path) and reuses it; it does not re-derive VAT/commission from current rates or current job state. `roundToCents()` remains the only rounding implementation touched.

## 8. Idempotency

- Invoice/customer-receipt creation: `invoices.findByJobIdAndType(jobId, type)` is checked before any draft is created; a duplicate `PaymentReleaseApproved` delivery resumes from the current document state instead of creating a second document or re-throwing unexpectedly.
- Credit note creation: keyed by `idempotencyKey: "credit-note:financial-adjustment:${financialAdjustmentId}"`, reusing the existing `CreditNote.idempotencyKey` unique constraint — a duplicate `PaymentRefunded` delivery for the same financial adjustment produces exactly one credit note.
- Numbering: the transactional fix (Section 4) makes numbering itself idempotent under lost races — a failed issue attempt never consumes a number.

Verified by dedicated tests: duplicate-event idempotency (invoice side and credit-note side) and partial-failure-resume (an invoice stuck mid-lifecycle from a prior partial failure converges to `ISSUED` on the next delivery).

## 9. VAT/IVA

No new VAT/IVA calculation was introduced. Both the professional invoice and the customer receipt are populated exclusively from the existing `calculateMaestroYaTaxBreakdown` output (`professionalNetBase/VatRateBps/VatAmount/InvoiceGrossTotal` for the professional side, `customerTaxableBase/VatRateBps/VatAmount/GrossTotal` for the customer side). The credit note reuses `calculateTaxReversal` unchanged, scaled proportionally when a refund is partial.

## 10. Database

Migration `20260908000000_add_invoice_customer_receipt_and_numbering_fix`:
- `ALTER TYPE "InvoiceType" ADD VALUE 'CUSTOMER_RECEIPT'`
- `ALTER TABLE "invoices" ALTER COLUMN "selfBillingAuthorizationId" DROP NOT NULL`
- Drops `invoices_active_job_unique`, replaces it with `invoices_active_job_type_unique` on `(jobId, type) WHERE status <> 'CANCELLED'`

No other schema changes. The migration was not applied against a live database in this environment (the pre-existing Prisma query-engine binary mismatch — see Section 12 — prevents any live-DB operation here); `prisma/schema.prisma` was kept in sync with the migration by hand and both were reviewed for consistency. Recommend running `npx prisma migrate deploy` (or `dev`) in an environment with a matching query-engine binary before relying on this in a real database.

## 11. Tests

- New: `tests/unit/core/application/use-cases/invoicing/module-85-activation.test.ts` — 11 tests covering: numbering-race gap prevention, issuer-tax-id guard, customer-receipt creation + coexistence with a professional invoice, fallback recipient name, full auto-activation pipeline (draft→submit→accept→issue) for both document types with no manual trigger, no-self-billing-authorization case (customer receipt still issues, professional invoice silently skipped), duplicate-event idempotency, partial-failure-resume, credit-note auto-creation from a refund with correct linkage and reversed VAT, duplicate-refund-event idempotency, and the no-issued-invoice no-op case.
- Updated: `fakes.ts` (`FakeInvoiceRepository`/`FakeCreditNoteRepository` now faithfully model the transactional numbering behavior — a failed `fromStatuses` match consumes no number — plus new `FakeCustomerProfileRepository`/`FakeUserRepository`); `invoicing-use-cases.test.ts` and `execute-professional-payout.use-case.test.ts` updated for the `IssueInvoiceData`/`IssueCreditNoteData` interface change (no test was weakened — only call-site shapes were updated to match the new, stricter transactional contract).
- Total: 560 test files / 4722 tests, run in 5 sequential batches (see Section 12) due to the environment's per-command execution cap. **All 4722 tests passed. Zero failures.**
- Unrelated environment noise: a pre-existing `PrismaClientInitializationError` ("could not locate the Query Engine for runtime 'linux-arm64-openssl-3.0.x' ... generated for 'darwin-arm64'") surfaces as an async `Unhandled Rejection` in a number of test files across batches 2–5, including files this module never touched (e.g. `tests/unit/app/admin-layout-authorization.test.ts`, `tests/unit/prisma_probe.test.ts`). This is a binary-target mismatch between the Prisma Client generated on the user's Mac (darwin-arm64) and this session's Linux ARM64 execution environment — pre-existing, unrelated to Module 85, and does not cause any test to fail (every affected file's own assertions still pass; vitest counts the rejection as a separate `Error`, not a test failure).

## 12. Validation

- `npm run typecheck` — **PASS**, zero errors. (One call site required updating for the `IssueInvoiceData` shape change — `execute-professional-payout.use-case.test.ts` — fixed; this was the only typecheck error in the entire codebase after the interface changes.)
- `npm run lint` — **PASS**, zero warnings/errors. (Two lint issues found and fixed in the new test file: unused imports, and a copy-paste bug where `makePayment`'s `...overrides` spread had been dropped, silently discarding override arguments — fixed by restoring the spread.)
- `git diff --check` — **PASS**, exit code 0, no whitespace or conflict-marker errors.
- Full test suite — **PASS**, 560 files / 4722 tests, 0 failures, run in 5 batches (batch boundaries were purely to stay under this environment's ~180s per-command cap, not related to test dependencies):
  1. invoicing/refunds/financial/reconciliation/payments/dispute-resolution/domain — 143 files / 1349 tests
  2. remaining `tests/unit/core/application` — 114 files / 761 tests
  3. `tests/unit/core/infrastructure` — 146 files / 1090 tests
  4. `tests/unit/app` + `tests/unit/presentation` + `tests/unit/prisma` + `tests/unit/regression` + `tests/unit/shared` — 94 files / 627 tests
  5. `tests/integration` — 63 files / 895 tests
- `npm run build` — **NOT COMPLETED — environment/tool limitation, not a build failure.** This environment enforces a hard ~180-second cap per shell command, and background/detached processes (tested explicitly with `setsid`/`disown`/`nohup`, including a control experiment running only `sleep 300`) do not survive past the end of the command that launched them — the process is gone and its log file is empty by the very next command, regardless of technique. Two direct foreground attempts (175s and 60s, the second under `strace -e trace=network`) were made; `strace` confirmed the build was actively forking real webpack/SWC worker processes and doing genuine work (not hung on a stalled network call or an infinite loop), it simply did not reach a state (success or failure) within the available window for an application of this size. No git operations were run at any point.

Given `typecheck` passes cleanly (the same compiler, over the same changed files, that a build would also run) and the full test suite is green with zero regressions, there is strong circumstantial evidence the build would succeed, but I cannot respond as if I obtained an actual PASS. Recommend the user run `npm run build` once in a normal shell (or CI) with no artificial time cap to get a definitive result before deploying.

## 13. Out-of-Scope Findings for Modules 86–90

- No route or admin UI currently displays `CUSTOMER_RECEIPT` invoices to customers, nor a professional-facing UI for reviewing/accepting a self-billed invoice beyond the existing `AcceptInvoiceUseCase` API surface — likely Module 86/87 territory (customer/professional invoicing UI).
- No automated retry/backoff mechanism exists for a subscriber failure beyond `FailureReporter` — a permanently-failing activation (e.g. a persistent downstream error) currently requires manual intervention/replay of the triggering event; a dead-letter or scheduled-retry mechanism for domain-event subscribers in general (not just invoicing) looks like a cross-cutting infrastructure concern for a future module.
- PDF/document rendering and delivery (email, download) for invoices and credit notes was out of scope here and was not audited.
- The Prisma Client binary-target mismatch (darwin-arm64 vs. this session's linux-arm64) is a real environment configuration issue worth fixing at the project level (e.g. adding `binaryTargets` in `schema.prisma` for both platforms) so CI/cloud environments can run live-DB-dependent checks; flagged here since it blocked independent verification of the migration SQL against a real database, but it predates this module and is unrelated to it.

## 14. Final Verdict

Module 85's stated objective — connecting the existing, previously-inert Module 79 invoicing/credit-note engine into the real payment lifecycle — is implemented, using only the existing architecture, domain services, and calculation paths, with no parallel engine introduced. All new and existing tests pass (4722/4722), `typecheck` and `lint` are clean, and `git diff --check` is clean. The only unresolved validation step is `npm run build`, which could not be run to completion inside this environment's command-timeout constraints; this is reported honestly as an environment/tool limitation rather than a build failure, per the explicit instruction to distinguish the two. No git add/commit/push/reset/checkout commands were run at any point in this session.
