import { ValidationError } from "@/domain/errors/domain-error";
import { ProfessionalOnboardingActivated } from "@/domain/events/professional-onboarding-activated";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import type {
  ProfessionalOnboardingRecord,
  ProfessionalOnboardingRepository,
} from "@/domain/repositories/professional-onboarding-repository";
import type { EventBus } from "@/application/ports/event-bus";
import { EventDispatchError } from "@/application/ports/event-dispatch-error";
import { type FailureReporter, NullFailureReporter } from "@/application/ports/failure-reporter";
import type { GetOnboardingStatusUseCase } from "@/application/use-cases/onboarding/get-onboarding-status.use-case";
import type { ValidateProfessionalActivationUseCase } from "@/application/use-cases/onboarding/validate-professional-activation.use-case";

/**
 * Module 62 — Professional Onboarding, Step 7 (Final Activation).
 *
 * A professional becomes ACTIVE only if every onboarding requirement has
 * been satisfied — enforced here by re-running
 * `ValidateProfessionalActivationUseCase` (never trusting a client's claim
 * that onboarding is complete) and throwing `ValidationError` listing
 * every unmet step if it isn't. No shortcuts: this is the single place
 * `ProfessionalOnboarding.status` is ever written to `ACTIVATED`.
 *
 * Idempotent: activating an already-ACTIVATED record is a no-op that
 * returns the existing record without re-publishing
 * `ProfessionalOnboardingActivated` — an activation event should fire
 * exactly once per professional, not once per redundant client call.
 */
export class ActivateProfessionalUseCase {
  constructor(
    private readonly onboardings: ProfessionalOnboardingRepository,
    private readonly professionals: ProfessionalRepository,
    private readonly getOnboardingStatus: GetOnboardingStatusUseCase,
    private readonly validateActivation: ValidateProfessionalActivationUseCase,
    private readonly eventBus: EventBus,
    private readonly failureReporter: FailureReporter = new NullFailureReporter(),
  ) {}

  async execute(userId: string): Promise<ProfessionalOnboardingRecord> {
    const professional = await this.professionals.findByUserId(userId);
    if (!professional) {
      throw new ValidationError("Complete your professional profile before activating your account.");
    }

    const { onboarding } = await this.getOnboardingStatus.execute(userId);
    if (!onboarding) {
      throw new ValidationError("Start onboarding before activating your account.");
    }

    if (onboarding.status === "ACTIVATED") return onboarding;

    const { eligible, missingSteps } = await this.validateActivation.execute(userId);
    if (!eligible) {
      throw new ValidationError(
        `Onboarding is not yet complete. Remaining steps: ${missingSteps.join("; ")}.`,
      );
    }

    const activatedAt = new Date();
    const activated = await this.onboardings.activate(onboarding.id, activatedAt);

    try {
      await this.eventBus.publishAll([
        new ProfessionalOnboardingActivated(activated.id, activated.professionalProfileId, userId, activatedAt),
      ]);
    } catch (error) {
      if (!(error instanceof EventDispatchError)) throw error;
      this.failureReporter.report(error, { event: error.eventName, eventId: error.eventId });
    }

    return activated;
  }
}
