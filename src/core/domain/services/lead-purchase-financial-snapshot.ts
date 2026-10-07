import { LeadPublicationRejectedError, isLeadPublicationSnapshotComplete } from "@/domain/services/lead-publication";

/**
 * Module 135 — the immutable financial snapshot of ONE LeadPurchase, as stored.
 *
 * `feeAmount` + `currency` are the lead fee the professional agreed to pay
 * MaestroYa, copied from the Lead's M133 publication snapshot when the purchase
 * was created. They are exact decimal STRINGS (never JS numbers) and are never
 * recomputed from mutable pricing configuration. The provenance fields say
 * which published snapshot produced the fee; they are null only for purchases
 * created before Module 135 (nothing is fabricated for those).
 *
 * `taxAmount` / `totalAmount` are a deliberately neutral, forward-compatible
 * placeholder: null = "tax not determined". Module 135 never computes tax; the
 * authoritative lead-fee tax policy belongs to Module 136.
 *
 * Kept in its own file so the M133 publication contract and the M123 purchase
 * rules stay free of each other (no import cycle).
 */
export interface LeadPurchaseFinancialSnapshot {
  feeAmount: string;
  currency: string;
  taxAmount: string | null;
  totalAmount: string | null;
  pricingConfigVersion: string | null;
  pricingRuleVersion: string | null;
  leadPublishedAt: Date | null;
}

/**
 * The financial terms a purchase of a published Lead is created with: the
 * Lead's immutable publication snapshot, copied verbatim. Pure; no arithmetic
 * and no tax (Module 136). Throws LeadPublicationRejectedError("SNAPSHOT_INVALID")
 * when the snapshot is not complete: a purchase can never be priced from
 * anything else.
 */
export function toLeadPurchaseFinancialSnapshot(publication: unknown): LeadPurchaseFinancialSnapshot {
  if (!isLeadPublicationSnapshotComplete(publication)) throw new LeadPublicationRejectedError("SNAPSHOT_INVALID");
  return {
    feeAmount: publication.price,
    currency: publication.currency,
    taxAmount: null,
    totalAmount: null,
    pricingConfigVersion: publication.pricingConfigVersion,
    pricingRuleVersion: publication.pricingRuleVersion,
    leadPublishedAt: publication.publishedAt,
  };
}
