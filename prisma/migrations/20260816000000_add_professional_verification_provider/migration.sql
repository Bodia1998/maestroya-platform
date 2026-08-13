-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/Prisma-engine access in this sandbox to run `prisma migrate dev`
-- and have it generate this file from a real diff — see
-- docs/MODULE_21_DISPUTES_SUPPORT.md, "Validation Results", for the same
-- confirmed precedent). Mirrors what that command would produce for the
-- schema changes below. Run the real command once you have a database
-- locally to double-check, then delete this comment block.
--
-- Module 59 — Professional Verification (Persona).
--
-- Purely additive: one new enum, four new nullable/defaulted columns on
-- the existing `professional_verifications` table, one new index. No
-- table is created, renamed, or dropped — this module deliberately
-- extends the Module 17 `ProfessionalVerification` aggregate rather than
-- introducing a parallel verification system (see
-- docs/MODULE_59_PROFESSIONAL_VERIFICATION_PERSONA.md).

-- 1. Which system drives a case toward a decision. Existing rows default
--    to MANUAL (the entire pre-Module-59 Module 17 workflow), so this
--    migration changes no observable behavior for any existing case.
CREATE TYPE "VerificationProviderName" AS ENUM ('MANUAL', 'PERSONA');

-- 2. New columns on the existing aggregate table.
ALTER TABLE "professional_verifications"
  ADD COLUMN "provider" "VerificationProviderName" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "providerVerificationId" VARCHAR(191),
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "providerSyncedAt" TIMESTAMP(3);

-- 3. Correlates an inbound provider lookup/webhook back to its case, and
--    lets SynchronizeVerificationUseCase cheaply select every PERSONA
--    case still awaiting a decision.
CREATE INDEX "professional_verifications_provider_providerVerificationId_idx"
  ON "professional_verifications" ("provider", "providerVerificationId");
