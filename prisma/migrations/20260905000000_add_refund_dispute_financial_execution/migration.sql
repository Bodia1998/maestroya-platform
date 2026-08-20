-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260825000000_add_refund_boundedness_guard/
-- migration.sql for the same confirmed precedent).
--
-- Module 77 — Refund & Dispute Financial Execution.
--
-- Purely additive: new columns on the existing "payouts"/"refunds" tables
-- (both previously unused-until-Module-76/never-written tables — see
-- PayoutRepository's/RefundRepository's own doc comments), one new
-- PayoutStatus enum value, and one new trigger. No table is renamed,
-- dropped, or has a column removed; no existing row is rewritten.
--
-- ============================================================================
-- 1. PayoutStatus: new REVERSED value.
-- ============================================================================
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- statement that uses the new value (same documented constraint
-- prisma/migrations/20260903000000_add_business_registration_document_type/
-- migration.sql already records) — this migration only adds the value here
-- and never references 'REVERSED' anywhere else in this same file.
ALTER TYPE "PayoutStatus" ADD VALUE 'REVERSED';

-- ============================================================================
-- 2. "payouts": reversal columns (Step 6 — Payout Reversal).
-- ============================================================================
ALTER TABLE "payouts"
  ADD COLUMN "stripeReversalId" TEXT,
  ADD COLUMN "reversalIdempotencyKey" TEXT,
  ADD COLUMN "reversedAmount" DECIMAL(10,2),
  ADD COLUMN "reversalFailureReason" TEXT,
  ADD COLUMN "reversalAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reversedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "payouts_stripeReversalId_key" ON "payouts"("stripeReversalId");
CREATE UNIQUE INDEX "payouts_reversalIdempotencyKey_key" ON "payouts"("reversalIdempotencyKey");

-- ============================================================================
-- 3. "refunds": execution/idempotency columns (Steps 2-3 — Refund
--    Execution & Idempotency).
-- ============================================================================
ALTER TABLE "refunds"
  ADD COLUMN "financialAdjustmentId" UUID,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "refunds_financialAdjustmentId_key" ON "refunds"("financialAdjustmentId");
CREATE UNIQUE INDEX "refunds_idempotencyKey_key" ON "refunds"("idempotencyKey");

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_financialAdjustmentId_fkey" FOREIGN KEY ("financialAdjustmentId") REFERENCES "financial_adjustments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 4. Race-condition protection (Step 7 — critical): a Payout can never be
--    marked PAID once its Payment has already been refunded.
-- ============================================================================
-- `ExecuteProfessionalPayoutUseCase` (Module 76) already re-checks
-- `Payment.status === "CAPTURED"` immediately before executing a transfer
-- — but that application-level check reads-then-decides in two separate
-- statements and is therefore not race-safe on its own against a
-- concurrent `ExecuteRefundUseCase` (Module 77) committing a refund for
-- the SAME Payment between that read and this Payout's own `markPaid`
-- write. Per this codebase's established "database-level guarantees are
-- preferred" convention (see `check_refund_boundedness()`,
-- 20260825000000_add_refund_boundedness_guard), this trigger is the
-- authoritative backstop:
--
--   - Fires BEFORE UPDATE on "payouts", only when the new row's "status"
--     is being set to 'PAID'.
--   - Takes a row lock on the referenced "payments" row (SELECT ... FOR
--     UPDATE) — a concurrent transaction refunding that same Payment (a
--     plain UPDATE on "payments") always takes its own row lock too, so
--     whichever transaction (this payout's markPaid, or the refund's
--     Payment.updateStatus) commits first is the one the other must wait
--     for before it can read the Payment's true, post-commit status.
--   - RAISEs an exception (rolling back the whole markPaid UPDATE, and
--     with it the Payout staying out of 'PAID') if the Payment has
--     already been refunded by the time this trigger's lock is acquired.
--
-- If Stripe's own transfer already succeeded before this trigger blocks
-- the local write (the transfer call always happens before markPaid — see
-- `ExecuteProfessionalPayoutUseCase`'s own doc comment on Stripe-then-DB
-- ordering), `ExecuteProfessionalPayoutUseCase`'s existing catch block
-- persists that failure via `markFailed` (never silently drops the
-- `stripeTransferId` a human needs to reconcile) — this is the explicit,
-- documented "fails safe and becomes reconcilable by a future Module 80"
-- design this module's own safety requirement calls for, not a gap.
CREATE OR REPLACE FUNCTION check_payout_blocked_by_refund()
RETURNS TRIGGER AS $$
DECLARE
  payment_status "PaymentStatus";
BEGIN
  IF NEW.status <> 'PAID' OR NEW."paymentId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO payment_status
  FROM payments
  WHERE id = NEW."paymentId"
  FOR UPDATE;

  IF payment_status IS NULL THEN
    RAISE EXCEPTION 'payouts.paymentId % does not reference an existing payment', NEW."paymentId";
  END IF;

  IF payment_status IN ('REFUNDED', 'PARTIALLY_REFUNDED') THEN
    RAISE EXCEPTION 'Cannot mark payout % PAID: payment % has already been refunded (status %)',
      NEW.id, NEW."paymentId", payment_status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_payout_blocked_by_refund ON payouts;
CREATE TRIGGER trg_check_payout_blocked_by_refund
BEFORE UPDATE ON payouts
FOR EACH ROW
EXECUTE FUNCTION check_payout_blocked_by_refund();
