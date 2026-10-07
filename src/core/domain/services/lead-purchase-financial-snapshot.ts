import { computeLeadFeeTax } from "@/domain/services/lead-fee-tax-policy";
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
 * Module 136: `feeAmount` is the NET lead fee. `taxAmount` (21% IVA),
 * `totalAmount` (= fee + IVA, what the professional pays MaestroYa) and
 * `taxPolicyVersion` are computed ONCE, at creation, by the pure lead-fee tax
 * policy from that immutable fee, and stored with it. All three are null only for
 * purchases created before Module 136 ("tax not determined": no tax is invented
 * for them, and they are never recomputed from current rules).
 *
 * Kept in its own file so the M133 publication contract and the M123 purchase
 * rules stay free of each other (no import cycle).
 */
export interface LeadPurchaseFinancialSnapshot {
  feeAmount: string;
  currency: string;
  taxAmount: string | null;
  totalAmount: string | null;
  taxPolicyVersion: string | null;
  pricingConfigVersion: string | null;
  pricingRuleVersion: string | null;
  leadPublishedAt: Date | null;
}

/**
 * The financial terms a purchase of a published Lead is created with: the
 * Lead's immutable publication snapshot, copied verbatim. Pure; the only
 * arithmetic is the Module 136 tax policy over the fee. Throws LeadPublicationRejectedError("SNAPSHOT_INVALID")
 * when the snapshot is not complete: a purchase can never be priced from
 * anything else.
 */
export function toLeadPurchaseFinancialSnapshot(publication: unknown): LeadPurchaseFinancialSnapshot {
  if (!isLeadPublicationSnapshotComplete(publication)) throw new LeadPublicationRejectedError("SNAPSHOT_INVALID");
  const tax = computeLeadFeeTax(publication.price);
  return {
    feeAmount: publication.price,
    currency: publication.currency,
    taxAmount: tax.taxAmount,
    totalAmount: tax.totalAmount,
    taxPolicyVersion: tax.taxPolicyVersion,
    pricingConfigVersion: publication.pricingConfigVersion,
    pricingRuleVersion: publication.pricingRuleVersion,
    leadPublishedAt: publication.publishedAt,
  };
}
