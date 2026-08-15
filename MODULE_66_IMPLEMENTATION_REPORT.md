# Module 66 — Job Completion & Payment Release Protection

Implementation report. Branch: `feature/job-completion-payment-release-protection`.

## 1. Implementation summary

A customer-confirmation step now sits between "professional marked the Job COMPLETED" and "payment may be released." A professional completing a job can never by itself trigger payout. Release requires: job COMPLETED, a `JobCompletionConfirmation` row in status CONFIRMED (or an admin-cleared DISPUTED/TIMED_OUT_UNDER_REVIEW), a captured payment, no open dispute on the job, payout (KYC) eligibility, and no active Trust & Integrity payout hold — evaluated by one authoritative pure function, `decidePaymentReleaseStatus`. Customer silence past the 72-hour window is never treated as confirmation: it opens a `ManualReviewCase` and holds release.

## 2. Architecture / DB changes

Additive only. Two new enums (`JobCompletionConfirmationStatus`, `PaymentReleaseStatus`), one new table (`job_completion_confirmations`, one row per Job, created atomically inside the same Prisma transaction as `Job.status → COMPLETED`), five new enum values on existing enums (`TrustRiskEventReason`, `NotificationType` ×4), two new `AdminAuditAction` values. No existing table/column altered or removed. The 10% commission model, Job/Dispute/Trust & Integrity/KYC architectures are untouched — this module only reads from them.

## 3. New use cases

- `EvaluatePaymentReleaseUseCase` — the single place that writes `releaseStatus`.
- `ConfirmJobCompletionUseCase` — customer confirms; idempotent.
- `DisputeJobCompletionUseCase` — customer rejects; delegates to the existing `CreateDisputeUseCase`.
- `AdminResolvePaymentReleaseUseCase` — admin APPROVE/HOLD on DISPUTED/TIMED_OUT_UNDER_REVIEW confirmations only, gated on the underlying Dispute/ManualReviewCase actually being closed/resolved. Now writes an audit-log entry (`PAYMENT_RELEASE_ADMIN_RESOLVED`) on every decision.
- `ProcessJobCompletionConfirmationsUseCase` — reminder (36h) + timeout (72h) batch, wired into the existing `RunWorkflowExpirationsUseCase` cron.

## 4. New domain events

`ProfessionalCompletedJob`, `CustomerConfirmedCompletion`, `CustomerConfirmationTimedOut`, `PaymentReleaseApproved`, `PaymentReleaseHeld`.

## 5. Payment release state machine

`JobCompletionConfirmation.status`: WAITING_FOR_CUSTOMER → {CONFIRMED, DISPUTED, TIMED_OUT_UNDER_REVIEW} (all three terminal, no path back to WAITING_FOR_CUSTOMER).
`releaseStatus` (re-evaluated, not a one-way transition): PENDING → RELEASE_APPROVED | RELEASE_HELD | RELEASE_DENIED, per `decidePaymentReleaseStatus`'s pure rule order (cancelled/no-payment/failed-payment → DENIED; anything incomplete → HELD; every condition met → APPROVED).

## 6. Security controls

- `resolveJobActor` (existing IDOR-safe pattern) — customer-only actions authorized server-side from session, never client-supplied IDs.
- Admin actions gated by `requireRole(ADMIN, SUPER_ADMIN, SUPPORT)`.
- Every admin release decision now recorded on the append-only `AdminAuditLogRepository` trail.
- Zod DTOs validate all new server-action inputs.

## 7. Concurrency / idempotency controls

Every mutating repository method (`confirm`, `markDisputed`, `markTimedOut`, `updateReleaseDecision`, etc.) is guarded with `expectedStatuses`/`expectedReleaseStatuses` on `updateMany`, translating a 0-row race into `ConflictError`, which callers catch and re-read rather than blindly retry. `JobCompletionConfirmation` creation is inside the same transaction as the Job's COMPLETED write, and a `P2002` unique-constraint hit on `jobId` maps to `ConflictError`. Re-evaluation of the release decision is a pure function of current state, so re-running it (e.g., after a confirm and a dispute race) is naturally idempotent — no event is published unless `releaseStatus` actually changes.

## 8. Tests executed and results

Ran via `vitest run` on the device (`node_modules/.bin/vitest`):

- `payment-release-decision.test.ts` — 20/20 passed.
- `job-completion-confirmation-state.test.ts` — 5/5 passed.
- `job-completion-confirmation-rules.test.ts` — 10/10 passed.
- Broader regression sweep (`tests/unit/core/domain/*`, `tests/unit/core/application/use-cases/{job,dispute,trust-integrity,workflow-expiration}`) — every file that completed within the sandbox's time budget passed (60+ files, 0 failures); the full domain directory run was truncated by the sandbox's 45-second tool timeout partway through, not by any failure — no `✗` appeared in any partial run.

