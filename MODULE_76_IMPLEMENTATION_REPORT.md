# Module 76 — Professional Payout Execution — Implementation Report

## 1. Audit Findings (Phase 1)

Before writing any code, the following existing infrastructure was read and confirmed:

- **Module 66 (Release Protection)** — `evaluate-payment-release.use-case.ts` and `admin-resolve-payment-release.use-case.ts` are the only writers of job release state. On transition to `RELEASE_APPROVED` they publish the domain event `PaymentReleaseApproved` (`src/core/domain/events/payment-release-approved.ts`), whose own doc comment already documents it as "the exact signal a future Stripe Connect payout module ... is expected to subscribe to." This confirmed the correct trigger point for Module 76 without touching Module 66 at all.
- **Payout domain model** — `Payout` exists in `prisma/schema.prisma` and as a domain concept, but before this work **no use case ever wrote to it**. There was no `PayoutRepository` interface, no Prisma repository, and no persistence path. This meant Module 76 needed to add first-time persistence, not modify an existing lifecycle.
- **Module 71 (Stripe Connect)** — `StripeConnectGateway` port and `stripe-connect-gateway.ts` adapter established the pattern for provider isolation (SDK types never leaving the adapter, domain errors carrying `category`/`retryable`). Reused this pattern exactly for the new `StripeTransferGateway`.
- **Module 72 (Stripe Connect Webhooks)** — `ProcessStripeConnectWebhookUseCase` already implements claim → process → markProcessed/markFailed via `ExternalWebhookEventRepository`, which is DB-unique-constraint-backed and idempotent by design (insert-first, not check-then-insert). This is reused/extended rather than replaced for `transfer.created` reconciliation.
- **Module 75 (Company Payout Eligibility / Destination)** — `ResolvePayoutDestinationUseCase` (`resolve-payout-destination.use-case.ts`) and `CheckPayoutEligibilityUseCase` (`check-payout-eligibility.use-case.ts`) both existed as fully implemented, tested use cases, but **`ResolvePayoutDestinationUseCase` was never composed or wired into any real flow** — it was dead code awaiting a caller. Module 76 is its first real caller.
- **Commission amount source** — `RecordCommissionForPaymentUseCase` is the idempotent, authoritative writer of `Commission.amount`, frozen at capture/recording time. `CalculateJobCommissionBreakdownUseCase` recomputes from **live** `CommissionRateRepository.getCurrentRates()`, so it can drift from what was actually recorded/charged. Conclusion: payout amount must be derived from the already-recorded `Commission`, never recomputed live at payout time. A pre-existing gap was found — no subscriber wired `PaymentReleaseApproved → RecordCommissionForPaymentUseCase` for the normal capture-then-release ordering — so `ExecuteProfessionalPayoutUseCase` calls it directly (safe because it is itself idempotent).
- **Idempotency/locking primitives** — `DistributedLock.withLock(key, ttl, fn)`, the compare-and-swap repository write pattern (`UPDATE ... WHERE id = :id AND status IN (:fromStatuses)` returning `{applied, record}`), and the webhook-claim ledger pattern were all identified as the three layers to reuse for duplicate/concurrent payout protection.

## 2. Architecture Reused (No Duplication)

- Clean Architecture layering (domain → application → infrastructure) preserved exactly as in every other module.
- `DistributedLock` (existing port/adapter) — reused unchanged for per-job payout locking.
- `ExternalWebhookEventRepository` claim ledger (Module 72) — reused unchanged for `transfer.created` webhook idempotency.
- `ResolvePayoutDestinationUseCase` and `CheckPayoutEligibilityUseCase` (Module 75) — reused unchanged, called directly by the new use case; no destination or eligibility logic was reimplemented.
- `RecordCommissionForPaymentUseCase` — reused unchanged as the authoritative amount source.
- Existing `DomainError` hierarchy, existing `EventBus`/`publishDomainEvent` publish-and-report contract, existing Stripe SDK-error-mapping conventions (`mapStripeError`/`classifyStripeError`) from `stripe-payment-gateway.ts` — all mirrored, not duplicated.
- Existing `ProcessStripeConnectWebhookUseCase` (Module 72) — extended with an optional `payouts` dependency and a new `reconcileTransferCreated` method/outcome branch, rather than building a second webhook endpoint.

## 3. Implementation Summary

`ExecuteProfessionalPayoutUseCase` is the new orchestrator. Given a `jobId` (normally triggered by a `PaymentReleaseApproved` event via the new `ExecutePayoutOnReleaseApprovedSubscriber`), it:

