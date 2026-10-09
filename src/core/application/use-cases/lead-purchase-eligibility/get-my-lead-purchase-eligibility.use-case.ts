import type { LeadPurchaseEligibilityEvaluator } from "@/application/services/lead-purchase-eligibility-policy";
import type { LeadPurchaseIneligibilityReason } from "@/domain/services/lead-purchase-eligibility";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";

/** Safe, display-only answer for the signed-in professional's own state: a flag and a closed reason code. Nothing else. */
export type LeadPurchaseEligibilityDTO = { eligible: true; reason: null } | { eligible: false; reason: LeadPurchaseIneligibilityReason };

/**
 * Module 147 — read-only view of the CALLER's own eligibility, for UI guidance. NOT a security
 * boundary: the enforcing checks live in `InitiateLeadPurchaseUseCase` and
 * `InitiateLeadFeePaymentUseCase`. `userId` is the server-session user; the professional is resolved
 * from it and the response contains no billing detail, tax id, address or note.
 */
export class GetMyLeadPurchaseEligibilityUseCase {
  constructor(
    private readonly professionals: ProfessionalRepository,
    private readonly policy: LeadPurchaseEligibilityEvaluator,
  ) {}

  async execute(userId: string): Promise<LeadPurchaseEligibilityDTO> {
    if (typeof userId !== "string" || userId === "") return { eligible: false, reason: "NO_PROFESSIONAL_PROFILE" };
    const professional = await this.professionals.findByUserId(userId);
    const decision = await this.policy.evaluate(professional);
    return decision.eligible ? { eligible: true, reason: null } : { eligible: false, reason: decision.reason };
  }
}
