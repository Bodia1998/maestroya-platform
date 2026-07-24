-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev` and
-- have it generate this file from a real diff). Mirrors what that command
-- would produce for the schema changes below. Run the real command once you
-- have a database locally to double-check.
--
-- Professional Verification module (Module 17): introduces two brand-new
-- tables ("professional_verifications" and its child
-- "professional_verification_documents"), a new status enum, and four new
-- NotificationType values. Nothing existing is renamed, dropped, or made
-- backward-incompatible.
--
-- Key design points (see schema.prisma / docs for full rationale):
--   * A verification case is Restrict-anchored to its ProfessionalProfile (a
--     trust/compliance record must not vanish if the profile row is ever hard
--     deleted — profiles are soft-deleted for exactly this reason). Its
--     reviewer FK is SET NULL (losing "who reviewed it" is acceptable).
--   * Documents CASCADE with their parent case (they have no meaning alone).
--   * A professional may hold at most one *non-EXPIRED* case at a time — this
--     is enforced by a partial unique index Prisma cannot express in its
--     schema language, added manually below, alongside the application-level
--     check in CreateProfessionalVerificationUseCase.

-- CreateEnum
CREATE TYPE "ProfessionalVerificationStatus" AS ENUM (
    'DRAFT',
    'PENDING',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'RESUBMISSION_REQUIRED',
    'EXPIRED'
);

-- AlterEnum
-- New NotificationType values for verification events. (ALTER TYPE ... ADD
-- VALUE cannot run inside a transaction block on older Postgres; `prisma
-- migrate` handles this automatically. If applying by hand on such a version,
-- run these outside a transaction.)
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'VERIFICATION_RESUBMISSION_REQUIRED';

-- CreateTable
CREATE TABLE "professional_verifications" (
    "id" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "status" "ProfessionalVerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "rejectionReason" TEXT,
    "resubmissionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professional_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_verification_documents" (
    "id" UUID NOT NULL,
    "verificationId" UUID NOT NULL,
    "type" "VerificationDocumentType" NOT NULL,
    "status" "VerificationDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "professional_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "professional_verifications_professionalProfileId_idx" ON "professional_verifications"("professionalProfileId");

-- CreateIndex
CREATE INDEX "professional_verifications_status_idx" ON "professional_verifications"("status");

-- CreateIndex
CREATE INDEX "professional_verifications_reviewedByUserId_idx" ON "professional_verifications"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "professional_verifications_status_submittedAt_idx" ON "professional_verifications"("status", "submittedAt");

-- CreateIndex
-- Partial unique index: at most one non-EXPIRED verification case per
-- professional (the "one active case at a time" invariant). Not expressible
-- in Prisma's schema language, hence hand-added here.
CREATE UNIQUE INDEX "professional_verifications_active_unique"
    ON "professional_verifications"("professionalProfileId")
    WHERE "status" <> 'EXPIRED';

-- CreateIndex
CREATE INDEX "professional_verification_documents_verificationId_idx" ON "professional_verification_documents"("verificationId");

-- CreateIndex
CREATE INDEX "professional_verification_documents_type_idx" ON "professional_verification_documents"("type");

-- AddForeignKey
ALTER TABLE "professional_verifications"
    ADD CONSTRAINT "professional_verifications_professionalProfileId_fkey"
    FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_verifications"
    ADD CONSTRAINT "professional_verifications_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_verification_documents"
    ADD CONSTRAINT "professional_verification_documents_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "professional_verifications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
