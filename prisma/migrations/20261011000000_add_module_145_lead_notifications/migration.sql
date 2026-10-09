-- Module 145 — LEAD_V1 lead notifications.
--
-- Additive only: four NotificationType values and one nullable idempotency column
-- with a (userId, dedupeKey) unique index. No existing row, column, constraint or
-- trigger is changed. Pre-M145 notifications keep dedupeKey NULL, and Postgres
-- treats NULLs as distinct in a unique index, so they are unconstrained.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_REQUEST_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_PURCHASED';
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_PURCHASE_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'LEAD_PURCHASE_CANCELLED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "dedupeKey" VARCHAR(191);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");
