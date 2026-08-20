-- Module 76 — Professional Payout Execution
--
-- Adds the minimum columns `ExecuteProfessionalPayoutUseCase` needs on the
-- existing `payouts` table (introduced by an earlier migration, never
-- written to until this module — see `ProfessionalPayoutLedgerRepository`'s
-- own "no writer of Payout exists yet" doc comment) to execute and
-- reconcile a real per-job Stripe Transfer:
--
--   - "jobId": which Job this payout was executed for. UNIQUE — the
--     database-level guarantee that at most one Payout row can ever exist
--     per Job, the core "duplicate payout prevention" invariant Module 76
--     requires. Nullable so a future periodic-payout-batch writer (the
--     existing "periodStart"/"periodEnd" columns already anticipate one)
--     never collides with this constraint.
--   - "paymentId": the captured Payment this payout's amount was derived
--     from (via the already-recorded Commission row) — correlation only.
--   - "idempotencyKey": the deterministic key used both as this row's own
--     duplicate guard and as the Stripe request idempotency key.
--   - "attemptCount"/"lastAttemptedAt": execution-attempt observability for
--     investigation and Module 80 reconciliation.
--
-- Foreign keys to "jobs"/"payments" are added as plain database
-- constraints (ON DELETE RESTRICT, matching every other financial FK in
-- this schema) without corresponding Prisma relation fields on the `Job`/
-- `Payment` models — this migration deliberately touches only the
-- `Payout` model's own Prisma definition, never `Job`'s or `Payment`'s,
-- per this module's "minimal, focused changes" instruction. The
-- constraint still guarantees referential integrity at the database
-- level; application code reaches the related Job/Payment through the
-- existing `JobRepository`/`PaymentRepository` by id, exactly as
-- `ExecuteProfessionalPayoutUseCase` already does for every other lookup.

ALTER TABLE "payouts"
  ADD COLUMN "jobId" UUID,
  ADD COLUMN "paymentId" UUID,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "payouts_jobId_key" ON "payouts"("jobId");
CREATE UNIQUE INDEX "payouts_idempotencyKey_key" ON "payouts"("idempotencyKey");
CREATE INDEX "payouts_paymentId_idx" ON "payouts"("paymentId");

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payouts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
