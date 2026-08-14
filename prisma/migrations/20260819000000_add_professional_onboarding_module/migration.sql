-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- prisma/migrations/20260818000000_add_affiliate_partner_system/migration.sql
-- for the same confirmed precedent). Mirrors what that command would
-- produce for the schema changes below. Run the real command once you have
-- a database locally to double-check, then delete this comment block.
--
-- Module 62 — Professional Onboarding.
--
-- Purely additive: four new enums, two new tables, and two new nullable
-- columns on the existing `consents` table (request-provenance for the
-- Terms & Conditions onboarding step — see AcceptOnboardingTermsUseCase's
-- own doc comment). No existing table is renamed or dropped, and no
-- existing column is altered or removed.

-- 1. Professional Onboarding enums.
CREATE TYPE "OnboardingStatus" AS ENUM ('IN_PROGRESS', 'ACTIVATED');

CREATE TYPE "PayoutMethod" AS ENUM ('IBAN', 'STRIPE_EXPRESS');

CREATE TYPE "PayoutAccountStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TYPE "StripeExpressReadiness" AS ENUM ('NOT_STARTED', 'PENDING', 'READY');

-- 2. Onboarding progress/activation — one row per professional profile.
CREATE TABLE "professional_onboardings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "professionalProfileId" UUID NOT NULL,
  "status" "OnboardingStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "professional_onboardings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "professional_onboardings_professionalProfileId_key" ON "professional_onboardings" ("professionalProfileId");
CREATE INDEX "professional_onboardings_status_idx" ON "professional_onboardings" ("status");

ALTER TABLE "professional_onboardings"
  ADD CONSTRAINT "professional_onboardings_professionalProfileId_fkey"
  FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. The professional's single active payout destination — insert-or-
--    replace (see ProfessionalPayoutAccount's own doc comment in
--    schema.prisma), not an append-only history table. A raw IBAN is
--    never stored: only the last 4 digits (display only) and a keyed hash
--    (duplicate-destination detection only) — see IbanPayoutProvider.
CREATE TABLE "professional_payout_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "professionalProfileId" UUID NOT NULL,
  "method" "PayoutMethod" NOT NULL,
  "status" "PayoutAccountStatus" NOT NULL DEFAULT 'PENDING',
  "accountHolderName" TEXT NOT NULL,
  "ibanLast4" VARCHAR(4),
  "ibanHash" TEXT,
  "stripeExpressAccountId" TEXT,
  "stripeExpressStatus" "StripeExpressReadiness" NOT NULL DEFAULT 'NOT_STARTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "professional_payout_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "professional_payout_accounts_professionalProfileId_key" ON "professional_payout_accounts" ("professionalProfileId");
CREATE UNIQUE INDEX "professional_payout_accounts_ibanHash_key" ON "professional_payout_accounts" ("ibanHash");
CREATE UNIQUE INDEX "professional_payout_accounts_stripeExpressAccountId_key" ON "professional_payout_accounts" ("stripeExpressAccountId");
CREATE INDEX "professional_payout_accounts_method_idx" ON "professional_payout_accounts" ("method");
CREATE INDEX "professional_payout_accounts_status_idx" ON "professional_payout_accounts" ("status");

ALTER TABLE "professional_payout_accounts"
  ADD CONSTRAINT "professional_payout_accounts_professionalProfileId_fkey"
  FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Terms & Conditions request-provenance columns on the existing
--    Module 38 `consents` table — additive and nullable, so every
--    pre-Module-62 row and every non-onboarding consent grant is
--    unaffected (see Consent's own doc comment in schema.prisma).
ALTER TABLE "consents" ADD COLUMN "ipHash" TEXT;
ALTER TABLE "consents" ADD COLUMN "userAgent" TEXT;
