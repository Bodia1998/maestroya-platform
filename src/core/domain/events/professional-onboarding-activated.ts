import { DomainEvent } from "@/domain/events/domain-event";

/**
 * Module 62 — Professional Onboarding.
 *
 * Raised exactly once per professional, by `ActivateProfessionalUseCase`,
 * the instant every onboarding requirement (terms, privacy policy,
 * identity verification, profile completeness, payout destination) has
 * been satisfied. Follows the same shape `ProfessionalVerificationStatusChanged`
 * (Module 37) established: this is "several unrelated reactions to one
 * business fact" (write an audit-log entry today; a future module can
 * subscribe to unlock booking/payout eligibility without this module ever
 * needing to know that consumer exists — see `EventBus`'s own doc comment).
 */
export class ProfessionalOnboardingActivated extends DomainEvent {
  static readonly eventName = "professional-onboarding.activated";

  constructor(
    readonly onboardingId: string,
    readonly professionalProfileId: string,
    readonly userId: string,
    readonly activatedAt: Date,
  ) {
    super();
  }
}
