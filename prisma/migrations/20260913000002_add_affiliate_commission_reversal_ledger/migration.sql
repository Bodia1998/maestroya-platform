-- Module 96 — Referral & Affiliate Production Wiring.
--
-- Append-only reversal ledger for AffiliateCommission — mirrors Module
-- 22's Transaction ledger convention ("a correction is always a new row,
-- never an edit of the original") applied to the affiliate domain.
-- Additive/non-destructive: affiliate_commissions has no live production
-- writer as of this migration, so REVERSED can be added to the enum and
-- reversedAmount defaulted to 0 with no backfill needed.

ALTER TYPE "AffiliateCommissionStatus" ADD VALUE 'REVERSED';

CREATE TYPE "AffiliateCommissionReversalType" AS ENUM ('FULL', 'PARTIAL');

ALTER TABLE "affiliate_commissions"
  ADD COLUMN "reversedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE "affiliate_commission_reversals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "affiliateCommissionId" UUID NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "type" "AffiliateCommissionReversalType" NOT NULL,
  "financialAdjustmentId" VARCHAR(191) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "affiliate_commission_reversals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "affiliate_commission_reversals_financialAdjustmentId_key"
  ON "affiliate_commission_reversals" ("financialAdjustmentId");

CREATE INDEX "affiliate_commission_reversals_affiliateCommissionId_idx"
  ON "affiliate_commission_reversals" ("affiliateCommissionId");

ALTER TABLE "affiliate_commission_reversals"
  ADD CONSTRAINT "affiliate_commission_reversals_affiliateCommissionId_fkey"
  FOREIGN KEY ("affiliateCommissionId") REFERENCES "affiliate_commissions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
