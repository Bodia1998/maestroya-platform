import { LeadFeeDisputeRejectedError } from "@/domain/services/lead-fee-dispute";
import { normalizeLeadFeeRefundEvidenceReference, normalizeLeadFeeRefundExplanation } from "@/domain/services/lead-fee-refund";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeId(raw: unknown): string {
  if (typeof raw !== "string" || !UUID.test(raw.trim())) throw new LeadFeeDisputeRejectedError("INVALID_INPUT");
  return raw.trim();
}

/**
 * Free text written by an administrator (revocation explanation, evidence text): trimmed, never truncated, 1..1000 characters, and
 * obvious e-mail addresses / URLs / phone-like digit runs are rejected. The check is the SAME heuristic Module 153 uses for its
 * explanation (imported, not copied); it is NOT a guarantee that no personal data is present.
 */
export function normalizeAdminText(raw: unknown): string {
  try {
    return normalizeLeadFeeRefundExplanation(raw);
  } catch {
    throw new LeadFeeDisputeRejectedError("INVALID_INPUT");
  }
}

/** Opaque incident / evidence reference (ticket id etc.), separate from the free text. */
export function normalizeEvidenceReference(raw: unknown): string {
  try {
    return normalizeLeadFeeRefundEvidenceReference(raw);
  } catch {
    throw new LeadFeeDisputeRejectedError("INVALID_INPUT");
  }
}
