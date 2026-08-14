import type { PartnerPayoutMethodValue } from "@/domain/repositories/partner-repository";

/**
 * Module 61 — Affiliate & Partner System: repository interface for
 * `PartnerPayout` — one row per batch of `AffiliateCommission`s settled
 * together for a partner. `method` is always `MANUAL` today; `STRIPE` is
 * modeled in the enum/schema now purely so the architecture doesn't need a
 * migration later, but no Stripe SDK call happens anywhere in this module
 * — see docs/MODULE_61's "Future Stripe support" section.
 */
export const PARTNER_PAYOUT_STATUS_VALUES = ["PENDING", "PROCESSING", "PAID", "FAILED", "CANCELLED"] as const;
export type PartnerPayoutStatusValue = (typeof PARTNER_PAYOUT_STATUS_VALUES)[number];

export interface PartnerPayoutRecord {
  id: string;
  partnerId: string;
  amount: number;
  currency: string;
  method: PartnerPayoutMethodValue;
  status: PartnerPayoutStatusValue;
  /** External reference (e.g. a bank transfer reference today, a future
   *  Stripe transfer id) — opaque to this module, never parsed. */
  reference: string | null;
  periodStart: Date;
  periodEnd: Date;
  processedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePartnerPayoutData {
  partnerId: string;
  amount: number;
  currency?: string;
  method: PartnerPayoutMethodValue;
  periodStart: Date;
  periodEnd: Date;
}

export interface PartnerPayoutRepository {
  create(data: CreatePartnerPayoutData): Promise<PartnerPayoutRecord>;
  findById(id: string): Promise<PartnerPayoutRecord | null>;
  listForPartner(partnerId: string): Promise<PartnerPayoutRecord[]>;
  updateStatus(
    id: string,
    data: { status: PartnerPayoutStatusValue; reference?: string | null; processedAt?: Date | null; failureReason?: string | null },
  ): Promise<PartnerPayoutRecord>;
}
