-- Hand-authored (no Postgres/Prisma-engine access in this sandbox to run
-- `prisma migrate dev` and have it generate this file from a real diff —
-- see prisma/migrations/20260901000000_add_external_webhook_event_idempotency/
-- migration.sql and prior migrations for the same confirmed precedent).
-- Mirrors what that command would produce for the schema change below.
-- Run the real command once you have a database locally to double-check,
-- then delete this comment block.
--
-- Module 88 — GDPR Erasure Execution & Document Retention.
--
-- Two purely additive, nullable columns. No existing table is renamed,
-- dropped, or has a column removed. No existing row is rewritten (every
-- new column defaults to NULL for all pre-existing rows, which is the
-- correct "not yet erased / not yet purged" state for data that predates
-- this migration).
--
-- 1) users.personalDataErasedAt — ExecuteAccountErasureUseCase's own
--    idempotency guard (see that use case's doc comment and User's schema
--    doc comment for why this is distinct from the pre-existing
--    `deletedAt`).
-- 2) professional_verification_documents.deletedAt /
--    professional_verification_documents.storagePurgedAt — the erasure
--    execution's document-retention lifecycle: `deletedAt` marks a
--    document erased from the platform's own database; `storagePurgedAt`
--    marks the separate, retryable confirmation that the underlying
--    Cloudinary file was actually deleted (see the model's own doc
--    comment in schema.prisma).

ALTER TABLE "users" ADD COLUMN "personalDataErasedAt" TIMESTAMP(3);

CREATE INDEX "users_personalDataErasedAt_idx" ON "users"("personalDataErasedAt");

ALTER TABLE "professional_verification_documents" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "professional_verification_documents" ADD COLUMN "storagePurgedAt" TIMESTAMP(3);

CREATE INDEX "professional_verification_documents_deletedAt_idx" ON "professional_verification_documents"("deletedAt");
