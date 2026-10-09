import {
  decideLeadPurchaseEligibility,
  decideProfessionalVerificationEligibility,
  type LeadPurchaseBillingReadinessFacts,
  type LeadPurchaseEligibilityDecision,
  type LeadPurchaseProfessionalFacts,
} from "@/domain/services/lead-purchase-eligibility";

/**
 * Module 147 — the billing-readiness query the policy consumes. Structurally satisfied by M146's
 * `GetProfessionalBillingReadinessUseCase` (the authoritative implementation); declared as a port so
 * this policy does not re-implement it and can be faked in unit tests.
 */
export interface LeadPurchaseBillingReadinessReader {
  execute(professionalProfileId: string): Promise<LeadPurchaseBillingReadinessFacts>;
}

export interface LeadPurchaseEligibilityProfessional extends LeadPurchaseProfessionalFacts {
  id: string;
}

export interface LeadPurchaseEligibilityEvaluator {
  evaluate(professional: LeadPurchaseEligibilityProfessional | null): Promise<LeadPurchaseEligibilityDecision>;
}

/**
 * Module 147 — LEAD_V1 Professional Eligibility Policy (application service).
 *
 * TRUST: `professional` MUST be the record the CALLER resolved from the server-side session user
 * (`ProfessionalRepository.findByUserId(session user)`). This service accepts no client value; the
 * billing lookup key is that record's own `id`. Only the four readiness facts are copied out of the
 * M146 result — the snapshot (tax id, address) never leaves this method.
 *
 * FAIL CLOSED: M98 is checked first (no billing read for an unverified/inactive professional). If
 * the readiness query throws, the error propagates — a read failure is never turned into eligibility.
 *
 * NOT ATOMIC: the decision is a point-in-time read. It is NOT atomic with a concurrent billing
 * identity update or admin decision (the purchase transaction locks the lead row, not the billing
 * row); callers keep the window small by evaluating right before the write and re-evaluating before a
 * new provider payment is created.
 */
export class LeadPurchaseEligibilityPolicy implements LeadPurchaseEligibilityEvaluator {
  constructor(private readonly billingReadiness: LeadPurchaseBillingReadinessReader) {}

  async evaluate(professional: LeadPurchaseEligibilityProfessional | null): Promise<LeadPurchaseEligibilityDecision> {
    const verification = decideProfessionalVerificationEligibility(professional);
    if (!verification.eligible || !professional) return verification;

    const readiness = await this.billingReadiness.execute(professional.id);
    return decideLeadPurchaseEligibility({
      professional,
      billing: readiness
        ? { state: readiness.state, isComplete: readiness.isComplete, isVerified: readiness.isVerified, billingReady: readiness.billingReady }
        : null,
    });
  }
}
