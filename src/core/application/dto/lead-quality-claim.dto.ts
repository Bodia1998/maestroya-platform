import type { LeadQualityClaimRecord } from "@/domain/repositories/lead-quality-claim-repository";
import type { LeadQualityClaimReasonCode, LeadQualityClaimStatus } from "@/domain/services/lead-quality-claim";

/**
 * Module 154 — what a use case returns about a claim. It deliberately has NO financial field: a claim decision (even APPROVED)
 * is not a refund and this DTO must never be read as one. No customer data is present (the description is the professional's own text).
 */
export interface LeadQualityClaimDTO {
  id: string;
  leadPurchaseId: string;
  reasonCode: LeadQualityClaimReasonCode;
  status: LeadQualityClaimStatus;
  evidenceReference: string | null;
  submittedAt: string;
  respondBy: string;
  reviewStartedAt: string | null;
  decidedAt: string | null;
  decisionExplanation: string | null;
}

export function toLeadQualityClaimDto(record: LeadQualityClaimRecord): LeadQualityClaimDTO {
  return {
    id: record.id,
    leadPurchaseId: record.leadPurchaseId,
    reasonCode: record.reasonCode,
    status: record.status,
    evidenceReference: record.evidenceReference,
    submittedAt: record.submittedAt.toISOString(),
    respondBy: record.respondBy.toISOString(),
    reviewStartedAt: record.reviewStartedAt ? record.reviewStartedAt.toISOString() : null,
    decidedAt: record.decidedAt ? record.decidedAt.toISOString() : null,
    decisionExplanation: record.decisionExplanation,
  };
}
