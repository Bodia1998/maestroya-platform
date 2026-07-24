-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev`
-- and have it generate this file from a real diff). Mirrors what that
-- command would produce for the schema changes below. Run the real
-- command once you have a database locally to double-check, then delete
-- this comment block.
--
-- Portfolio module (Module 14): introduces "portfolio_items", a brand-new
-- table with no pre-existing rows anywhere this migration will ever run
-- against — so, same reasoning as the Module 13 Review.jobId migration,
-- every column can be added directly in its final shape with no nullable-
-- then-backfill dance.
--
-- Each row is anchored to exactly one ProfessionalProfile
-- ("professionalProfileId", NOT NULL, ON DELETE CASCADE) — a portfolio
-- item has no reason to outlive the professional profile that owns it,
-- same convention as CompanyMember -> CompanyProfile. It optionally tags
-- itself with a ServiceCategory ("serviceCategoryId", nullable,
-- ON DELETE SET NULL) — purely descriptive, so a deprecated/removed
-- category never blocks a professional from managing their own portfolio.
--
-- Soft-deleted via "deletedAt" (never a hard DELETE), same convention as
-- "addresses", "professional_profiles", "messages" elsewhere in this
-- schema. The composite index on (professionalProfileId, deletedAt,
-- createdAt) covers this module's one hot read path: "list this
-- professional's non-deleted portfolio items, newest first".

-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" UUID NOT NULL,
    "professionalProfileId" UUID NOT NULL,
    "serviceCategoryId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mediaUrl" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_items_professionalProfileId_deletedAt_createdAt_idx" ON "portfolio_items"("professionalProfileId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "portfolio_items_serviceCategoryId_idx" ON "portfolio_items"("serviceCategoryId");

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_professionalProfileId_fkey" FOREIGN KEY ("professionalProfileId") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
