import type { ProfessionalBillingIdentityRepository } from "@/domain/repositories/professional-billing-identity-repository";
import {
  evaluateBillingIdentityReadiness,
  toBillingIdentitySnapshot,
  type BillingIdentityReadiness,
  type BillingIdentitySnapshot,
} from "@/domain/services/professional-billing-identity";

export interface ProfessionalBillingReadiness extends BillingIdentityReadiness {
  /** Present only when `billingReady`: a frozen copy for M150 to attach to an invoice. */
  snapshot: BillingIdentitySnapshot | null;
}

/**
 * Module 146 — the authoritative, TRUSTED-INTERNAL query later modules consume
 * (M147 eligibility policy: `billingReady`; M150 invoice: `snapshot`).
 *
 * It takes a `professionalProfileId` that the CALLER has already resolved from a
 * session or from a persisted purchase, so it must never be wired to a Server
 * Action or route that accepts that id from the client, and its result (which
 * contains the tax id and address in `snapshot`) must never be placed in a
 * marketplace, lead-preview, notification or contact DTO. M146 itself calls it
 * from nowhere: it changes NO purchase or payment gate.
 */
export class GetProfessionalBillingReadinessUseCase {
  constructor(private readonly identities: ProfessionalBillingIdentityRepository) {}

  async execute(professionalProfileId: string): Promise<ProfessionalBillingReadiness> {
    const record = await this.identities.findByProfessionalProfileId(professionalProfileId);
    const readiness = evaluateBillingIdentityReadiness(record);
    return { ...readiness, snapshot: record ? toBillingIdentitySnapshot(record) : null };
  }
}
