import { ONBOARDING_STEP_LABELS } from "@/domain/services/professional-onboarding-rules";
import type { GetOnboardingStatusUseCase } from "@/application/use-cases/onboarding/get-onboarding-status.use-case";

export interface ActivationValidationResult {
  eligible: boolean;
  /** Human-readable labels for every unmet requirement, in the fixed
   *  `ONBOARDING_STEP_VALUES` order — empty when `eligible` is `true`. */
  missingSteps: string[];
}

/**
 * Module 62 — Professional Onboarding.
 *
 * Pure read-only check: "would activation succeed right now?" — reuses
 * `GetOnboardingStatusUseCase` (and, through it,
 * `computeOnboardingProgress`) rather than re-deriving eligibility, so this
 * can never disagree with what a status page shows or what
 * `ActivateProfessionalUseCase` actually enforces. Deliberately has no
 * side effects — a UI can poll this freely (e.g. to enable/disable an
 * "Activate" button) without it ever mutating onboarding state.
 */
export class ValidateProfessionalActivationUseCase {
  constructor(private readonly getOnboardingStatus: GetOnboardingStatusUseCase) {}

  async execute(userId: string): Promise<ActivationValidationResult> {
    const { progress } = await this.getOnboardingStatus.execute(userId);

    const missingSteps = progress.steps.filter((s) => !s.complete).map((s) => ONBOARDING_STEP_LABELS[s.step]);

    return { eligible: progress.isEligibleForActivation, missingSteps };
  }
}
