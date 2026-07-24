-- Same caveat as every prior migration in this repo: hand-authored to
-- mirror what `npx prisma migrate dev` would generate, not engine-verified
-- (no network/DB access in this environment). Run the real command once you
-- have this locally, or apply via `prisma migrate deploy`.
--
-- Admin Panel module (Module 16): the only schema change this module needs.
-- Everything else it moderates already had a usable field before this
-- migration:
--   - User.status (UserStatus: ACTIVE/SUSPENDED/...) already supports
--     suspend/reactivate — added by an earlier module.
--   - Review.status (ReviewStatus: PUBLISHED/FLAGGED/REMOVED/...) already
--     supports moderation — added by Module 13 specifically anticipating
--     this module (see schema.prisma's Review model doc comment).
--   - AuditLog already exists as a general-purpose, append-only audit
--     trail — reused as-is for every admin mutation this module performs.
--   - Role/UserRole already support an ADMIN role — reused as-is.
--
-- PortfolioItem (Module 14) is the one aggregate with no existing
-- moderation concept: it only had `deletedAt`, which is the *owner's own*
-- soft-delete and must not be conflated with admin moderation (see
-- schema.prisma's PortfolioItem.moderatedAt doc comment). This migration
-- adds exactly one nullable, indexed column for that purpose. Nothing
-- existing is renamed, dropped, or made backward-incompatible.

-- AlterTable
ALTER TABLE "portfolio_items" ADD COLUMN "moderatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "portfolio_items_moderatedAt_idx" ON "portfolio_items"("moderatedAt");
