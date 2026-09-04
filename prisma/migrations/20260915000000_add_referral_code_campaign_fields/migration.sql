-- Module 96 — Referral & Affiliate Production Wiring: campaign-management
-- fields on ReferralCode (source label + activate/deactivate).
ALTER TABLE "referral_codes" ADD COLUMN "source" VARCHAR(40);
ALTER TABLE "referral_codes" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
