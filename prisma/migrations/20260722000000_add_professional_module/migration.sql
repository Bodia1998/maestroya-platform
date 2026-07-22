-- Same caveat as every prior migration in this repo: hand-authored to
-- mirror what `npx prisma migrate dev` would generate, not engine-verified
-- (no network access in this environment). Run the real command once you
-- have this locally.
--
-- Professional Module: adds business/contact fields, lifecycle status, and
-- a proper verification-status enum to ProfessionalProfile. The previous
-- `isVerified` boolean is dropped in favor of `verificationStatus` being
-- the single source of truth for trust/verification state (`verifiedAt`
-- is preserved and now only meaningful once verificationStatus = VERIFIED).

-- CreateEnum
CREATE TYPE "ProfessionalStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- DropIndex
DROP INDEX IF EXISTS "professional_profiles_isVerified_idx";

-- AlterTable
ALTER TABLE "professional_profiles" DROP COLUMN IF EXISTS "isVerified";
ALTER TABLE "professional_profiles" ADD COLUMN "businessName" TEXT;
ALTER TABLE "professional_profiles" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "professional_profiles" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "professional_profiles" ADD COLUMN "websiteUrl" TEXT;
ALTER TABLE "professional_profiles" ADD COLUMN "taxId" TEXT;
ALTER TABLE "professional_profiles" ADD COLUMN "status" "ProfessionalStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "professional_profiles" ADD COLUMN "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- CreateIndex
CREATE UNIQUE INDEX "professional_profiles_taxId_key" ON "professional_profiles"("taxId");

-- CreateIndex
CREATE INDEX "professional_profiles_verificationStatus_idx" ON "professional_profiles"("verificationStatus");

-- CreateIndex
CREATE INDEX "professional_profiles_status_idx" ON "professional_profiles"("status");
