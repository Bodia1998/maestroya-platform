/**
 * Module 61 — Affiliate & Partner System: repository interface for
 * `AffiliateCommission` — the ledger row recording that a partner has
 * earned 10% of a specific, already-recorded Module 22 `Commission`.
 *
 * This module NEVER computes or writes to Module 22's `Commission` table
 * (see `domain/services/affiliate-commission-policy.ts`'s own doc comment)
 * — `platformCommissionRefId`/`platformCommissionAmount` are a snapshot of
 * an already-existing `Commission` row, read-only, the same "reference
 * another bounded context's id via a plain string, never a cross-module FK"
 * convention `ConversionEventRecord.referenceId` already establishes (see
 * that repository's own doc comment for the identical reasoning).
 *
 * Idempotency: `conversionEventId` is unique — at most one
 * `AffiliateCommission` is ever recorded per Module 60 `ConversionEvent`
 * (specifically, per `COMMISSION_GENERATED` event), so a webhook/use-case
 * retry can never double-pay a partner for the same booking.
 */
export const AFFILIATE_COMMISSION_STATUS_VALUES = ["PENDING", "APPROVED", "PAID", "CANCELLED", "EXPIRED"] as const;
export type AffiliateCommissionStatusValue = (typeof AFFILIATE_COMMISSION_STATUS_VALUES)[number];

export interface AffiliateCommissionRecord {
  id: string;
  partnerId: string;
  /** The `ReferralCode.code` that drove the attribution behind this
   *  commission — denormalized (not just the id) so a report/ledger export
   *  never needs a join back to `referral_codes` to be readable. */
  referralCode: string;
  /** Module 60 `ConversionEvent.id` (type `COMMISSION_GENERATED`) this
   *  commission was derived from — the uniqueness anchor for idempotency. */
  conversionEventId: string;
  /** Module 22 `Commission.id` — plain string reference, never a Prisma
   *  relation across module boundaries (see class doc comment). */
  platformCommissionRefId: string;
  /** Snapshot of `Commission.amount` at the time this row was created —
   *  never re-read live, so a later Module 22 correction never silently
   *  changes an already-recorded affiliate ledger entry. */
  platformCommissionAmount: number;
  /** Basis points actually applied — snapshotted the same way
   *  `CommissionRecord.rateBps` is, so a future rate change never
   *  retroactively changes what an already-recorded row says it paid. */
  affiliateRateBps: number;
  affiliateAmount: number;
  status: AffiliateCommissionStatusValue;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  expiresAt: Date;
  expiredAt: Date | null;
  paidAt: Date | null;
  payoutId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAffiliateCommissionData {
  partnerId: string;
  referralCode: string;
  conversionEventId: string;
  platformCommissionRefId: string;
  platformCommissionAmount: number;
  affiliateRateBps: number;
  affiliateAmount: number;
  expiresAt: Date;
}

export interface AffiliateEarningsTotals {
  pendingTotal: number;
  approvedTotal: number;
  paidTotal: number;
}

export interface AffiliateCommissionRepository {
  create(data: CreateAffiliateCommissionData): Promise<AffiliateCommissionRecord>;
  findById(id: string): Promise<AffiliateCommissionRecord | null>;
  /** Idempotency lookup — see class doc comment. */
  findByConversionEventId(conversionEventId: string): Promise<AffiliateCommissionRecord | null>;
  listForPartner(partnerId: string, filter?: { status?: AffiliateCommissionStatusValue }): Promise<AffiliateCommissionRecord[]>;
  /** Every row still `PENDING` whose `expiresAt` is at or before `asOf` —
   *  feeds `ExpireAffiliateCommissionsUseCase`'s batch sweep. */
  listExpirable(asOf: Date): Promise<AffiliateCommissionRecord[]>;
  /** Every `APPROVED` row for a partner, oldest first — the exact set
   *  `CreatePartnerPayoutUseCase` selects from (see
   *  `domain/services/partner-payout-rules.ts`). */
  listApprovedForPartner(partnerId: string): Promise<AffiliateCommissionRecord[]>;
  updateStatus(
    id: string,
    data: {
      status: AffiliateCommissionStatusValue;
      approvedAt?: Date | null;
      cancelledAt?: Date | null;
      cancelReason?: string | null;
      expiredAt?: Date | null;
      paidAt?: Date | null;
      payoutId?: string | null;
    },
  ): Promise<AffiliateCommissionRecord>;
  /** Marks every commission in `ids` PAID and stamps `payoutId` — used by
   *  `CreatePartnerPayoutUseCase` to settle a whole payout batch
   *  atomically-in-intent (the Prisma implementation wraps this in a single
   *  `updateMany`, not `ids.length` sequential round trips). */
  markPaidByIds(ids: string[], payoutId: string, paidAt: Date): Promise<void>;
  totalsForPartner(partnerId: string): Promise<AffiliateEarningsTotals>;
}
