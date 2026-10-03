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
  confirmedAt: Date | null;
  createdAt: Date;
}

export function toLeadPurchaseDto(record: LeadPurchaseRecord): LeadPurchaseDTO {
  return {
    purchaseId: record.id,
    leadId: record.leadId,
    status: record.status,
    price: record.price,
    currency: record.currency,
    confirmedAt: record.confirmedAt,
    createdAt: record.createdAt,
  };
}
