import { LeadPurchaseEligibilityPolicy } from "@/application/services/lead-purchase-eligibility-policy";
import { makeGetProfessionalBillingReadinessUseCase } from "@/application/use-cases/billing-identity/compose";
import { GetMyLeadPurchaseEligibilityUseCase } from "@/application/use-cases/lead-purchase-eligibility/get-my-lead-purchase-eligibility.use-case";
import { PrismaProfessionalRepository } from "@/infrastructure/database/prisma/repositories/prisma-professional-repository";

/**
 * Module 147 — composition root of the LEAD_V1 eligibility policy (plain factories, no DI container).
 * The ONLY place that wires the M146 readiness query into the policy; the purchase and payment
 * composition roots obtain the policy from here.
 */
export function makeLeadPurchaseEligibilityPolicy() {
  return new LeadPurchaseEligibilityPolicy(makeGetProfessionalBillingReadinessUseCase());
}

/** Read-only, session-user-only: for the purchase page's guidance. */
export function makeGetMyLeadPurchaseEligibilityUseCase() {
  return new GetMyLeadPurchaseEligibilityUseCase(new PrismaProfessionalRepository(), makeLeadPurchaseEligibilityPolicy());
}
