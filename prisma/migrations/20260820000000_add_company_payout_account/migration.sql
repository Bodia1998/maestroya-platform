-- Module 75 — Company Payout Eligibility.
--
-- Adds CompanyPayoutAccount: the company-owned mirror of
-- ProfessionalPayoutAccount (Module 62/71), so a company-owned Job can
-- satisfy the same payout-destination requirement a solo professional's
-- Job already does. Reuses the existing PayoutMethod / PayoutAccountStatus
-- / StripeExpressReadiness enums (no new enums introduced) — see
-- CompanyPayoutAccount's own doc comment in schema.prisma for the full
-- rationale. Additive only: no existing table/column is altered.

CREATE TABLE "company_payout_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyProfileId" UUID NOT NULL,
  "method" "PayoutMethod" NOT NULL,
  "status" "PayoutAccountStatus" NOT NULL DEFAULT 'PENDING',
  "accountHolderName" TEXT NOT NULL,
  "ibanLast4" VARCHAR(4),
  "ibanHash" TEXT,
  "stripeExpressAccountId" TEXT,
  "stripeExpressStatus" "StripeExpressReadiness" NOT NULL DEFAULT 'NOT_STARTED',
  "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
  "stripeRequirementsCurrentlyDue" BOOLEAN NOT NULL DEFAULT false,
  "stripeConnectSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "company_payout_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_payout_accounts_companyProfileId_key" ON "company_payout_accounts" ("companyProfileId");
CREATE UNIQUE INDEX "company_payout_accounts_ibanHash_key" ON "company_payout_accounts" ("ibanHash");
CREATE UNIQUE INDEX "company_payout_accounts_stripeExpressAccountId_key" ON "company_payout_accounts" ("stripeExpressAccountId");
CREATE INDEX "company_payout_accounts_method_idx" ON "company_payout_accounts" ("method");
CREATE INDEX "company_payout_accounts_status_idx" ON "company_payout_accounts" ("status");

ALTER TABLE "company_payout_accounts"
  ADD CONSTRAINT "company_payout_accounts_companyProfileId_fkey"
  FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
