-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff). Mirrors what that
-- command would produce for the schema changes below.
--
-- Module 97 — Tax & IVA Production Integration.
--
-- Purely additive: two new enums and a set of nullable (or safely
-- defaulted) columns on two existing tables. No existing table is
-- renamed or dropped, no existing column is altered, removed, or
-- reinterpreted, and no existing row's behavior changes — every new
-- column here is either NOT NULL with a default that reproduces today's
-- implicit behavior (customerType, taxRequiresLegalConfirmation) or
-- nullable with NULL meaning exactly "no Module 97 data exists for this
-- pre-existing row," which is simply true for every row that predates
-- this migration.

-- 1. Customer tax classification (Phase 3). Defaults every existing
--    CustomerProfile to PRIVATE_CUSTOMER — the conservative, already-true
--    default (an ordinary consumer, general IVA, no special treatment).
CREATE TYPE "CustomerType" AS ENUM ('PRIVATE_CUSTOMER', 'COMMUNITY_OF_OWNERS', 'COMPANY');

ALTER TABLE "customer_profiles" ADD COLUMN "customerType" "CustomerType" NOT NULL DEFAULT 'PRIVATE_CUSTOMER';

-- 2. Quote-level operation characteristics (Phase 4) — explicit domain
--    input the community reduced-rate policy needs; never inferred.
CREATE TYPE "QuoteOperationType" AS ENUM ('RENOVATION_OR_REPAIR', 'MAINTENANCE', 'OTHER');

ALTER TABLE "quotes" ADD COLUMN "operationType" "QuoteOperationType";
ALTER TABLE "quotes" ADD COLUMN "isResidentialProperty" BOOLEAN;

-- 3. Quote-level persisted tax snapshot (Phase 5/6). All nullable: every
--    pre-Module-97 Quote simply never had a snapshot computed.
--    `taxRequiresLegalConfirmation` defaults to false only because a
--    pre-existing Quote was never run through the Module 97 policy at
--    all (there is nothing to flag for legal confirmation on a row this
--    module never touched) — every NEW Quote always has this field
--    explicitly set by CreateQuoteUseCase, never left at the default.
ALTER TABLE "quotes" ADD COLUMN "taxableBase" DECIMAL(10,2);
ALTER TABLE "quotes" ADD COLUMN "vatRateBps" INTEGER;
ALTER TABLE "quotes" ADD COLUMN "vatAmount" DECIMAL(10,2);
ALTER TABLE "quotes" ADD COLUMN "grossTotalAmount" DECIMAL(10,2);
ALTER TABLE "quotes" ADD COLUMN "taxClassificationCode" TEXT;
ALTER TABLE "quotes" ADD COLUMN "taxRequiresLegalConfirmation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "quotes" ADD COLUMN "taxCalculationVersion" INTEGER;
ALTER TABLE "quotes" ADD COLUMN "taxCalculatedAt" TIMESTAMP(3);
