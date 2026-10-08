import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 144 — what the checkout page may know about the caller's own LeadPurchase.
 *
 * Explicit whitelist built ONLY through `toLeadPurchaseCheckoutDto`: no professional id, no
 * customer / contact data, no payment reference, no provider id, no pricing provenance. The
 * money fields are the persisted M135/M136 snapshot strings, passed through untouched — the
 * frontend renders them and never derives one from another. `taxAmount` / `totalAmount` are
 * null only for purchases created before Module 136 (nothing is invented for them).
 * `status` is the authoritative backend purchase status; nothing here grants contact access.
 */
export interface LeadPurchaseCheckoutDTO {
  /** Lookup id only (needed to continue to payment); never proof of ownership. */
  purchaseId: string;
  leadId: string;
  status: LeadPurchaseStatus;
  /** Net lead fee, exact decimal string. */
  feeAmount: string;
  /** IVA on the fee, exact decimal string (M136). */
  taxAmount: string | null;
  /** Fee + IVA, exact decimal string (M136): what the professional pays. */
  totalAmount: string | null;
  currency: string;
}

export function toLeadPurchaseCheckoutDto(record: LeadPurchaseRecord): LeadPurchaseCheckoutDTO {
  return {
    purchaseId: record.id,
    leadId: record.leadId,
    status: record.status,
    feeAmount: record.financialSnapshot.feeAmount,
    taxAmount: record.financialSnapshot.taxAmount,
    totalAmount: record.financialSnapshot.totalAmount,
    currency: record.financialSnapshot.currency,
  };
}
