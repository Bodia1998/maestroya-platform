-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev`
-- and have it generate this file from a real diff). Mirrors what that
-- command would produce for the schema changes below. Run the real
-- command once you have a database locally to double-check, then delete
-- this comment block.
--
-- Reviews & Ratings module (Module 13): re-anchors the pre-existing
-- (schema-only, never wired to any application code) "reviews" table to
-- Job, the execution-lifecycle entity Module 11 introduced. Before this
-- migration, Review only pointed at ServiceRequest — with no Job model to
-- anchor to at the time reviews was first scaffolded. Job is now the
-- authoritative record of "was the work actually completed"
-- (Job.status = COMPLETED), so Module 13's business rules require a
-- direct, uniquely-constrained Job relationship rather than relying on
-- ServiceRequest/Quote for eligibility or duplicate-prevention.
--
-- This migration:
--   1. Adds "reviews"."jobId" (UUID, NOT NULL) with a UNIQUE constraint —
--      the DB-level guarantee behind "at most one review per Job", the
--      final concurrency backstop behind CreateReviewUseCase's own
--      application-level duplicate check.
--   2. Adds the "reviews_jobId_fkey" FK to "jobs"("id"), ON DELETE RESTRICT
--      (same convention as every other Review FK, and as Job's own FKs) —
--      a Job can never be deleted out from under a Review that references
--      it.
--   3. Changes the default value of "reviews"."status" from PENDING to
--      PUBLISHED. Module 13 does not implement a moderation/approval
--      workflow (that remains Module 16 — Admin Panel's job); with the old
--      PENDING default, every review created by this module would stay
--      invisible forever, since nothing in this module transitions a
--      review to PUBLISHED. Existing rows are not touched by this
--      migration — only the column default changes, and Module 13 never
--      wrote any "reviews" row before this migration existed, so there is
--      no pre-existing PENDING data to reconcile.
--
-- There is no backfill step for "jobId": at the time this migration is
-- authored, Module 13 is the first code anywhere in this repo to write a
-- "reviews" row, so the table is guaranteed empty on every environment
-- this migration will ever run against. Adding "jobId" as NOT NULL
-- directly (no nullable-then-backfill-then-not-null dance, unlike
-- Appointment.jobId in the Module 11 migration, which *did* need to
-- account for pre-existing rows) is safe for exactly that reason.
--
-- Nothing existing is renamed or dropped; no other table is touched; no
-- existing FK/index/CHECK constraint from a prior migration is removed.

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN "jobId" UUID NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "status" SET DEFAULT 'PUBLISHED';

-- CreateIndex
CREATE UNIQUE INDEX "reviews_jobId_key" ON "reviews"("jobId");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
