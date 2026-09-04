-- Module 96 Financial Fix Pass — at most one PENDING/PROCESSING payout
-- per partner, enforced at the database level (fixes
-- CreatePartnerPayoutUseCase's former check-then-create race). Prisma's
-- schema DSL cannot express a partial unique index without a preview
-- feature this codebase does not otherwise use, so this constraint is
-- declared here only (see PartnerPayout's own doc comment in
-- schema.prisma) and enforced in application code exclusively through
-- PartnerPayoutRepository.createBatch, which relies on this index's
-- P2002 violation.
CREATE UNIQUE INDEX "partner_payouts_one_inflight_per_partner"
  ON "partner_payouts" ("partnerId")
  WHERE "status" IN ('PENDING', 'PROCESSING');
