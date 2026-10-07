import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import type { LeadPurchaseStatus } from "@/domain/services/lead-purchase";

/**
 * Module 126 — safe result of a LeadPurchase operation. Explicit whitelist:
 * no professional id, no customer data, no contact data. A purchase result
 * (any status) never unlocks contact — only Module 122's policy does.
 */
export interface LeadPurchaseDTO {
  purchaseId: string;
  leadId: string;
  status: LeadPurchaseStatus;
  price: number;
  currency: string;
  /** Module 136: exact decimal strings from the immutable snapshot; null only for pre-M136 purchases. */
  taxAmount: string | null;
  totalAmount: string | null;
  taxPolicyVersion: string | null;
  confirmedAt: Date | null;
  /** Module 137 lifecycle audit timestamps (null unless that transition happened). */
  failedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export function toLeadPurchaseDto(record: LeadPurchaseRecord): LeadPurchaseDTO {
  return {
    purchaseId: record.id,
    leadId: record.leadId,
    status: record.status,
    price: record.price,
    currency: record.currency,
    taxAmount: record.financialSnapshot.taxAmount,
    totalAmount: record.financialSnapshot.totalAmount,
    taxPolicyVersion: record.financialSnapshot.taxPolicyVersion,
    confirmedAt: record.confirmedAt,
    failedAt: record.failedAt,
    cancelledAt: record.cancelledAt,
    createdAt: record.createdAt,
  };
}