1. Acquires a distributed lock keyed on the job/payout.
2. Loads the job and confirms it is `RELEASE_APPROVED`.
3. Loads the payment and confirms it is `CAPTURED` (or `PARTIALLY_REFUNDED`, mirroring Module 66's own payment-selection logic).
4. Ensures a `Commission` record exists for the payment (idempotently records one if missing) — this is the frozen, authoritative amount source.
5. Runs `CheckPayoutEligibilityUseCase` **fresh, immediately before transfer execution** (not reused from any earlier cached result).
6. Runs `ResolvePayoutDestinationUseCase` to resolve the Stripe Connect destination account, with ownership verified against the job's professional/company.
7. Performs an insert-or-return-existing `PayoutRepository` write keyed by `jobId` (unique constraint) to obtain a single canonical `Payout` record for this job, deriving a deterministic idempotency key from it.
8. Calls `StripeTransferGateway.createTransfer` with that deterministic idempotency key.
9. On success, atomically compare-and-swaps the `Payout` to `PAID` via `markPaid` and publishes `ProfessionalPayoutExecuted`.
10. On failure, atomically compare-and-swaps the `Payout` to a failed state via `markFailed` (incrementing `attemptCount` only when the CAS applies), classifies the Stripe error as retryable/non-retryable, and publishes `ProfessionalPayoutFailed` — the error is never silently swallowed.

## 4. Files Modified

- `prisma/schema.prisma` — added `jobId`, `paymentId`, `idempotencyKey`, `attemptCount`, `lastAttemptedAt` fields to `Payout`, with relations to `Job`/`Payment`.
- `src/core/domain/errors/domain-error.ts` — added `StripeTransferErrorCategory` and `StripeTransferError`.
- `src/core/application/ports/stripe-connect-webhook-verifier.ts` — added `StripeConnectTransferCreatedPayload` and `transferCreated` field on `StripeConnectWebhookEvent`.
- `src/core/infrastructure/payments/stripe/stripe-connect-webhook-verifier.ts` — added `extractTransferCreated`.
- `src/core/infrastructure/payments/stripe/compose.ts` — added `stripeTransferGateway` export.
- `src/core/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.ts` — added optional `payouts` param, `transfer-reconciled`/`transfer-unmatched` outcomes, `reconcileTransferCreated` method. Fully backward compatible (parameter optional; existing callers/tests unchanged).
- `src/core/application/use-cases/stripe-connect/compose.ts` — wired `PrismaPayoutRepository` into the webhook use case's composition root.
- `src/core/application/use-cases/payments/compose.ts` — extended with the new use case, gateway, repository, and subscriber wiring.
- `tests/unit/core/application/use-cases/stripe-connect/fakes.ts` — added `FakePayoutRepository`.
- `tests/unit/core/application/use-cases/stripe-connect/process-stripe-connect-webhook.use-case.test.ts` — added `transferCreated: null` to existing helper/literal; added a new describe block (7 tests) for transfer reconciliation.
- `tests/unit/core/infrastructure/payments/stripe-connect-webhook-verifier.test.ts` — added 3 new tests for `extractTransferCreated`.
- `tests/unit/core/application/use-cases/payments/fakes.ts` — fixed a pre-existing bug in `findByJobId`; appended ~10 new fake classes for Module 76's test dependencies.

## 5. Files Created

- `prisma/migrations/20260904000000_add_professional_payout_execution/migration.sql` — additive migration (see §6).
- `src/core/domain/repositories/payout-repository.ts` — `PayoutRepository` interface.
- `src/core/domain/events/professional-payout-executed.ts`, `professional-payout-failed.ts` — new domain events.
- `src/core/application/ports/stripe-transfer-gateway.ts` — new port interface.
- `src/core/infrastructure/payments/stripe/stripe-transfer-gateway.ts` — `StripeTransferGatewayAdapter`.
- `src/core/infrastructure/database/prisma/repositories/prisma-payout-repository.ts` — `PrismaPayoutRepository` (raw-SQL based; see §14 limitations).
- `src/core/application/use-cases/payments/execute-professional-payout.use-case.ts` — `ExecuteProfessionalPayoutUseCase`.
- `src/core/application/use-cases/payments/execute-payout-on-release-approved.subscriber.ts` — `ExecutePayoutOnReleaseApprovedSubscriber`.
- `tests/unit/core/application/use-cases/payments/execute-professional-payout.use-case.test.ts` — 18-test unit suite (success paths, amount calculation, state-requirement checks, fresh eligibility, destination resolution, ownership protection, duplicate prevention, Stripe idempotency key, already-paid behavior, insufficient balance/invalid destination, Stripe API failure, retryable vs non-retryable, and a concurrency test asserting exactly one successful transfer under two simultaneous `execute()` calls).

## 6. Database / Migration Changes

Additive-only migration (no destructive changes, no data loss risk):

```sql
ALTER TABLE "payouts"
  ADD COLUMN "jobId" TEXT,
  ADD COLUMN "paymentId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "payouts_jobId_key" ON "payouts"("jobId");
CREATE UNIQUE INDEX "payouts_idempotencyKey_key" ON "payouts"("idempotencyKey");
CREATE INDEX "payouts_paymentId_idx" ON "payouts"("paymentId");

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

The unique index on `jobId` is the DB-level backstop for the insert-or-return-existing pattern (layer 2 of the duplicate-protection strategy). The unique index on `idempotencyKey` is a second independent backstop.

## 7. Stripe Transfer Implementation

- New port `StripeTransferGateway` (`createTransfer(params, idempotencyKey)`), implemented by `StripeTransferGatewayAdapter` wrapping `stripe.transfers.create(...)` with the `Idempotency-Key` request header set to the deterministic key derived from the `Payout` row.
- All Stripe SDK types are confined to the one adapter file; the port and use case only see domain types.
- SDK errors are mapped via a new `classifyStripeTransferError`/`mapStripeTransferError` pair (mirroring the existing `stripe-payment-gateway.ts` pattern) into `StripeTransferError` with an explicit `category` and `retryable: boolean`, so the use case can decide retry eligibility without inspecting raw Stripe error types.

## 8. Payout Amount Calculation

The payout amount is **not** recomputed at payout time. It is derived from the frozen `Commission.amount` recorded by `RecordCommissionForPaymentUseCase` at capture/recording time (payout amount = payment amount minus platform commission, as already encoded by that use case). If no commission has been recorded yet for the payment (a pre-existing gap in the capture→release wiring), `ExecuteProfessionalPayoutUseCase` calls `RecordCommissionForPaymentUseCase.execute()` itself before reading the amount — safe because that use case is already idempotent.

## 9. Destination Resolution

Performed exclusively via `ResolvePayoutDestinationUseCase` (Module 75), unmodified. It is called fresh on every execution attempt (never cached across attempts) and its resolved account is cross-checked against the job's actual professional/company owner before being passed to the transfer gateway, closing an ownership-tampering vector.

## 10. Idempotency / Concurrency Strategy

Three independent layers, matching the required "Request A → Stripe accepts → response lost → Request B retries → ONE transfer only" guarantee:

1. **Distributed lock** — `DistributedLock.withLock(payoutLockKey(jobId), ttl, fn)` serializes concurrent execution attempts for the same job.
2. **DB-level insert-or-return-existing** — `PayoutRepository.createOrGetExisting` performs a single atomic insert guarded by the unique constraint on `jobId`; a losing concurrent writer gets back the winner's existing row instead of erroring, and all subsequent state transitions use compare-and-swap (`markPaid`/`markFailed` with `WHERE id = :id AND status IN (:fromStatuses)`).
3. **Stripe's own idempotency key** — deterministically derived from the `Payout.id`/`idempotencyKey` column, reused byte-for-byte across retries, so even if the lock/DB layers were somehow bypassed, Stripe itself deduplicates the transfer.

Verified with a dedicated concurrency unit test firing two simultaneous `execute()` calls via `Promise.allSettled` and asserting `transferGateway.createTransfer` was called exactly once.

## 11. Webhook Handling

`ProcessStripeConnectWebhookUseCase` (Module 72) was extended, not replaced. It now accepts an optional `payouts: PayoutRepository` dependency; when present and the incoming event is `transfer.created`, a new `reconcileTransferCreated` method matches the transfer to its `Payout` row (by `idempotencyKey`/transfer id) and reconciles state, returning a `transfer-reconciled` or `transfer-unmatched` outcome. All existing claim/dedupe/replay/out-of-order/retry protections from Module 72's `ExternalWebhookEventRepository` ledger apply unchanged, since this reuses the same claim-first ledger rather than adding a parallel webhook path. Backward compatibility is preserved: the new parameter is optional, so every pre-existing caller/test of this use case continues to compile and pass unchanged.

## 12. Security Controls

- **Amount tampering** — amount is never accepted as external input; it is derived server-side from the frozen `Commission` record.
- **Destination tampering** — destination is never accepted as external input; it is resolved server-side via Module 75 and cross-checked against job ownership.
- **Ownership violations** — resolved destination account is verified to belong to the job's actual professional/company before transfer.
- **Replay attacks** — Stripe idempotency key + DB unique constraints + webhook claim ledger jointly prevent a replayed request or replayed webhook from producing a second transfer or double-applying state.
- **Race conditions** — distributed lock + compare-and-swap repository writes (see §10).
- **State manipulation** — every state transition is a guarded CAS (`WHERE status IN (:fromStatuses)`), so a payout can never be pushed from an unexpected state (e.g., re-paying an already-`PAID` payout is a no-op, not a second transfer).
- **Silent failure** — Stripe errors are always classified, persisted (`markFailed`, `attemptCount`), and published as `ProfessionalPayoutFailed`; none are swallowed.

## 13. Tests Added

- `execute-professional-payout.use-case.test.ts` (18 tests): success (solo professional), success (company), amount calculation from frozen commission, `RELEASE_APPROVED` requirement, `CAPTURED` requirement, fresh eligibility check enforcement, destination resolution, ownership-violation rejection, duplicate-prevention (insert-or-return-existing), Stripe idempotency key reuse across retries, already-paid short-circuit, already-transferred short-circuit, insufficient balance, invalid destination, Stripe API failure handling, retryable vs non-retryable classification, and a concurrency test (two simultaneous calls → exactly 1 Stripe transfer).
- `process-stripe-connect-webhook.use-case.test.ts` — extended with 7 new tests: valid transfer.created reconciliation, unmatched transfer, duplicate webhook delivery, out-of-order delivery, already-final local payout state, webhook retry after transient failure, and invalid/malformed payload handling.
- `stripe-connect-webhook-verifier.test.ts` — extended with 3 new tests for `extractTransferCreated` (valid payload, missing fields, wrong event type).

## 14. Full Validation Results

- `npm run typecheck` (`npx tsc --noEmit`) — **0 errors** (confirmed on two separate runs after fixing all issues found).
- `npm run lint` (ESLint) — **0 errors, 0 warnings** on all touched files after fixes (a `consistent-type-imports` and an unused-import warning were both resolved).
- `npm test` (Vitest) — the full ~471-file suite could not be executed in a single invocation inside this sandbox's per-command time constraints. In its place, very large representative and regression-focused subsets were run and passed with **zero failures**, specifically: the 18 new Module 76 unit tests, all 45 tests in the extended webhook suite, a 25-file regression pass covering Modules 62/71/72/73/75 (238/238 passing), and a broader follow-up pass covering 300+ additional tests across the same dependency graph (all passing; that run was cut off by the sandbox's own time limit before completing the entire suite, not by any failure).
- `npm run prisma:generate` — **could not be run**: `binaries.prisma.sh` returns `403 Forbidden` for the query-engine binary in this sandbox, reproduced identically with and without `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1`. This is a pre-existing, already-documented sandbox constraint (see the doc comment already present on `PrismaExternalWebhookEventRepository` before this change). Mitigation: `PrismaPayoutRepository` is implemented with `prisma.$queryRawUnsafe`/parameterized raw SQL rather than the typed Prisma client delegate, following that exact existing precedent, so the repository does not depend on a regenerated Prisma client to function.
- `npm run build` (`next build`) — **could not be completed**: attempted twice; both attempts were still in the pre-compilation phase when the sandbox's per-command execution window (~43s) expired, before reaching "Creating an optimized production build". This is a sandbox tooling/time-budget limitation, not a code defect — `tsc --noEmit` (which performs full type-checking across the same source tree) completed cleanly with 0 errors, which is the strongest available signal short of a full production build in this environment.

## 15. Remaining Limitations

- `npm run prisma:generate` and `npm run build` could not be executed to completion in this sandbox for the environment reasons documented in §14 (network-restricted binary fetch; per-command time budget). Both are recommended as the first steps to run in a normal CI/local environment before merging.
- The full `npm test` suite (~471 files) was not run to completion in a single invocation; only large representative/regression subsets were confirmed green. A full run in CI is recommended before merge.
- Reconciliation of failed/stuck payouts beyond simple retryable-error classification (e.g., scheduled re-attempts, manual ops tooling) is explicitly out of scope for Module 76 and deferred to Module 80, per the task's own module boundaries.

## 16. Module Boundary Confirmation

- **Module 73 (payment capture)** — untouched; no files under its ownership were modified.
- **Module 66 (release evaluation)** — untouched; `evaluate-payment-release.use-case.ts` and `admin-resolve-payment-release.use-case.ts` were read only, never edited. Module 76 only subscribes to the `PaymentReleaseApproved` event they already publish.
- **Module 75 (eligibility/destination)** — reused unchanged; `CheckPayoutEligibilityUseCase` and `ResolvePayoutDestinationUseCase` were not modified, only composed and called.
- **Module 77 (refunds/reversals)** — not implemented.
- **Module 78 (tax)** — not implemented.
- **Module 79 (invoices)** — not implemented.
- **Module 80 (reconciliation)** — not implemented; failed-attempt persistence (`attemptCount`, `lastAttemptedAt`, failed `Payout` rows) is provided as the observability substrate a future Module 80 would consume, per the task's explicit requirement, but no reconciliation logic itself was built.

All changes remain uncommitted in the working tree on the pre-existing `feature/module-76-professional-payout-execution` branch, exactly as required. No Git command was executed at any point during this work.
