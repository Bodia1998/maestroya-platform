-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260821000000_add_trust_integrity_system/
-- migration.sql and prisma/migrations/20260820000000_add_materials_procurement_workflow/
-- migration.sql for the same confirmed precedent). Mirrors what that
-- command would produce for the schema changes below. Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 66 — Job Completion & Payment Release Protection.
--
-- Purely additive: two new enums, five new enum values on three existing
-- enums, one new table. No existing table is renamed, dropped, or has a
-- column altered/removed. Job.status, the 10% commission model, the
-- Dispute architecture, and the Trust & Integrity system are all untouched.

-- ============================================================================
-- Enums
-- ============================================================================

-- AlterEnum
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as other
-- statements that use the new value on some Postgres versions; `prisma
-- migrate` sequences this automatically. If applying by hand, run this
-- statement (and the NotificationType ones below) in their own transaction
-- ahead of anything that references the new values.
ALTER TYPE "TrustRiskEventReason" ADD VALUE 'JOB_COMPLETION_CONFIRMATION_TIMEOUT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'JOB_COMPLETION_CONFIRMATION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_COMPLETION_CONFIRMATION_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_COMPLETION_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'JOB_COMPLETION_CONFIRMATION_TIMED_OUT';

-- CreateEnum
-- See JobCompletionConfirmationStatus's doc comment in schema.prisma for
-- the full state-machine description. WAITING_FOR_CUSTOMER is the only
-- non-terminal value; CONFIRMED/DISPUTED/TIMED_OUT_UNDER_REVIEW are all
-- terminal (see job-completion-confirmation-state.ts).
CREATE TYPE "JobCompletionConfirmationStatus" AS ENUM (
  'WAITING_FOR_CUSTOMER',
  'CONFIRMED',
  'DISPUTED',
  'TIMED_OUT_UNDER_REVIEW'
);

-- CreateEnum
-- The single authoritative outcome of PaymentReleaseDecisionService — see
-- payment-release-decision.ts's own doc comment for the full rule set.
CREATE TYPE "PaymentReleaseStatus" AS ENUM (
  'PENDING',
  'RELEASE_APPROVED',
  'RELEASE_HELD',
  'RELEASE_DENIED'
);

-- ============================================================================
-- job_completion_confirmations
-- ============================================================================

-- CreateTable
-- One row per Job (jobId is unique), created exactly once, atomically
-- alongside the Job.status -> COMPLETED write inside the same Prisma
-- transaction (see PrismaJobRepository.complete). Tracks the
-- customer-confirmation step and, separately, the persisted output of the
-- single authoritative payment-release decision (releaseStatus /
-- releaseReason / releaseDecidedAt), written only by
-- EvaluatePaymentReleaseUseCase.
CREATE TABLE "job_completion_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobId" UUID NOT NULL,
    "status" "JobCompletionConfirmationStatus" NOT NULL DEFAULT 'WAITING_FOR_CUSTOMER',
    "professionalCompletedAt" TIMESTAMP(3) NOT NULL,
    "confirmationDeadlineAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" UUID,
    "disputeId" UUID,
    "manualReviewCaseId" UUID,
    "reminderSentAt" TIMESTAMP(3),
    "releaseStatus" "PaymentReleaseStatus" NOT NULL DEFAULT 'PENDING',
    "releaseReason" TEXT NOT NULL,
    "releaseDecidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_completion_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_completion_confirmations_jobId_key" ON "job_completion_confirmations"("jobId");
CREATE INDEX "job_completion_confirmations_status_idx" ON "job_completion_confirmations"("status");
CREATE INDEX "job_completion_confirmations_confirmationDeadlineAt_idx" ON "job_completion_confirmations"("confirmationDeadlineAt");
CREATE INDEX "job_completion_confirmations_releaseStatus_idx" ON "job_completion_confirmations"("releaseStatus");
CREATE INDEX "job_completion_confirmations_disputeId_idx" ON "job_completion_confirmations"("disputeId");
CREATE INDEX "job_completion_confirmations_manualReviewCaseId_idx" ON "job_completion_confirmations"("manualReviewCaseId");

-- AddForeignKey
-- Restrict: a Job with a completion-confirmation row must never be
-- deletable out from under it — mirrors the Restrict convention already
-- used for other Job-linked financial/audit rows in this schema.
ALTER TABLE "job_completion_confirmations" ADD CONSTRAINT "job_completion_confirmations_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_completion_confirmations" ADD CONSTRAINT "job_completion_confirmations_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_completion_confirmations" ADD CONSTRAINT "job_completion_confirmations_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull: unlike Dispute (Restrict), a linked ManualReviewCase may in
-- principle be pruned independently without invalidating the completion
-- record's own history — mirrors ManualReviewCase's own SetNull
-- convention for its optional foreign keys (see
-- trust_manual_review_cases_assignedAdminId_fkey /
-- trust_manual_review_cases_resolvedByUserId_fkey in
-- 20260821000000_add_trust_integrity_system/migration.sql).
ALTER TABLE "job_completion_confirmations" ADD CONSTRAINT "job_completion_confirmations_manualReviewCaseId_fkey" FOREIGN KEY ("manualReviewCaseId") REFERENCES "trust_manual_review_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
