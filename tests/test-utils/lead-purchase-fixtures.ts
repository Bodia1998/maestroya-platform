import type { LeadPurchaseRecord } from "@/domain/repositories/lead-purchase-repository";
import { toLeadPurchaseFinancialSnapshot } from "@/domain/services/lead-purchase-financial-snapshot";
import { LeadNotPurchasableError } from "@/domain/services/lead-purchase";

/**
 * Module 135 test helper (tests only): builds the PENDING_PAYMENT record the Prisma
 * repository's `initiate` would create from a Lead's M133 publication snapshot — the
 * same pure domain function, so fakes cannot drift from production semantics. An
 * incomplete/missing snapshot is "not purchasable", exactly like the locked-row check.
 */
export function pendingPurchaseFromPublication(
  id: string,
  leadId: string,
  professionalProfileId: string,
  publication: unknown,
): LeadPurchaseRecord {
  let financialSnapshot;
  try {
    financialSnapshot = toLeadPurchaseFinancialSnapshot(publication);
  } catch {
    throw new LeadNotPurchasableError();
  }
  return {
    id,
    leadId,
    professionalProfileId,
    status: "PENDING_PAYMENT",
    price: Number(financialSnapshot.feeAmount),
    currency: financialSnapshot.currency,
    financialSnapshot,
    confirmedAt: null,
    refundedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
