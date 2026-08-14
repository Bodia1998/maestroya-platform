/**
 * Module 61 — Affiliate & Partner System: repository interface for
 * `Partner` — the affiliate/partner account a user operates alongside
 * their normal `User` row. One `Partner` per `User` (`userId` unique).
 *
 * Deliberately does NOT duplicate anything from Module 60: a Partner's
 * referral links are ordinary `ReferralCode` rows owned by the partner's
 * own `userId` (see `ReferralCodeRepository.findByOwnerUserId`, added by
 * this module) — there is no separate "partner referral code" table. This
 * is what "reuse the existing attribution, referral code and conversion
 * infrastructure" means in practice for this module.
 */
export const PARTNER_TYPE_VALUES = [
  "INDIVIDUAL",
  "COMPANY",
  "AGENCY",
  "BLOGGER",
  "TELEGRAM_CHANNEL",
  "INSTAGRAM_CREATOR",
  "TIKTOK_CREATOR",
  "YOUTUBE_CREATOR",
  "FACEBOOK_COMMUNITY",
] as const;
export type PartnerTypeValue = (typeof PARTNER_TYPE_VALUES)[number];

export const PARTNER_STATUS_VALUES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED", "BANNED"] as const;
export type PartnerStatusValue = (typeof PARTNER_STATUS_VALUES)[number];

export const PARTNER_PAYOUT_METHOD_VALUES = ["MANUAL", "STRIPE"] as const;
export type PartnerPayoutMethodValue = (typeof PARTNER_PAYOUT_METHOD_VALUES)[number];

/** Free-form, provider-shaped payout details (e.g. `{ iban: "..." }` for
 *  MANUAL, or a future `{ stripeConnectAccountId: "..." }` for STRIPE).
 *  Stored as JSON precisely because this module never validates a specific
 *  provider's schema — see docs/MODULE_61's "Future Stripe support"
 *  section for why the field is provider-agnostic on purpose. */
export type PartnerPayoutDetails = Record<string, unknown>;

export interface PartnerRecord {
  id: string;
  userId: string;
  type: PartnerTypeValue;
  status: PartnerStatusValue;
  displayName: string;
  contactEmail: string;
  payoutMethod: PartnerPayoutMethodValue;
  payoutDetails: PartnerPayoutDetails | null;
  /** Minimum accumulated APPROVED commission total (in the platform's base
   *  currency) before a payout can be created for this partner. Per-partner
   *  so a future negotiated threshold never requires a schema change — see
   *  `domain/services/partner-payout-rules.ts`'s own doc comment. */
  minimumPayoutThreshold: number;
  notes: string | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  rejectedAt: Date | null;
  rejectedReason: string | null;
  suspendedAt: Date | null;
  suspendedReason: string | null;
  bannedAt: Date | null;
  bannedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerData {
  userId: string;
  type: PartnerTypeValue;
  displayName: string;
  contactEmail: string;
  payoutMethod?: PartnerPayoutMethodValue;
  payoutDetails?: PartnerPayoutDetails | null;
  minimumPayoutThreshold?: number;
}

/** Every field a status-transition use case (approve/reject/suspend/ban)
 *  may update — always a strict subset applied on top of the existing row,
 *  never a full replace, so an unrelated field is never accidentally
 *  cleared by, say, `SuspendPartnerUseCase`. */
export interface UpdatePartnerStatusData {
  status: PartnerStatusValue;
  approvedAt?: Date | null;
  approvedByUserId?: string | null;
  rejectedAt?: Date | null;
  rejectedReason?: string | null;
  suspendedAt?: Date | null;
  suspendedReason?: string | null;
  bannedAt?: Date | null;
  bannedReason?: string | null;
}

export interface PartnerRepository {
  create(data: CreatePartnerData): Promise<PartnerRecord>;
  findById(id: string): Promise<PartnerRecord | null>;
  findByUserId(userId: string): Promise<PartnerRecord | null>;
  updateStatus(id: string, data: UpdatePartnerStatusData): Promise<PartnerRecord>;
  /** Admin-panel listing, optionally filtered by status. No pagination yet
   *  — same "this catalog is expected to stay small for now" convention
   *  `ReferralCodeRepository.list` documents; add pagination here first if
   *  that assumption stops holding. */
  list(filter?: { status?: PartnerStatusValue }): Promise<PartnerRecord[]>;
  countByStatus(status: PartnerStatusValue): Promise<number>;
}
