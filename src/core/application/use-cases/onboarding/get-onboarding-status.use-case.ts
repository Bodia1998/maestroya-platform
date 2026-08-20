import { ValidationError } from "@/domain/errors/domain-error";
import {
  type OnboardingProgress,
  computeOnboardingProgress,
} from "@/domain/services/professional-onboarding-rules";
import type { AddressRepository } from "@/domain/repositories/address-repository";
import type { ConsentRepository } from "@/domain/repositories/consent-repository";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type { ProfessionalVerificationRepository } from "@/domain/repositories/professional-verification-repository";
import type {
  ProfessionalOnboardingRecord,
  ProfessionalOnboardingRepository,
  ProfessionalPayoutAccountRecord,
} from "@/domain/repositories/professional-onboarding-repository";

export interface OnboardingStatusResult {
  onboarding: ProfessionalOnboardingRecord | null;
  progress: OnboardingProgress;
  payoutAccount: ProfessionalPayoutAccountRecord | null;
  /** Module 59's own status string, surfaced as-is (`"UNVERIFIED"` when no
   *  case has ever been opened) — see that module's doc comment on why
   *  this module never re-derives "is this professional verified" itself. */
  identityVerificationStatus: string | null;
}

/**
 * Module 62 — Professional Onboarding.
 *
 * Read-model aggregation: pulls the current state of every onboarding
 * requirement from the module that actually owns it — Module 38 (`Consent`)
 * for terms/privacy, Module 17/59 (`ProfessionalVerificationRepository`)
 * for identity, `ProfessionalRepository`/`AddressRepository` for profile
 * completeness, this module's own `ProfessionalOnboardingRepository` for
 * the payout destination — and folds them through the single pure
 * `computeOnboardingProgress` function so this is the *only* place that
 * assembly happens. `ValidateProfessionalActivationUseCase` and
 * `ActivateProfessionalUseCase` both call this rather than re-querying the
 * same five repositories themselves, so "what does 'onboarding complete'
 * mean" can never drift between a status page and the actual activation
 * gate.
 */
export class GetOnboardingStatusUseCase {
  constructor(
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly addresses: AddressRepository,
    private readonly consents: ConsentRepository,
    private readonly verifications: ProfessionalVerificationRepository,
  ) {}

  async execute(userId: string): Promise<OnboardingStatusResult> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("Complete your professional profile before checking onboarding status.");
    }

    const [onboarding, payoutAccount, termsConsent, privacyConsent, activeVerification, primaryAddress] =
      await Promise.all([
        this.onboardings.findByProfessionalProfileId(professional.id),
        this.onboardings.findPayoutAccountByProfessionalProfileId(professional.id),
        this.consents.findActiveByUserAndType(userId, "TERMS_OF_SERVICE"),
        this.consents.findActiveByUserAndType(userId, "PRIVACY_POLICY"),
        // Module 74 — Business Registration Enforcement: needs the case's
        // documents (not just its status) to evaluate
        // BUSINESS_REGISTRATION_VERIFIED — same repository method the
        // professional's own verification dashboard already uses.
        this.verifications.findActiveWithDocumentsByProfessionalProfileId(professional.id),
        this.addresses.findPrimaryByUserId(userId),
      ]);

    const progress = computeOnboardingProgress({
      termsAccepted: termsConsent !== null,
      privacyPolicyAccepted: privacyConsent !== null,
      identityVerificationStatus: activeVerification?.status ?? null,
      verificationDocumentTypes: activeVerification?.documents.map((d) => d.type) ?? [],
      profile: {
        businessName: professional.businessName,
        bio: professional.bio,
        contactPhone: professional.contactPhone,
        serviceRadiusKm: professional.serviceRadiusKm,
        yearsExperience: professional.yearsExperience,
        categoryIds: professional.categoryIds,
        hasPrimaryAddress: primaryAddress !== null,
      },
      payoutAccountStatus: payoutAccount?.status ?? null,
    });

    return {
      onboarding,
      progress,
      payoutAccount,
      identityVerificationStatus: activeVerification?.status ?? professional.verificationStatus,
    };
  }
}
