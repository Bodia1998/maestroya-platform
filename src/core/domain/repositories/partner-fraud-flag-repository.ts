/**
 * Module 61 — Affiliate & Partner System: repository interface for
 * `PartnerFraudFlag` — a flagged suspicious-activity signal against a
 * partner, raised by `DetectPartnerFraudSignalsUseCase` (see
 * `domain/services/affiliate-fraud-rules.ts` for the pure detection rules)
 * and reviewed by an admin. Flagging is always advisory: nothing in this
 * module automatically suspends/bans a partner or cancels a commission
 * purely because a flag was raised — see docs/MODULE_61's "Fraud
 * Protection" section for why a human always makes the final call.
 */
export const PARTNER_FRAUD_FLAG_TYPE_VALUES = [
  "SELF_REFERRAL",
  "DUPLICATE_ACCOUNT",
  "SUSPICIOUS_CONVERSION",
  "REPEATED_IP",
  "REPEATED_DEVICE",
  "FAKE_REGISTRATION",
] as const;
export type PartnerFraudFlagTypeValue = (typeof PARTNER_FRAUD_FLAG_TYPE_VALUES)[number];

export const PARTNER_FRAUD_FLAG_STATUS_VALUES = ["OPEN", "REVIEWED", "DISMISSED", "CONFIRMED"] as const;
export type PartnerFraudFlagStatusValue = (typeof PARTNER_FRAUD_FLAG_STATUS_VALUES)[number];

export interface PartnerFraudFlagRecord {
  id: string;
  partnerId: string;
  type: PartnerFraudFlagTypeValue;
  status: PartnerFraudFlagStatusValue;
  /** Human-readable explanation of what was detected — always safe to show
   *  an admin verbatim (never includes a raw IP, only ever an `ipHash` if
   *  relevant, matching Module 60/24's own "never persist a raw IP"
   *  convention). */
  detail: string;
  relatedReferralCode: string | null;
  relatedVisitorId: string | null;
  relatedUserId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolution: string | null;
  createdAt: Date;
}

export interface CreatePartnerFraudFlagData {
  partnerId: string;
  type: PartnerFraudFlagTypeValue;
  detail: string;
  relatedReferralCode?: string | null;
  relatedVisitorId?: string | null;
  relatedUserId?: string | null;
}

export interface PartnerFraudFlagRepository {
  create(data: CreatePartnerFraudFlagData): Promise<PartnerFraudFlagRecord>;
  listForPartner(partnerId: string): Promise<PartnerFraudFlagRecord[]>;
  listOpen(): Promise<PartnerFraudFlagRecord[]>;
  resolve(
    id: string,
    data: { status: "REVIEWED" | "DISMISSED" | "CONFIRMED"; resolvedByUserId: string; resolution: string },
  ): Promise<PartnerFraudFlagRecord>;
  countOpenForPartner(partnerId: string): Promise<number>;
}
