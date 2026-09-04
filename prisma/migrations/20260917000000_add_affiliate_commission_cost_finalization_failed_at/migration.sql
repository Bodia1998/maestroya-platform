-- Module 96 Financial Integrity Hardening Pass — Risk 3: an
-- AffiliateCommission whose Stripe fee never arrives within the bounded
-- finalization window (see FinalizeOverdueAffiliateCommissionFeesUseCase)
-- must reach an explicit, observable, queryable "requires review" state
-- instead of silently retrying forever with attributableCostAmount
-- implicitly treated as a final 0.
--
-- Purely additive, nullable column — no existing row is affected, no
-- backfill required (a null value means "not (yet) finalization-failed,"
-- the correct default for every pre-existing row).

ALTER TABLE "affiliate_commissions" ADD COLUMN "costFinalizationFailedAt" TIMESTAMP(3);