Total new tests: 35, all green.

## 9. Typecheck result

`tsc --noEmit` on the device: **0 real errors**. The only errors present (21) are `Property 'jobCompletionConfirmation' does not exist on PrismaClient` / `Type '"JOB_COMPLETION_..."' is not assignable to type 'NotificationType'/'TrustRiskEventReason'` — all caused by the stale generated Prisma Client, which cannot regenerate in this sandbox (see §10). During this pass I also found and fixed three real gaps the stale-client noise was masking: `RISK_SCORE_DELTA_TABLE` (risk-score-policy.ts) was missing the new `JOB_COMPLETION_CONFIRMATION_TIMEOUT` reason (mirrors the neutral-0 entry already added to `TRUST_SCORE_DELTA_TABLE`); `AdminAuditAction` was missing the two new action strings the new use cases reference; and `AdminResolvePaymentReleaseUseCase` had no audit-log call at all (now added, following the codebase's existing try/catch-and-`console.error` best-effort convention).

## 10. Prisma migration result

`prisma generate`/`validate`/`migrate dev` cannot run in this sandbox: `binaries.prisma.sh` returns 403 from both the device's Linux VM and the cloud container (confirmed via direct `curl`). This is a pre-existing, already-accepted limitation in this exact repo — the two most recent real migrations (`20260820000000_add_materials_procurement_workflow`, `20260821000000_add_trust_integrity_system`) hit the same wall and were hand-authored with the same disclaimer. `prisma/migrations/20260822000000_add_job_completion_payment_release_protection/migration.sql` was hand-authored the same way, matching the Prisma schema field-for-field (2 enums, 5 `ALTER TYPE ... ADD VALUE`, 1 table with 6 indexes and 4 FKs). **You still need to run `npx prisma generate` (or `migrate dev`) locally where `binaries.prisma.sh` is reachable** before the stale-client typecheck errors in §9 disappear and before the migration can be applied for real.

## 11. Remaining risks

- Company-owned jobs (`job.companyProfileId`, no `job.professionalProfileId`) currently default `payoutEligible = false` / no payout-hold check in `EvaluatePaymentReleaseUseCase` and `AdminResolvePaymentReleaseUseCase` — release would sit HELD indefinitely for a fully company-staffed job. This mirrors an existing gap in `CheckPayoutEligibilityUseCase`'s scope and was **not** invented around per your instruction not to add undefined business rules — it needs a product decision on how company payout eligibility should be checked.
- The reminder/timeout batch runs only via `RunWorkflowExpirationsUseCase`'s existing cron cadence; if that cron's schedule ever changes, the 36h/72h windows are still enforced correctly on the next run (idempotent, deadline-based), just possibly later than intended.

## 12. Business decisions still needing confirmation

Company-job payout eligibility scope (§11) is the one open item — everything else in the original spec was either explicitly answered by you (72h window, no-auto-approve-on-timeout) or already decidable from the existing codebase.

## 13. What Module 67 should implement

Dispute resolution outcomes wired to financial effect: `ResolveDisputeUseCase`/`CloseDisputeUseCase` closing a Dispute should be able to drive `AdminResolvePaymentReleaseUseCase`'s APPROVE path automatically (or leave it manual, per your preference) once resolution + refund amount are decided.

## 14. What Module 68 should implement

`CreateFinancialAdjustmentUseCase` — refund / partial refund issuance keyed off a closed Dispute or a resolved manual-review case, plus the actual payout execution against `RELEASE_APPROVED` confirmations (still gateway-agnostic — reads `PaymentReleaseStatus`, never re-derives it).

## 15. Why Stripe Connect is now safe to add after 67-68

`PaymentReleaseStatus`/`decidePaymentReleaseStatus` already fully decide *whether* funds may move, independent of any payment provider. A future `StripePayoutProvider` implementing the existing `PayoutProvider` port would only ever be handed an already-`RELEASE_APPROVED` confirmation to *execute* — it can never itself decide release, so Stripe webhooks/Connect onboarding can be added later without touching this module's business rules.

## 16. What was NOT done (per your explicit constraints)

No Stripe Connect, Stripe webhooks, or VAT/invoice integration. Commission model untouched. No `git add`/`commit`/`push` was run — all 32 changed/new files were delivered to your Mac via the device bridge only.
