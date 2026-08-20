import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import { canReceivePayouts, type ProfessionalVerificationStatusValue } from "@/domain/services/professional-verification-rules";
import type { CompanyVerificationRepository } from "@/domain/repositories/company-verification-repository";
import { canReceivePayouts as canCompanyReceivePayouts, type VerificationCaseStatusValue } from "@/domain/services/company-verification-rules";
import type { CompanyRepository } from "@/domain/repositories/company-repository";
import { isCompanyDiscoverable } from "@/domain/services/company-rules";
import type { CompanyPayoutAccountRepository } from "@/domain/repositories/company-payout-account-repository";
import { isPayoutAccountConnected } from "@/domain/services/professional-onboarding-rules";

export interface PayoutEligibility {
  eligible: boolean;
  status: ProfessionalVerificationStatusValue | VerificationCaseStatusValue | "NOT_STARTED";
  reason: string;
}

/**
 * Module 59 — Professional Verification (Persona): the "BlockPayoutWhenNotVerified"
 * use case from the module brief, and the concrete implementation behind
 * professional.canReceivePayouts(). Financial code (the future Stripe
 * Connect payout module) depends on this use case, never on
 * ProfessionalVerificationRepository, ProfessionalVerificationStatus,
 * or any Persona detail directly.
 *
 * Eligibility is a pure function of ProfessionalVerification.status
 * (canReceivePayouts in professional-verification-rules.ts) - APPROVED
 * only, regardless of whether that APPROVED came from a human reviewer or
 * a Persona decision.
 *
 * ## Module 75 - Company Payout Eligibility
 * execute(professionalProfileId) above is completely unchanged - same
 * signature, same single dependency, same behavior for every existing
 * caller. Company-owned jobs are handled by the separate executeForCompany
 * method added below, which requires three additional, optional
 * constructor dependencies (companyVerifications/companies/
 * companyPayoutAccounts). They are optional specifically so every
 * existing composition root that only ever calls execute() (e.g.
 * verification/compose.ts) does not have to change - only job/compose.ts,
 * which actually needs company support for EvaluatePaymentReleaseUseCase,
 * supplies them. Calling executeForCompany without them configured is a
 * programming error (throws), never a silent "eligible: false" - that
 * would be indistinguishable from a genuinely ineligible company.
 *
 * A company is payout-eligible only when ALL of the following hold -
 * reusing Module 18's own CompanyVerification/CompanyProfile state
 * exactly, never a second/parallel verification concept:
 *   1. The company's active CompanyVerification case is APPROVED
 *      (company-verification-rules.ts's own canReceivePayouts - mirrors
 *      the professional predicate above exactly).
 *   2. CompanyProfile.status === "ACTIVE" (isCompanyDiscoverable - the
 *      same "company activation" condition that already gates public
 *      discoverability/new work).
 *   3. A CompanyPayoutAccount exists for the company and is not REJECTED
 *      (isPayoutAccountConnected, reused unchanged from
 *      professional-onboarding-rules.ts).
 */
export class CheckPayoutEligibilityUseCase {
  constructor(
    private readonly verifications: ProfessionalVerificationRepository,
    private readonly companyVerifications?: CompanyVerificationRepository,
    private readonly companies?: CompanyRepository,
    private readonly companyPayoutAccounts?: CompanyPayoutAccountRepository,
  ) {}

  async execute(professionalProfileId: string): Promise<PayoutEligibility> {
    const verification = await this.verifications.findActiveByProfessionalProfileId(professionalProfileId);

    if (!verification) {
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

  /** Module 75 - Company Payout Eligibility. See this class's own doc
   *  comment for the exact three conditions this checks. */
  async executeForCompany(companyProfileId: string): Promise<PayoutEligibility> {
    if (!this.companyVerifications || !this.companies || !this.companyPayoutAccounts) {
      throw new Error(
        "CheckPayoutEligibilityUseCase.executeForCompany requires companyVerifications/companies/companyPayoutAccounts to be configured - see this class's own doc comment.",
      );
    }

    const verification = await this.companyVerifications.findActiveByCompanyProfileId(companyProfileId);
    if (!verification) {
      return {
        eligible: false,
        status: "NOT_STARTED",
        reason: "This company has not started business verification.",
      };
    }

    if (!canCompanyReceivePayouts(verification.status)) {
      return {
        eligible: false,
        status: verification.status,
        reason: `Business verification is not approved (current status: ${verification.status}).`,
      };
    }

    const company = await this.companies.findById(companyProfileId);
    if (!company || !isCompanyDiscoverable(company.status)) {
      return {
        eligible: false,
        status: verification.status,
        reason: `This company is not active (current status: ${company?.status ?? "UNKNOWN"}).`,
      };
    }

    const payoutAccount = await this.companyPayoutAccounts.findByCompanyProfileId(companyProfileId);
    if (!payoutAccount || !isPayoutAccountConnected(payoutAccount.status)) {
      return {
        eligible: false,
        status: verification.status,
        reason: payoutAccount
          ? `This company's payout destination was rejected (status: ${payoutAccount.status}).`
          : "This company has not added a payout destination yet.",
      };
    }

    return {
      eligible: true,
      status: verification.status,
      reason: "Business verification is approved, the company is active, and a payout destination is connected.",
    };
  }
}
