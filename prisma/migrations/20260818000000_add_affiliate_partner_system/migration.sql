-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- prisma/migrations/20260817000000_add_referral_marketing_attribution_module/
-- migration.sql for the same confirmed precedent). Mirrors what that
-- command would produce for the schema changes below. Run the real command
-- once you have a database locally to double-check, then delete this
-- comment block.
--
-- Module 61 — Affiliate & Partner System.
--
-- Purely additive: five new enums, four new tables, one new column-free
-- back-relation on the existing `users` table (Prisma-side only, no FK
-- column added to `users` itself — `Partner.userId` carries the FK). No
-- existing table is altered, renamed, or dropped. No column is added,
-- removed, or changed on `referral_codes`, `referral_visits`,
-- `marketing_attributions`, `conversion_events`, or `commissions` — this
-- module reads those tables through its repositories only.

-- 1. Partner enums.
CREATE TYPE "PartnerType" AS ENUM (
  'INDIVIDUAL', 'COMPANY', 'AGENCY', 'BLOGGER', 'TELEGRAM_CHANNEL',
  'INSTAGRAM_CREATOR', 'TIKTOK_CREATOR', 'YOUTUBE_CREATOR', 'FACEBOOK_COMMUNITY'
);

CREATE TYPE "PartnerStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BANNED');

CREATE TYPE "PartnerPayoutMethod" AS ENUM ('MANUAL', 'STRIPE');

CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'CANCELLED', 'EXPIRED');

CREATE TYPE "PartnerPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

CREATE TYPE "PartnerFraudFlagType" AS ENUM (
  'SELF_REFERRAL', 'DUPLICATE_ACCOUNT', 'SUSPICIOUS_CONVERSION', 'REPEATED_IP',
  'REPEATED_DEVICE', 'FAKE_REGISTRATION'
);

CREATE TYPE "PartnerFraudFlagStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED', 'CONFIRMED');

-- 2. Partner accounts — one per User.
CREATE TABLE "partners" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "type" "PartnerType" NOT NULL,
  "status" "PartnerStatus" NOT NULL DEFAULT 'PENDING',
  "displayName" VARCHAR(120) NOT NULL,
  "contactEmail" VARCHAR(191) NOT NULL,
  "payoutMethod" "PartnerPayoutMethod" NOT NULL DEFAULT 'MANUAL',
  "payoutDetails" JSONB,
  "minimumPayoutThreshold" DECIMAL(10, 2) NOT NULL DEFAULT 50,
  "notes" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedByUserId" UUID,
  "rejectedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "suspendedAt" TIMESTAMP(3),
  "suspendedReason" TEXT,
  "bannedAt" TIMESTAMP(3),
  "bannedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partners_userId_key" ON "partners" ("userId");
CREATE INDEX "partners_status_idx" ON "partners" ("status");
CREATE INDEX "partners_type_idx" ON "partners" ("type");

ALTER TABLE "partners"
  ADD CONSTRAINT "partners_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Affiliate commission ledger — read-only w.r.t. Module 22's
--    `commissions` table (no FK to it; see AffiliateCommission's own doc
--    comment in schema.prisma).
CREATE TABLE "affiliate_commissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "partnerId" UUID NOT NULL,
  "referralCode" VARCHAR(40) NOT NULL,
  "conversionEventId" UUID NOT NULL,
  "platformCommissionRefId" VARCHAR(191) NOT NULL,
  "platformCommissionAmount" DECIMAL(10, 2) NOT NULL,
  "affiliateRateBps" INTEGER NOT NULL,
  "affiliateAmount" DECIMAL(10, 2) NOT NULL,
  "status" "AffiliateCommissionStatus" NOT NULL DEFAULT 'PENDING',
  "approvedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "expiredAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "payoutId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "affiliate_commissions_conversionEventId_key" ON "affiliate_commissions" ("conversionEventId");
CREATE INDEX "affiliate_commissions_partnerId_idx" ON "affiliate_commissions" ("partnerId");
CREATE INDEX "affiliate_commissions_status_idx" ON "affiliate_commissions" ("status");
CREATE INDEX "affiliate_commissions_expiresAt_idx" ON "affiliate_commissions" ("expiresAt");
CREATE INDEX "affiliate_commissions_payoutId_idx" ON "affiliate_commissions" ("payoutId");

ALTER TABLE "affiliate_commissions"
  ADD CONSTRAINT "affiliate_commissions_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Partner payouts (created below `affiliate_commissions` in this file,
--    but `affiliate_commissions.payoutId` references it, so its FK is
--    added after both tables exist — see the end of this section).
CREATE TABLE "partner_payouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "partnerId" UUID NOT NULL,
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "method" "PartnerPayoutMethod" NOT NULL,
  "status" "PartnerPayoutStatus" NOT NULL DEFAULT 'PENDING',
  "reference" VARCHAR(191),
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "partner_payouts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_payouts_partnerId_idx" ON "partner_payouts" ("partnerId");
CREATE INDEX "partner_payouts_status_idx" ON "partner_payouts" ("status");

ALTER TABLE "partner_payouts"
  ADD CONSTRAINT "partner_payouts_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "affiliate_commissions"
  ADD CONSTRAINT "affiliate_commissions_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "partner_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Partner fraud flags — advisory only (see PartnerFraudFlag's own doc
--    comment); nothing above ever reads this table to make an automated
--    decision.
CREATE TABLE "partner_fraud_flags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "partnerId" UUID NOT NULL,
  "type" "PartnerFraudFlagType" NOT NULL,
  "status" "PartnerFraudFlagStatus" NOT NULL DEFAULT 'OPEN',
  "detail" TEXT NOT NULL,
  "relatedReferralCode" VARCHAR(40),
  "relatedVisitorId" VARCHAR(100),
  "relatedUserId" UUID,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByUserId" UUID,
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "partner_fraud_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_fraud_flags_partnerId_idx" ON "partner_fraud_flags" ("partnerId");
CREATE INDEX "partner_fraud_flags_status_idx" ON "partner_fraud_flags" ("status");

ALTER TABLE "partner_fraud_flags"
  ADD CONSTRAINT "partner_fraud_flags_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
