-- Hand-authored (same caveat as every prior migration in this repo: no
-- Postgres/engine access in this environment to run `prisma migrate dev`
-- and have it generate this file from a real diff). Mirrors what that
-- command would produce for the schema changes below. Run the real
-- command once you have a database locally to double-check, then delete
-- this comment block.
--
-- Notifications module (Module 15): reshapes the "notifications" table
-- that the Phase-1 domain model migration (20260717000000_init_domain_model)
-- already created as a placeholder. That placeholder anticipated
-- multi-channel (email/SMS/push) delivery — "channel"/"status"/"sentAt" —
-- that no module has ever read or written; this table has zero rows in any
-- environment this migration will run against (nothing in the codebase
-- before this module wrote to it), so every column below is altered
-- directly rather than nullable-then-backfilled, same reasoning as the
-- Module 13/14 migrations used for their own brand-new tables.
--
-- Column changes:
--   * "channel" (NotificationChannel), "status" (NotificationStatus),
--     "sentAt" — dropped. In-app only; multi-channel delivery is a valid
--     future extension that would reintroduce a channel/status pair
--     without disturbing this shape (see schema.prisma's Notification doc
--     comment).
--   * "body" -> renamed to "message" (same TEXT NOT NULL column, new name
--     matching the module's DTO/domain vocabulary).
--   * "data" -> renamed to "metadata" (same nullable JSONB column).
--   * "deletedAt" -> renamed to "dismissedAt" (same nullable TIMESTAMP(3)
--     column) — this table's soft-delete marker was already named
--     "deletedAt"; Module 15 calls the same concept "dismissedAt" to match
--     its own domain vocabulary (a notification is "dismissed", not
--     "deleted" — see DismissNotificationUseCase).
--   * "resourceType", "resourceId", "actionUrl" — new nullable TEXT
--     columns for deep-linking a notification back to the resource it's
--     about.
--
-- "NotificationType" is rebuilt from scratch with the module's concrete,
-- currently-triggered value set (see schema.prisma's enum doc comment) —
-- Postgres has no single statement to remove enum values, so this follows
-- the standard "create new type, swap the column over, drop the old type"
-- sequence. The column has zero rows to cast, so the `USING (NULL)` cast
-- below is safe (mirrors the same technique used for
-- "appointments"."cancellationReason" in
-- 20260723010000_add_appointment_scheduling_lifecycle/migration.sql).
-- "NotificationChannel" and "NotificationStatus" are dropped outright —
-- nothing else in the schema ever referenced them.
--
-- Indexes are rebuilt to match this module's two hot read paths: "list
-- this user's active (non-dismissed) notifications, newest first" and
-- "count this user's unread, non-dismissed notifications".

-- AlterEnum: rebuild NotificationType with the concrete, currently-
-- triggered value set.
CREATE TYPE "NotificationType_new" AS ENUM (
    'NEW_QUOTE',
    'QUOTE_ACCEPTED',
    'QUOTE_REJECTED',
    'NEW_MESSAGE',
    'APPOINTMENT_PROPOSED',
    'APPOINTMENT_CONFIRMED',
    'APPOINTMENT_CANCELLED',
    'JOB_STARTED',
    'JOB_COMPLETED',
    'JOB_CANCELLED',
    'REVIEW_RECEIVED'
);

ALTER TABLE "notifications" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING (NULL);
ALTER TABLE "notifications" ALTER COLUMN "type" SET NOT NULL;

DROP TYPE "NotificationType";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";

-- AlterTable: drop the old indexes that reference columns being dropped
-- below before dropping those columns.
DROP INDEX IF EXISTS "notifications_userId_readAt_idx";
DROP INDEX IF EXISTS "notifications_userId_createdAt_idx";
DROP INDEX IF EXISTS "notifications_deletedAt_idx";

-- AlterTable: drop multi-channel-delivery columns this module doesn't use.
ALTER TABLE "notifications" DROP COLUMN "channel";
ALTER TABLE "notifications" DROP COLUMN "status";
ALTER TABLE "notifications" DROP COLUMN "sentAt";

-- AlterTable: rename columns to this module's vocabulary.
ALTER TABLE "notifications" RENAME COLUMN "body" TO "message";
ALTER TABLE "notifications" RENAME COLUMN "data" TO "metadata";
ALTER TABLE "notifications" RENAME COLUMN "deletedAt" TO "dismissedAt";

-- AlterTable: add the new deep-linking columns.
ALTER TABLE "notifications" ADD COLUMN "resourceType" TEXT;
ALTER TABLE "notifications" ADD COLUMN "resourceId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "actionUrl" TEXT;

-- DropEnum: no longer referenced by any column.
DROP TYPE "NotificationChannel";
DROP TYPE "NotificationStatus";

-- CreateIndex
CREATE INDEX "notifications_userId_dismissedAt_createdAt_idx" ON "notifications"("userId", "dismissedAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_dismissedAt_idx" ON "notifications"("userId", "readAt", "dismissedAt");
