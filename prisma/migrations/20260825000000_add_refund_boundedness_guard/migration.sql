-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260824000000_add_dispute_resolution_financial_protection/
-- migration.sql for the same confirmed precedent). Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 69 — Financial Ledger & Payout Readiness Audit.
--
-- Purely additive: one trigger function + one trigger on the existing
-- "financial_adjustments" table. No table is renamed, dropped, or has a
-- column altered/removed; no existing row is rewritten.
--
-- ## What this enforces (Invariant 8 — Refund boundedness)
-- `CreateFinancialAdjustmentUseCase` already rejects, at the application
-- layer, a new refund-type FinancialAdjustment (FULL_REFUND/PARTIAL_REFUND/
-- PLATFORM_FEE_REFUND) that would push the cumulative APPLIED total for a
-- Payment above that Payment's captured `amount`. That check reads-then-
-- decides in two separate statements and is therefore not race-safe on its
-- own: two concurrent admin actions applying two different, legitimately
-- distinct adjustments (e.g. two different Disputes against the same Job's
-- Payment, resolved by two different admins at the same instant) could each
-- pass the application-level check before either write commits, together
-- refunding more than was ever captured. Per this module's non-negotiable
-- safety rule ("Do not rely on 'the application checks first' as the only
-- protection — where money is involved, database-level guarantees are
-- preferred"), this migration adds the authoritative backstop:
--
--   1. `check_refund_boundedness()` — fires AFTER INSERT OR UPDATE on
--      "financial_adjustments", but only when the affected row's new
--      status is 'APPLIED', its type is a refund type, and it references a
--      Payment (mirrors `CreateFinancialAdjustmentUseCase`'s own guard
--      condition exactly — see `REFUND_TYPE_ADJUSTMENTS`, the domain-layer
--      constant this trigger's IN-list is kept in lock-step with).
--   2. It first takes a row lock on the referenced "payments" row
--      (`SELECT ... FOR UPDATE`) — this is what makes the check race-safe:
--      a second concurrent transaction attempting to APPLY another refund
--      adjustment against the SAME Payment blocks on that lock until the
--      first transaction commits or rolls back, so the two sums can never
--      be computed against the same stale snapshot.
--   3. It then sums every APPLIED refund-type adjustment for that Payment
--      (including the row just written, since triggers run inside the same
--      transaction as the write that fired them) and RAISEs an exception if
--      that sum exceeds the Payment's captured `amount` — the whole
--      transaction (the UPDATE that tried to mark the adjustment APPLIED,
--      and everything else in that transaction) rolls back.
--
-- `markApplied`/`markFailed` in `prisma-financial-adjustment-repository.ts`
-- already wrap their own failure in a try/catch at the use-case layer
-- (`CreateFinancialAdjustmentUseCase.execute`'s own try/catch around the
-- ledger write + `markApplied` call) — a trigger-raised exception here
-- surfaces the same way an unexpected database error already does: the
-- adjustment is marked FAILED and the error is rethrown for the caller
-- (an admin action) to see, never silently swallowed.

-- ============================================================================
-- Trigger function
-- ============================================================================
CREATE OR REPLACE FUNCTION check_refund_boundedness()
RETURNS TRIGGER AS $$
DECLARE
  payment_amount NUMERIC(10,2);
  applied_refund_total NUMERIC(10,2);
BEGIN
  IF NEW.status <> 'APPLIED' OR NEW."paymentId" IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type NOT IN ('FULL_REFUND', 'PARTIAL_REFUND', 'PLATFORM_FEE_REFUND') THEN
    RETURN NEW;
  END IF;

  -- Lock the Payment row so a concurrent transaction applying a different
  -- refund-type adjustment against the same Payment must wait for this one
  -- to commit (or roll back) before it can compute its own sum — see this
  -- migration's own comment block above.
  SELECT amount INTO payment_amount
  FROM payments
  WHERE id = NEW."paymentId"
  FOR UPDATE;

  IF payment_amount IS NULL THEN
    RAISE EXCEPTION 'financial_adjustments.paymentId % does not reference an existing payment', NEW."paymentId";
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO applied_refund_total
  FROM financial_adjustments
  WHERE "paymentId" = NEW."paymentId"
    AND status = 'APPLIED'
    AND type IN ('FULL_REFUND', 'PARTIAL_REFUND', 'PLATFORM_FEE_REFUND');

  IF applied_refund_total > payment_amount THEN
    RAISE EXCEPTION 'Refund boundedness violated for payment %: applied refund-type adjustments (%) would exceed the captured amount (%)',
      NEW."paymentId", applied_refund_total, payment_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Trigger
-- ============================================================================
DROP TRIGGER IF EXISTS trg_check_refund_boundedness ON financial_adjustments;
CREATE TRIGGER trg_check_refund_boundedness
AFTER INSERT OR UPDATE ON financial_adjustments
FOR EACH ROW
EXECUTE FUNCTION check_refund_boundedness();
