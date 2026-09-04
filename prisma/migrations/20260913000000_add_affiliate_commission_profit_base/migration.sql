-- Module 96 — Referral & Affiliate Production Wiring.
--
-- Additive, non-destructive: `affiliate_commissions` has no live writer
-- in production as of this migration (RecordAffiliateCommissionUseCase
-- has no production caller yet — see MODULE_96 implementation report),
-- so both new columns are safe to add with a DEFAULT and no backfill is
-- needed. Both columns are added with a default and remain NOT NULL to
-- keep every reader simple (no null-coalescing at every call site) —
-- see affiliate-commission-policy.ts's own doc comment for why 0 is the
-- correct, non-fabricated default rather than an invented figure.
--
-- attributableCostAmount: directly attributable transaction cost (Stripe
-- processing fee, refund/dispute loss) known at commission-creation time,
-- subtracted from the already-existing platformCommissionAmount to reach
-- the affiliate profit base. Not yet populated with a real Stripe fee in
-- production (no fee-capture integration exists in this codebase yet —
-- see the implementation report) — this column exists so the correct
-- formula and its audit trail are in place the moment that integration
-- exists, without a further migration.
--
-- profitBaseAmount: platformCommissionAmount - attributableCostAmount,
-- floored at 0. Persisted (not re-derived at read time) purely for
-- auditability — a ledger reader should never have to recompute what
-- MaestroYa's stated profit was for a historical row.
ALTER TABLE "affiliate_commissions"
  ADD COLUMN "attributableCostAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "profitBaseAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;
