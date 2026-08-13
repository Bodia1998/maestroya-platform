import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import { canReceivePayouts, type ProfessionalVerificationStatusValue } from "@/domain/services/professional-verification-rules";

export interface PayoutEligibility {
  eligible: boolean;
  /** `"NOT_STARTED"` when the professional has no case at all (never
   *  submitted for verification) — distinct from every
   *  `ProfessionalVerificationStatusValue`, which always describes an
   *  existing case. Matches the module brief's status vocabulary for the
   *  one state that has no row to read it off of. */
  status: ProfessionalVerificationStatusValue | "NOT_STARTED";
  reason: string;
}

/**
 * Module 59 — Professional Verification (Persona): the "BlockPayoutWhenNotVerified"
 * use case from the module brief, and the concrete implementation behind
 * `professional.canReceivePayouts()`. Financial code (the future Stripe
 * Connect payout module) depends on this use case — never on
 * `ProfessionalVerificationRepository`, `ProfessionalVerificationStatus`,
 * or any Persona detail directly — so verification stays a black box to
 * the financial layer, exactly as `PaymentGateway`'s own doc comment
 * requires in the other direction (application/ports/payment-gateway.ts).
 *
 * Eligibility is a pure function of `ProfessionalVerification.status`
 * (`canReceivePayouts` in professional-verification-rules.ts) — APPROVED
 * only, regardless of whether that APPROVED came from a human reviewer or
 * a Persona decision. A professional with no case at all, or a case in
 * any non-APPROVED status (PENDING, UNDER_REVIEW, REJECTED,
 * RESUBMISSION_REQUIRED, EXPIRED), is blocked.
 */
export class CheckPayoutEligibilityUseCase {
  constructor(private readonly verifications: ProfessionalVerificationRepository) {}

  async execute(professionalProfileId: string): Promise<PayoutEligibility> {
    const verification = await this.verifications.findActiveByProfessionalProfileId(professionalProfileId);

    if (!verification) {
      // `findActiveByProfessionalProfileId` excludes EXPIRED cases (see its
      // own doc comment) — a professional whose only case history is a
      // lapsed APPROVED case also lands here as "NOT_STARTED" rather than
      // "EXPIRED". Blocking behavior is unaffected either way (`eligible:
      // false` in both cases); only this label is imprecise. Documented
      // rather than adding a new "find most recent case regardless of
      // status" repository method for a cosmetic distinction — see
      // docs/MODULE_59_PROFESSIONAL_VERIFICATION_PERSONA.md, "Remaining
      // limitations".
      return {
        eligible: false,
        status: "NOT_STARTED",
        reason: "This professional has not started identity verification.",
      };
    }

    const eligible = canReceivePayouts(verification.status);
    return {
      eligible,
      status: verification.status,
      reason: eligible
        ? "Identity verification is approved."
        : `Identity verification is not approved (current status: ${verification.status}).`,
    };
  }
}
