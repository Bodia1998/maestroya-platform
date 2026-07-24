-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev` and
-- have it generate this file from a real diff). Mirrors what that command
-- would produce for the schema changes below. Run the real command once you
-- have a database locally to double-check.
--
-- Module 18 — Company Professional. Summary of every change:
--   * CompanyMemberRole gains MANAGER (additive enum value, between ADMIN
--     and MEMBER).
--   * Two brand-new enums: CompanyStatus, CompanyInvitationStatus,
--     VerificationCaseStatus.
--   * CompanyProfile gains: slug, contactEmail, contactPhone, addressLine,
--     city, province, postalCode, country, latitude, longitude, status,
--     suspendedAt — all additive/nullable (status has a DEFAULT so existing
--     rows backfill cleanly).
--   * PortfolioItem.professionalProfileId becomes nullable and gains a new
--     nullable companyProfileId, with a CHECK enforcing exactly one is set
--     (existing rows are unaffected — they already have
--     professionalProfileId set, which remains valid under "exactly one").
--   * Two brand-new tables: company_invitations, company_verifications (+
--     its child company_verification_documents).
--   * Ten new NotificationType values for company events.
--
-- Nothing existing is renamed, dropped, or made backward-incompatible.
-- Existing individual-professional data and code paths are untouched.

-- ============================================================================
-- Enums
-- ============================================================================

-- AlterEnum
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as other
-- statements that use the new value on some Postgres versions; `prisma
-- migrate` sequences this automatically. If applying by hand, run this
-- statement (and the NotificationType ones below) in their own transaction
-- ahead of anything that references the new values.
ALTER TYPE "CompanyMemberRole" ADD VALUE 'MANAGER';

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "CompanyInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VerificationCaseStatus" AS ENUM (
    'DRAFT',
    'PENDING',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'RESUBMISSION_REQUIRED',
    'EXPIRED'
);

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_INVITATION_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_INVITATION_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_INVITATION_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_MEMBER_REMOVED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_MEMBER_ROLE_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_VERIFICATION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_VERIFICATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_VERIFICATION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_VERIFICATION_RESUBMISSION_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_SUSPENDED';
ALTER TYPE "NotificationType" ADD VALUE 'COMPANY_REACTIVATED';

-- ============================================================================
-- CompanyProfile: additive columns
-- ============================================================================

-- AlterTable
ALTER TABLE "company_profiles"
    ADD COLUMN "slug" TEXT,
    ADD COLUMN "contactEmail" TEXT,
    ADD COLUMN "contactPhone" TEXT,
    ADD COLUMN "addressLine" TEXT,
    ADD COLUMN "city" TEXT,
    ADD COLUMN "province" TEXT,
    ADD COLUMN "postalCode" TEXT,
    ADD COLUMN "country" TEXT DEFAULT 'ES',
    ADD COLUMN "latitude" DOUBLE PRECISION,
    ADD COLUMN "longitude" DOUBLE PRECISION,
    ADD COLUMN "status" "CompanyStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_slug_key" ON "company_profiles"("slug");

-- CreateIndex
CREATE INDEX "company_profiles_status_idx" ON "company_profiles"("status");

-- ============================================================================
-- PortfolioItem: relax professionalProfileId, add companyProfileId
-- ============================================================================

-- AlterTable
ALTER TABLE "portfolio_items"
    ALTER COLUMN "professionalProfileId" DROP NOT NULL,
    ADD COLUMN "companyProfileId" UUID;

-- CreateIndex
CREATE INDEX "portfolio_items_companyProfileId_deletedAt_createdAt_idx" ON "portfolio_items"("companyProfileId", "deletedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "portfolio_items"
    ADD CONSTRAINT "portfolio_items_companyProfileId_fkey"
    FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- CreateTable: company_invitations
-- ============================================================================

CREATE TABLE "company_invitations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "invitedUserId" UUID,
    "invitedByUserId" UUID NOT NULL,
    "role" "CompanyMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "CompanyInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_invitations_tokenHash_key" ON "company_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "company_invitations_companyId_status_idx" ON "company_invitations"("companyId", "status");

-- CreateIndex
CREATE INDEX "company_invitations_invitedUserId_idx" ON "company_invitations"("invitedUserId");

-- CreateIndex
CREATE INDEX "company_invitations_email_idx" ON "company_invitations"("email");

-- CreateIndex
CREATE INDEX "company_invitations_expiresAt_idx" ON "company_invitations"("expiresAt");

-- CreateIndex
-- Partial unique index: at most one PENDING invitation per (companyId, email)
-- — prevents duplicate pending invitations. Not expressible in Prisma's
-- schema language, hence hand-added here (same pattern as
-- professional_verifications_active_unique).
CREATE UNIQUE INDEX "company_invitations_pending_unique"
    ON "company_invitations"("companyId", "email")
    WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "company_invitations"
    ADD CONSTRAINT "company_invitations_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations"
    ADD CONSTRAINT "company_invitations_invitedUserId_fkey"
    FOREIGN KEY ("invitedUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations"
    ADD CONSTRAINT "company_invitations_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- CreateTable: company_verifications (+ company_verification_documents)
-- ============================================================================

CREATE TABLE "company_verifications" (
    "id" UUID NOT NULL,
    "companyProfileId" UUID NOT NULL,
    "status" "VerificationCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "rejectionReason" TEXT,
    "resubmissionReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "company_verification_documents" (
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

    CONSTRAINT "company_verification_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_verifications_companyProfileId_idx" ON "company_verifications"("companyProfileId");

-- CreateIndex
CREATE INDEX "company_verifications_status_idx" ON "company_verifications"("status");

-- CreateIndex
CREATE INDEX "company_verifications_reviewedByUserId_idx" ON "company_verifications"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "company_verifications_status_submittedAt_idx" ON "company_verifications"("status", "submittedAt");

-- CreateIndex
-- Partial unique index: at most one non-EXPIRED verification case per
-- company (mirrors professional_verifications_active_unique).
CREATE UNIQUE INDEX "company_verifications_active_unique"
    ON "company_verifications"("companyProfileId")
    WHERE "status" <> 'EXPIRED';

-- CreateIndex
CREATE INDEX "company_verification_documents_verificationId_idx" ON "company_verification_documents"("verificationId");

-- CreateIndex
CREATE INDEX "company_verification_documents_type_idx" ON "company_verification_documents"("type");

-- AddForeignKey
ALTER TABLE "company_verifications"
    ADD CONSTRAINT "company_verifications_companyProfileId_fkey"
    FOREIGN KEY ("companyProfileId") REFERENCES "company_profiles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_verifications"
    ADD CONSTRAINT "company_verifications_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_verification_documents"
    ADD CONSTRAINT "company_verification_documents_verificationId_fkey"
    FOREIGN KEY ("verificationId") REFERENCES "company_verifications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- CHECK constraints — cannot be expressed in Prisma's schema language
-- ============================================================================

-- PortfolioItem: exactly one of professionalProfileId/companyProfileId.
-- Every pre-existing row already has professionalProfileId set and
-- companyProfileId NULL, so num_nonnulls(...) = 1 holds for 100% of
-- existing data — this CHECK is safe to add without a backfill.
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_owner_xor_check"
    CHECK (num_nonnulls("professionalProfileId", "companyProfileId") = 1);
