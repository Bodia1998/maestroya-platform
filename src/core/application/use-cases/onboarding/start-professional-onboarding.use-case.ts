import { ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalOnboardingRecord,
  ProfessionalOnboardingRepository,
} from "@/domain/repositories/professional-onboarding-repository";

/**
 * Module 62 — Professional Onboarding.
 *
 * Get-or-create entry point: opens (or returns the existing) `IN_PROGRESS`
 * onboarding record for the authenticated professional. Requires an
 * existing `ProfessionalProfile` — this module does not create one (that
 * remains `CompleteProfessionalOnboardingUseCase`'s job, `application/use-
 * cases/professional/`, the flow a user goes through right after choosing
 * "Soy profesional" at signup). This use case is the *next* step: the
 * compliance/activation flow a professional with a profile already
 * completes before they can receive bookings/payouts.
 *
 * Idempotent by design — calling this on every visit to an onboarding
 * dashboard is expected and safe; it never creates a second record for the
 * same profile.
 */
export class StartProfessionalOnboardingUseCase {
  constructor(
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly professionals: ProfessionalRepository,
  ) {}

  async execute(userId: string): Promise<ProfessionalOnboardingRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError(
        "Complete your professional profile before starting onboarding.",
      );
    }

    const existing = await this.onboardings.findByProfessionalProfileId(professional.id);
    if (existing) return existing;

    return this.onboardings.create(professional.id);
  }
}
